/**
 * Agent discovery - finds available subagents for chain building.
 *
 * Adapted from the official subagent extension.
 * Searches ~/.pi/agent/agents/*.md and .pi/agents/*.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// In-memory cache for agent discovery (TTL-based to pick up file changes)
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  ts: number;
}

/** Cache TTL in ms. Short enough to reflect edits, long enough to avoid
 *  redundant disk I/O during a single /chain session. */
const AGENT_CACHE_TTL_MS = 30_000;

const discoverCache = new Map<string, CacheEntry<AgentConfig[]>>();

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
  const agents: AgentConfig[] = [];

  if (!fs.existsSync(dir)) {
    return agents;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return agents;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    let frontmatter: Record<string, string>;
    let body: string;
    try {
      const parsed = parseFrontmatter<Record<string, string>>(content);
      frontmatter = parsed.frontmatter;
      body = parsed.body;
    } catch {
      // Invalid frontmatter (malformed YAML, etc.) — skip this agent file
      continue;
    }

    if (!frontmatter.name || !frontmatter.description) {
      continue;
    }

    const tools = frontmatter.tools
      ?.split(",")
      .map((t: string) => t.trim())
      .filter(Boolean);

    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: tools && tools.length > 0 ? tools : undefined,
      model: frontmatter.model,
      systemPrompt: body,
      source,
      filePath,
    });
  }

  return agents;
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, ".pi", "agents");
    if (isDirectory(candidate)) return candidate;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

export function discoverAgents(cwd: string): AgentConfig[] {
  // Clean up expired cache entries to prevent unbounded memory growth
  // when pi runs for a long time across many working directories.
  const now = Date.now();
  for (const [key, entry] of discoverCache) {
    if (now - entry.ts >= AGENT_CACHE_TTL_MS) discoverCache.delete(key);
  }

  // Return cached result if still fresh (TTL-based invalidation)
  const cached = discoverCache.get(cwd);
  if (cached && now - cached.ts < AGENT_CACHE_TTL_MS) {
    return cached.data;
  }

  const userDir = path.join(getAgentDir(), "agents");
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);

  const userAgents = loadAgentsFromDir(userDir, "user");
  const projectAgents = projectAgentsDir ? loadAgentsFromDir(projectAgentsDir, "project") : [];

  // Merge: project overrides user (same name)
  const agentMap = new Map<string, AgentConfig>();
  for (const agent of userAgents) agentMap.set(agent.name, agent);
  for (const agent of projectAgents) agentMap.set(agent.name, agent);

  const result = Array.from(agentMap.values());
  discoverCache.set(cwd, { data: result, ts: Date.now() });
  return result;
}

/**
 * Parse a model string like "anthropic/claude-sonnet-4-5" into { provider, id }.
 * For provider-less strings (e.g. "claude-sonnet-4-5"), returns the ID with an
 * empty provider string so downstream code can resolve it against the model registry.
 * Returns null only for empty/whitespace strings.
 */
export function parseModelString(modelStr: string): { provider: string; id: string } | null {
  const trimmed = modelStr.trim();
  if (!trimmed) return null;
  const slashIdx = trimmed.indexOf("/");
  if (slashIdx > 0) {
    return {
      provider: trimmed.slice(0, slashIdx),
      id: trimmed.slice(slashIdx + 1),
    };
  }
  // No provider prefix - return ID with empty provider (resolved at runtime)
  return { provider: "", id: trimmed };
}

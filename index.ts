/**
 * pi-chain Extension
 *
 * Allows users to sequentially select self-created subagents and execute them
 * in a single, ordered chain flow. Chains are persisted across sessions.
 *
 * Command: /chain
 *
 * Features:
 *   - Create chain: 3-step wizard (select agents → configure model/effort → name)
 *   - Run chain: select chain, input requirement with @ file references, task distribution, execute
 *   - List chain: view all created chains
 *   - Delete chain: remove a chain
 *   - Settings: configure task distribution & summarization models
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  abortChainExecution,
  getActiveExecution,
  handleChainAgentEnd,
  isChainRunning,
  startChainExecution,
} from "./execution";
import { getSettings } from "./storage";
import { MSG, type ThinkingLevel, type ModelRef } from "./types";
import {
  createChainFlow,
  deleteChainFlow,
  listChainsFlow,
  reviewAndModifyTasks,
  selectChainAndInputRequirement,
  settingsFlow,
  showMainMenu,
} from "./ui";
import { distributeTasks } from "./utils";
import { discoverAgents } from "./agents";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a ModelRef to an actual Model instance from the registry.
 *  Handles both provider-ful ("anthropic/claude-sonnet") and provider-less
 *  ("claude-sonnet") references consistently. */
function resolveModel(ctx: ExtensionContext, ref: ModelRef): Model<Api> | undefined {
  if (ref.provider) {
    return ctx.modelRegistry.find(ref.provider, ref.id);
  }
  // Provider-less: search by ID across all registered providers
  return ctx.modelRegistry.getAll().find((m) => m.id === ref.id);
}

// ---------------------------------------------------------------------------
// Run Chain - Full Flow (orchestrates UI + task distribution + execution)
// ---------------------------------------------------------------------------

async function runChainFlowOrchestrator(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const input = await selectChainAndInputRequirement(ctx);
  if (input.cancelled) return;

  ctx.ui.notify("Distributing tasks...", "info");
  ctx.ui.setStatus("pi-chain", "Analyzing requirement & distributing tasks...");
  const settings = getSettings();
  const distResult = await distributeTasks(ctx, input.chain, input.requirement, settings);
  ctx.ui.setStatus("pi-chain", "");

  if (distResult.error) {
    ctx.ui.notify(`Task distribution failed: ${distResult.error}`, "error");
    const proceed = await ctx.ui.confirm(
      "Distribution failed",
      "Continue with simple sequential tasks (each agent gets the full requirement)?",
    );
    if (!proceed) return;
    ctx.ui.notify(
      "Using fallback task distribution — each agent receives the same requirement. Results may be less focused.",
      "warning",
    );
    // Build a fallback task for each step that mentions the agent's role
    // and includes the previous step's expected output so subagents have
    // better context even without proper distribution.
    const agents = discoverAgents(ctx.cwd);
    const agentMap = new Map(agents.map((a) => [a.name, a]));
    distResult.tasks = input.chain.steps.map((s, i) => {
      const agent = agentMap.get(s.agentName);
      const roleHint = agent?.description ? ` (${agent.description})` : "";
      const prevHint = i > 0
        ? `\n\nThe previous step was handled by "${input.chain.steps[i - 1].agentName}". Use its output to inform your work.`
        : "";
      return {
        stepIndex: i,
        agentName: s.agentName,
        task: `You are step ${i + 1} of ${input.chain.steps.length} in a chain${roleHint}.${prevHint}\n\nProcess the following requirement:\n\n${input.requirement}`,
      };
    });
  }

  const reviewResult = await reviewAndModifyTasks(ctx, input.chain, distResult.tasks);
  if (reviewResult.cancelled) { ctx.ui.notify("Chain execution cancelled", "info"); return; }

  try {
    startChainExecution(pi, ctx, input.chain, reviewResult.tasks, input.requirement, input.cleanup);
  } catch (err) {
    ctx.ui.notify(`Failed to start chain: ${(err as Error).message}`, "error");
    ctx.ui.setStatus("pi-chain", "");
  }
}

// ---------------------------------------------------------------------------
// Extension Entry Point
// ---------------------------------------------------------------------------

export default function piChainExtension(pi: ExtensionAPI) {
  pi.registerCommand("chain", {
    description: "Build and execute sequential subagent chains",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("pi-chain requires interactive mode", "warning");
        return;
      }

      // Loop: return to main menu after each operation.
      // The loop terminates when the user presses Esc (showMainMenu returns null)
      // or when a chain starts executing (chain runs async in the main session).
      let menuOpen = true;
      while (menuOpen) {
        // Don't show menu while a chain is running — the chain owns the main session
        if (isChainRunning()) { menuOpen = false; break; }

        const action = await showMainMenu(ctx);
        if (!action) { menuOpen = false; break; }

        switch (action) {
          case "create": await createChainFlow(ctx); break;
          case "run": await runChainFlowOrchestrator(pi, ctx); break;
          case "list": await listChainsFlow(ctx); break;
          case "delete": await deleteChainFlow(ctx); break;
          case "settings": await settingsFlow(ctx); break;
          default: break;
        }
        // After "run" starts a chain, break out so the user sees the main session
        if (action === "run" && isChainRunning()) { menuOpen = false; break; }
        // Loop back to main menu for non-run actions
      }
    },
  });

  // /chain-abort: cancel a running chain execution
  pi.registerCommand("chain-abort", {
    description: "Abort the currently running chain execution",
    handler: async (_args, ctx) => {
      const exec = getActiveExecution();
      if (!exec) {
        ctx.ui.notify("No chain is currently running.", "info");
        return;
      }
      const confirmed = await ctx.ui.confirm(
        "Abort chain?",
        `Abort "${exec.chain.name}" at step ${exec.currentStepIndex + 1}/${exec.chain.steps.length}?`,
      );
      if (confirmed) {
        abortChainExecution(pi, "Aborted by user");
      }
    },
  });

  // before_agent_start: inject chain step configuration (model, effort, tools)
  pi.on("before_agent_start", async (_event, ctx) => {
    const exec = getActiveExecution();
    if (!exec) return;

    const { chain, currentStepIndex, agentTools } = exec;
    if (currentStepIndex >= chain.steps.length) return;

    const step = chain.steps[currentStepIndex];

    // Set tools from agent config
    const tools = agentTools.get(step.agentName);
    if (tools) {
      const allToolNames = pi.getAllTools().map((t) => t.name);
      const validTools = tools.filter((t) => allToolNames.includes(t));
      if (validTools.length > 0) pi.setActiveTools(validTools);
    }

    // Set model if configured
    if (step.model) {
      const model = resolveModel(ctx, step.model);
      if (model) {
        await pi.setModel(model);
      } else {
        const modelKey = step.model.provider ? `${step.model.provider}/${step.model.id}` : step.model.id;
        ctx.ui.notify(
          `Model "${modelKey}" for "${step.agentName}" not found in registered providers. Using current model.`,
          "warning",
        );
      }
    }

    // Set effort if configured
    if (step.effort) pi.setThinkingLevel(step.effort);
  });

  // agent_end: handle multi-turn chain step advancement.
  // Error recovery (skip-step on failure) is handled internally by handleChainAgentEnd.
  pi.on("agent_end", async (_event, ctx) => {
    if (!getActiveExecution()) return;
    await handleChainAgentEnd(pi, ctx);
  });

  // Message renderers
  pi.registerMessageRenderer(MSG.CHAIN_START, (message, _options, theme) => {
    return new Text(theme.fg("accent", `⛓ ${message.content}`), 0, 0);
  });

  pi.registerMessageRenderer(MSG.STEP_DONE, (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : "";
    return new Text(theme.fg("success", `✓ ${content}`), 0, 0);
  });

  pi.registerMessageRenderer(MSG.WAITING, (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : "";
    return new Text(theme.fg("warning", content), 0, 0);
  });

  pi.registerMessageRenderer(MSG.ERROR, (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : "";
    return new Text(theme.fg("error", content), 0, 0);
  });

  pi.registerMessageRenderer(MSG.ABORTED, (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : "";
    return new Text(theme.fg("error", theme.bold(content)), 0, 0);
  });

  pi.registerMessageRenderer(MSG.COMPLETE, (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : "";
    return new Text(theme.fg("success", theme.bold(content)), 0, 0);
  });
}

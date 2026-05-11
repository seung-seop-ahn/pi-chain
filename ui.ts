/**
 * pi-chain UI components
 *
 * All TUI dialogs, menus, and interactive flows for the pi-chain extension.
 * Uses @earendil-works/pi-tui for rendering and keyboard input.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
  Container,
  Key,
  matchesKey,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { discoverAgents, parseModelString, type AgentConfig } from "./agents";
import { deleteChain, getAllChains, getChain, getSettings, saveChain, saveSettings } from "./storage";
import type { ChainConfig, ChainStep, DistributedTask, ModelRef, ThinkingLevel } from "./types";
import {
  DEFAULT_EFFORT,
  EFFORT_LEVELS,
  FILE_PICKER_WINDOW,
  FILE_SEARCH_DEBOUNCE_MS,
  formatModel,
  getAvailableModels,
  MODEL_PICKER_WINDOW,
  MODEL_SEARCH_VISIBLE_ITEMS,
  searchFiles,
  searchModels,
  SETTINGS_MODEL_VISIBLE_ITEMS,
  SETTINGS_MODEL_WINDOW,
} from "./utils";

// ---------------------------------------------------------------------------
// Types for UI flows
// ---------------------------------------------------------------------------

export interface SelectionResult {
  agents: AgentConfig[];
  cancelled: boolean;
}

export interface ConfiguredStep {
  agent: AgentConfig;
  model?: ModelRef;
  effort?: ThinkingLevel;
}

export interface RunChainInput {
  chain: ChainConfig;
  requirement: string;
  cleanup: boolean;
  cancelled: boolean;
}

// ---------------------------------------------------------------------------
// Main Menu (overlay)
// ---------------------------------------------------------------------------

export async function showMainMenu(ctx: ExtensionContext): Promise<string | null> {
  const items: SelectItem[] = [
    { value: "create", label: "Create chain", description: "Build a new chain from available subagents" },
    { value: "run", label: "Run chain", description: "Execute a chain with your requirements" },
    { value: "list", label: "List chain", description: "View all created chains" },
    { value: "delete", label: "Delete chain", description: "Remove a chain" },
    { value: "settings", label: "Settings", description: "Configure task distribution & summarization models" },
  ];

  return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(new Text(theme.fg("accent", theme.bold(" ⛓  pi-chain")), 1, 0));
    container.addChild(new Text(theme.fg("muted", " Sequential subagent chain executor"), 1, 0));
    container.addChild(new Spacer(1));

    const selectList = new SelectList(items, items.length, {
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
      noMatch: (t) => theme.fg("warning", t),
    });
    selectList.onSelect = (item) => done(item.value);
    selectList.onCancel = () => done(null);
    container.addChild(selectList);

    container.addChild(new Text(theme.fg("dim", " arrow-keys navigate • enter select • esc back"), 1, 0));
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

    return {
      render: (w: number) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => { selectList.handleInput(data); tui.requestRender(); },
    };
  });
}

// ---------------------------------------------------------------------------
// Create Chain - Step 1: Subagent Selection
// ---------------------------------------------------------------------------

export async function selectSubagents(ctx: ExtensionContext): Promise<SelectionResult> {
  const allAgents = discoverAgents(ctx.cwd);

  if (allAgents.length === 0) {
    ctx.ui.notify(
      "No subagents found. Create agent files in ~/.pi/agent/agents/*.md or .pi/agents/*.md",
      "warning",
    );
    return { agents: [], cancelled: true };
  }

  return ctx.ui.custom<SelectionResult>((tui, theme, _kb, done) => {
    let optionIndex = 0;
    const selectedOrder = new Map<string, number>();
    let selectionCounter = 0;
    let cachedLines: string[] | undefined;
    let noSelectionWarning = false;
    const agents = allAgents;

    function refresh() { cachedLines = undefined; tui.requestRender(); }

    function getChainPreview(): string {
      if (selectedOrder.size === 0) return theme.fg("muted", "(no agents selected)");
      const ordered = Array.from(selectedOrder.entries())
        .sort(([, a], [, b]) => a - b)
        .map(([name]) => name);
      return ordered.map((n) => theme.fg("accent", n)).join(theme.fg("dim", " → "));
    }

    function handleInput(data: string) {
      if (matchesKey(data, Key.up)) { optionIndex = Math.max(0, optionIndex - 1); noSelectionWarning = false; refresh(); return; }
      if (matchesKey(data, Key.down)) { optionIndex = Math.min(agents.length - 1, optionIndex + 1); noSelectionWarning = false; refresh(); return; }
      if (matchesKey(data, Key.space)) {
        noSelectionWarning = false;
        const agent = agents[optionIndex];
        if (agent == null) return;
        if (selectedOrder.has(agent.name)) {
          const removedOrder = selectedOrder.get(agent.name);
          if (removedOrder != null) {
            selectedOrder.delete(agent.name);
            for (const [name, order] of selectedOrder) {
              if (order > removedOrder) selectedOrder.set(name, order - 1);
            }
            selectionCounter--;
          }
        } else {
          selectionCounter++;
          selectedOrder.set(agent.name, selectionCounter);
        }
        refresh(); return;
      }
      if (matchesKey(data, Key.enter)) {
        if (selectedOrder.size === 0) {
          noSelectionWarning = true;
          refresh(); return;
        }
        const ordered = Array.from(selectedOrder.entries())
          .sort(([, a], [, b]) => a - b)
          .map(([name]) => agents.find((a) => a.name === name))
          .filter((a): a is AgentConfig => a != null);
        done({ agents: ordered, cancelled: false }); return;
      }
      if (matchesKey(data, Key.escape)) { done({ agents: [], cancelled: true }); }
    }

    function render(width: number): string[] {
      if (cachedLines) return cachedLines;
      const lines: string[] = [];
      const add = (s: string) => lines.push(truncateToWidth(s, width));
      add(theme.fg("accent", "─".repeat(width)));
      add(theme.fg("accent", theme.bold(" Chain Preview:")));
      add(` ${getChainPreview()}`);
      lines.push("");
      add(theme.fg("accent", theme.bold(" Select Subagents:")));
      add(theme.fg("dim", " Space to select • order = execution order"));
      lines.push("");
      for (let i = 0; i < agents.length; i++) {
        const agent = agents[i];
        const isSelected = selectedOrder.has(agent.name);
        const isFocused = i === optionIndex;
        const order = selectedOrder.get(agent.name);
        const prefix = isFocused ? theme.fg("accent", ">") : " ";
        const marker = isSelected ? theme.fg("success", ` #${order}`) : theme.fg("dim", "   ");
        const nameStyle = isSelected ? "accent" : isFocused ? "text" : "muted";
        add(`${prefix}${marker} ${theme.fg(nameStyle, agent.name)}  ${theme.fg("dim", `[${agent.source}]`)}`);
        add(`      ${theme.fg("muted", agent.description)}`);
      }
      lines.push("");
      if (noSelectionWarning) {
        add(theme.fg("warning", " ⚠ Select at least one subagent before pressing Enter"));
      }
      add(theme.fg("dim", " arrow-keys navigate • space toggle • enter confirm • esc cancel"));
      add(theme.fg("accent", "─".repeat(width)));
      cachedLines = lines;
      return lines;
    }

    return { render, invalidate: () => { cachedLines = undefined; }, handleInput };
  });
}

// ---------------------------------------------------------------------------
// Create Chain - Step 2: Model & Effort Assignment
// ---------------------------------------------------------------------------

export async function configureModelEffort(
  ctx: ExtensionContext,
  selectedAgents: AgentConfig[],
): Promise<{ steps: ConfiguredStep[]; cancelled: boolean }> {
  const steps: ConfiguredStep[] = selectedAgents.map((agent) => ({ agent }));
  for (const step of steps) {
    if (step.agent.model) {
      const parsed = parseModelString(step.agent.model);
      if (parsed) step.model = parsed;
    }
  }

  // Track which agents have been explicitly configured
  const configured = new Set<number>();
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].model || steps[i].effort) configured.add(i);
  }

  // Step 2a: Show list of all subagents, select one to configure
  let selecting = true;
  while (selecting) {
    const listResult = await showAgentList(ctx, steps, configured);
    if (listResult === null) return { steps: [], cancelled: true };
    if (listResult === "done") {
      // All subagents must be configured before advancing
      if (configured.size < steps.length) {
        ctx.ui.notify(
          `Configure all subagents before finishing (${configured.size}/${steps.length} done). Press Enter on each to set Model & Effort.`,
          "warning",
        );
        continue;
      }
      return { steps, cancelled: false };
    }
    // listResult is an index into steps to configure
    const configResult = await showAgentConfig(ctx, steps[listResult], listResult, steps.length);
    if (configResult !== null) {
      configured.add(listResult);
    }
    // Esc from config → stay in list (continue loop)
  }
  return { steps: [], cancelled: true }; // unreachable, satisfies TypeScript
}

/** Show list of all selected agents. User picks one to configure or Done. */
async function showAgentList(
  ctx: ExtensionContext,
  steps: ConfiguredStep[],
  configured: Set<number>,
): Promise<number | "done" | null> {
  return ctx.ui.custom<number | "done" | null>((tui, theme, _kb, done) => {
    let cursorIdx = 0;
    let cachedLines: string[] | undefined;
    const totalSteps = steps.length;
    // Menu items: each agent + Done at the end
    const totalItems = totalSteps + 1; // +1 for Done

    function refresh() { cachedLines = undefined; tui.requestRender(); }

    function handleInput(data: string) {
      if (matchesKey(data, Key.up)) { cursorIdx = Math.max(0, cursorIdx - 1); refresh(); return; }
      if (matchesKey(data, Key.down)) { cursorIdx = Math.min(totalItems - 1, cursorIdx + 1); refresh(); return; }
      if (matchesKey(data, Key.escape)) { done(null); return; }
      if (matchesKey(data, Key.enter)) {
        if (cursorIdx < totalSteps) { done(cursorIdx); return; }
        done("done"); return;
      }
    }

    function render(width: number): string[] {
      if (cachedLines) return cachedLines;
      const lines: string[] = [];
      const add = (s: string) => lines.push(truncateToWidth(s, width));
      add(theme.fg("accent", "─".repeat(width)));
      add(theme.fg("accent", theme.bold(" Configure Model & Effort")));
      add(theme.fg("muted", " Select an agent to configure, or Done to finish"));
      lines.push("");

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const isSelected = i === cursorIdx;
        const isConfigured = configured.has(i);
        const prefix = isSelected ? theme.fg("accent", ">") : " ";
        const marker = isConfigured ? theme.fg("success", " ✓") : theme.fg("dim", "   ");
        const nameStyle = isSelected ? "accent" : "text";
        const modelStr = step.model ? ` [${formatModel(step.model)}]` : "";
        const effortStr = step.effort && step.effort !== DEFAULT_EFFORT ? ` effort:${step.effort}` : "";
        add(`${prefix}${marker} ${theme.fg(nameStyle, `${i + 1}. ${step.agent.name}`)}${theme.fg("muted", modelStr + effortStr)}`);
      }

      lines.push("");
      const isDoneSelected = cursorIdx === totalSteps;
      const donePrefix = isDoneSelected ? theme.fg("accent", ">") : " ";
      add(`${donePrefix} ${isDoneSelected ? theme.fg("accent", "Done") : theme.fg("text", "Done")}`);
      lines.push("");
      add(theme.fg("dim", " arrow-keys navigate • enter configure/advance • esc cancel"));
      add(theme.fg("accent", "─".repeat(width)));
      cachedLines = lines;
      return lines;
    }

    return { render, invalidate: () => { cachedLines = undefined; }, handleInput };
  });
}

/** Configure Model & Effort for a single agent, then return to the list.
 *  Opens sub-menus for Model selection (pickModel) and Effort cycling.
 *  Returns true in all non-error paths (back to list, step is configured). */
async function showAgentConfig(
  ctx: ExtensionContext,
  step: ConfiguredStep,
  index: number,
  total: number,
): Promise<boolean | null> {
  const titleBase = `Step ${index + 1}/${total}: ${step.agent.name}`;

  while (true) {
    const action = await showAgentConfigMenu(ctx, step, titleBase);
    if (action === null) return true; // User pressed Esc → back to list (same as "back")
    if (action === "back") return true; // "Back to list" selected

    if (action === "model") {
      const model = await pickModel(ctx, `${titleBase} — Model`);
      if (model) step.model = model;
      // Continue loop → back to menu
    } else if (action === "effort") {
      const currentIdx = EFFORT_LEVELS.indexOf((step.effort || DEFAULT_EFFORT) as ThinkingLevel);
      step.effort = EFFORT_LEVELS[(currentIdx + 1) % EFFORT_LEVELS.length];
      // Continue loop → back to menu
    }
  }
}

/** Single-agent configuration menu (Model / Effort / Back to list).
 *  Returns the selected action, or null when the user cancels with Esc. */
async function showAgentConfigMenu(
  ctx: ExtensionContext,
  step: ConfiguredStep,
  title: string,
): Promise<"model" | "effort" | "back" | null> {
  return ctx.ui.custom<"model" | "effort" | "back" | null>((tui, theme, _kb, done) => {
    let menuIndex = 0;
    let cachedLines: string[] | undefined;

    function refresh() { cachedLines = undefined; tui.requestRender(); }
    function getCurrentEffort(): string { return step.effort || DEFAULT_EFFORT; }

    function handleInput(data: string) {
      const menuItems = ["model", "effort", "back"] as const;
      if (matchesKey(data, Key.up)) { menuIndex = Math.max(0, menuIndex - 1); refresh(); return; }
      if (matchesKey(data, Key.down)) { menuIndex = Math.min(menuItems.length - 1, menuIndex + 1); refresh(); return; }
      if (matchesKey(data, Key.escape)) { done(null); return; }
      if (matchesKey(data, Key.enter)) {
        const selected = menuItems[menuIndex];
        if (selected === "model") { done("model"); }
        else if (selected === "effort") { done("effort"); }
        else if (selected === "back") { done("back"); }
      }
    }

    function render(width: number): string[] {
      if (cachedLines) return cachedLines;
      const lines: string[] = [];
      const add = (s: string) => lines.push(truncateToWidth(s, width));
      add(theme.fg("accent", "─".repeat(width)));
      add(theme.fg("accent", theme.bold(` ${title}`)));
      if (step.agent.tools) add(theme.fg("dim", ` Tools: ${step.agent.tools.join(", ")}`));
      if (step.agent.model) add(theme.fg("dim", ` Default model: ${step.agent.model}`));
      lines.push("");

      const modelDisplay = step.model ? theme.fg("success", formatModel(step.model)) : theme.fg("muted", "(current)");
      const effortDisplay = theme.fg("success", getCurrentEffort());
      add(theme.fg("accent", theme.bold(" Configuration:")));
      lines.push("");

      const labels = [` Model: ${modelDisplay}`, ` Effort: ${effortDisplay}`, " Back to list"];
      for (let i = 0; i < labels.length; i++) {
        const isSelected = i === menuIndex;
        const prefix = isSelected ? theme.fg("accent", ">") : " ";
        add(`${prefix} ${isSelected ? theme.fg("accent", labels[i]) : theme.fg("text", labels[i])}`);
      }
      lines.push("");
      add(theme.fg("dim", " arrow-keys navigate • enter select • esc back to list"));
      add(theme.fg("accent", "─".repeat(width)));
      cachedLines = lines;
      return lines;
    }

    return { render, invalidate: () => { cachedLines = undefined; }, handleInput };
  });
}

/** Reusable model-picker dialog. Shows a searchable list of registered models.
 *  Returns the selected ModelRef (with provider and id), or null when the user cancels with Esc. */
async function pickModel(
  ctx: ExtensionContext,
  title: string,
  windowSize: number = MODEL_PICKER_WINDOW,
  visibleItems: number = MODEL_SEARCH_VISIBLE_ITEMS,
): Promise<ModelRef | null> {
  const allModels = getAvailableModels(ctx);

  return ctx.ui.custom<ModelRef | null>((tui, theme, _kb, done) => {
    let query = "";
    let selectedIndex = 0;
    let cachedLines: string[] | undefined;
    let noMatchWarning = false;

    function refresh() { cachedLines = undefined; tui.requestRender(); }

    function getFilteredModels(): Model<Api>[] {
      return query ? searchModels(ctx, query, visibleItems) : allModels.slice(0, visibleItems);
    }

    function getFilteredItems(): SelectItem[] {
      return getFilteredModels().map((m) => ({
        value: formatModel(m),
        label: m.name || m.id,
        description: `${m.provider}/${m.id}${m.reasoning ? " R" : ""}`,
      }));
    }

    function handleInput(data: string) {
      if (matchesKey(data, Key.escape)) { done(null); return; }
      if (matchesKey(data, Key.up)) { selectedIndex = Math.max(0, selectedIndex - 1); noMatchWarning = false; refresh(); return; }
      if (matchesKey(data, Key.down)) { selectedIndex = Math.min(getFilteredItems().length - 1, selectedIndex + 1); noMatchWarning = false; refresh(); return; }
      if (matchesKey(data, Key.enter)) {
        const models = getFilteredModels();
        if (models.length > 0) {
          const selected = models[Math.min(selectedIndex, models.length - 1)];
          if (selected != null) {
            // Use the original model object's provider/id directly to avoid
            // parsing ambiguity when formatModel omits the provider prefix.
            done({ provider: selected.provider, id: selected.id });
          } else {
            done(null);
          }
        } else {
          noMatchWarning = true;
          refresh();
        }
        return;
      }
      if (matchesKey(data, Key.backspace)) { query = query.slice(0, -1); selectedIndex = 0; refresh(); return; }
      if (data.length === 1 && data.charCodeAt(0) >= 32) { query += data; selectedIndex = 0; refresh(); return; }
    }

    function render(width: number): string[] {
      if (cachedLines) return cachedLines;
      const lines: string[] = [];
      const add = (s: string) => lines.push(truncateToWidth(s, width));

      add(theme.fg("accent", "─".repeat(width)));
      add(theme.fg("accent", theme.bold(` ${title}`)));
      lines.push("");

      const queryDisplay = query || theme.fg("dim", "(type to search models...)");
      add(` > ${queryDisplay}_`);
      lines.push("");

      const items = getFilteredItems();
      if (items.length === 0) {
        if (allModels.length === 0) {
          add(theme.fg("warning", " No models registered. Configure a provider in pi settings."));
        } else {
          add(theme.fg("muted", " No models found"));
          if (noMatchWarning) {
            add(theme.fg("warning", " ⚠ No model matches your search. Try a different query."));
          }
        }
      } else {
        const halfWin = Math.floor(windowSize / 2);
        const startIdx = Math.max(0, selectedIndex - halfWin);
        const endIdx = Math.min(items.length, startIdx + windowSize);
        for (let i = startIdx; i < endIdx; i++) {
          const item = items[i];
          const isSelected = i === selectedIndex;
          const prefix = isSelected ? theme.fg("accent", ">") : " ";
          add(`${prefix} ${theme.fg(isSelected ? "accent" : "text", item.label)}`);
          if (item.description) add(`   ${theme.fg("muted", item.description)}`);
        }
        if (items.length > windowSize) {
          add(theme.fg("dim", ` ... (${items.length} models, type to filter)`));
        }
      }

      lines.push("");
      add(theme.fg("dim", " type to search • arrow-keys navigate • enter select • esc cancel"));
      add(theme.fg("accent", "─".repeat(width)));

      cachedLines = lines;
      return lines;
    }

    return { render, invalidate: () => { cachedLines = undefined; }, handleInput };
  });
}

// ---------------------------------------------------------------------------
// Create Chain - Step 3: Name the chain
// ---------------------------------------------------------------------------

export async function nameChain(ctx: ExtensionContext): Promise<string | null> {
  while (true) {
    const name = await ctx.ui.input("Chain name:", "my-chain");
    if (name === null) return null; // User cancelled
    const trimmed = name.trim();
    if (!trimmed) {
      ctx.ui.notify("Chain name cannot be empty.", "warning");
      continue;
    }
    if (/[<>:"/\\|?*]/.test(trimmed)) {
      ctx.ui.notify("Chain name contains invalid characters: < > : \" / \\ | ? *", "warning");
      continue;
    }
    return trimmed;
  }
}

// ---------------------------------------------------------------------------
// Create Chain - Full Flow
// ---------------------------------------------------------------------------

export async function createChainFlow(ctx: ExtensionContext): Promise<void> {
  const selection = await selectSubagents(ctx);
  if (selection.cancelled || selection.agents.length === 0) {
    if (selection.cancelled) ctx.ui.notify("Chain creation cancelled", "info");
    return;
  }

  const configResult = await configureModelEffort(ctx, selection.agents);
  if (configResult.cancelled) { ctx.ui.notify("Chain creation cancelled", "info"); return; }

  const name = await nameChain(ctx);
  if (!name) { ctx.ui.notify("Chain creation cancelled", "info"); return; }

  const existing = getChain(name);
  if (existing) {
    const overwrite = await ctx.ui.confirm("Overwrite?", `A chain named "${name}" already exists. Overwrite it?`);
    if (!overwrite) { ctx.ui.notify("Chain creation cancelled", "info"); return; }
  }

  const chain: ChainConfig = {
    name,
    steps: configResult.steps.map((s) => ({
      agentName: s.agent.name,
      model: s.model,
      effort: s.effort,
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  saveChain(chain);
  ctx.ui.notify(`Chain "${name}" created with ${chain.steps.length} steps!`, "success");
}

// ---------------------------------------------------------------------------
// Run Chain - Step 1: Chain Selection & Requirement Input (with @ files)
// ---------------------------------------------------------------------------

export async function selectChainAndInputRequirement(ctx: ExtensionContext): Promise<RunChainInput> {
  const chains = getAllChains();

  if (chains.length === 0) {
    ctx.ui.notify("No chains exist. Create a chain first with /chain -> Create chain.", "warning");
    return { chain: null as unknown as ChainConfig, requirement: "", cleanup: false, cancelled: true };
  }

  const chainItems: SelectItem[] = chains.map((c) => ({
    value: c.name,
    label: c.name,
    description: `${c.steps.length} steps: ${c.steps.map((s) => s.agentName).join(" -> ")}`,
  }));

  const chainName = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(new Text(theme.fg("accent", theme.bold(" Select Chain")), 1, 0));
    const selectList = new SelectList(chainItems, Math.min(chainItems.length, 10), {
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
      noMatch: (t) => theme.fg("warning", t),
    });
    selectList.onSelect = (item) => done(item.value);
    selectList.onCancel = () => done(null);
    container.addChild(selectList);
    container.addChild(new Text(theme.fg("dim", " arrow-keys navigate • enter select • esc back"), 1, 0));
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    return {
      render: (w: number) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => { selectList.handleInput(data); tui.requestRender(); },
    };
  });

  if (!chainName) return { chain: null as unknown as ChainConfig, requirement: "", cleanup: false, cancelled: true };

  // Find the chain directly from the already-loaded list (avoid second disk read)
  const chain = chains.find((c) => c.name === chainName);
  if (!chain) {
    ctx.ui.notify(`Chain "${chainName}" not found`, "error");
    return { chain: null as unknown as ChainConfig, requirement: "", cleanup: false, cancelled: true };
  }

  // Step 1b: Input requirement with @ file reference support
  const requirement = await inputRequirementWithFiles(ctx, chain.name);
  if (requirement === null) {
    return { chain: null as unknown as ChainConfig, requirement: "", cleanup: false, cancelled: true };
  }

  // Step 1c: Cleanup option
  const cleanup = await ctx.ui.confirm("Cleanup", "Clean up generated files after chain execution?");

  return { chain, requirement, cleanup, cancelled: false };
}

/**
 * Custom requirement input with @ file reference autocomplete.
 * Typing @ triggers a file search below the input. User can select files
 * with arrow keys + enter to insert @path references.
 */
export async function inputRequirementWithFiles(
  ctx: ExtensionContext,
  chainName: string,
): Promise<string | null> {
  return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    let text = "";
    let cursorPos = 0;
    let showFilePicker = false;
    let fileQuery = "";
    let fileResults: string[] = [];
    let fileIndex = 0;
    let cachedLines: string[] | undefined;
    let searchDebounce: ReturnType<typeof setTimeout> | undefined;
    let searchAbort: AbortController | undefined;
    let destroyed = false;
    const cwd = ctx.cwd;

    function refresh() { if (destroyed) return; cachedLines = undefined; tui.requestRender(); }

    function cancelSearch() {
      if (searchAbort) { searchAbort.abort(); searchAbort = undefined; }
    }

    function updateFilePicker() {
      const beforeCursor = text.slice(0, cursorPos);
      const atMatch = beforeCursor.match(/@([^\s@]*)$/);
      if (atMatch) {
        showFilePicker = true;
        fileQuery = atMatch[1];
        fileIndex = 0;
        // Cancel any in-flight search
        cancelSearch();
        if (searchDebounce) clearTimeout(searchDebounce);
        // Debounce file search to avoid blocking the UI on every keystroke
        searchDebounce = setTimeout(async () => {
          const controller = new AbortController();
          searchAbort = controller;
          fileResults = await searchFiles(cwd, fileQuery, controller.signal);
          searchAbort = undefined;
          fileIndex = 0;
          refresh();
        }, FILE_SEARCH_DEBOUNCE_MS);
        // Show previous results immediately while waiting for the debounced search
      } else {
        showFilePicker = false;
        fileResults = [];
        cancelSearch();
        if (searchDebounce) { clearTimeout(searchDebounce); searchDebounce = undefined; }
      }
    }

    function insertFileReference(filePath: string) {
      if (searchDebounce) { clearTimeout(searchDebounce); searchDebounce = undefined; }
      cancelSearch();
      const beforeCursor = text.slice(0, cursorPos);
      const atMatch = beforeCursor.match(/@([^\s@]*)$/);
      if (atMatch) {
        const before = text.slice(0, cursorPos - atMatch[0].length);
        const after = text.slice(cursorPos);
        text = before + "@" + filePath + " " + after;
        cursorPos = before.length + filePath.length + 2;
      }
      showFilePicker = false;
      fileResults = [];
      refresh();
    }

    function handleInput(data: string) {
      // File picker mode: navigate results or dismiss
      if (showFilePicker) {
        if (matchesKey(data, Key.up)) {
          fileIndex = Math.max(0, fileIndex - 1); refresh(); return;
        }
        if (matchesKey(data, Key.down)) {
          fileIndex = Math.min(fileResults.length - 1, fileIndex + 1); refresh(); return;
        }
        if (matchesKey(data, Key.enter)) {
          if (fileResults.length > 0) insertFileReference(fileResults[fileIndex]);
          return;
        }
        if (matchesKey(data, Key.escape)) {
          if (searchDebounce) { clearTimeout(searchDebounce); searchDebounce = undefined; }
          showFilePicker = false; fileResults = []; refresh(); return;
        }
        // Any other key dismisses picker and processes normally
        showFilePicker = false;
      }

      if (matchesKey(data, Key.escape)) {
        destroyed = true;
        if (searchDebounce) clearTimeout(searchDebounce);
        cancelSearch();
        done(null); return;
      }

      if (matchesKey(data, Key.enter)) {
        if (text.trim()) {
          destroyed = true;
          if (searchDebounce) clearTimeout(searchDebounce);
          cancelSearch();
          done(text); return;
        }
        return;
      }

      if (matchesKey(data, Key.backspace)) {
        if (cursorPos > 0) {
          text = text.slice(0, cursorPos - 1) + text.slice(cursorPos);
          cursorPos--;
        }
        updateFilePicker(); refresh(); return;
      }

      if (matchesKey(data, Key.left)) {
        cursorPos = Math.max(0, cursorPos - 1);
        updateFilePicker(); refresh(); return;
      }

      if (matchesKey(data, Key.right)) {
        cursorPos = Math.min(text.length, cursorPos + 1);
        updateFilePicker(); refresh(); return;
      }

      if (matchesKey(data, Key.home)) {
        cursorPos = 0;
        updateFilePicker(); refresh(); return;
      }

      if (matchesKey(data, Key.end)) {
        cursorPos = text.length;
        updateFilePicker(); refresh(); return;
      }

      // Printable characters
      if (data.length === 1 && data.charCodeAt(0) >= 32) {
        text = text.slice(0, cursorPos) + data + text.slice(cursorPos);
        cursorPos++;
        updateFilePicker(); refresh(); return;
      }
    }

    function render(width: number): string[] {
      if (cachedLines) return cachedLines;
      const lines: string[] = [];
      const add = (s: string) => lines.push(truncateToWidth(s, width));

      add(theme.fg("accent", "─".repeat(width)));
      add(theme.fg("accent", theme.bold(` Requirement for "${chainName}":`)));
      add(theme.fg("dim", " Type @ to reference files • Enter to submit • Esc to cancel"));
      lines.push("");

      // Render single-line text with cursor indicator.
      const maxTextWidth = width - 3; // 1 padding + 1 for cursor marker
      let visibleText: string;
      let visibleCursor: number;

      if (text.length <= maxTextWidth) {
        visibleText = text;
        visibleCursor = cursorPos;
      } else {
        // Scroll window: keep cursor centered when possible
        const half = Math.floor(maxTextWidth / 2);
        let scrollStart = cursorPos - half;
        if (scrollStart < 0) scrollStart = 0;
        if (scrollStart + maxTextWidth > text.length) scrollStart = text.length - maxTextWidth;
        visibleText = text.slice(scrollStart, scrollStart + maxTextWidth);
        visibleCursor = cursorPos - scrollStart;
      }

      // Render line with highlighted cursor position
      let renderedLine = " ";
      if (!text) {
        renderedLine += theme.fg("dim", "(type your requirement...)");
      } else {
        for (let i = 0; i < visibleText.length; i++) {
          if (i === visibleCursor) {
            renderedLine += theme.bg("selectedBg", theme.fg("text", visibleText[i]));
          } else {
            renderedLine += visibleText[i];
          }
        }
        if (visibleCursor >= visibleText.length) {
          renderedLine += theme.bg("selectedBg", " ");
        }
      }
      add(renderedLine);

      // File picker
      if (showFilePicker && fileResults.length > 0) {
        lines.push("");
        add(theme.fg("muted", ` Matching files (@${fileQuery}):`));
        const halfWin = Math.floor(FILE_PICKER_WINDOW / 2);
        const startIdx = Math.max(0, fileIndex - halfWin);
        const endIdx = Math.min(fileResults.length, startIdx + FILE_PICKER_WINDOW);
        for (let i = startIdx; i < endIdx; i++) {
          const isSelected = i === fileIndex;
          const prefix = isSelected ? theme.fg("accent", ">") : " ";
          add(`${prefix} ${theme.fg(isSelected ? "accent" : "text", fileResults[i])}`);
        }
        if (fileResults.length > FILE_PICKER_WINDOW) {
          add(theme.fg("dim", ` ... and ${fileResults.length - FILE_PICKER_WINDOW} more`));
        }
      } else if (showFilePicker) {
        lines.push("");
        add(theme.fg("muted", ` No files matching "@${fileQuery}"`));
      }

      lines.push("");
      add(theme.fg("accent", "─".repeat(width)));

      cachedLines = lines;
      return lines;
    }

    return { render, invalidate: () => { cachedLines = undefined; }, handleInput };
  });
}

// ---------------------------------------------------------------------------
// Run Chain - Step 3: Task Review & Modification
// ---------------------------------------------------------------------------

export async function reviewAndModifyTasks(
  ctx: ExtensionContext,
  chain: ChainConfig,
  tasks: DistributedTask[],
): Promise<{ tasks: DistributedTask[]; cancelled: boolean }> {
  let currentIndex = 0;

  let reviewing = true;
  while (reviewing) {
    const result = await showTaskReviewDialog(ctx, chain, tasks, currentIndex);
    if (result === null) return { tasks, cancelled: true };
    if (result === "edit") {
      const edited = await ctx.ui.editor(
        `Edit task for "${tasks[currentIndex].agentName}" (step ${currentIndex + 1}/${tasks.length}):`,
        tasks[currentIndex].task,
      );
      if (edited != null) tasks[currentIndex] = { ...tasks[currentIndex], task: edited.trim() || tasks[currentIndex].task };
      continue;
    }
    if (result === "prev" && currentIndex > 0) { currentIndex--; continue; }
    if (result === "next" && currentIndex < tasks.length - 1) { currentIndex++; continue; }
    if (result === "done") return { tasks, cancelled: false };
  }
  return { tasks, cancelled: true }; // unreachable
}

async function showTaskReviewDialog(
  ctx: ExtensionContext,
  chain: ChainConfig,
  tasks: DistributedTask[],
  currentIndex: number,
): Promise<"prev" | "next" | "edit" | "done" | null> {
  const task = tasks[currentIndex];
  // Look up step by agentName (not index) for safety against out-of-order distribution
  const step = chain.steps.find((s) => s.agentName === task.agentName) || chain.steps[currentIndex];

  return ctx.ui.custom<"prev" | "next" | "edit" | "done" | null>((tui, theme, _kb, done) => {
    let cachedLines: string[] | undefined;
    const menuItems = [
      currentIndex > 0 ? "<- Previous" : null,
      "Edit task",
      currentIndex < tasks.length - 1 ? "Next ->" : null,
      "Confirm & Execute",
    ].filter(Boolean) as string[];
    let menuIndex = menuItems.findIndex((m) => m === "Edit task");

    function refresh() { cachedLines = undefined; tui.requestRender(); }

    function handleInput(data: string) {
      if (matchesKey(data, Key.up)) { menuIndex = Math.max(0, menuIndex - 1); refresh(); return; }
      if (matchesKey(data, Key.down)) { menuIndex = Math.min(menuItems.length - 1, menuIndex + 1); refresh(); return; }
      if (matchesKey(data, Key.escape)) { done(null); return; }
      if (matchesKey(data, Key.enter)) {
        const selected = menuItems[menuIndex];
        if (selected.startsWith("<-")) done("prev");
        else if (selected.startsWith("Edit")) done("edit");
        else if (selected.startsWith("Next")) done("next");
        else if (selected.startsWith("Confirm")) done("done");
      }
    }

    function render(width: number): string[] {
      if (cachedLines) return cachedLines;
      const lines: string[] = [];
      const add = (s: string) => lines.push(truncateToWidth(s, width));
      add(theme.fg("accent", "─".repeat(width)));
      add(theme.fg("accent", theme.bold(` Task Review: ${chain.name}`)));
      add(theme.fg("muted", ` Step ${currentIndex + 1}/${tasks.length}`));
      lines.push("");
      add(theme.fg("accent", ` Agent: ${theme.bold(task.agentName)}`));
      if (step.model) add(theme.fg("dim", ` Model: ${formatModel(step.model)}`));
      if (step.effort && step.effort !== DEFAULT_EFFORT) add(theme.fg("dim", ` Effort: ${step.effort}`));
      lines.push("");
      add(theme.fg("muted", " Task:"));
      const taskWords = task.task.split(/\s+/);
      let currentLine = " ";
      for (const word of taskWords) {
        if ((currentLine + " " + word).length > width - 2) { add(theme.fg("text", currentLine)); currentLine = "  " + word; }
        else currentLine += (currentLine.length > 1 ? " " : "") + word;
      }
      if (currentLine.length > 1) add(theme.fg("text", currentLine));
      lines.push("");
      lines.push("");
      for (let i = 0; i < menuItems.length; i++) {
        const isSelected = i === menuIndex;
        const prefix = isSelected ? theme.fg("accent", ">") : " ";
        add(`${prefix} ${isSelected ? theme.fg("accent", menuItems[i]) : theme.fg("text", menuItems[i])}`);
      }
      lines.push("");
      add(theme.fg("dim", " arrow-keys navigate • enter select • esc cancel"));
      add(theme.fg("accent", "─".repeat(width)));
      cachedLines = lines;
      return lines;
    }

    return { render, invalidate: () => { cachedLines = undefined; }, handleInput };
  });
}

// ---------------------------------------------------------------------------
// List Chains
// ---------------------------------------------------------------------------

export async function listChainsFlow(ctx: ExtensionContext): Promise<void> {
  const chains = getAllChains();
  if (chains.length === 0) { ctx.ui.notify("No chains exist.", "info"); return; }

  const items: SelectItem[] = chains.map((c) => ({
    value: c.name,
    label: c.name,
    description: `${c.steps.length} steps: ${c.steps.map((s) => s.agentName).join(" -> ")} | Created: ${new Date(c.createdAt).toLocaleDateString()}`,
  }));

  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(new Text(theme.fg("accent", theme.bold(` Chains (${chains.length})`)), 1, 0));
    const selectList = new SelectList(items, Math.min(items.length, 15), {
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
      noMatch: (t) => theme.fg("warning", t),
    });
    selectList.onSelect = () => done(undefined);
    selectList.onCancel = () => done(undefined);
    container.addChild(selectList);
    container.addChild(new Text(theme.fg("dim", " enter/esc to return to menu"), 1, 0));
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    return {
      render: (w: number) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => { selectList.handleInput(data); tui.requestRender(); },
    };
  });
}

// ---------------------------------------------------------------------------
// Delete Chain
// ---------------------------------------------------------------------------

export async function deleteChainFlow(ctx: ExtensionContext): Promise<void> {
  const chains = getAllChains();
  if (chains.length === 0) { ctx.ui.notify("No chains exist to delete.", "info"); return; }

  const items: SelectItem[] = chains.map((c) => ({ value: c.name, label: c.name, description: `${c.steps.length} steps` }));

  const chainName = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(new Text(theme.fg("error", theme.bold(" Delete Chain")), 1, 0));
    const selectList = new SelectList(items, Math.min(items.length, 15), {
      selectedPrefix: (t) => theme.fg("error", t),
      selectedText: (t) => theme.fg("error", t),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
      noMatch: (t) => theme.fg("warning", t),
    });
    selectList.onSelect = (item) => done(item.value);
    selectList.onCancel = () => done(null);
    container.addChild(selectList);
    container.addChild(new Text(theme.fg("dim", " enter to delete • esc to cancel"), 1, 0));
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    return {
      render: (w: number) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => { selectList.handleInput(data); tui.requestRender(); },
    };
  });

  if (!chainName) return;

  const confirmed = await ctx.ui.confirm("Confirm Deletion", `Are you sure you want to delete the chain "${chainName}"? This cannot be undone.`);
  if (confirmed) {
    if (deleteChain(chainName)) ctx.ui.notify(`Chain "${chainName}" deleted.`, "success");
    else ctx.ui.notify(`Failed to delete chain "${chainName}".`, "error");
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function settingsFlow(ctx: ExtensionContext): Promise<void> {
  const settings = getSettings();

  let currentIndex = 0;
  const settingItems = [
    {
      label: "Task Distribution Model",
      get: () => settings.taskDistributionModel ? formatModel(settings.taskDistributionModel) : "(current model)",
      async set() {
        const model = await selectModel(ctx, "Select Task Distribution Model");
        if (model) { settings.taskDistributionModel = model; saveSettings(settings); }
      },
    },
    {
      label: "Task Distribution Effort",
      get: () => settings.taskDistributionEffort || DEFAULT_EFFORT,
      async set() {
        const current = EFFORT_LEVELS.indexOf((settings.taskDistributionEffort || DEFAULT_EFFORT) as ThinkingLevel);
        settings.taskDistributionEffort = EFFORT_LEVELS[(current + 1) % EFFORT_LEVELS.length];
        saveSettings(settings);
      },
    },
    {
      label: "Summarization Model",
      get: () => settings.summarizationModel ? formatModel(settings.summarizationModel) : "(current model)",
      async set() {
        const model = await selectModel(ctx, "Select Summarization Model");
        if (model) { settings.summarizationModel = model; saveSettings(settings); }
      },
    },
    {
      label: "Summarization Effort",
      get: () => settings.summarizationEffort || DEFAULT_EFFORT,
      async set() {
        const current = EFFORT_LEVELS.indexOf((settings.summarizationEffort || DEFAULT_EFFORT) as ThinkingLevel);
        settings.summarizationEffort = EFFORT_LEVELS[(current + 1) % EFFORT_LEVELS.length];
        saveSettings(settings);
      },
    },
  ];

  let settingsOpen = true;
  while (settingsOpen) {
    const result = await renderSettings(ctx, settingItems.map((s) => ({ label: s.label, value: s.get() })), currentIndex);
    if (result === null) { settingsOpen = false; break; }
    currentIndex = result;
    await settingItems[currentIndex].set();
  }
}

async function renderSettings(
  ctx: ExtensionContext,
  items: { label: string; value: string }[],
  currentIndex: number,
): Promise<number | null> {
  return ctx.ui.custom<number | null>((tui, theme, _kb, done) => {
    let cachedLines: string[] | undefined;
    let idx = currentIndex;

    function refresh() { cachedLines = undefined; tui.requestRender(); }

    function handleInput(data: string) {
      if (matchesKey(data, Key.up)) { idx = Math.max(0, idx - 1); refresh(); return; }
      if (matchesKey(data, Key.down)) { idx = Math.min(items.length - 1, idx + 1); refresh(); return; }
      if (matchesKey(data, Key.enter)) { done(idx); return; }
      if (matchesKey(data, Key.escape)) { done(null); }
    }

    function render(width: number): string[] {
      if (cachedLines) return cachedLines;
      const lines: string[] = [];
      const add = (s: string) => lines.push(truncateToWidth(s, width));
      add(theme.fg("accent", "─".repeat(width)));
      add(theme.fg("accent", theme.bold(" pi-chain Settings")));
      lines.push("");
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const isSelected = i === idx;
        const prefix = isSelected ? theme.fg("accent", ">") : " ";
        add(`${prefix} ${theme.fg(isSelected ? "accent" : "text", item.label)}: ${theme.fg("success", item.value)}`);
      }
      lines.push("");
      add(theme.fg("dim", " arrow-keys navigate • enter change • esc back"));
      add(theme.fg("accent", "─".repeat(width)));
      cachedLines = lines;
      return lines;
    }

    return { render, invalidate: () => { cachedLines = undefined; }, handleInput };
  });
}

export async function selectModel(ctx: ExtensionContext, title: string): Promise<ModelRef | null> {
  return pickModel(ctx, title, SETTINGS_MODEL_WINDOW, SETTINGS_MODEL_VISIBLE_ITEMS);
}

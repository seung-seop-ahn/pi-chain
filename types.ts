/**
 * pi-chain type definitions
 *
 * Defines the data structures for chain configurations, execution state,
 * and settings used throughout the pi-chain extension.
 */

/** Thinking level as used in pi */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** A model identifier combining provider and model ID */
export interface ModelRef {
  provider: string;
  id: string;
}

/** A single step in a chain, mapping a subagent to its configuration */
export interface ChainStep {
  /** Name of the subagent (matches AgentConfig.name) */
  agentName: string;
  /** Model override for this step (if not set, uses agent default or current model) */
  model?: ModelRef;
  /** Thinking level (effort) for this step */
  effort?: ThinkingLevel;
}

/** A complete chain definition */
export interface ChainConfig {
  /** User-given name for the chain */
  name: string;
  /** Ordered list of chain steps */
  steps: ChainStep[];
  /** When the chain was created (epoch ms) */
  createdAt: number;
  /** When the chain was last modified (epoch ms) */
  updatedAt: number;
}

/** Task distribution result - tasks assigned to each step */
export interface DistributedTask {
  /** Index into the chain's steps array */
  stepIndex: number;
  /** Agent name for this step */
  agentName: string;
  /** The distributed task description for this subagent */
  task: string;
}

/** Settings for the pi-chain extension */
export interface ChainSettings {
  /** Model used for task distribution */
  taskDistributionModel?: ModelRef;
  /** Effort level for task distribution */
  taskDistributionEffort?: ThinkingLevel;
  /** Model used for summarization */
  summarizationModel?: ModelRef;
  /** Effort level for summarization */
  summarizationEffort?: ThinkingLevel;
}

/** Current schema version for chains.json. Bump when the format changes
 *  so migrations can be applied. */
export const CHAIN_STORE_VERSION = 1;

/** Persisted data format stored in chains.json */
export interface ChainStore {
  /** Schema version for forward compatibility */
  version: number;
  chains: ChainConfig[];
  settings: ChainSettings;
}

// ---------------------------------------------------------------------------
// Message type constants (used across index.ts and execution.ts)
// ---------------------------------------------------------------------------

export const MSG = {
  CHAIN_START: "pi-chain-start",
  STEP_DONE: "pi-chain-step-done",
  WAITING: "pi-chain-waiting",
  ERROR: "pi-chain-error",
  ABORTED: "pi-chain-aborted",
  COMPLETE: "pi-chain-complete",
} as const;

/** Maximum length (chars) for user-facing summaries. Enforced by both
 *  LLM-based summarization and truncation fallback. */
export const MAX_SUMMARY_LENGTH = 970;

/** Watchdog timeout for a single chain step in the main session (ms).
 *  If a subagent's LLM call takes longer than this without producing output,
 *  the step is considered stuck and the chain moves to the next step.
 *  Set to 0 to disable. */
export const CHAIN_STEP_WATCHDOG_MS = 1_800_000; // 30 minutes

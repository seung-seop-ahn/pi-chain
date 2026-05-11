/**
 * Chain storage - file-based persistence across sessions.
 *
 * Stores chain configurations and settings in:
 *   ~/.pi/agent/pi-chain/chains.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { CHAIN_STORE_VERSION, type ChainConfig, type ChainSettings, type ChainStore } from "./types";

/** Get the storage directory path */
function getStorageDir(): string {
  return path.join(getAgentDir(), "pi-chain");
}

/** Get the chains file path */
function getChainsPath(): string {
  return path.join(getStorageDir(), "chains.json");
}

/** Ensure the storage directory exists */
function ensureStorageDir(): void {
  const dir = getStorageDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// In-memory cache to avoid repeated disk I/O during a single session
// ---------------------------------------------------------------------------

let cachedStore: ChainStore | null = null;

/** Invalidate the in-memory cache (call after external modifications, e.g.
 *  when you know another process has written to chains.json). */
export function invalidateCache(): void {
  cachedStore = null;
}

/** Create the default (empty) store with the current schema version. */
function createDefaultStore(): ChainStore {
  return { version: CHAIN_STORE_VERSION, chains: [], settings: {} };
}

/** Read the full chain store from disk (with caching).
 *  On first load, migrates older schema versions if needed. */
export function readStore(): ChainStore {
  if (cachedStore) return cachedStore;
  const chainsPath = getChainsPath();
  if (!fs.existsSync(chainsPath)) {
    cachedStore = createDefaultStore();
    return cachedStore;
  }
  try {
    const data = fs.readFileSync(chainsPath, "utf-8");
    const raw = JSON.parse(data) as Partial<ChainStore>;
    // Migrate older stores that lack a version field
    if (typeof raw.version !== "number") {
      cachedStore = {
        version: CHAIN_STORE_VERSION,
        chains: Array.isArray(raw.chains) ? raw.chains : [],
        settings: (raw.settings && typeof raw.settings === "object") ? raw.settings as ChainSettings : {},
      };
    } else {
      cachedStore = raw as ChainStore;
    }
    return cachedStore;
  } catch {
    cachedStore = createDefaultStore();
    return cachedStore;
  }
}

/** Write the full chain store to disk atomically and update cache.
 *  Uses a temp-file + rename to avoid partial writes on crash. */
export function writeStore(store: ChainStore): void {
  ensureStorageDir();
  const chainsPath = getChainsPath();
  const tmpPath = chainsPath + ".tmp";
  const content = JSON.stringify(store, null, 2);
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, chainsPath);
  cachedStore = store;
}

/** Get all chains */
export function getAllChains(): ChainConfig[] {
  return readStore().chains;
}

/** Get a chain by name */
export function getChain(name: string): ChainConfig | undefined {
  return readStore().chains.find((c) => c.name === name);
}

/** Save a chain (creates or updates) */
export function saveChain(chain: ChainConfig): void {
  const store = readStore();
  const index = store.chains.findIndex((c) => c.name === chain.name);
  const now = Date.now();
  if (index >= 0) {
    store.chains[index] = { ...chain, updatedAt: now };
  } else {
    store.chains.push({ ...chain, createdAt: now, updatedAt: now });
  }
  writeStore(store);
}

/** Delete a chain by name */
export function deleteChain(name: string): boolean {
  const store = readStore();
  const index = store.chains.findIndex((c) => c.name === name);
  if (index < 0) return false;
  store.chains.splice(index, 1);
  writeStore(store);
  return true;
}

/** Get settings */
export function getSettings(): ChainSettings {
  return readStore().settings;
}

/** Save settings */
export function saveSettings(settings: ChainSettings): void {
  const store = readStore();
  store.settings = settings;
  writeStore(store);
}

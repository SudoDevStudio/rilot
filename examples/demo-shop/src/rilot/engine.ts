// Loads rilot-core.wasm once. Every decision on the right-hand panel comes
// from this engine — the same Rust code native Rilot runs.
import { loadEngine, type RilotEngine } from '@rilot/core-js';
import wasmUrl from './generated/rilot_core.wasm?url';

let cached: Promise<RilotEngine> | null = null;

export function getEngine(): Promise<RilotEngine> {
  cached ??= (async () => {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`Could not load the routing engine (HTTP ${response.status}).`);
    return loadEngine(await response.arrayBuffer());
  })().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

export type { RilotEngine };

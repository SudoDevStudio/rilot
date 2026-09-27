// Browser loader for rilot-core.wasm. The binding itself is shared with the
// Cloudflare adapter (packages/rilot-js); this file only fetches the module.

import { loadEngine, type RilotEngine } from '@rilot/core-js';
import wasmUrl from './generated/rilot_core.wasm?url';

export type { EngineResult, RilotEngine } from '@rilot/core-js';

/** Instantiates rilot-core from raw module bytes (used by tests and custom hosts). */
export async function loadRilotEngineFromBytes(bytes: BufferSource): Promise<RilotEngine> {
  return loadEngine(bytes);
}

let cached: Promise<RilotEngine> | null = null;

/** Loads the bundled rilot-core.wasm once per page. */
export function loadRilotEngine(): Promise<RilotEngine> {
  cached ??= (async () => {
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(`Could not download the routing engine (HTTP ${response.status}).`);
    }
    return loadEngine(await response.arrayBuffer());
  })().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

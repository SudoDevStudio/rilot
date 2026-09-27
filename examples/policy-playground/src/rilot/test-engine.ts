// Test helper: loads the compiled rilot-core.wasm from disk (Node / Vitest).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadRilotEngineFromBytes, type RilotEngine } from './wasm';

let engine: Promise<RilotEngine> | null = null;

export function testEngine(): Promise<RilotEngine> {
  engine ??= loadRilotEngineFromBytes(
    readFileSync(fileURLToPath(new URL('./generated/rilot_core.wasm', import.meta.url)))
  );
  return engine;
}

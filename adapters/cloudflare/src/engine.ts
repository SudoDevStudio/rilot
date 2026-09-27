// Loads rilot-core.wasm once per isolate. The binding is shared with the
// browser playground (packages/rilot-js).
import { loadEngine, type RilotEngine } from '../../../packages/rilot-js/src/index';
import wasmModule from './generated/rilot_core.wasm';

let engine: Promise<RilotEngine> | null = null;

export function getEngine(): Promise<RilotEngine> {
  engine ??= loadEngine(wasmModule);
  return engine;
}

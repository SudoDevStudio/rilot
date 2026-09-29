// The Edge Function Vercel deploys.
//
// Everything testable lives in ../src; this file exists to do the one thing
// only the platform can do — hand the runtime a compiled WebAssembly module.
// Vercel's Edge runtime resolves a `?module` import to a `WebAssembly.Module`,
// so the binary is never fetched at runtime and cold starts stay cheap.
//
// `vercel.json` rewrites every path here, so the function sees the caller's
// original URL and can route on it.

// @ts-expect-error -- resolved by Vercel's bundler, not by tsc.
import wasmModule from './generated/rilot_core.wasm?module';
import { loadEngine } from '../../../packages/rilot-js/src/index';
import { createHandler } from '../src/handler';

export const config = { runtime: 'edge' };

/** Instantiated once per instance and reused by every request it serves. */
const handler = loadEngine(wasmModule as WebAssembly.Module).then((engine) => createHandler({ engine }));

export default async function rilot(request: Request): Promise<Response> {
  return (await handler)(request);
}

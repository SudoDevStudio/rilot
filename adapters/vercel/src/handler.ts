// Rilot Vercel adapter.
//
// The function owns transport only: it reads Vercel's request metadata, builds
// the carbon service (Vercel KV + provider), and hands both to the shared HTTP
// layer in packages/rilot-http — the same code the Cloudflare Worker runs.
// Every routing decision is made by rilot-core.wasm.
//
//   request ─▶ plan() ─▶ carbon for those regions ─▶ decide() ─▶ fetch(backend)

import type { GeoPoint, PreviousDecision, RilotEngine } from '../../../packages/rilot-js/src/index';
import { handleRequest, json, parseLocation, type Host } from '../../../packages/rilot-http/src/index';
import { createCarbonService, type CarbonWiring } from './carbon';
import { loadConfig } from './config';
import { readEnv, type Env } from './env';

/**
 * Hysteresis state per matched rule.
 *
 * Per instance, like the Worker's: Vercel runs many, and a region's instance
 * may be recycled at any time, so stickiness is best-effort rather than global.
 */
const lastDecisions = new Map<string, PreviousDecision>();

/**
 * Vercel's own guess at where the caller is.
 *
 * `x-vercel-ip-latitude` / `-longitude` are set on every request that reaches a
 * function; the shared layer lets `x-user-location` override them, which is how
 * you test a deployment from your desk.
 */
export function vercelLocation(headers: Headers): GeoPoint | undefined {
  const rawLat = headers.get('x-vercel-ip-latitude');
  const rawLon = headers.get('x-vercel-ip-longitude');
  // Both must be present: `Number(null)` is 0, and 0,0 is a real place in the
  // Gulf of Guinea that every backend would be measured against.
  if (rawLat === null || rawLon === null) return undefined;
  return parseLocation(`${rawLat},${rawLon}`);
}

/** The region serving this request, for `/__rilot/health`. */
function region(request: Request, env: Env): string | null {
  // `x-vercel-id` looks like `iad1::abc123-...`; the first segment is the region.
  const id = request.headers.get('x-vercel-id');
  return env.VERCEL_REGION ?? id?.split('::')[0] ?? null;
}

export type HandlerOptions = {
  /** Loaded once per instance by the entry point. */
  engine: RilotEngine;
  /** Defaults to the process environment. */
  env?: Env;
  /** Overrides for tests: a fake `fetch`, or a real `waitUntil`. */
  wiring?: CarbonWiring & { fetch?: typeof fetch };
};

/**
 * Builds the request handler. The entry point supplies the engine, because
 * only it knows how this host loads WebAssembly.
 */
export function createHandler(options: HandlerOptions): (request: Request) => Promise<Response> {
  const { engine, wiring = {} } = options;
  const env = options.env ?? readEnv();

  return async (request: Request): Promise<Response> => {
    let config;
    try {
      config = loadConfig(env);
    } catch (error) {
      return json({ error: (error as Error).message }, 500);
    }

    const host: Host = {
      engine,
      config,
      carbon: createCarbonService(engine, config.carbon ?? {}, env, {
        ...(wiring.schedule ? { schedule: wiring.schedule } : {}),
        ...(wiring.fetch ? { fetchImpl: wiring.fetch } : {})
      }),
      location: vercelLocation(request.headers),
      health: { region: region(request, env) },
      exposeResearchHeaders: env.RILOT_EXPOSE_RESEARCH_HEADERS === 'true',
      previous: lastDecisions,
      ...(wiring.fetch ? { fetch: wiring.fetch } : {})
    };

    return handleRequest(request, host);
  };
}

export { POLICY_COOKIE } from '../../../packages/rilot-http/src/index';

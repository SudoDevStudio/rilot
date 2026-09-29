// Rilot Cloudflare Worker adapter.
//
// The Worker owns transport only: it reads Cloudflare request metadata, builds
// the carbon service (Workers KV + provider), and hands both to the shared HTTP
// layer in packages/rilot-http. Every routing decision is made by
// rilot-core.wasm.
//
//   request ─▶ plan() ─▶ carbon for those regions ─▶ decide() ─▶ fetch(backend)

import type { GeoPoint, PreviousDecision } from '../../../packages/rilot-js/src/index';
import { handleRequest, json, type Host } from '../../../packages/rilot-http/src/index';
import { createCarbonService } from './carbon';
import { loadConfig } from './config';
import { getEngine } from './engine';
import type { Env } from './env';

/** Hysteresis state per matched rule. Per isolate: Cloudflare runs many. */
const lastDecisions = new Map<string, PreviousDecision>();

export { POLICY_COOKIE, buildRequestContext } from '../../../packages/rilot-http/src/index';

/** Cloudflare's own guess at where the caller is. Headers override it. */
function cloudflareLocation(request: Request): GeoPoint | undefined {
  const cf = request.cf as IncomingRequestCfProperties | undefined;
  if (cf?.latitude === undefined || cf?.longitude === undefined) return undefined;
  const lat = Number(cf.latitude);
  const lon = Number(cf.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let config;
    try {
      config = await loadConfig(env);
    } catch (error) {
      return json({ error: (error as Error).message }, 500);
    }

    const engine = await getEngine();
    const host: Host = {
      engine,
      config,
      carbon: createCarbonService(engine, config.carbon ?? {}, env, ctx),
      location: cloudflareLocation(request),
      health: { colo: (request.cf as IncomingRequestCfProperties | undefined)?.colo ?? null },
      exposeResearchHeaders: env.RILOT_EXPOSE_RESEARCH_HEADERS === 'true',
      previous: lastDecisions
    };

    return handleRequest(request, host);
  }
};

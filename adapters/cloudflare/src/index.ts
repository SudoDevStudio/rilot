// Rilot Cloudflare Worker adapter.
//
// The Worker owns transport only: it reads Cloudflare request metadata, gets
// carbon signals (KV + provider), forwards the request, and emits headers.
// Every routing decision is made by rilot-core.wasm.
//
//   request ─▶ plan() ─▶ carbon for those regions ─▶ decide() ─▶ fetch(backend)

import type {
  CandidateEvaluation,
  CarbonSignal,
  DecisionInput,
  DecisionOutput,
  GeoPoint,
  Policy,
  PreviousDecision,
  RequestContext,
  RequestHints,
  RilotEngine
} from '../../../packages/rilot-js/src/index';
import { createCarbonService } from './carbon';
import { loadConfig, maxAgeSeconds, type RilotConfig } from './config';
import { getEngine } from './engine';
import type { Env } from './env';

/** Hysteresis state per matched rule. Per isolate: Cloudflare runs many. */
const lastDecisions = new Map<string, PreviousDecision>();

/**
 * Cookie a site sets to route its own pages per session, for example
 * `rilot_policy=/products/*:carbon,/checkout/*:latency`.
 *
 * The engine parses it and matches the patterns (see `crates/rilot-core/src/cookie.rs`),
 * so a cookie behaves exactly like a routing rule of the same shape and the
 * Worker cannot drift from the native proxy.
 */
export const POLICY_COOKIE = 'rilot_policy';

function parseFlag(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(v)) return true;
  if (['0', 'false', 'off', 'no'].includes(v)) return false;
  return undefined;
}

function requestHints(headers: Headers): RequestHints {
  const routeClass = headers.get('x-rilot-class')?.trim();
  const policy = headers.get('x-rilot-policy')?.trim();
  return {
    ...(policy === 'latency' || policy === 'balanced' || policy === 'carbon' ? { policy } : {}),
    ...(routeClass === 'flexible' || routeClass === 'strict-local' || routeClass === 'background'
      ? { route_class: routeClass }
      : {}),
    ...(parseFlag(headers.get('x-rilot-carbon-cursor')) !== undefined
      ? { carbon_aware: parseFlag(headers.get('x-rilot-carbon-cursor')) }
      : {}),
    ...(parseFlag(headers.get('x-rilot-forecasting')) !== undefined
      ? { forecasting: parseFlag(headers.get('x-rilot-forecasting')) }
      : {}),
    ...(parseFlag(headers.get('x-rilot-time-shift')) !== undefined
      ? { time_shift: parseFlag(headers.get('x-rilot-time-shift')) }
      : {})
  };
}

/** Parses `"<lat>,<lon>"`; anything unparseable means "location unknown". */
function parseLocation(value: string | null): GeoPoint | undefined {
  const parts = value?.split(',');
  if (parts?.length !== 2) return undefined;
  const lat = Number(parts[0].trim());
  const lon = Number(parts[1].trim());
  const usable =
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  return usable ? { lat, lon } : undefined;
}

/**
 * Builds the core request context from Cloudflare's request metadata.
 *
 * Headers win over Cloudflare's own geolocation, so a deployed Worker can be
 * tested from anywhere:
 *
 *   x-user-region: us-east-1        pins the region
 *   x-user-location: 51.5,-0.13     pins the coordinates
 *
 * A per-request policy can arrive as `x-rilot-policy`, or from the session
 * cookie when an engine is passed; an explicit header wins over the cookie.
 */
export function buildRequestContext(request: Request, path: string, engine?: RilotEngine): RequestContext {
  const cf = request.cf as IncomingRequestCfProperties | undefined;
  const headerRegion = request.headers.get('x-user-region')?.trim();
  const location =
    parseLocation(request.headers.get('x-user-location')) ??
    parseLocation(cf ? `${cf.latitude},${cf.longitude}` : null);
  const hints = requestHints(request.headers);
  const cookie = request.headers.get('cookie');
  if (engine && cookie && !hints.policy) {
    const fromCookie = engine.cookiePolicy(cookie, path, POLICY_COOKIE);
    if (fromCookie.ok && fromCookie.value) hints.policy = fromCookie.value;
  }
  return {
    path,
    ...(headerRegion ? { user_region: headerRegion } : {}),
    ...(location ? { user_location: location } : {}),
    hints
  };
}

function researchHeaders(decision: DecisionOutput, selected: CandidateEvaluation | null): Record<string, string> {
  const carbonOf = (c: CandidateEvaluation) => c.carbon.used_g_per_kwh ?? c.carbon.carbon_g_per_kwh;
  const byCarbon = [...decision.candidates].sort(
    (a, b) => (carbonOf(a) ?? Infinity) - (carbonOf(b) ?? Infinity)
  );
  const snapshot = (list: CandidateEvaluation[]) =>
    list.map((c) => `${c.backend_id}:${carbonOf(c)?.toFixed(3) ?? 'na'}`).join(';');
  const headers: Record<string, string> = {
    'x-rilot-selected-zone': selected?.backend_id ?? 'none',
    'x-rilot-decision-reason': decision.reason.code,
    'x-rilot-zone-carbon-intensity-g-per-kwh': snapshot(byCarbon),
    'x-rilot-eligible-zone-carbon-intensity-g-per-kwh': snapshot(byCarbon.filter((c) => c.rejections.length === 0)),
    'x-rilot-zone-filter-reasons': byCarbon
      .map((c) => `${c.backend_id}:${c.rejections[0]?.kind ?? 'eligible'}`)
      .join(';'),
    'x-rilot-carbon-saved-vs-worst': decision.carbon_saved_vs_worst_g_per_kwh.toFixed(3),
    'x-rilot-carbon-saved-vs-worst-percent': decision.carbon_saved_vs_worst_percent.toFixed(2)
  };
  const carbon = selected ? carbonOf(selected) : undefined;
  if (carbon !== undefined) headers['x-rilot-selected-carbon-intensity'] = carbon.toFixed(3);
  if (selected?.carbon.source) headers['x-rilot-carbon-source'] = selected.carbon.source;
  if (selected?.carbon.age_seconds !== undefined) {
    headers['x-rilot-carbon-age-seconds'] = String(selected.carbon.age_seconds);
  }
  if (decision.defer_seconds > 0) headers['x-rilot-defer-seconds'] = String(decision.defer_seconds);
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== ''));
}

/** Adds the age and staleness a caller would otherwise have to work out. */
function describe(signal: CarbonSignal, now: number, maxAgeSeconds: number) {
  const observed = Date.parse(signal.observed_at);
  const ageSeconds = Number.isFinite(observed) ? Math.max(0, Math.round((now - observed) / 1000)) : null;
  return {
    ...signal,
    age_seconds: ageSeconds,
    stale: ageSeconds === null ? true : ageSeconds > maxAgeSeconds
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });

/** Runs the full routing decision for one request path. */
async function decide(
  config: RilotConfig,
  context: RequestContext,
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>
): Promise<{ input: DecisionInput; decision: DecisionOutput } | { error: string }> {
  const engine = await getEngine();
  const plan = engine.plan({ config, request: context });
  if (!plan.ok) return { error: plan.error };

  const carbon = createCarbonService(engine, config.carbon ?? {}, env, ctx);
  const signals = await carbon.getSignals(plan.value.carbon_regions);

  const routeKey = plan.value.effective.matched_rule?.path ?? '*';
  const input: DecisionInput = {
    config,
    request: context,
    now: new Date().toISOString(),
    carbon: { max_age_seconds: maxAgeSeconds(config), signals },
    ...(lastDecisions.has(routeKey) ? { previous: lastDecisions.get(routeKey) } : {})
  };

  const result = engine.computeDecision(input);
  if (!result.ok) return { error: result.error };
  if (result.value.next_state) lastDecisions.set(routeKey, result.value.next_state);
  return { input, decision: result.value };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    let config: RilotConfig;
    try {
      config = await loadConfig(env);
    } catch (error) {
      return json({ error: (error as Error).message }, 500);
    }

    if (url.pathname === '/__rilot/health') {
      const engine = await getEngine();
      return json({
        ok: true,
        engine: `rilot-core ${engine.version}`,
        backends: (config.backends ?? []).map((b) => b.id),
        colo: (request.cf as IncomingRequestCfProperties | undefined)?.colo ?? null
      });
    }

    // The carbon signals this deployment is routing on, straight from the
    // shared layer: memory, then KV, then the provider. Read-only, and it never
    // exposes the provider's API key.
    //
    //   GET /__rilot/carbon                     every backend region
    //   GET /__rilot/carbon?regions=us-east-1   just these
    if (url.pathname === '/__rilot/carbon') {
      const engine = await getEngine();
      const asked = url.searchParams.get('regions');
      const known = [...new Set((config.backends ?? []).map((b) => b.carbon_region ?? b.region))].filter(
        (region): region is string => Boolean(region)
      );
      const regions = asked
        ? asked
            .split(',')
            .map((r) => r.trim())
            .filter((r) => known.includes(r))
        : known;
      if (asked && regions.length === 0) {
        return json({ error: 'No known region in ?regions', known }, 400);
      }

      const service = createCarbonService(engine, config.carbon ?? {}, env, ctx);
      const signals = await service.getSignals(regions);
      const maxAge = maxAgeSeconds(config);
      const now = Date.now();
      return new Response(
        JSON.stringify(
          {
            max_age_seconds: maxAge,
            asked_for: regions,
            missing: regions.filter((region) => !signals.some((s) => s.region === region)),
            signals: signals.map((signal) => describe(signal, now, maxAge))
          },
          null,
          2
        ),
        {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            // Safe to share: it is grid data, not user data.
            'access-control-allow-origin': '*',
            'cache-control': `public, max-age=${Math.max(1, Math.round(maxAge / 2))}`
          }
        }
      );
    }

    // Dry run: compute a decision for ?path=... without forwarding anything.
    // Useful for testing a deployment that has no real backends yet.
    if (url.pathname === '/__rilot/decision') {
      const path = url.searchParams.get('path') ?? '/';
      const context = buildRequestContext(request, path, await getEngine());
      const result = await decide(config, context, env, ctx);
      return 'error' in result
        ? json({ error: result.error }, 400)
        : json({
            request: context,
            carbon_signals: result.input.carbon?.signals ?? [],
            decision: result.decision
          });
    }

    const context = buildRequestContext(request, url.pathname, await getEngine());
    const result = await decide(config, context, env, ctx);
    if ('error' in result) return json({ error: result.error }, 500);

    const { decision } = result;
    const selected = decision.candidates.find((c) => c.backend_id === decision.selected_backend_id) ?? null;
    const expose = env.RILOT_EXPOSE_RESEARCH_HEADERS === 'true';

    if (!selected?.url) {
      return json(
        { error: 'No eligible backend', reason: decision.reason, candidates: decision.candidates },
        503
      );
    }

    const target = new URL(selected.url);
    target.pathname = `${target.pathname.replace(/\/$/, '')}${url.pathname}`;
    target.search = url.search;

    const response = await fetch(new Request(target.toString(), request));
    if (!expose) return response;

    const withHeaders = new Response(response.body, response);
    for (const [name, value] of Object.entries(researchHeaders(decision, selected))) {
      withHeaders.headers.set(name, value);
    }
    return withHeaders;
  }
};

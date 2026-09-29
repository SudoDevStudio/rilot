// The request path every Rilot adapter follows:
//
//   request ─▶ plan() ─▶ carbon for those regions ─▶ decide() ─▶ fetch(backend)
//
// plus three read-only endpoints that explain a deployment without forwarding
// anything. A host supplies its config, its carbon service and the caller's
// location; everything else — including every routing decision — happens here
// and in rilot-core.wasm, so two adapters cannot drift apart.

import type { CarbonService } from '../../rilot-carbon/src/index';
import type {
  CarbonSignal,
  DecisionInput,
  DecisionOutput,
  GeoPoint,
  PreviousDecision,
  RequestContext,
  RilotEngine,
  RoutingConfig
} from '../../rilot-js/src/index';
import { buildRequestContext } from './context';
import { researchHeaders } from './headers';

export type RilotHttpConfig = RoutingConfig & { carbon?: { max_age_seconds?: number } };

export const DEFAULT_MAX_AGE_SECONDS = 300;

export function maxAgeSeconds(config: RilotHttpConfig): number {
  return config.carbon?.max_age_seconds ?? DEFAULT_MAX_AGE_SECONDS;
}

/** What a host has to provide for one request. */
export type Host = {
  engine: RilotEngine;
  config: RilotHttpConfig;
  carbon: CarbonService;
  /** The caller's coordinates as the platform knows them, if it does. */
  location?: GeoPoint;
  /** Extra fields for `/__rilot/health`, e.g. the colo or region serving it. */
  health?: Record<string, unknown>;
  /** `true` adds the `x-rilot-*` research headers to forwarded responses. */
  exposeResearchHeaders?: boolean;
  /**
   * Hysteresis state, keyed by matched rule. Hosts pass a map that lives as
   * long as their instance does; it is per isolate, not global.
   */
  previous?: Map<string, PreviousDecision>;
  /** Defaults to `globalThis.fetch`; tests and hosts can substitute one. */
  fetch?: typeof fetch;
};

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });

/** Runs the full routing decision for one request path. */
export async function decide(
  host: Host,
  context: RequestContext
): Promise<{ input: DecisionInput; decision: DecisionOutput } | { error: string }> {
  const { engine, config, carbon } = host;
  const plan = engine.plan({ config, request: context });
  if (!plan.ok) return { error: plan.error };

  const signals = await carbon.getSignals(plan.value.carbon_regions);

  const routeKey = plan.value.effective.matched_rule?.path ?? '*';
  const previous = host.previous?.get(routeKey);
  const input: DecisionInput = {
    config,
    request: context,
    now: new Date().toISOString(),
    carbon: { max_age_seconds: maxAgeSeconds(config), signals },
    ...(previous ? { previous } : {})
  };

  const result = engine.computeDecision(input);
  if (!result.ok) return { error: result.error };
  if (result.value.next_state) host.previous?.set(routeKey, result.value.next_state);
  return { input, decision: result.value };
}

/** Adds the age and staleness a caller would otherwise have to work out. */
export function describeSignal(signal: CarbonSignal, now: number, maxAge: number) {
  const observed = Date.parse(signal.observed_at);
  const ageSeconds = Number.isFinite(observed) ? Math.max(0, Math.round((now - observed) / 1000)) : null;
  return { ...signal, age_seconds: ageSeconds, stale: ageSeconds === null ? true : ageSeconds > maxAge };
}

/** Every carbon region the configured backends route on. */
export function knownRegions(config: RilotHttpConfig): string[] {
  return [...new Set((config.backends ?? []).map((b) => b.carbon_region ?? b.region))].filter(
    (region): region is string => Boolean(region)
  );
}

/**
 * Handles one request: the `/__rilot/*` endpoints, or the routed request.
 *
 * Returns the response to send. Hosts do not need to know which endpoint was
 * hit, only how to build the `Host` for it.
 */
export async function handleRequest(request: Request, host: Host): Promise<Response> {
  const url = new URL(request.url);
  const { engine, config } = host;

  if (url.pathname === '/__rilot/health') {
    return json({
      ok: true,
      engine: `rilot-core ${engine.version}`,
      backends: (config.backends ?? []).map((b) => b.id),
      ...(host.health ?? {})
    });
  }

  // The carbon signals this deployment is routing on, straight from the shared
  // layer: memory, then the store, then the provider. Read-only, and it never
  // exposes the provider's API key.
  //
  //   GET /__rilot/carbon                     every backend region
  //   GET /__rilot/carbon?regions=us-east-1   just these
  if (url.pathname === '/__rilot/carbon') {
    const known = knownRegions(config);
    const asked = url.searchParams.get('regions');
    const regions = asked
      ? asked
          .split(',')
          .map((r) => r.trim())
          .filter((r) => known.includes(r))
      : known;
    if (asked && regions.length === 0) {
      return json({ error: 'No known region in ?regions', known }, 400);
    }

    const signals = await host.carbon.getSignals(regions);
    const maxAge = maxAgeSeconds(config);
    const now = Date.now();
    return json(
      {
        max_age_seconds: maxAge,
        asked_for: regions,
        missing: regions.filter((region) => !signals.some((s) => s.region === region)),
        signals: signals.map((signal) => describeSignal(signal, now, maxAge))
      },
      200,
      {
        // Safe to share: it is grid data, not user data.
        'access-control-allow-origin': '*',
        'cache-control': `public, max-age=${Math.max(1, Math.round(maxAge / 2))}`
      }
    );
  }

  // Dry run: compute a decision for ?path=... without forwarding anything.
  // Useful for testing a deployment that has no real backends yet.
  if (url.pathname === '/__rilot/decision') {
    const path = url.searchParams.get('path') ?? '/';
    const context = buildRequestContext({ path, headers: request.headers, hostLocation: host.location, engine });
    const result = await decide(host, context);
    return 'error' in result
      ? json({ error: result.error }, 400)
      : json({
          request: context,
          carbon_signals: result.input.carbon?.signals ?? [],
          decision: result.decision
        });
  }

  const context = buildRequestContext({
    path: url.pathname,
    headers: request.headers,
    hostLocation: host.location,
    engine
  });
  const result = await decide(host, context);
  if ('error' in result) return json({ error: result.error }, 500);

  const { decision } = result;
  const selected = decision.candidates.find((c) => c.backend_id === decision.selected_backend_id) ?? null;

  if (!selected?.url) {
    return json({ error: 'No eligible backend', reason: decision.reason, candidates: decision.candidates }, 503);
  }

  const target = new URL(selected.url);
  target.pathname = `${target.pathname.replace(/\/$/, '')}${url.pathname}`;
  target.search = url.search;

  const send = host.fetch ?? fetch;
  const response = await send(new Request(target.toString(), request));
  if (!host.exposeResearchHeaders) return response;

  const withHeaders = new Response(response.body, response);
  for (const [name, value] of Object.entries(researchHeaders(decision, selected))) {
    withHeaders.headers.set(name, value);
  }
  return withHeaders;
}

// One shop request → one Rilot decision.
//
// This mirrors what an adapter does in production (see the Cloudflare Worker):
//
//   plan()  →  fetch carbon only for the regions it asks for  →  decide()
//
// The decision is real. The backends, their response times, and the carbon
// feed are simulated, because this page runs entirely in your browser.

import type {
  CarbonSignal,
  DecisionOutput,
  Policy,
  PreviousDecision,
  RilotEngine,
  RoutingConfig
} from '@rilot/core-js';
import { signalsAt } from './carbon';
import { BACKENDS, type City } from './config';

export type ShopRequest = {
  method: 'GET' | 'POST';
  path: string;
  /** Plain-language label shown in the flow, e.g. "Pay for the order". */
  label: string;
  /** Rough response size, used for the energy estimate. */
  kilobytes: number;
};

export type Trace = {
  id: number;
  request: ShopRequest;
  decision: DecisionOutput;
  /** Signals actually handed to the engine (empty when carbon was not needed). */
  signals: CarbonSignal[];
  /** Simulated end-to-end time for this request. */
  latencyMs: number;
  /** Estimated CO2e for this request, in milligrams. */
  co2eMg: number;
  /** How much less CO2e than the dirtiest eligible backend, in milligrams. */
  savedMg: number;
};

export type RouteContext = {
  config: RoutingConfig;
  city: City;
  /**
   * Per-request policy, as an adapter would derive it from the session cookie.
   * It beats the matched rule and the root config.
   */
  policy?: Policy | null;
  /**
   * Signals from a real carbon API. When absent the demo simulates them from
   * the grid clock, which is what happens on GitHub Pages.
   */
  signals?: CarbonSignal[] | null;
  /** Simulated clock, 0–24 UTC. */
  utcHour: number;
  signalAgeSeconds: number;
  previous: PreviousDecision | null;
};

/** Same energy model as native Rilot (docs/model-calibration.md). */
function energyJoules(latencyMs: number, kilobytes: number): number {
  return 0.003 * latencyMs + 0.00001 * kilobytes * 1024;
}

function co2eMilligrams(energyJ: number, carbonGPerKwh: number): number {
  return (energyJ / 3_600_000) * carbonGPerKwh * 1000;
}

let nextId = 1;

export type Preview = {
  backendId: string | null;
  city?: string;
  carbonGPerKwh?: number;
};

/**
 * Where a path would be served from under the config in force, without
 * recording it as a request. Used by the impact page to show the effect of a
 * carbon-first switch before the visitor navigates there.
 */
export function previewPath(engine: RilotEngine, path: string, ctx: RouteContext): Preview | null {
  const request: ShopRequest = { method: 'GET', path, label: 'preview', kilobytes: 0 };
  const result = routeRequest(engine, request, ctx);
  if ('error' in result) return null;
  const { decision } = result;
  const selected = decision.candidates.find((c) => c.backend_id === decision.selected_backend_id);
  return {
    backendId: decision.selected_backend_id,
    city: selected ? BACKENDS[selected.backend_id]?.city : undefined,
    carbonGPerKwh: selected?.carbon.used_g_per_kwh
  };
}

export function routeRequest(engine: RilotEngine, request: ShopRequest, ctx: RouteContext): Trace | { error: string } {
  const now = new Date();
  const context = {
    path: request.path,
    user_location: { lat: ctx.city.lat, lon: ctx.city.lon },
    ...(ctx.policy ? { hints: { policy: ctx.policy } } : {})
  };

  // 1. Ask the engine what it needs before touching any carbon data.
  const plan = engine.plan({ config: ctx.config, request: context });
  if (!plan.ok) return { error: plan.error };

  // 2. "Fetch" only those regions, exactly like a real adapter.
  const wanted = new Set(plan.value.carbon_regions);
  const available = ctx.signals ?? signalsAt(ctx.utcHour, now, ctx.signalAgeSeconds);
  const signals = wanted.size ? available.filter((s) => wanted.has(s.region)) : [];

  // 3. Decide.
  const result = engine.computeDecision({
    config: ctx.config,
    request: context,
    now: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    carbon: { max_age_seconds: 300, signals },
    ...(ctx.previous ? { previous: ctx.previous } : {})
  });
  if (!result.ok) return { error: result.error };
  const decision = result.value;

  const selected = decision.candidates.find((c) => c.backend_id === decision.selected_backend_id);
  const backend = selected ? BACKENDS[selected.backend_id] : undefined;
  // Network time comes from the engine's own estimate; the rest is the backend.
  const latencyMs = Math.round((selected?.latency_ms ?? 0) + (backend?.baseLatencyMs ?? 0) + request.kilobytes * 0.4);
  const energyJ = energyJoules(latencyMs, request.kilobytes);

  const carbonOf = (id: string | null) =>
    decision.candidates.find((c) => c.backend_id === id)?.carbon.used_g_per_kwh;
  const chosenCarbon = carbonOf(decision.selected_backend_id);
  const worstCarbon = decision.candidates
    .filter((c) => c.rejections.length === 0)
    .reduce<number | undefined>((worst, c) => {
      const value = c.carbon.used_g_per_kwh;
      return value === undefined ? worst : Math.max(worst ?? value, value);
    }, undefined);

  const co2eMg = chosenCarbon === undefined ? 0 : co2eMilligrams(energyJ, chosenCarbon);
  const savedMg =
    chosenCarbon === undefined || worstCarbon === undefined
      ? 0
      : Math.max(0, co2eMilligrams(energyJ, worstCarbon) - co2eMg);

  return { id: nextId++, request, decision, signals, latencyMs, co2eMg, savedMg };
}

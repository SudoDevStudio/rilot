// Maps playground state to rilot-core's DecisionInput. Pure data mapping:
// rule resolution, eligibility, scoring, hysteresis and fallback all happen
// inside rilot-core.
import { DEFAULT_SIM, type PlaygroundState } from '../model/ui-types';
import type { BackendRuntime, DecisionInput, DecisionOutput } from '@rilot/core-js';
import type { EngineResult, RilotEngine } from './wasm';
import { SIMULATED_NOW, simulatedSignals } from './fixtures';

export function buildDecisionInput(state: PlaygroundState, now: string = SIMULATED_NOW): DecisionInput {
  const backends = Array.isArray(state.config.backends) ? state.config.backends : [];
  const runtime: Record<string, BackendRuntime> = {};
  for (const backend of backends) {
    const sim = state.sim[backend.id] ?? DEFAULT_SIM;
    runtime[backend.id] = {
      ...(sim.latencyMs !== null ? { latency_ms: Math.max(0, sim.latencyMs) } : {}),
      error_rate: Math.min(1, Math.max(0, sim.errorRatePercent / 100)),
      ...(sim.healthy ? {} : { healthy: false })
    };
  }

  return {
    config: state.config,
    request: { path: state.path, user_region: state.userRegion },
    now,
    carbon: {
      max_age_seconds: state.carbon.maxAgeSeconds,
      signals: simulatedSignals(
        backends.map((b) => b.carbon_region ?? b.region),
        state.carbonByRegion,
        state.carbon.signalAgeSeconds,
        state.carbon.source,
        now
      )
    },
    runtime,
    ...(state.activeBackendId ? { previous: { backend_id: state.activeBackendId, since: now } } : {})
  };
}

/**
 * Runs the same two-step flow as native Rilot and edge adapters:
 * `plan()` first, then fetch carbon only for the regions the core asks for
 * (none for a latency policy), then `decide()`.
 */
export function runDecision(engine: RilotEngine, input: DecisionInput): EngineResult<DecisionOutput> & { input: DecisionInput } {
  const planned = engine.plan({ config: input.config, request: input.request, runtime: input.runtime });
  if (!planned.ok) return { ...planned, input };
  const wanted = new Set(planned.value.carbon_regions);
  const fetched: DecisionInput = {
    ...input,
    carbon: { ...input.carbon, signals: (input.carbon?.signals ?? []).filter((s) => wanted.has(s.region)) }
  };
  return { ...engine.computeDecision(fetched), input: fetched };
}

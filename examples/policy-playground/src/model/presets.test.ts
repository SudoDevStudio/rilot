import { describe, expect, it } from 'vitest';
import { buildDecisionInput, runDecision } from '../rilot/config';
import { testEngine } from '../rilot/test-engine';
import type { DecisionOutput } from '@rilot/core-js';
import { clonePresetState } from './presets';
import type { PlaygroundState } from './ui-types';

async function decide(state: PlaygroundState): Promise<DecisionOutput> {
  const result = runDecision(await testEngine(), buildDecisionInput(state));
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const kinds = (out: DecisionOutput, id: string) =>
  out.candidates.find((c) => c.backend_id === id)?.rejections.map((r) => r.kind);

describe('production presets (routing rules)', () => {
  it('checkout: /checkout/* rule, latency policy, 800 km, no carbon lookup', async () => {
    const out = await decide(clonePresetState('checkout'));
    expect(out.effective).toMatchObject({
      matched_rule: { path: '/checkout/*' },
      policy: 'latency',
      policy_source: 'rule',
      radius_km: 800,
      radius_source: 'rule',
      fallback: 'nearest',
      fallback_source: 'root',
      backends_source: 'root'
    });
    expect(out.needs_carbon).toBe(false);
    expect(out.selected_backend_id).toBe('east');
    expect(out.reason.code).toBe('lowest-latency');
    expect(kinds(out, 'west')).toEqual(['outside-radius']);
    expect(out.candidates.find((c) => c.backend_id === 'east')?.latency_source).toBe('distance-estimate');
    expect(out.candidates.every((c) => c.carbon.status === 'not-requested')).toBe(true);
  });

  it('recommendations: no rule matches, root balanced 2000 km applies', async () => {
    const out = await decide(clonePresetState('recommendations'));
    expect(out.effective.matched_rule).toBeNull();
    expect(out.effective).toMatchObject({ policy: 'balanced', policy_source: 'root', radius_km: 2000 });
    expect(out.selected_backend_id).toBe('east');
    expect(kinds(out, 'west')).toEqual(['outside-radius']);
  });

  it('reports: /reports/* carbon policy reaches the clean west coast; Stockholm is outside 5000 km', async () => {
    const out = await decide(clonePresetState('reports'));
    expect(out.effective).toMatchObject({ matched_rule: { path: '/reports/*' }, policy: 'carbon', radius_km: 5000 });
    expect(out.selected_backend_id).toBe('west');
    expect(kinds(out, 'stockholm')).toEqual(['outside-radius']);
    expect(out.carbon_saved_vs_worst_g_per_kwh).toBeGreaterThan(0);
    // Carbon is fetched only for regions that survived the radius filter.
    expect(out.candidates.find((c) => c.backend_id === 'stockholm')?.carbon.status).toBe('not-requested');
  });

  it('a region with no carbon signal is reported as carbon unavailable', async () => {
    const state = clonePresetState('reports');
    state.carbonByRegion['us-west-2'] = null;
    const out = await decide(state);
    expect(kinds(out, 'west')).toEqual(['carbon-unavailable']);
    expect(out.selected_backend_id).not.toBe('west');
  });
});

describe('research presets run through rilot-core', () => {
  it('local pinned interactive keeps traffic in the user region', async () => {
    const out = await decide(clonePresetState('local-pinned-interactive'));
    expect(out.selected_backend_id).toBe('us-east');
    expect(kinds(out, 'eu-central')).toContain('region-constraint');
  });

  it('balanced routing blocks far regions with latency guardrails', async () => {
    const out = await decide(clonePresetState('balanced-routing'));
    expect(out.selected_backend_id).toBe('us-east');
    expect(kinds(out, 'eu-central')).toContain('latency-constraint');
    expect(kinds(out, 'us-west')).toEqual([]);
  });

  it('carbon-first background picks the cleanest region', async () => {
    const out = await decide(clonePresetState('carbon-first-background'));
    expect(out.selected_backend_id).toBe('eu-central');
    expect(out.reason.code).toBe('score-win');
  });

  it('cleaner but rejected keeps the fast region and explains why', async () => {
    const out = await decide(clonePresetState('cleaner-but-rejected'));
    expect(out.selected_backend_id).toBe('us-east');
    expect(kinds(out, 'us-west')).toContain('latency-constraint');
  });

  it('hysteresis keeps the active backend when the gain is small', async () => {
    const out = await decide(clonePresetState('hysteresis-prevents-flapping'));
    expect(out.selected_backend_id).toBe('us-east');
    expect(out.reason.code).toBe('hysteresis-sticky-zone');
  });

  it('every candidate rejected falls back to the nearest backend', async () => {
    const state = clonePresetState('balanced-routing');
    state.config.advanced = { ...state.config.advanced, hard_max_latency_ms: 10 };
    const out = await decide(state);
    expect(out.fallback_used).toBe(true);
    expect(out.reason.code).toBe('fallback-nearest');
    expect(out.selected_backend_id).toBe('us-east');
  });

  it('stale carbon makes carbon-aware routing fall back', async () => {
    const state = clonePresetState('carbon-first-background');
    state.carbon.signalAgeSeconds = 900;
    const out = await decide(state);
    expect(out.candidates.every((c) => c.carbon.status === 'stale')).toBe(true);
    expect(out.fallback_used).toBe(true);
  });

  it('unhealthy backends are reported as a health constraint', async () => {
    const state = clonePresetState('balanced-routing');
    state.sim['us-east'] = { ...state.sim['us-east'], healthy: false };
    const out = await decide(state);
    expect(kinds(out, 'us-east')).toContain('health-constraint');
    expect(out.selected_backend_id).not.toBe('us-east');
  });

  it('signal source is carried through to every candidate', async () => {
    const state = clonePresetState('reports');
    state.carbon.source = 'last-known-good';
    const out = await decide(state);
    expect(out.candidates.find((c) => c.backend_id === 'west')?.carbon.source).toBe('last-known-good');
  });
});

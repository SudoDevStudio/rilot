import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { testEngine } from './test-engine';
import type { DecisionInput, DecisionOutput } from '@rilot/core-js';

type Fixture = { name: string; input: DecisionInput; expect: Record<string, unknown> };

const fixtureDir = fileURLToPath(new URL('../../../../fixtures/decisions/', import.meta.url));
const fixtures: Fixture[] = readdirSync(fixtureDir)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => JSON.parse(readFileSync(fixtureDir + file, 'utf8')) as Fixture);

function actualFor(key: string, out: DecisionOutput): unknown {
  if (key === 'reason_code') return out.reason.code;
  if (key === 'rejections') {
    return Object.fromEntries(out.candidates.map((c) => [c.backend_id, c.rejections.map((r) => r.kind)]));
  }
  return (out as unknown as Record<string, unknown>)[key];
}

describe('rilot-core.wasm through the browser adapter', () => {
  it('loads and reports a version', async () => {
    const engine = await testEngine();
    expect(engine.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each(fixtures.map((f) => [f.name, f] as const))('shared fixture: %s', async (_name, fixture) => {
    const engine = await testEngine();
    const result = engine.computeDecision(fixture.input);
    if (!result.ok) throw new Error(result.error);
    for (const [key, want] of Object.entries(fixture.expect)) {
      const got = actualFor(key, result.value);
      if (key === 'rejections') expect(got).toEqual(want);
      else expect(got).toMatchObject(want as object);
    }
  });

  it('returns UI-safe errors instead of throwing', async () => {
    const engine = await testEngine();
    const result = engine.computeDecision({ config: { backends: [] }, request: { path: '/' }, now: '2026-09-18T20:00:00Z' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('at least one backend');
  });

  it('resolves routing-rule inheritance', async () => {
    const engine = await testEngine();
    const result = engine.resolveConfig(
      {
        backends: [{ id: 'east', region: 'us-east-1' }],
        policy: 'balanced',
        radius_km: 2000,
        fallback: 'nearest',
        routing_rules: [{ path: '/checkout/*', policy: 'latency', radius_km: 800 }]
      },
      '/checkout/pay'
    );
    expect(result.ok && result.value).toMatchObject({
      matched_rule: { path: '/checkout/*' },
      policy: 'latency',
      policy_source: 'rule',
      radius_km: 800,
      fallback_source: 'root',
      backends_source: 'root'
    });
  });
});

import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DecisionOutput } from '../../../packages/rilot-js/src/index';
import { resetCarbonMemoryCache } from '../src/carbon';
import worker from '../src/index';

// Virginia-ish coordinates, as Cloudflare would supply them.
const CF = { latitude: '38.95', longitude: '-77.45', colo: 'IAD' };

const CONFIG = {
  carbon: { provider: 'static', max_age_seconds: 300, zone_current: { 'us-east-1': 390, 'us-west-2': 90 } },
  backends: [
    { id: 'east', region: 'us-east-1', url: 'https://east.example.com' },
    { id: 'west', region: 'us-west-2', url: 'https://west.example.com' },
    { id: 'dublin', region: 'eu-west-1', url: 'https://dublin.example.com' }
  ],
  policy: 'balanced',
  radius_km: 6000,
  fallback: 'nearest',
  routing_rules: [
    { path: '/checkout/*', policy: 'latency', radius_km: 1500 },
    { path: '/reports/*', policy: 'carbon' }
  ]
};

async function call(path: string, options: { config?: unknown; headers?: Record<string, string> } = {}) {
  const url = new URL(`https://edge.example.com${path}`);
  const request = new Request(url, { headers: options.headers, cf: CF as unknown as IncomingRequestCfProperties });
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    request,
    { ...env, RILOT_CONFIG: JSON.stringify(options.config ?? CONFIG) },
    ctx
  );
  await waitOnExecutionContext(ctx);
  return response;
}

const decisionFor = async (path: string, options: Parameters<typeof call>[1] = {}) => {
  const response = await call(`/__rilot/decision?path=${encodeURIComponent(path)}`, options);
  expect(response.status).toBe(200);
  return (await response.json()) as {
    request: { user_location?: { lat: number }; user_region?: string };
    carbon_signals: { region: string; source?: string }[];
    decision: DecisionOutput;
  };
};

describe('Rilot Cloudflare Worker', () => {
  // This pool version does not isolate storage per test, so start each test
  // with an empty cache and an empty KV namespace.
  beforeEach(async () => {
    resetCarbonMemoryCache();
    const { keys } = await env.CARBON_KV.list();
    await Promise.all(keys.map((key) => env.CARBON_KV.delete(key.name)));
  });

  it('reports health and the linked engine version', async () => {
    const response = await call('/__rilot/health');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; engine: string; backends: string[] };
    expect(body.ok).toBe(true);
    expect(body.engine).toMatch(/^rilot-core \d+\.\d+\.\d+$/);
    expect(body.backends).toEqual(['east', 'west', 'dublin']);
  });

  it('uses Cloudflare coordinates for radius and distance', async () => {
    const { request, decision } = await decisionFor('/reports/monthly');
    expect(request.user_location?.lat).toBeCloseTo(38.95, 2);
    expect(decision.user.location_source).toBe('request');
    expect(decision.user.radius_applied).toBe(true);
    const east = decision.candidates.find((c) => c.backend_id === 'east');
    expect(east?.distance_km).toBeLessThan(100);
    expect(east?.latency_source).toBe('distance-estimate');
  });

  it('a location header overrides Cloudflare geolocation', async () => {
    // CF puts us in Virginia; the header moves us to Dublin.
    const { request, decision } = await decisionFor('/reports/monthly', {
      headers: { 'x-user-location': '53.35,-6.26' }
    });
    expect(request.user_location?.lat).toBeCloseTo(53.35, 2);
    expect(decision.user.location_source).toBe('request');
    const dublin = decision.candidates.find((c) => c.backend_id === 'dublin');
    expect(dublin?.distance_km).toBeLessThan(100);
  });

  it('ignores an unparseable location header and falls back to Cloudflare', async () => {
    const { request } = await decisionFor('/reports/monthly', {
      headers: { 'x-user-location': 'somewhere-nice' }
    });
    expect(request.user_location?.lat).toBeCloseTo(38.95, 2);
  });

  it('applies the /checkout/* rule and skips carbon entirely', async () => {
    const { decision, carbon_signals } = await decisionFor('/checkout/pay');
    expect(decision.effective.matched_rule?.path).toBe('/checkout/*');
    expect(decision.effective.policy).toBe('latency');
    expect(decision.effective.radius_km).toBe(1500);
    expect(decision.needs_carbon).toBe(false);
    expect(carbon_signals).toEqual([]);
    expect(decision.selected_backend_id).toBe('east');
    expect(decision.candidates.find((c) => c.backend_id === 'dublin')?.rejections[0]?.kind).toBe('outside-radius');
  });

  it('routes carbon-sensitive paths to the cleaner region', async () => {
    const { decision } = await decisionFor('/reports/monthly');
    expect(decision.effective.policy).toBe('carbon');
    expect(decision.selected_backend_id).toBe('west');
    expect(decision.carbon_saved_vs_worst_g_per_kwh).toBeGreaterThan(0);
  });

  it('honours the x-rilot-carbon-cursor header', async () => {
    const { decision } = await decisionFor('/reports/monthly', { headers: { 'x-rilot-carbon-cursor': 'off' } });
    expect(decision.needs_carbon).toBe(false);
    expect(decision.effective.policy).toBe('latency');
    expect(decision.selected_backend_id).toBe('east');
  });

  it('serves a fresh signal from Workers KV without calling a provider', async () => {
    await env.CARBON_KV.put(
      'carbon:eu-west-1',
      JSON.stringify({ region: 'eu-west-1', carbon_g_per_kwh: 5, observed_at: new Date().toISOString() })
    );
    const config = { ...CONFIG, carbon: { provider: 'none', max_age_seconds: 300 }, radius_km: null };
    const { decision, carbon_signals } = await decisionFor('/reports/monthly', { config });
    expect(carbon_signals.find((s) => s.region === 'eu-west-1')?.source).toBe('last-known-good');
    expect(decision.selected_backend_id).toBe('dublin');
    expect(decision.candidates.find((c) => c.backend_id === 'east')?.rejections[0]?.kind).toBe('carbon-unavailable');
  });

  it('stores fetched signals in KV as last-known-good', async () => {
    await decisionFor('/reports/monthly');
    const stored = await env.CARBON_KV.get('carbon:us-west-2');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).carbon_g_per_kwh).toBe(90);
  });

  it('falls back and explains itself when carbon is unavailable', async () => {
    const config = { ...CONFIG, carbon: { provider: 'none' }, policy: 'carbon' };
    const { decision } = await decisionFor('/api/items', { config });
    expect(decision.fallback_used).toBe(true);
    expect(decision.reason.code).toBe('fallback-nearest');
    expect(decision.reason.message).toContain('nearest');
  });

  describe('the carbon API', () => {
    it('serves every backend region with its age and staleness', async () => {
      const response = await call('/__rilot/carbon');
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('cache-control')).toMatch(/^public, max-age=\d+$/);
      const body = (await response.json()) as {
        max_age_seconds: number;
        asked_for: string[];
        missing: string[];
        signals: { region: string; carbon_g_per_kwh: number; age_seconds: number | null; stale: boolean }[];
      };
      expect(body.max_age_seconds).toBe(300);
      expect(body.asked_for).toEqual(['us-east-1', 'us-west-2', 'eu-west-1']);
      const east = body.signals.find((s) => s.region === 'us-east-1');
      expect(east?.carbon_g_per_kwh).toBe(390);
      expect(east?.stale).toBe(false);
      expect(east?.age_seconds).toBeGreaterThanOrEqual(0);
      // The static provider has no value for Dublin, and the API says so.
      expect(body.missing).toEqual(['eu-west-1']);
    });

    it('filters to the regions asked for, and rejects unknown ones', async () => {
      const ok = await call('/__rilot/carbon?regions=us-west-2');
      const body = (await ok.json()) as { asked_for: string[]; signals: { region: string }[] };
      expect(body.asked_for).toEqual(['us-west-2']);
      expect(body.signals.map((s) => s.region)).toEqual(['us-west-2']);

      const bad = await call('/__rilot/carbon?regions=mars-1');
      expect(bad.status).toBe(400);
      expect((await bad.json() as { known: string[] }).known).toContain('us-east-1');
    });

    it('answers from KV without calling the provider', async () => {
      await env.CARBON_KV.put(
        'carbon:us-east-1',
        JSON.stringify({ region: 'us-east-1', carbon_g_per_kwh: 111, observed_at: new Date().toISOString() })
      );
      const response = await call('/__rilot/carbon?regions=us-east-1');
      const body = (await response.json()) as { signals: { carbon_g_per_kwh: number; source?: string }[] };
      expect(body.signals[0].carbon_g_per_kwh).toBe(111);
    });
  });

  describe('the session policy cookie', () => {
    const cookie = (value: string) => ({ headers: { cookie: `sid=1; rilot_policy=${encodeURIComponent(value)}` } });

    it('routes by the policy the cookie asks for, and says it came from the request', async () => {
      // Without the cookie /products is balanced, and Oregon's much cleaner
      // grid (90 vs 390) outweighs Virginia being closer.
      const plain = await decisionFor('/products');
      expect(plain.decision.effective.policy).toBe('balanced');
      expect(plain.decision.effective.policy_source).toBe('root');
      expect(plain.decision.selected_backend_id).toBe('west');

      // A session that asked for speed gets the nearest backend instead.
      const chosen = await decisionFor('/products', cookie('/products/*:latency'));
      expect(chosen.decision.effective.policy).toBe('latency');
      expect(chosen.decision.effective.policy_source).toBe('request');
      expect(chosen.decision.selected_backend_id).toBe('east');
      expect(chosen.carbon_signals).toEqual([]); // latency never asks for carbon
    });

    it('matches patterns with rule specificity and ignores paths it does not cover', async () => {
      const value = '/*:carbon,/products/bottle:latency';
      expect((await decisionFor('/products/bottle', cookie(value))).decision.effective.policy).toBe('latency');
      expect((await decisionFor('/products/tote', cookie(value))).decision.effective.policy).toBe('carbon');

      const narrow = cookie('/products/*:carbon');
      expect((await decisionFor('/cart', narrow)).decision.effective.policy).toBe('balanced');
    });

    it('cannot make the checkout carbon-aware, because latency skips carbon', async () => {
      const { decision, carbon_signals } = await decisionFor('/checkout/pay', cookie('/checkout/*:latency'));
      expect(decision.effective.policy).toBe('latency');
      expect(carbon_signals).toEqual([]);
    });

    it('lets an explicit header win over the cookie', async () => {
      const { decision } = await decisionFor('/products', {
        headers: { cookie: 'rilot_policy=%2Fproducts%2F*%3Acarbon', 'x-rilot-policy': 'latency' }
      });
      expect(decision.effective.policy).toBe('latency');
    });

    it('ignores a malformed cookie rather than failing the request', async () => {
      const { decision } = await decisionFor('/products', {
        headers: { cookie: 'rilot_policy=not-a-rule;;;' }
      });
      expect(decision.effective.policy).toBe('balanced');
      expect(decision.effective.policy_source).toBe('root');
    });
  });

  it('rejects an invalid config with a clear message', async () => {
    const response = await call('/__rilot/decision?path=/', { config: { backends: [] } });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('at least one backend');
  });

  it('returns 503 with the reason when no backend can serve', async () => {
    const config = { ...CONFIG, carbon: { provider: 'none' }, policy: 'carbon', fallback: 'none' };
    const response = await call('/api/items', { config });
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string; reason: { code: string } };
    expect(body.error).toBe('No eligible backend');
    expect(body.reason.code).toBe('no-eligible-backend');
  });
});

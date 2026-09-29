// The Vercel adapter, driven exactly as its runtime drives it: a Request in,
// a Response out. No platform emulator is needed, because everything the
// platform provides — geolocation, environment, KV — arrives as data.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEngine, type DecisionOutput, type RilotEngine } from '../../../packages/rilot-js/src/index';
import { resetCarbonMemoryCache } from '../src/carbon';
import { createHandler, vercelLocation } from '../src/handler';
import type { Env } from '../src/env';

const wasmPath = fileURLToPath(
  new URL('../../../target/wasm32-unknown-unknown/wasm/rilot_wasm.wasm', import.meta.url)
);

let engine: RilotEngine;

beforeEach(async () => {
  engine ??= await loadEngine(readFileSync(wasmPath));
  resetCarbonMemoryCache();
});

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

/** Virginia-ish coordinates, as Vercel supplies them. */
const GEO = { 'x-vercel-ip-latitude': '38.95', 'x-vercel-ip-longitude': '-77.45' };

type CallOptions = {
  config?: unknown;
  headers?: Record<string, string>;
  env?: Partial<Env>;
  fetch?: typeof fetch;
};

function call(path: string, options: CallOptions = {}) {
  const env: Env = {
    RILOT_CONFIG: JSON.stringify(options.config ?? CONFIG),
    VERCEL_REGION: 'iad1',
    ...options.env
  };
  const handler = createHandler({
    engine,
    env,
    ...(options.fetch ? { wiring: { fetch: options.fetch } } : {})
  });
  const request = new Request(`https://rilot.vercel.app${path}`, {
    headers: { ...GEO, ...options.headers }
  });
  return handler(request);
}

const decisionFor = async (path: string, options: CallOptions = {}) => {
  const response = await call(`/__rilot/decision?path=${encodeURIComponent(path)}`, options);
  expect(response.status).toBe(200);
  return (await response.json()) as {
    request: { user_location?: { lat: number }; user_region?: string };
    carbon_signals: { region: string; source?: string }[];
    decision: DecisionOutput;
  };
};

describe('Rilot Vercel adapter', () => {
  it('reports health, the linked engine and the serving region', async () => {
    const response = await call('/__rilot/health');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; engine: string; backends: string[]; region: string };
    expect(body.ok).toBe(true);
    expect(body.engine).toMatch(/^rilot-core \d+\.\d+\.\d+$/);
    expect(body.backends).toEqual(['east', 'west', 'dublin']);
    expect(body.region).toBe('iad1');
  });

  it('falls back to x-vercel-id when VERCEL_REGION is not set', async () => {
    const response = await call('/__rilot/health', {
      env: { VERCEL_REGION: undefined },
      headers: { 'x-vercel-id': 'fra1::abc123-1700000000000-deadbeef' }
    });
    expect(((await response.json()) as { region: string }).region).toBe('fra1');
  });

  it('uses the x-vercel-ip-* headers for radius and distance', async () => {
    const { request, decision } = await decisionFor('/reports/monthly');
    expect(request.user_location?.lat).toBeCloseTo(38.95, 2);
    expect(decision.user.location_source).toBe('request');
    expect(decision.candidates.every((c) => c.distance_km !== undefined)).toBe(true);
  });

  it('lets a location header override Vercel geolocation', async () => {
    const { request, decision } = await decisionFor('/reports/monthly', {
      headers: { 'x-user-location': '53.35,-6.26' } // Dublin
    });
    expect(request.user_location?.lat).toBeCloseTo(53.35, 2);
    const dublin = decision.candidates.find((c) => c.backend_id === 'dublin');
    expect(Math.round(dublin?.distance_km ?? Infinity)).toBeLessThan(100);
  });

  it('ignores an unparseable location header and falls back to Vercel', async () => {
    const { request } = await decisionFor('/reports/monthly', { headers: { 'x-user-location': 'somewhere' } });
    expect(request.user_location?.lat).toBeCloseTo(38.95, 2);
  });

  it('applies the /checkout/* rule and skips carbon entirely', async () => {
    const { decision, carbon_signals } = await decisionFor('/checkout/pay');
    expect(decision.effective.policy).toBe('latency');
    expect(decision.needs_carbon).toBe(false);
    expect(carbon_signals).toEqual([]);
    expect(decision.selected_backend_id).toBe('east');
  });

  it('routes carbon-sensitive paths to the cleaner region', async () => {
    const { decision } = await decisionFor('/reports/monthly');
    expect(decision.effective.policy).toBe('carbon');
    expect(decision.selected_backend_id).toBe('west'); // 90 vs 390 gCO2/kWh
  });

  it('rejects an invalid config with a clear message', async () => {
    const response = await call('/__rilot/decision?path=/', { config: { backends: [] } });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('at least one backend');
  });

  it('explains a missing config instead of failing obscurely', async () => {
    const response = await call('/__rilot/health', { env: { RILOT_CONFIG: '' } });
    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toMatch(/RILOT_CONFIG/);
  });

  describe('forwarding', () => {
    it('sends the request to the selected backend, keeping path and query', async () => {
      const seen: string[] = [];
      const fakeFetch = vi.fn(async (input: Request | string | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        seen.push(url);
        return new Response('hello', { status: 200 });
      }) as unknown as typeof fetch;

      const response = await call('/reports/monthly?range=90d', { fetch: fakeFetch });
      expect(response.status).toBe(200);
      expect(seen).toEqual(['https://west.example.com/reports/monthly?range=90d']);
    });

    it('adds the research headers only when the deployment opts in', async () => {
      const fakeFetch = (async () => new Response('ok')) as unknown as typeof fetch;

      const quiet = await call('/reports/monthly', { fetch: fakeFetch });
      expect(quiet.headers.get('x-rilot-selected-zone')).toBeNull();

      const loud = await call('/reports/monthly', {
        fetch: fakeFetch,
        env: { RILOT_EXPOSE_RESEARCH_HEADERS: 'true' }
      });
      expect(loud.headers.get('x-rilot-selected-zone')).toBe('west');
      expect(loud.headers.get('x-rilot-decision-reason')).toBeTruthy();
    });

    it('returns 503 with the reason when no backend can serve', async () => {
      const response = await call('/checkout/pay', {
        // Every backend is far outside the 1500 km checkout radius.
        headers: { 'x-user-location': '1.35,103.82' },
        config: { ...CONFIG, fallback: 'none' }
      });
      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: string; reason: { code: string } };
      expect(body.error).toBe('No eligible backend');
      expect(body.reason.code).toBe('no-eligible-backend');
    });
  });

  describe('the carbon API', () => {
    it('serves every backend region with its age and staleness', async () => {
      const response = await call('/__rilot/carbon');
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      const body = (await response.json()) as {
        max_age_seconds: number;
        asked_for: string[];
        missing: string[];
        signals: { region: string; carbon_g_per_kwh: number; age_seconds: number | null; stale: boolean }[];
      };
      expect(body.max_age_seconds).toBe(300);
      expect(body.asked_for).toEqual(['us-east-1', 'us-west-2', 'eu-west-1']);
      expect(body.signals.find((s) => s.region === 'us-east-1')?.carbon_g_per_kwh).toBe(390);
      expect(body.signals.find((s) => s.region === 'us-east-1')?.stale).toBe(false);
      // The static provider has no value for Dublin, and the API says so.
      expect(body.missing).toEqual(['eu-west-1']);
    });

    it('filters to the regions asked for, and rejects unknown ones', async () => {
      const ok = await call('/__rilot/carbon?regions=us-west-2');
      expect(((await ok.json()) as { asked_for: string[] }).asked_for).toEqual(['us-west-2']);

      const bad = await call('/__rilot/carbon?regions=mars-1');
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { known: string[] }).known).toContain('us-east-1');
    });
  });

  describe('Vercel KV as last-known-good storage', () => {
    /** A fake Upstash REST endpoint, so the transport itself is exercised. */
    function fakeKv(seed: Record<string, string> = {}) {
      const store = new Map(Object.entries(seed));
      const calls: string[][] = [];
      const fetchImpl = vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (!url.startsWith('https://kv.example.com')) {
          return new Response('backend', { status: 200 });
        }
        const command = JSON.parse(String(init?.body ?? '[]')) as string[];
        calls.push(command);
        if (command[0] === 'GET') {
          return Response.json({ result: store.get(command[1]) ?? null });
        }
        if (command[0] === 'SET') {
          store.set(command[1], command[2]);
          return Response.json({ result: 'OK' });
        }
        return Response.json({ error: `unsupported: ${command[0]}` }, { status: 400 });
      }) as unknown as typeof fetch;
      return { fetchImpl, calls, store };
    }

    const kvEnv = { KV_REST_API_URL: 'https://kv.example.com', KV_REST_API_TOKEN: 'secret' };

    it('serves a fresh signal from KV without calling the provider', async () => {
      const fresh = JSON.stringify({
        region: 'us-east-1',
        carbon_g_per_kwh: 111,
        observed_at: new Date().toISOString()
      });
      const kv = fakeKv({ 'carbon:us-east-1': fresh });

      const response = await call('/__rilot/carbon?regions=us-east-1', { env: kvEnv, fetch: kv.fetchImpl });
      const body = (await response.json()) as { signals: { carbon_g_per_kwh: number }[] };
      expect(body.signals[0].carbon_g_per_kwh).toBe(111);
      expect(kv.calls[0]).toEqual(['GET', 'carbon:us-east-1']);
    });

    it('writes fetched signals back with a TTL', async () => {
      const kv = fakeKv();
      await call('/__rilot/carbon?regions=us-east-1', { env: kvEnv, fetch: kv.fetchImpl });
      // The write is scheduled, so give the microtask queue a turn.
      await new Promise((resolve) => setTimeout(resolve, 0));

      const set = kv.calls.find((c) => c[0] === 'SET');
      expect(set?.[1]).toBe('carbon:us-east-1');
      expect(Number(set?.[4])).toBeGreaterThanOrEqual(60);
      expect(JSON.parse(String(set?.[2])).carbon_g_per_kwh).toBe(390);
    });

    it('keeps routing when the KV store is unreachable', async () => {
      const broken = (async (input: Request | string | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.startsWith('https://kv.example.com')) return new Response('nope', { status: 500 });
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;

      const { decision } = await decisionFor('/reports/monthly', { env: kvEnv, fetch: broken });
      expect(decision.selected_backend_id).toBe('west');
    });
  });

  describe('the session policy cookie', () => {
    const cookie = (value: string) => ({ headers: { cookie: `sid=1; rilot_policy=${encodeURIComponent(value)}` } });

    it('routes by the policy the cookie asks for, and says it came from the request', async () => {
      const plain = await decisionFor('/products');
      expect(plain.decision.effective.policy).toBe('balanced');
      expect(plain.decision.selected_backend_id).toBe('west');

      const chosen = await decisionFor('/products', cookie('/products/*:latency'));
      expect(chosen.decision.effective.policy).toBe('latency');
      expect(chosen.decision.effective.policy_source).toBe('request');
      expect(chosen.decision.selected_backend_id).toBe('east');
      expect(chosen.carbon_signals).toEqual([]);
    });

    it('cannot make the checkout carbon-aware', async () => {
      const { decision, carbon_signals } = await decisionFor('/checkout/pay', cookie('/checkout/*:carbon'));
      expect(decision.effective.policy).toBe('carbon');
      // The rule's 1500 km radius still applies, so nothing distant slips in.
      expect(decision.effective.radius_km).toBe(1500);
      expect(carbon_signals.length).toBeGreaterThan(0);
    });

    it('ignores a malformed cookie rather than failing the request', async () => {
      const { decision } = await decisionFor('/products', { headers: { cookie: 'rilot_policy=not-a-rule;;;' } });
      expect(decision.effective.policy).toBe('balanced');
      expect(decision.effective.policy_source).toBe('root');
    });
  });

  describe('vercelLocation', () => {
    it('reads the header pair, and rejects nonsense', () => {
      expect(vercelLocation(new Headers(GEO))).toEqual({ lat: 38.95, lon: -77.45 });
      expect(vercelLocation(new Headers({}))).toBeUndefined();
      expect(vercelLocation(new Headers({ 'x-vercel-ip-latitude': '38.95' }))).toBeUndefined();
      expect(
        vercelLocation(new Headers({ 'x-vercel-ip-latitude': '99', 'x-vercel-ip-longitude': '0' }))
      ).toBeUndefined();
    });
  });
});

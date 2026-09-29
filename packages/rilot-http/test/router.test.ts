// The layer every JavaScript adapter shares.
//
// The Cloudflare and Vercel suites prove their own wiring; these prove the
// behaviour underneath both, so a change here fails once rather than twice —
// and so the pure helpers are covered directly instead of by inference.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CarbonService } from '../../rilot-carbon/src/index';
import { loadEngine, type CarbonSignal, type RilotEngine } from '../../rilot-js/src/index';
import {
  buildRequestContext,
  describeSignal,
  handleRequest,
  knownRegions,
  maxAgeSeconds,
  parseLocation,
  requestHints,
  type Host
} from '../src/index';

const wasmPath = fileURLToPath(
  new URL('../../../target/wasm32-unknown-unknown/wasm/rilot_wasm.wasm', import.meta.url)
);

let engine: RilotEngine;

beforeAll(async () => {
  engine = await loadEngine(readFileSync(wasmPath));
});

const CONFIG = {
  carbon: { max_age_seconds: 300 },
  backends: [
    { id: 'east', region: 'us-east-1', url: 'https://east.example.com' },
    { id: 'west', region: 'us-west-2', url: 'https://west.example.com' }
  ],
  policy: 'balanced' as const,
  radius_km: 6000,
  fallback: 'nearest' as const,
  routing_rules: [
    { path: '/checkout/*', policy: 'latency' as const, radius_km: 1500 },
    { path: '/reports/*', policy: 'carbon' as const }
  ]
};

const now = () => new Date().toISOString();

/** A carbon service that answers from a fixed table, with no I/O. */
function stubCarbon(intensities: Record<string, number>): CarbonService {
  return {
    async getSignals(regions: string[]): Promise<CarbonSignal[]> {
      return regions
        .filter((region) => region in intensities)
        .map((region) => ({ region, carbon_g_per_kwh: intensities[region], observed_at: now() }));
    }
  } as unknown as CarbonService;
}

function host(overrides: Partial<Host> = {}): Host {
  return {
    engine,
    config: CONFIG,
    carbon: stubCarbon({ 'us-east-1': 390, 'us-west-2': 90 }),
    location: { lat: 38.95, lon: -77.45 }, // Virginia
    ...overrides
  };
}

const get = (url: string, headers: Record<string, string> = {}) =>
  new Request(`https://edge.example.com${url}`, { headers });

describe('parseLocation', () => {
  it('accepts a pair, with or without spaces', () => {
    expect(parseLocation('51.5,-0.13')).toEqual({ lat: 51.5, lon: -0.13 });
    expect(parseLocation(' 51.5 , -0.13 ')).toEqual({ lat: 51.5, lon: -0.13 });
  });

  it('treats anything else as location unknown', () => {
    for (const value of ['', 'somewhere', '51.5', '51.5,-0.13,7', '91,0', '0,181', 'a,b', null, undefined]) {
      expect(parseLocation(value)).toBeUndefined();
    }
  });
});

describe('requestHints', () => {
  const from = (headers: Record<string, string>) => requestHints((name) => headers[name] ?? null);

  it('reads a policy, a route class and the flags', () => {
    expect(from({ 'x-rilot-policy': 'carbon' }).policy).toBe('carbon');
    expect(from({ 'x-rilot-class': 'background' }).route_class).toBe('background');
    expect(from({ 'x-rilot-carbon-cursor': 'off' }).carbon_aware).toBe(false);
    expect(from({ 'x-rilot-forecasting': 'yes' }).forecasting).toBe(true);
    expect(from({ 'x-rilot-time-shift': '1' }).time_shift).toBe(true);
  });

  it('ignores values it does not understand instead of failing', () => {
    expect(from({ 'x-rilot-policy': 'teleport' }).policy).toBeUndefined();
    expect(from({ 'x-rilot-class': 'urgent' }).route_class).toBeUndefined();
    expect(from({ 'x-rilot-carbon-cursor': 'maybe' }).carbon_aware).toBeUndefined();
    expect(from({})).toEqual({});
  });
});

describe('buildRequestContext', () => {
  it('prefers the location header over what the platform reported', () => {
    const context = buildRequestContext({
      path: '/',
      headers: new Headers({ 'x-user-location': '53.35,-6.26' }),
      hostLocation: { lat: 38.95, lon: -77.45 }
    });
    expect(context.user_location).toEqual({ lat: 53.35, lon: -6.26 });
  });

  it('falls back to the platform when the header is unusable', () => {
    const context = buildRequestContext({
      path: '/',
      headers: new Headers({ 'x-user-location': 'nowhere' }),
      hostLocation: { lat: 38.95, lon: -77.45 }
    });
    expect(context.user_location).toEqual({ lat: 38.95, lon: -77.45 });
  });

  it('applies the session cookie, but only with an engine to parse it', () => {
    const headers = new Headers({ cookie: 'sid=1; rilot_policy=%2Freports%2F*%3Alatency' });
    expect(buildRequestContext({ path: '/reports/monthly', headers }).hints?.policy).toBeUndefined();
    expect(buildRequestContext({ path: '/reports/monthly', headers, engine }).hints?.policy).toBe('latency');
    // A path the cookie says nothing about is left alone.
    expect(buildRequestContext({ path: '/cart', headers, engine }).hints?.policy).toBeUndefined();
  });

  it('lets an explicit header win over the cookie', () => {
    const context = buildRequestContext({
      path: '/reports/monthly',
      headers: new Headers({ cookie: 'rilot_policy=/*:carbon', 'x-rilot-policy': 'latency' }),
      engine
    });
    expect(context.hints?.policy).toBe('latency');
  });
});

describe('carbon helpers', () => {
  it('works out age and staleness, and distrusts an unreadable timestamp', () => {
    const base = { region: 'us-east-1', carbon_g_per_kwh: 100 };
    const at = Date.parse('2026-01-01T00:10:00Z');

    const fresh = describeSignal({ ...base, observed_at: '2026-01-01T00:09:00Z' }, at, 300);
    expect(fresh.age_seconds).toBe(60);
    expect(fresh.stale).toBe(false);

    const old = describeSignal({ ...base, observed_at: '2026-01-01T00:00:00Z' }, at, 300);
    expect(old.age_seconds).toBe(600);
    expect(old.stale).toBe(true);

    const broken = describeSignal({ ...base, observed_at: 'not a date' }, at, 300);
    expect(broken.age_seconds).toBeNull();
    expect(broken.stale).toBe(true);
  });

  it('lists each backend region once, preferring an explicit carbon_region', () => {
    expect(knownRegions(CONFIG)).toEqual(['us-east-1', 'us-west-2']);
    expect(
      knownRegions({
        backends: [
          { id: 'a', region: 'us-east-1', carbon_region: 'US-MIDA', url: 'https://a' },
          { id: 'b', region: 'us-east-1', carbon_region: 'US-MIDA', url: 'https://b' }
        ]
      })
    ).toEqual(['US-MIDA']);
  });

  it('defaults max_age_seconds when the config does not set it', () => {
    expect(maxAgeSeconds(CONFIG)).toBe(300);
    expect(maxAgeSeconds({ backends: [] })).toBe(300);
    expect(maxAgeSeconds({ backends: [], carbon: { max_age_seconds: 60 } })).toBe(60);
  });
});

describe('handleRequest', () => {
  it('reports health, and lets the host add its own fields', async () => {
    const response = await handleRequest(get('/__rilot/health'), host({ health: { colo: 'IAD' } }));
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.engine).toMatch(/^rilot-core \d+\.\d+\.\d+$/);
    expect(body.backends).toEqual(['east', 'west']);
    expect(body.colo).toBe('IAD');
  });

  it('decides without forwarding, and never calls fetch doing it', async () => {
    let called = false;
    const response = await handleRequest(
      get('/__rilot/decision?path=/reports/monthly'),
      host({
        fetch: (async () => {
          called = true;
          return new Response('');
        }) as unknown as typeof fetch
      })
    );
    const body = (await response.json()) as { decision: { selected_backend_id: string } };
    expect(response.status).toBe(200);
    expect(body.decision.selected_backend_id).toBe('west'); // the cleaner grid
    expect(called).toBe(false);
  });

  it("answers 400 with the engine's message when the config is unusable", async () => {
    const response = await handleRequest(
      get('/__rilot/decision?path=/'),
      host({ config: { backends: [] } })
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('at least one backend');
  });

  it('serves the carbon endpoint with cache headers, and says what is missing', async () => {
    const response = await handleRequest(
      get('/__rilot/carbon'),
      host({ carbon: stubCarbon({ 'us-east-1': 390 }) })
    );
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe('public, max-age=150');
    const body = (await response.json()) as { asked_for: string[]; missing: string[] };
    expect(body.asked_for).toEqual(['us-east-1', 'us-west-2']);
    expect(body.missing).toEqual(['us-west-2']);
  });

  it('filters the carbon endpoint, and refuses a region it does not have', async () => {
    const ok = await handleRequest(get('/__rilot/carbon?regions=us-west-2'), host());
    expect(((await ok.json()) as { asked_for: string[] }).asked_for).toEqual(['us-west-2']);

    const bad = await handleRequest(get('/__rilot/carbon?regions=mars-1'), host());
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { known: string[] }).known).toEqual(['us-east-1', 'us-west-2']);
  });

  it('forwards to the selected backend, keeping the path and the query', async () => {
    const seen: string[] = [];
    const response = await handleRequest(
      get('/reports/monthly?range=90d'),
      host({
        fetch: (async (input: Request) => {
          seen.push(input.url);
          return new Response('report', { status: 200 });
        }) as unknown as typeof fetch
      })
    );
    expect(response.status).toBe(200);
    expect(seen).toEqual(['https://west.example.com/reports/monthly?range=90d']);
    // Off by default: the headers describe internal state.
    expect(response.headers.get('x-rilot-selected-zone')).toBeNull();
  });

  it('adds the research headers when the host opts in', async () => {
    const response = await handleRequest(
      get('/reports/monthly'),
      host({
        exposeResearchHeaders: true,
        fetch: (async () => new Response('report')) as unknown as typeof fetch
      })
    );
    expect(response.headers.get('x-rilot-selected-zone')).toBe('west');
    expect(response.headers.get('x-rilot-decision-reason')).toBeTruthy();
    expect(response.headers.get('x-rilot-zone-filter-reasons')).toContain('east');
  });

  it('answers 503 with the reason when nothing can serve', async () => {
    const response = await handleRequest(
      get('/checkout/pay'),
      host({ config: { ...CONFIG, fallback: 'none' }, location: { lat: 1.35, lon: 103.82 } })
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string; reason: { code: string } };
    expect(body.error).toBe('No eligible backend');
    expect(body.reason.code).toBe('no-eligible-backend');
  });

  it('remembers hysteresis state per matched rule when the host keeps a map', async () => {
    const previous = new Map();
    const h = host({ previous, fetch: (async () => new Response('ok')) as unknown as typeof fetch });
    await handleRequest(get('/reports/monthly'), h);
    expect([...previous.keys()]).toEqual(['/reports/*']);
  });
});

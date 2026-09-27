// Pins the story this demo tells. If routing changes so that checkout stops
// going to the nearest backend, or the report stops chasing clean power, these
// fail instead of the page quietly lying to visitors.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngine, type RilotEngine } from '@rilot/core-js';
import { CITIES, POLICIES, ROUTE_CONTROLS, SHOP_CONFIG } from './config';
import { routeRequest, type RouteContext, type ShopRequest, type Trace } from './request';
import type { Policy } from '@rilot/core-js';
import { ADD_TO_CART, PAGE_REQUESTS, PAY, SUBSCRIBE, productRequest } from '../shop/requests';

const wasmPath = fileURLToPath(
  new URL('../../../../target/wasm32-unknown-unknown/wasm/rilot_wasm.wasm', import.meta.url)
);

let engine: RilotEngine;

beforeAll(async () => {
  engine = await loadEngine(readFileSync(wasmPath));
});

const city = (id: string) => CITIES.find((c) => c.id === id)!;

/**
 * Routes one request the way an adapter does: the session cookie is handed to
 * the engine, which decides whether it applies to this path, and the result
 * travels as a per-request policy hint.
 */
function route(request: ShopRequest, cityId = 'new-york', utcHour = 13, cookie = ''): Trace {
  const hint = engine.cookiePolicy(cookie, request.path);
  if (!hint.ok) throw new Error(hint.error);
  const ctx: RouteContext = {
    config: SHOP_CONFIG,
    city: city(cityId),
    policy: hint.value,
    utcHour,
    signalAgeSeconds: 45,
    previous: null
  };
  const result = routeRequest(engine, request, ctx);
  if ('error' in result) throw new Error(result.error);
  return result;
}

/** The cookie value the impact page would write for these choices. */
const cookieFor = (choices: Record<string, Policy>) =>
  Object.entries(choices)
    .map(([pattern, policy]) => `${pattern}:${policy}`)
    .join(',');

describe('the shop demo', () => {
  it('serves the storefront from the root config', () => {
    const { decision } = route(PAGE_REQUESTS.home);
    expect(decision.effective.matched_rule).toBeNull();
    expect(decision.effective.policy).toBe('balanced');
    expect(decision.needs_carbon).toBe(true);
    expect(decision.selected_backend_id).toBeTruthy();
  });

  it('routes paying by latency and never asks for carbon', () => {
    const { decision, signals } = route(PAY);
    expect(decision.effective.matched_rule?.path).toBe('/checkout/*');
    expect(decision.effective.policy).toBe('latency');
    expect(decision.effective.radius_km).toBe(1500);
    expect(decision.needs_carbon).toBe(false);
    expect(signals).toEqual([]);
    expect(decision.selected_backend_id).toBe('east'); // closest to New York
  });

  it('routes the checkout page itself by latency too', () => {
    // `/checkout` matches `/checkout/*`, so the form page is as urgent as the
    // payment it leads to.
    const { decision } = route(PAGE_REQUESTS.checkout);
    expect(decision.effective.matched_rule?.path).toBe('/checkout/*');
    expect(decision.effective.policy).toBe('latency');
  });

  it('lets the monthly report travel to the cleanest region', () => {
    const { decision } = route(PAGE_REQUESTS.reports);
    expect(decision.effective.matched_rule?.path).toBe('/reports/*');
    expect(decision.effective.policy).toBe('carbon');
    expect(decision.effective.radius_km).toBeNull();
    const chosen = decision.candidates.find((c) => c.backend_id === decision.selected_backend_id);
    const cleanest = Math.min(
      ...decision.candidates.map((c) => c.carbon.used_g_per_kwh ?? Number.POSITIVE_INFINITY)
    );
    expect(chosen?.carbon.used_g_per_kwh).toBe(cleanest);
  });

  it('treats adding to the cart as its own POST request', () => {
    const { decision, request } = route(ADD_TO_CART);
    expect(request.method).toBe('POST');
    expect(decision.path).toBe('/cart/items');
    expect(decision.effective.matched_rule).toBeNull();
  });

  it('routes the newsletter signup like any other unmatched path', () => {
    const { decision } = route(SUBSCRIBE);
    expect(decision.path).toBe('/newsletter/subscribe');
    expect(decision.effective.policy).toBe('balanced');
  });

  it('gives every product page its own decision', () => {
    const { decision } = route(productRequest('bottle'));
    expect(decision.path).toBe('/products/bottle');
    expect(decision.selected_backend_id).toBeTruthy();
  });

  it('falls back when a distant shopper pays: every backend is outside the checkout radius', () => {
    const { decision } = route(PAY, 'singapore');
    expect(decision.candidates.every((c) => c.rejections.some((r) => r.kind === 'outside-radius'))).toBe(true);
    expect(decision.fallback_used).toBe(true);
    expect(decision.reason.code).toBe('fallback-nearest');
    expect(decision.selected_backend_id).toBe('dublin'); // nearest of the three
  });

  it('follows the sun: the report moves as the grid changes through the day', () => {
    // Midday in Europe: Dublin is the cleanest grid of the three.
    expect(route(PAGE_REQUESTS.reports, 'new-york', 12).decision.selected_backend_id).toBe('dublin');
    // Afternoon on the US west coast: Oregon takes over.
    expect(route(PAGE_REQUESTS.reports, 'new-york', 20).decision.selected_backend_id).toBe('west');
  });

  it('serves the impact page from the cleanest region', () => {
    const { decision } = route(PAGE_REQUESTS.impact);
    expect(decision.effective.matched_rule?.path).toBe('/green/*');
    expect(decision.effective.policy).toBe('carbon');
    expect(decision.effective.radius_km).toBeNull();
  });

  describe('the policy a visitor sets per route, carried in the session cookie', () => {
    it('leaves browsing on the root policy until one is set', () => {
      const { decision } = route(PAGE_REQUESTS.products);
      expect(decision.effective.matched_rule).toBeNull();
      expect(decision.effective.policy).toBe('balanced');
      expect(decision.effective.policy_source).toBe('root');
    });

    it('applies to a route that has no rule, and leaves the radius alone', () => {
      const chosen = cookieFor({ '/products/*': 'carbon' });
      const list = route(PAGE_REQUESTS.products, 'new-york', 13, chosen).decision;
      expect(list.effective.matched_rule).toBeNull(); // no rule needed: it is a hint
      expect(list.effective.policy).toBe('carbon');
      expect(list.effective.policy_source).toBe('request');
      expect(list.effective.radius_km).toBe(6000); // inherited, not dropped

      const detail = route(productRequest('bottle'), 'new-york', 13, chosen).decision;
      expect(detail.effective.policy).toBe('carbon');
      const winner = detail.candidates.find((c) => c.backend_id === detail.selected_backend_id);
      const cleanest = Math.min(
        ...detail.candidates
          .filter((c) => c.rejections.length === 0)
          .map((c) => c.carbon.used_g_per_kwh ?? Number.POSITIVE_INFINITY)
      );
      expect(winner?.carbon.used_g_per_kwh).toBe(cleanest);
    });

    it('overrides the policy of a rule that already exists, and nothing else about it', () => {
      // `/reports/*` ships as carbon with no radius; only the policy changes.
      const { decision, signals } = route(
        PAGE_REQUESTS.reports,
        'new-york',
        13,
        cookieFor({ '/reports/*': 'latency' })
      );
      expect(decision.effective.matched_rule?.path).toBe('/reports/*');
      expect(decision.effective.policy).toBe('latency');
      expect(decision.effective.policy_source).toBe('request');
      expect(decision.effective.radius_km).toBeNull();
      expect(decision.needs_carbon).toBe(false);
      expect(signals).toEqual([]);
      expect(decision.selected_backend_id).toBe('east'); // closest, not cleanest
    });

    it('covers adding to the cart when the cart is carbon-first', () => {
      const { decision } = route(ADD_TO_CART, 'new-york', 13, cookieFor({ '/cart/*': 'carbon' }));
      expect(decision.path).toBe('/cart/items');
      expect(decision.effective.policy).toBe('carbon');
    });

    it('never lets a choice reach checkout, because the control is locked', () => {
      const locked = ROUTE_CONTROLS.filter((control) => control.locked).map((control) => control.path);
      expect(locked).toEqual(['/checkout/*']);

      // Everything the UI can actually set, set to carbon.
      const everything = cookieFor(
        Object.fromEntries(
          ROUTE_CONTROLS.filter((control) => !control.locked).map((control) => [control.path, 'carbon' as const])
        )
      );
      const { decision, signals } = route(PAY, 'new-york', 13, everything);
      expect(decision.effective.matched_rule?.path).toBe('/checkout/*');
      expect(decision.effective.policy).toBe('latency');
      expect(signals).toEqual([]);
    });

    it('takes effect on the sample path shown under every control', () => {
      for (const control of ROUTE_CONTROLS) {
        if (control.locked) continue;
        for (const policy of POLICIES) {
          const { decision } = route(
            { method: 'GET', path: control.sample, label: control.label, kilobytes: 10 },
            'new-york',
            13,
            cookieFor({ [control.path]: policy })
          );
          expect(decision.effective.policy).toBe(policy);
          expect(decision.effective.policy_source).toBe('request');
        }
      }
    });

    it('asks for carbon only when the chosen policy needs it', () => {
      const cookie = (policy: Policy) => cookieFor({ '/products/*': policy });
      expect(route(PAGE_REQUESTS.products, 'new-york', 13, cookie('latency')).decision.needs_carbon).toBe(false);
      expect(route(PAGE_REQUESTS.products, 'new-york', 13, cookie('balanced')).decision.needs_carbon).toBe(true);
      expect(route(PAGE_REQUESTS.products, 'new-york', 13, cookie('carbon')).decision.needs_carbon).toBe(true);
    });

    it('matches the cookie with rule specificity, and ignores what it cannot parse', () => {
      const value = '/*:carbon,/products/bottle:latency';
      expect(route(productRequest('bottle'), 'new-york', 13, value).decision.effective.policy).toBe('latency');
      expect(route(productRequest('tote'), 'new-york', 13, value).decision.effective.policy).toBe('carbon');

      // Junk is skipped, so the config decides.
      expect(route(PAGE_REQUESTS.products, 'new-york', 13, 'nonsense').decision.effective.policy).toBe('balanced');
      expect(route(PAGE_REQUESTS.products, 'new-york', 13, 'products/*:carbon').decision.effective.policy).toBe(
        'balanced'
      );
    });
  });

  it('reports a saving whenever a cleaner backend was available', () => {
    const { savedMg, decision } = route(PAGE_REQUESTS.reports);
    const eligible = decision.candidates.filter((c) => c.rejections.length === 0);
    expect(eligible.length).toBeGreaterThan(1);
    expect(savedMg).toBeGreaterThan(0);
  });
});

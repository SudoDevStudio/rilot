// The shop's Rilot config. This is a normal Rilot config — the same file
// format native Rilot and the Cloudflare Worker load.
import type { Policy, RoutingConfig } from '@rilot/core-js';

export type BackendInfo = {
  id: string;
  city: string;
  /** Simulated round-trip behavior of this backend. */
  baseLatencyMs: number;
};

/** Display metadata for the three backends; routing itself uses the config below. */
export const BACKENDS: Record<string, BackendInfo> = {
  east: { id: 'east', city: 'Virginia, US', baseLatencyMs: 8 },
  west: { id: 'west', city: 'Oregon, US', baseLatencyMs: 10 },
  dublin: { id: 'dublin', city: 'Dublin, IE', baseLatencyMs: 9 }
};

export const SHOP_CONFIG: RoutingConfig = {
  backends: [
    { id: 'east', region: 'us-east-1', url: 'https://east.greencart.example' },
    { id: 'west', region: 'us-west-2', url: 'https://west.greencart.example' },
    { id: 'dublin', region: 'eu-west-1', url: 'https://dublin.greencart.example' }
  ],
  policy: 'balanced',
  radius_km: 6000,
  fallback: 'nearest',
  routing_rules: [
    // Paying must be fast and close to the shopper.
    { path: '/checkout/*', policy: 'latency', radius_km: 1500 },
    // Nightly store reports can travel anywhere clean.
    { path: '/reports/*', policy: 'carbon', radius_km: null },
    // The impact page is about the grid, so it is served from the cleanest region.
    { path: '/green/*', policy: 'carbon', radius_km: null }
  ]
};

/**
 * The routes a visitor can set a policy for on the impact page.
 *
 * A choice is written to the `rilot_policy` cookie as `pattern:policy`. The
 * engine reads that cookie and applies it as a per-request policy hint, which
 * beats both the matched rule and the root config — and reports itself as
 * `policy_source: "request"`. The Cloudflare Worker and native Rilot do exactly
 * the same thing with the same cookie.
 */
export type RouteControl = {
  /** The rule pattern this control writes. */
  path: string;
  /** A concrete path matching it, used to preview where that page goes now. */
  sample: string;
  label: string;
  detail: string;
  /** Shown, but not settable, with the reason why. */
  locked?: string;
};

export const ROUTE_CONTROLS: RouteControl[] = [
  { path: '/', sample: '/', label: 'Storefront', detail: 'The landing page. Cached anyway, so distance costs little.' },
  {
    path: '/products/*',
    sample: '/products',
    label: 'Catalog & product pages',
    detail: 'Browsing tolerates a few extra milliseconds.'
  },
  { path: '/cart/*', sample: '/cart', label: 'Cart', detail: 'Viewing and adding items, but not paying.' },
  {
    path: '/reports/*',
    sample: '/reports/monthly',
    label: 'Store report',
    detail: 'Already carbon-first in the config — set it to latency to see the difference.'
  },
  {
    path: '/checkout/*',
    sample: '/checkout/pay',
    label: 'Checkout',
    detail: 'Everything from opening the form to paying.',
    locked:
      'Payments stay latency-first — a slow checkout loses the order, and the saving is a fraction of a milligram.'
  }
];

export const POLICIES = ['latency', 'balanced', 'carbon'] as const satisfies readonly Policy[];

/** What one policy actually does, for the control's help text. */
export const POLICY_BLURB: Record<Policy, string> = {
  latency: 'nearest healthy backend, no carbon lookup',
  balanced: 'weighs latency, distance and carbon together',
  carbon: 'cleanest grid among the eligible backends'
};

/** Where the shopper is browsing from. */
export type City = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  /** Local time offset from UTC, used for the simulated grid clock. */
  utcOffset: number;
};

export const CITIES: City[] = [
  { id: 'new-york', label: 'New York', lat: 40.71, lon: -74.01, utcOffset: -4 },
  { id: 'san-francisco', label: 'San Francisco', lat: 37.77, lon: -122.42, utcOffset: -7 },
  { id: 'london', label: 'London', lat: 51.51, lon: -0.13, utcOffset: 1 },
  { id: 'singapore', label: 'Singapore', lat: 1.35, lon: 103.82, utcOffset: 8 }
];

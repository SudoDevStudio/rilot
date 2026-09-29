// Turning an HTTP request into the context rilot-core decides on.
//
// Nothing here is host-specific: the caller supplies the location its platform
// knows about (Cloudflare's `cf`, Vercel's `x-vercel-ip-*`), and headers always
// win over it so a deployed adapter can be tested from anywhere.

import type { GeoPoint, RequestContext, RequestHints, RilotEngine } from '../../rilot-js/src/index';

/**
 * Cookie a site sets to route its own pages per session, for example
 * `rilot_policy=/products/*:carbon,/checkout/*:latency`.
 *
 * The engine parses it and matches the patterns (`crates/rilot-core/src/cookie.rs`),
 * so a cookie behaves exactly like a routing rule of the same shape and no two
 * adapters can disagree about what one means.
 */
export const POLICY_COOKIE = 'rilot_policy';

function parseFlag(value: string | null | undefined): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(v)) return true;
  if (['0', 'false', 'off', 'no'].includes(v)) return false;
  return undefined;
}

/** Parses `"<lat>,<lon>"`; anything unparseable means "location unknown". */
export function parseLocation(value: string | null | undefined): GeoPoint | undefined {
  const parts = value?.split(',');
  if (parts?.length !== 2) return undefined;
  const lat = Number(parts[0].trim());
  const lon = Number(parts[1].trim());
  const usable = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  return usable ? { lat, lon } : undefined;
}

/** The `x-rilot-*` hints, from any header lookup function. */
export function requestHints(get: (name: string) => string | null | undefined): RequestHints {
  const routeClass = get('x-rilot-class')?.trim();
  const policy = get('x-rilot-policy')?.trim();
  const flag = (name: string) => parseFlag(get(name));
  return {
    ...(policy === 'latency' || policy === 'balanced' || policy === 'carbon' ? { policy } : {}),
    ...(routeClass === 'flexible' || routeClass === 'strict-local' || routeClass === 'background'
      ? { route_class: routeClass }
      : {}),
    ...(flag('x-rilot-carbon-cursor') !== undefined ? { carbon_aware: flag('x-rilot-carbon-cursor') } : {}),
    ...(flag('x-rilot-forecasting') !== undefined ? { forecasting: flag('x-rilot-forecasting') } : {}),
    ...(flag('x-rilot-time-shift') !== undefined ? { time_shift: flag('x-rilot-time-shift') } : {})
  };
}

/**
 * Builds the core request context.
 *
 *   x-user-region: us-east-1        pins the region
 *   x-user-location: 51.5,-0.13     pins the coordinates, beating `hostLocation`
 *   x-rilot-policy: carbon          policy for this request
 *   Cookie: rilot_policy=...        policy for this session, matched by the engine
 *
 * An explicit header always wins over the cookie, and the cookie over the config.
 */
export function buildRequestContext(options: {
  path: string;
  headers: Headers;
  /** What the platform thinks the caller's coordinates are. */
  hostLocation?: GeoPoint;
  /** Passing an engine enables the session policy cookie. */
  engine?: RilotEngine;
}): RequestContext {
  const { path, headers, hostLocation, engine } = options;
  const get = (name: string) => headers.get(name);

  const headerRegion = get('x-user-region')?.trim();
  const location = parseLocation(get('x-user-location')) ?? hostLocation;

  const hints = requestHints(get);
  const cookie = get('cookie');
  if (engine && cookie && !hints.policy) {
    const fromCookie = engine.cookiePolicy(cookie, path, POLICY_COOKIE);
    if (fromCookie.ok && fromCookie.value) hints.policy = fromCookie.value;
  }

  return {
    path,
    ...(headerRegion ? { user_region: headerRegion } : {}),
    ...(location ? { user_location: location } : {}),
    hints
  };
}

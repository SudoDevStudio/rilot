// The visitor's per-route policy choices, kept in a cookie.
//
// A cookie, not sessionStorage, because a cookie is sent with every request:
// the exact same value is read by the Cloudflare Worker and by native Rilot
// (`POLICY_COOKIE` in both adapters), which parse it with the engine's own
// matcher. So a choice made here is a choice a real deployment would honour.
//
//   rilot_policy=/products/*:carbon,/reports/*:latency
//
// Reading it back is the engine's job, not ours: `engine.cookiePolicy()` does
// the parsing and the pattern matching in Rust.

import type { Policy } from '@rilot/core-js';

export const POLICY_COOKIE = 'rilot_policy';

/** Session cookie: no Expires, so it dies with the tab like sessionStorage. */
const ATTRIBUTES = 'path=/; SameSite=Lax';

export type RoutePolicies = Record<string, Policy>;

function readRaw(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie
    .split(';')
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(`${POLICY_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(POLICY_COOKIE.length + 1)) : '';
}

/** The cookie exactly as an adapter would receive it. */
export function readCookie(): string {
  return readRaw();
}

/** The choices, for rendering the pickers. */
export function readPolicies(): RoutePolicies {
  const policies: RoutePolicies = {};
  for (const entry of readRaw().split(',')) {
    const at = entry.lastIndexOf(':');
    if (at < 1) continue;
    const pattern = entry.slice(0, at).trim();
    const policy = entry.slice(at + 1).trim();
    if (pattern.startsWith('/') && (policy === 'latency' || policy === 'balanced' || policy === 'carbon')) {
      policies[pattern] = policy;
    }
  }
  return policies;
}

function write(policies: RoutePolicies): void {
  if (typeof document === 'undefined') return;
  const value = Object.entries(policies)
    .map(([pattern, policy]) => `${pattern}:${policy}`)
    .join(',');
  document.cookie = value
    ? `${POLICY_COOKIE}=${encodeURIComponent(value)}; ${ATTRIBUTES}`
    : `${POLICY_COOKIE}=; ${ATTRIBUTES}; Max-Age=0`;
}

/** Sets one route's policy, or clears it back to the config's own with `null`. */
export function setPolicy(pattern: string, policy: Policy | null): RoutePolicies {
  const next = readPolicies();
  if (policy === null) delete next[pattern];
  else next[pattern] = policy;
  write(next);
  return next;
}

/** Forgets every choice, so the config decides again. */
export function clearPolicies(): void {
  write({});
}

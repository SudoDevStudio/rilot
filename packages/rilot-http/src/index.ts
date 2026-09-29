// Host-agnostic HTTP layer shared by every Rilot adapter.
//
// An adapter supplies what only it knows — where the config lives, how to reach
// a cache, what its platform says about the caller's location — and this
// package does the rest, so the Cloudflare Worker and the Vercel function
// behave identically by construction.

export { POLICY_COOKIE, buildRequestContext, parseLocation, requestHints } from './context';
export { researchHeaders } from './headers';
export {
  DEFAULT_MAX_AGE_SECONDS,
  decide,
  describeSignal,
  handleRequest,
  json,
  knownRegions,
  maxAgeSeconds,
  type Host,
  type RilotHttpConfig
} from './router';

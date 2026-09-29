/**
 * Everything the adapter reads from the environment.
 *
 * Passed in rather than read from `process.env` directly, so the tests drive
 * the same code path the runtime does.
 */
export type Env = {
  /** Routing config as JSON. Set it in the Vercel project's environment. */
  RILOT_CONFIG?: string;
  /** "true" emits x-rilot-* research headers on responses. */
  RILOT_EXPOSE_RESEARCH_HEADERS?: string;
  /** Electricity Maps API token. Store it as a Vercel secret, never in code. */
  ELECTRICITYMAP_API_KEY?: string;
  /** Vercel KV (Upstash Redis) REST credentials, added by the integration. */
  KV_REST_API_URL?: string;
  KV_REST_API_TOKEN?: string;
  /** Set by Vercel: the region serving this request, e.g. `iad1`. */
  VERCEL_REGION?: string;
};

/** Reads the environment Vercel exposes to an Edge Function. */
export function readEnv(): Env {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return {
    RILOT_CONFIG: env.RILOT_CONFIG,
    RILOT_EXPOSE_RESEARCH_HEADERS: env.RILOT_EXPOSE_RESEARCH_HEADERS,
    ELECTRICITYMAP_API_KEY: env.ELECTRICITYMAP_API_KEY,
    KV_REST_API_URL: env.KV_REST_API_URL,
    KV_REST_API_TOKEN: env.KV_REST_API_TOKEN,
    VERCEL_REGION: env.VERCEL_REGION
  };
}

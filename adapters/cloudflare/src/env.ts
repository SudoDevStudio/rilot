export interface Env {
  /** Routing config as JSON. If unset, the Worker reads KV key `rilot:config`. */
  RILOT_CONFIG?: string;
  /** "true" emits x-rilot-* research headers on responses. */
  RILOT_EXPOSE_RESEARCH_HEADERS?: string;
  /** Electricity Maps API token (set with `wrangler secret put`). */
  ELECTRICITYMAP_API_KEY?: string;
  /** Last-known-good carbon signals, and optionally the routing config. */
  CARBON_KV?: KVNamespace;
}

/// <reference types="@cloudflare/vitest-pool-workers/types" />

// `env` from "cloudflare:test" is typed as Cloudflare.Env; declare the
// bindings this Worker uses so tests are type-checked.
declare global {
  namespace Cloudflare {
    interface Env {
      RILOT_CONFIG?: string;
      RILOT_EXPOSE_RESEARCH_HEADERS?: string;
      ELECTRICITYMAP_API_KEY?: string;
      CARBON_KV: KVNamespace;
    }
  }
}

export {};

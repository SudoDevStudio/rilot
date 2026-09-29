// Edge wiring for the shared carbon layer (packages/rilot-carbon).
//
// This file only chooses which provider and stores to use; the freshness,
// refresh and fallback rules live in the shared CarbonService (and, under it,
// in Rust), and the provider zone mapping lives inside the provider.

import {
  CarbonService,
  KvStore,
  MemoryStore,
  createProvider,
  type CarbonEvent,
  type CarbonStore
} from '../../../packages/rilot-carbon/src/index';
import type { RilotEngine } from '../../../packages/rilot-js/src/index';
import type { CarbonConfig } from './config';
import type { Env } from './env';
import { vercelKv } from './kv';

/** Per-instance cache, shared by every request this instance handles. */
const memoryStore = new MemoryStore();

export type CarbonWiring = {
  /** Lets background work outlive the response where the host supports it. */
  schedule?: (work: () => Promise<unknown>) => void;
  fetchImpl?: typeof fetch;
};

export function createCarbonService(
  engine: RilotEngine,
  config: CarbonConfig,
  env: Env,
  wiring: CarbonWiring = {}
): CarbonService {
  const stores: CarbonStore[] = [memoryStore];
  const kv = vercelKv(env, wiring.fetchImpl ?? fetch);
  if (kv) stores.push(new KvStore(kv));

  return new CarbonService({
    // Freshness, refresh and fallback rules come from Rust, not from here.
    engine,
    provider: createProvider(config, { electricityMapApiKey: env.ELECTRICITYMAP_API_KEY }),
    stores,
    policy: {
      maxAgeSeconds: config.max_age_seconds,
      refreshSeconds: config.refresh_seconds,
      timeoutMs: config.provider_timeout_ms
    },
    // An Edge Function has no ctx.waitUntil, so by default a background refresh
    // is fire-and-forget: it may be cut short when the response is sent, and
    // the next request simply refreshes again. A host that can do better (for
    // example `waitUntil` from @vercel/functions) passes `schedule`.
    schedule: wiring.schedule ?? ((work) => void work().catch(() => {})),
    onEvent: logEvent
  });
}

function logEvent(event: CarbonEvent): void {
  if (event.type === 'provider-error') {
    console.warn(`carbon_provider_failed=${event.provider} regions=${event.regions.join(',')} error=${event.error}`);
  } else if (event.type === 'stale-served') {
    console.warn(`carbon_stale_served region=${event.region}`);
  } else if (event.type === 'policy-error' || event.type === 'store-error') {
    console.warn(`carbon_${event.type.replace('-', '_')}=${event.error}`);
  }
}

/** Test helper: clears the per-instance cache. */
export function resetCarbonMemoryCache(): void {
  memoryStore.clear();
}

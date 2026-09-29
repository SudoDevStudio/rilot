// Edge wiring for the shared carbon layer (packages/rilot-carbon).
//
// This file only chooses which provider and stores to use; the freshness,
// refresh and fallback rules live in the shared CarbonService, and the
// provider zone mapping lives inside the provider.

import type { RilotEngine } from '../../../packages/rilot-js/src/index';
import {
  CarbonService,
  KvStore,
  MemoryStore,
  createProvider,
  type CarbonEvent,
  type CarbonStore
} from '../../../packages/rilot-carbon/src/index';
import type { CarbonConfig } from './config';
import type { Env } from './env';

/** Per-isolate cache, shared by every request this isolate handles. */
const memoryStore = new MemoryStore();

export function createCarbonService(
  engine: RilotEngine,
  config: CarbonConfig,
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>
): CarbonService {
  const stores: CarbonStore[] = [memoryStore];
  if (env.CARBON_KV) stores.push(new KvStore(env.CARBON_KV));

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
    // Background refreshes and KV writes must outlive the response.
    schedule: (work) => ctx.waitUntil(work()),
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

/** Test helper: clears the per-isolate cache. */
export function resetCarbonMemoryCache(): void {
  memoryStore.clear();
}

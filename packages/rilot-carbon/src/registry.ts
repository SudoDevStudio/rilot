// Provider registry: adding a new carbon source means writing one
// CarbonProvider and registering it here (or at runtime via registerProvider).

import { ElectricityMapsProvider } from './providers/electricitymap';
import { JsonProvider } from './providers/json';
import { StaticProvider } from './providers/static';
import type { CarbonProvider } from './types';

/** Adapter-owned carbon section of a Rilot config. */
export type CarbonConfig = {
  provider?: string;
  /** Provider-specific settings (zone maps, URLs, balancing authorities, …). */
  options?: Record<string, unknown>;
  max_age_seconds?: number;
  refresh_seconds?: number;
  provider_timeout_ms?: number;
  /** Shorthand kept for convenience. */
  json_source?: string;
  zone_current?: Record<string, number>;
  electricitymap_zone_map?: Record<string, string>;
};

/** Secrets and host capabilities a provider may need. */
export type ProviderEnvironment = {
  electricityMapApiKey?: string;
  fetchImpl?: typeof fetch;
};

export type ProviderFactory = (
  config: CarbonConfig,
  env: ProviderEnvironment
) => CarbonProvider | null;

const factories = new Map<string, ProviderFactory>();

export function registerProvider(name: string, factory: ProviderFactory): void {
  factories.set(name, factory);
}

export function providerNames(): string[] {
  return [...factories.keys()].sort();
}

/** Returns null when the source is unavailable (e.g. a missing API key). */
export function createProvider(config: CarbonConfig, env: ProviderEnvironment = {}): CarbonProvider | null {
  const name = config.provider ?? 'electricitymap';
  if (name === 'none') return null;
  const factory = factories.get(name);
  if (!factory) throw new Error(`Unknown carbon provider "${name}". Known: ${providerNames().join(', ')}`);
  return factory(config, env);
}

registerProvider('static', (config) =>
  new StaticProvider((config.options?.values as Record<string, number>) ?? config.zone_current ?? {})
);

registerProvider('json', (config, env) => {
  const url = (config.options?.url as string) ?? config.json_source;
  return url ? new JsonProvider(url, env.fetchImpl as never) : null;
});

registerProvider('electricitymap', (config, env) => {
  const options = config.options ?? {};
  const apiKey = (options.api_key as string) ?? env.electricityMapApiKey;
  if (!apiKey) return null;
  return new ElectricityMapsProvider({
    apiKey,
    baseUrl: options.base_url as string | undefined,
    tokenHeader: options.token_header as string | undefined,
    zoneMap: (options.zone_map as Record<string, string>) ?? config.electricitymap_zone_map,
    disableEstimations: options.disable_estimations as boolean | undefined,
    fetchImpl: env.fetchImpl as never
  });
});

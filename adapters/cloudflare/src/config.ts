import type { RoutingConfig } from '../../../packages/rilot-js/src/index';
import type { Env } from './env';

export const CONFIG_KV_KEY = 'rilot:config';

/**
 * Adapter-owned carbon settings; rilot-core ignores this section.
 * The shape is defined by the shared carbon layer, so every host that uses
 * packages/rilot-carbon accepts the same configuration.
 */
export type { CarbonConfig } from '../../../packages/rilot-carbon/src/index';
import type { CarbonConfig } from '../../../packages/rilot-carbon/src/index';

export type RilotConfig = RoutingConfig & { carbon?: CarbonConfig };

export const DEFAULT_MAX_AGE_SECONDS = 300;
export const DEFAULT_PROVIDER_TIMEOUT_MS = 1500;

/**
 * Reads the routing config from the RILOT_CONFIG var, else from KV.
 * Parsed per request; Workers cache the module, and this is a small JSON parse.
 */
export async function loadConfig(env: Env): Promise<RilotConfig> {
  const raw = env.RILOT_CONFIG?.trim()
    ? env.RILOT_CONFIG
    : await env.CARBON_KV?.get(CONFIG_KV_KEY);
  if (!raw) {
    throw new Error('No routing config: set the RILOT_CONFIG var or the KV key "rilot:config".');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Routing config is not valid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Routing config must be a JSON object.');
  }
  return parsed as RilotConfig;
}

export function maxAgeSeconds(config: RilotConfig): number {
  return config.carbon?.max_age_seconds ?? DEFAULT_MAX_AGE_SECONDS;
}

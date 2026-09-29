import type { CarbonConfig } from '../../../packages/rilot-carbon/src/index';
import type { RilotHttpConfig } from '../../../packages/rilot-http/src/index';
import type { Env } from './env';

export type { CarbonConfig };

/** Routing config plus the adapter-owned `carbon` section. */
export type RilotConfig = RilotHttpConfig & { carbon?: CarbonConfig };

/**
 * Reads the routing config from `RILOT_CONFIG`.
 *
 * Unlike the Worker there is no KV fallback: Vercel environment variables hold
 * up to 64 KB, which is far more than a routing config needs, and one source
 * means one place to look when a deployment misbehaves.
 */
export function loadConfig(env: Env): RilotConfig {
  const raw = env.RILOT_CONFIG?.trim();
  if (!raw) {
    throw new Error('No routing config: set the RILOT_CONFIG environment variable.');
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

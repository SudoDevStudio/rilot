// Vercel KV (Upstash Redis) as last-known-good carbon storage.
//
// The shared carbon layer already has a KvStore; it only needs something with
// `get` and `put`, so this file is the REST transport and nothing else. No SDK:
// the Upstash REST API takes a command as a JSON array, which keeps values with
// slashes and quotes out of the URL.

import type { KvLike } from '../../../packages/rilot-carbon/src/index';
import type { Env } from './env';

type Credentials = { url: string; token: string };

function credentials(env: Env): Credentials | null {
  const url = env.KV_REST_API_URL?.trim().replace(/\/$/, '');
  const token = env.KV_REST_API_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

/** True when the project has a KV store connected. */
export function hasKv(env: Env): boolean {
  return credentials(env) !== null;
}

/**
 * A `KvLike` backed by Vercel KV, or `null` when the project has none — in
 * which case the carbon layer runs on its in-memory store alone, exactly as it
 * does on a Worker with no KV namespace bound.
 */
export function vercelKv(env: Env, fetchImpl: typeof fetch = fetch): KvLike | null {
  const creds = credentials(env);
  if (!creds) return null;

  const command = async (parts: (string | number)[]): Promise<unknown> => {
    const response = await fetchImpl(creds.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${creds.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(parts)
    });
    if (!response.ok) {
      throw new Error(`Vercel KV ${parts[0]} failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as { result?: unknown; error?: string };
    if (body.error) throw new Error(`Vercel KV ${parts[0]} failed: ${body.error}`);
    return body.result ?? null;
  };

  return {
    async get(key) {
      const result = await command(['GET', key]);
      return typeof result === 'string' ? result : null;
    },
    async put(key, value, options) {
      const ttl = Math.max(60, Math.round(options?.expirationTtl ?? 3600));
      await command(['SET', key, value, 'EX', ttl]);
    }
  };
}

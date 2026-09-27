import { isValidSignal, type CarbonProvider, type CarbonSignal, type ProviderContext } from '../types';

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * Generic provider: the source already returns Rilot's normalized format,
 * so no provider-specific translation is needed.
 *
 *   {"signals": [{"region": "us-east-1", "carbon_g_per_kwh": 245, "observed_at": "..."}]}
 */
export class JsonProvider implements CarbonProvider {
  readonly name = 'json';

  constructor(private readonly url: string, private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike) {}

  async fetch(regions: string[], ctx: ProviderContext): Promise<CarbonSignal[]> {
    const response = await this.fetchImpl(this.url, { signal: AbortSignal.timeout(ctx.timeoutMs) });
    if (!response.ok) throw new Error(`carbon JSON source returned HTTP ${response.status}`);
    const body = (await response.json()) as { signals?: unknown };
    if (!Array.isArray(body.signals)) throw new Error('carbon JSON must contain a "signals" array');
    const wanted = new Set(regions);
    return body.signals
      .filter((signal): signal is CarbonSignal => isValidSignal(signal) && wanted.has(signal.region))
      .map((signal) => ({ ...signal, source: 'json' as const }));
  }
}

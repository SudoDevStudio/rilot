import type { CarbonSignal, CarbonStore, SignalSource } from '../types';

export type KvLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

/** Workers KV (or any key/value store) as last-known-good storage. */
export class KvStore implements CarbonStore {
  readonly name = 'kv';
  readonly servedSource: SignalSource = 'last-known-good';

  constructor(private readonly kv: KvLike, private readonly prefix = 'carbon:') {}

  private key(region: string): string {
    return `${this.prefix}${region}`;
  }

  async get(regions: string[]): Promise<Map<string, CarbonSignal>> {
    const out = new Map<string, CarbonSignal>();
    await Promise.all(
      regions.map(async (region) => {
        const raw = await this.kv.get(this.key(region));
        if (!raw) return;
        try {
          out.set(region, JSON.parse(raw) as CarbonSignal);
        } catch {
          // Corrupt entry: treat as a miss.
        }
      })
    );
    return out;
  }

  async put(signals: CarbonSignal[], ttlSeconds: number): Promise<void> {
    await Promise.all(
      signals.map((signal) =>
        this.kv.put(this.key(signal.region), JSON.stringify(signal), {
          expirationTtl: Math.max(60, Math.round(ttlSeconds))
        })
      )
    );
  }
}

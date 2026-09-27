import type { CarbonSignal, CarbonStore, SignalSource } from '../types';

/** Process/isolate-local cache. Fast, not shared between isolates. */
export class MemoryStore implements CarbonStore {
  readonly name = 'memory';
  readonly servedSource: SignalSource = 'local-cache';
  private readonly entries: Map<string, CarbonSignal>;

  constructor(entries: Map<string, CarbonSignal> = new Map()) {
    this.entries = entries;
  }

  async get(regions: string[]): Promise<Map<string, CarbonSignal>> {
    const out = new Map<string, CarbonSignal>();
    for (const region of regions) {
      const signal = this.entries.get(region);
      if (signal) out.set(region, signal);
    }
    return out;
  }

  async put(signals: CarbonSignal[], _ttlSeconds?: number): Promise<void> {
    for (const signal of signals) this.entries.set(signal.region, signal);
  }

  clear(): void {
    this.entries.clear();
  }
}

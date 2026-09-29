import type {
  CarbonMergeOutput,
  CarbonPlanOutput,
  CarbonPolicyRules,
  CarbonSignal
} from '../../rilot-js/src/index';
import {
  resolvePolicy,
  type CachePolicy,
  type CarbonEvent,
  type CarbonPolicyEngine,
  type CarbonProvider,
  type CarbonServiceOptions,
  type CarbonStore
} from './types';

/**
 * Gets carbon signals for a set of regions.
 *
 * This class performs I/O only. Every decision — what can be served from
 * cache, what must be fetched, what to refresh, what to write back — comes
 * from the pure Rust policy (`crates/rilot-carbon-policy`) reached through
 * WebAssembly, so native Rilot and this host apply identical rules.
 *
 *   read stores ─▶ carbonPlan() ─▶ provider fetch ─▶ carbonMerge() ─▶ signals
 */
export class CarbonService {
  private readonly engine: CarbonPolicyEngine;
  private readonly provider: CarbonProvider | null;
  private readonly stores: CarbonStore[];
  private readonly policy: CachePolicy;
  private readonly now: () => number;
  private readonly schedule: (work: () => Promise<unknown>) => void;
  private readonly onEvent: (event: CarbonEvent) => void;
  /** Single-flight: one in-flight provider call per region. */
  private readonly inFlight = new Map<string, Promise<CarbonSignal[]>>();

  constructor(options: CarbonServiceOptions) {
    this.engine = options.engine;
    this.provider = options.provider ?? null;
    this.stores = options.stores ?? [];
    this.policy = resolvePolicy(options.policy);
    this.now = options.now ?? (() => Date.now());
    this.schedule = options.schedule ?? ((work) => void work().catch(() => {}));
    this.onEvent = options.onEvent ?? (() => {});
  }

  private get rules(): CarbonPolicyRules {
    return {
      max_age_seconds: this.policy.maxAgeSeconds,
      refresh_seconds: this.policy.refreshSeconds
    };
  }

  async getSignals(regions: string[]): Promise<CarbonSignal[]> {
    if (regions.length === 0) return [];
    const now = new Date(this.now()).toISOString();
    const cached = await this.readStores(regions);

    const planned = this.engine.carbonPlan({ policy: this.rules, now, regions, cached });
    if (!planned.ok) {
      this.onEvent({ type: 'policy-error', error: planned.error });
      return [];
    }
    const plan: CarbonPlanOutput = planned.value;

    let fetched: CarbonSignal[] = [];
    if (plan.fetch.length > 0) {
      this.onEvent({ type: 'miss', regions: plan.fetch });
      fetched = await this.callProvider(plan.fetch);
    }

    const merged = this.engine.carbonMerge({
      policy: this.rules,
      now,
      regions,
      serve: plan.serve,
      fetched,
      cached
    });
    if (!merged.ok) {
      this.onEvent({ type: 'policy-error', error: merged.error });
      return [];
    }
    const result: CarbonMergeOutput = merged.value;

    for (const region of result.stale_served) {
      this.onEvent({ type: 'stale-served', region });
    }
    if (result.store_writes.length > 0) {
      this.schedule(() => this.write(result.store_writes));
    }
    if (plan.refresh.length > 0) {
      this.onEvent({ type: 'refresh-scheduled', regions: plan.refresh });
      this.schedule(async () => {
        const refreshed = await this.callProvider(plan.refresh);
        if (refreshed.length > 0) await this.write(refreshed);
      });
    }

    return result.signals;
  }

  /** Reads every store in order, labelling signals with the store they came from. */
  private async readStores(regions: string[]): Promise<CarbonSignal[]> {
    const out: CarbonSignal[] = [];
    for (const store of this.stores) {
      try {
        const entries = await store.get(regions);
        for (const region of regions) {
          const signal = entries.get(region);
          if (signal) {
            out.push(store.servedSource ? { ...signal, source: store.servedSource } : signal);
          }
        }
      } catch (error) {
        this.onEvent({ type: 'store-error', store: store.name, error: String(error) });
      }
    }
    return out;
  }

  private async callProvider(regions: string[]): Promise<CarbonSignal[]> {
    if (!this.provider) return [];
    const pending = regions.filter((region) => !this.inFlight.has(region));
    if (pending.length > 0) {
      const call = this.fetchFromProvider(pending);
      for (const region of pending) this.inFlight.set(region, call);
    }
    try {
      const batches = await Promise.all(
        [...new Set(regions.map((region) => this.inFlight.get(region)))].filter(
          (batch): batch is Promise<CarbonSignal[]> => batch !== undefined
        )
      );
      return batches.flat();
    } finally {
      for (const region of pending) this.inFlight.delete(region);
    }
  }

  private async fetchFromProvider(regions: string[]): Promise<CarbonSignal[]> {
    const provider = this.provider!;
    try {
      const signals = await provider.fetch(regions, {
        now: this.now(),
        timeoutMs: this.policy.timeoutMs
      });
      this.onEvent({ type: 'provider-ok', provider: provider.name, regions });
      return signals;
    } catch (error) {
      this.onEvent({
        type: 'provider-error',
        provider: provider.name,
        regions,
        error: String(error)
      });
      return [];
    }
  }

  private async write(signals: CarbonSignal[]): Promise<void> {
    await Promise.all(
      this.stores.map(async (store) => {
        try {
          await store.put(signals, this.policy.storeTtlSeconds);
          this.onEvent({
            type: 'store-write',
            store: store.name,
            regions: signals.map((s) => s.region)
          });
        } catch (error) {
          this.onEvent({ type: 'store-error', store: store.name, error: String(error) });
        }
      })
    );
  }
}

// Shared carbon-layer conformance suite (fixtures/carbon/*.json).
// The Rust crate runs the same files, so both implementations behave alike.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngine, type RilotEngine } from '../../rilot-js/src/index';
import { CarbonService, KvStore, MemoryStore, type CarbonProvider, type CarbonSignal } from '../src/index';

type Fixture = {
  name: string;
  description: string;
  now: string;
  policy: { max_age_seconds: number; refresh_seconds: number };
  stores: { memory?: CarbonSignal[]; kv?: CarbonSignal[] };
  provider: { signals?: CarbonSignal[]; fail?: boolean };
  request: string[];
  expect: {
    signals: { region: string; carbon_g_per_kwh: number; source?: string }[];
    provider_called_with: string[];
    refreshed: string[];
    store_writes: Record<string, string[]>;
  };
};

// The policy itself is Rust (crates/rilot-carbon-policy) reached through Wasm.
const wasmPath = fileURLToPath(
  new URL('../../../target/wasm32-unknown-unknown/wasm/rilot_wasm.wasm', import.meta.url)
);
let engine: RilotEngine;

const dir = fileURLToPath(new URL('../../../fixtures/carbon/', import.meta.url));
const fixtures: Fixture[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(dir + f, 'utf8')) as Fixture);

class ScriptedProvider implements CarbonProvider {
  readonly name = 'scripted';
  readonly calls: string[][] = [];
  constructor(private readonly script: Fixture['provider']) {}

  async fetch(regions: string[]): Promise<CarbonSignal[]> {
    this.calls.push([...regions]);
    if (this.script.fail) throw new Error('provider unavailable');
    return this.script.signals ?? [];
  }
}

class RecordingKv {
  readonly entries = new Map<string, string>();
  readonly writes: string[] = [];
  async get(key: string) {
    return this.entries.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.entries.set(key, value);
    this.writes.push(key.replace('carbon:', ''));
  }
}

const sorted = (values: string[]) => [...new Set(values)].sort();

describe('carbon layer conformance', () => {
  beforeAll(async () => {
    engine = await loadEngine(readFileSync(wasmPath));
  });

  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const now = Date.parse(fixture.now);
    const memoryEntries = new Map((fixture.stores.memory ?? []).map((s) => [s.region, s]));
    const memory = new MemoryStore(memoryEntries);
    const kv = new RecordingKv();
    for (const signal of fixture.stores.kv ?? []) kv.entries.set(`carbon:${signal.region}`, JSON.stringify(signal));

    const provider = new ScriptedProvider(fixture.provider);
    const memoryWrites: string[] = [];
    const scheduled: (() => Promise<unknown>)[] = [];
    const refreshed: string[] = [];

    const service = new CarbonService({
      engine,
      provider,
      stores: [
        {
          name: 'memory',
          servedSource: memory.servedSource,
          get: (regions) => memory.get(regions),
          put: async (signals, ttl) => {
            memoryWrites.push(...signals.map((s) => s.region));
            await memory.put(signals, ttl);
          }
        },
        new KvStore(kv)
      ],
      policy: {
        maxAgeSeconds: fixture.policy.max_age_seconds,
        refreshSeconds: fixture.policy.refresh_seconds
      },
      now: () => now,
      schedule: (work) => void scheduled.push(work),
      onEvent: (event) => {
        if (event.type === 'refresh-scheduled') refreshed.push(...event.regions);
      }
    });

    const signals = await service.getSignals(fixture.request);
    const directCalls = provider.calls.flat();
    // Background refreshes and store writes run through `schedule`.
    while (scheduled.length > 0) await Promise.all(scheduled.splice(0).map((work) => work()));

    expect(
      signals.map((s) => ({ region: s.region, carbon_g_per_kwh: s.carbon_g_per_kwh, source: s.source }))
    ).toEqual(
      fixture.expect.signals.map((s) => ({
        region: s.region,
        carbon_g_per_kwh: s.carbon_g_per_kwh,
        source: s.source
      }))
    );
    expect(sorted(directCalls)).toEqual(sorted(fixture.expect.provider_called_with));
    expect(sorted(refreshed)).toEqual(sorted(fixture.expect.refreshed));
    expect(sorted(memoryWrites)).toEqual(sorted(fixture.expect.store_writes.memory ?? []));
    expect(sorted(kv.writes)).toEqual(sorted(fixture.expect.store_writes.kv ?? []));
  });

  it('covers the documented scenarios', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(9);
  });
});

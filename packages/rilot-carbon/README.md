# @rilot/carbon

Generic carbon signal acquisition for JavaScript hosts: pluggable **providers** (where signals come from) and **stores** (where they are cached) behind one freshness policy.

The freshness, refresh and fallback rules are **not** implemented here: they come from the pure Rust policy (`crates/rilot-carbon-policy`) reached through WebAssembly, so this host and native Rilot behave identically. This package only does I/O.

```ts
import { CarbonService, KvStore, MemoryStore, createProvider } from '@rilot/carbon';

const service = new CarbonService({
  engine,                                     // a loaded RilotEngine (the Rust policy)
  provider: createProvider(config.carbon, { electricityMapApiKey: env.ELECTRICITYMAP_API_KEY }),
  stores: [new MemoryStore(), new KvStore(env.CARBON_KV)],
  policy: { maxAgeSeconds: 300, refreshSeconds: 60 },
  schedule: (work) => ctx.waitUntil(work())   // background refresh + store writes
});

const signals = await service.getSignals(['us-east-1', 'us-west-2']);
```

`signals` is the normalized Rilot format, ready to hand to `rilot-core`:

```json
{ "region": "us-east-1", "carbon_g_per_kwh": 245, "observed_at": "2026-09-18T20:00:00Z", "source": "live" }
```

- Providers: `electricitymap`, `json`, `static`, or your own via `registerProvider`.
- Stores: `MemoryStore`, `KvStore`, or anything implementing `CarbonStore`.
- Behavior is pinned by `fixtures/carbon/*.json`, shared with the native Rust service (`crates/rilot-carbon`).

Design, rules, and a recipe for adding a source: [docs/carbon-layer.md](../../docs/carbon-layer.md).

```bash
npm install
npm test        # runs the shared conformance suite
```

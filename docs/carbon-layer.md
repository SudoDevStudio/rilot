# Carbon Layer

Carbon acquisition is a standalone layer. It is **not** part of `rilot-core` (which must stay pure and I/O-free) and **not** part of any adapter (which must stay replaceable). Adding a new carbon source means implementing one interface.

```text
carbon policy (Rust)   decides: serve from cache | fetch | refresh in background
        ▲
CarbonService          does the I/O the policy asks for
   ├── CarbonProvider  where signals come from   (electricitymap | json | static | yours)
   └── CarbonStore[]   where they are cached     (memory → KV → …), read-through, write-back
```

| Piece | Path | Role |
| --- | --- | --- |
| **Policy (Rust, pure)** | `crates/rilot-carbon-policy` | **the only** freshness / refresh / fallback rules; no I/O, compiles to Wasm |
| Native service | `crates/rilot-carbon` | providers, stores, and the I/O the policy asks for |
| JavaScript service | `packages/rilot-carbon` | the same I/O for Workers, calling the Rust policy through Wasm |
| Conformance suite | `fixtures/carbon/*.json` | runs against both services |

The rules exist **once**, in Rust. The two service classes only perform I/O: read stores, call a provider, write back. A Cloudflare Worker cannot use `reqwest`/`tokio`, so its I/O is TypeScript, but it reaches the same policy functions through WebAssembly:

```text
read stores ─▶ rilot_carbon_plan()  ─▶ { serve, fetch, refresh }
                    (Rust, Wasm)            │
                                    provider fetch (host I/O)
                                            │
             rilot_carbon_merge() ◀─────────┘
                    (Rust, Wasm)
                         └─▶ { signals, store_writes, stale_served }
```

`cargo test -p rilot-carbon` and `npm test` in `packages/rilot-carbon` run the same fixtures, so the wiring on both sides is checked too.

## Rules

1. **Providers never cache.** They fetch and normalize, nothing else.
2. **Stores never fetch.** They only read and write what they are given.
3. **Only the policy decides freshness.** Providers, stores, and hosts have no opinion about age; `crates/rilot-carbon-policy` answers "serve, fetch, or refresh?".
4. **Provider identifiers never escape the provider.** `us-east-1 → US-MIDA-PJM` stays inside `ElectricityMapsProvider`; `rilot-core` only ever sees canonical Rilot regions.
5. **A missing region is not an error.** Providers return what resolved; the core turns the gap into `carbon-unavailable` and applies the configured fallback.
6. **Never invent a value.** If nothing is known for a region, it is omitted.

## Freshness policy

For each requested region, given `refresh_seconds` and `max_age_seconds`:

| Cached signal age | Behavior |
| --- | --- |
| `≤ refresh_seconds` | served from the store |
| `≤ max_age_seconds` | served, and refreshed in the background |
| `> max_age_seconds` | the provider is called; the stale value is returned only if the provider fails |
| nothing cached | the provider is called; if it fails, the region is omitted |

`refresh_seconds: 0` disables cache reads entirely and always calls the provider (live reload). Provider results are written to every store (write-back) and the write, like the background refresh, runs through the host's scheduler (`ctx.waitUntil` on Workers, a Tokio task natively) so it never blocks the response.

This table is implemented in `plan()`; combining cached and fetched values, dropping invalid or unrequested rows, and flagging stale fallbacks is `merge()`. Both are pure functions of their inputs, including `now`, so they are fully testable and identical on every host.

A stale value that is returned after a provider failure is still labelled with its real `observed_at`, so `rilot-core` independently decides it is too old to route on. The layer never pretends a value is fresh.

## Configuration

```json
{
  "carbon": {
    "provider": "electricitymap",
    "options": { "zone_map": { "us-east-1": "US-MIDA-PJM" } },
    "max_age_seconds": 300,
    "refresh_seconds": 60,
    "provider_timeout_ms": 1500
  }
}
```

`options` is provider-specific and never interpreted by the service, so a new source needs no change to the config schema.

## Adding a new source

Implement one interface and register it. Nothing else in Rilot changes.

**TypeScript** (`packages/rilot-carbon/src/providers/`):

```ts
import { registerProvider, type CarbonProvider, type CarbonSignal, type ProviderContext } from '@rilot/carbon';

class WattTimeProvider implements CarbonProvider {
  readonly name = 'watttime';
  constructor(private readonly token: string, private readonly areas: Record<string, string>) {}

  async fetch(regions: string[], ctx: ProviderContext): Promise<CarbonSignal[]> {
    const results = await Promise.all(regions.map(async (region) => {
      const area = this.areas[region];               // mapping stays in here
      if (!area) return null;
      const res = await fetch(`https://api.watttime.org/v3/signal-index?region=${area}`, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(ctx.timeoutMs)
      });
      if (!res.ok) return null;                      // a failure is a gap, not an exception
      const body = await res.json();
      return { region, carbon_g_per_kwh: body.value, observed_at: body.point_time, source: 'live' as const };
    }));
    return results.filter((s): s is CarbonSignal => s !== null);
  }
}

registerProvider('watttime', (config, env) =>
  env.wattTimeToken ? new WattTimeProvider(env.wattTimeToken, (config.options?.areas as Record<string, string>) ?? {}) : null
);
```

**Rust** (`crates/rilot-carbon/src/providers.rs`):

```rust
pub struct WattTimeProvider { /* client, token, area map */ }

impl CarbonProvider for WattTimeProvider {
    fn name(&self) -> &str { "watttime" }

    fn fetch<'a>(&'a self, regions: &'a [String], ctx: ProviderContext) -> SignalsFuture<'a> {
        Box::pin(async move { /* fetch, map, return Vec<CarbonSignal> */ })
    }
}
```

Then wire it in `src/carbon.rs` (native) or the registry (TypeScript), and add a fixture to `fixtures/carbon/` if it introduces new behavior.

Adding a new **cache** (Redis, D1, Durable Object, a file) is the same shape: implement `CarbonStore` and add it to the store list. Order matters: fastest first.

## Reading the cache from outside

Both adapters expose `GET /__rilot/carbon`, which serves whatever the layer has
— memory, then the store, then the provider — with each signal's `age_seconds`
and `stale` worked out for the caller. It is read-only and never returns the
provider's API key, so a browser can call it directly; `examples/demo-shop`
does exactly that when `PUBLIC_CARBON_API` is set, instead of simulating.

Because it goes through the same `CarbonService`, calling it warms the same
cache a routed request would use, and its answer is by definition the data
routing decisions are being made on. Schema:
[docs/config-reference.md](config-reference.md#carbon-api).

## Observability

`CarbonService` emits events (`miss`, `stale-served`, `provider-ok`, `provider-error`, `store-write`, `store-error`, `refresh-scheduled`, `policy-error`). Native Rilot logs failures and stale reads; the Worker forwards them to `console.warn` for `wrangler tail`. Wire them to Prometheus or Analytics Engine as needed.

## Conformance scenarios

`fixtures/carbon/` currently pins:

| Fixture | Guarantees |
| --- | --- |
| `memory-fresh-hit` | a fresh cache hit never calls the provider |
| `kv-fresh-hit` | KV values are served and labelled `last-known-good` |
| `stale-while-revalidate` | past `refresh_seconds`: serve now, refresh in the background |
| `expired-calls-provider` | past `max_age_seconds`: call the provider, write to every store |
| `provider-failure-serves-last-known-good` | a failing provider does not lose the old value |
| `nothing-anywhere-is-omitted` | no value is invented |
| `partial-batch-asks-only-for-missing` | cached regions are not re-fetched |
| `refresh-zero-always-fetches` | live-reload mode bypasses the cache |
| `invalid-and-unrequested-signals-ignored` | negative values and unrequested regions are dropped |

Each file lists the stores' contents, a scripted provider, the request, and the expected signals, provider calls, background refreshes, and store writes.

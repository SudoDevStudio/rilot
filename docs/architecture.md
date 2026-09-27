# Architecture

## Goal

Rilot routes each request to the best backend under a carbon / latency / reliability policy, while keeping radius, health, and latency guardrails explicit and explainable.

## One routing engine, many adapters

```text
                    rilot-core (Rust, pure)
                            │
          ┌─────────────────┼──────────────────┐
          ▼                 ▼                  ▼
     Native Rilot      Cloudflare        Browser Wasm
    (src/, Hyper)      Worker           (policy playground)
```

`crates/rilot-core` is the only place routing decisions are made: routing-rule resolution, radius eligibility, constraints, scoring, fallback, and hysteresis. It is platform-independent. It has no async runtime, HTTP, filesystem, environment variables, clocks, or provider SDKs, and it compiles to `wasm32-unknown-unknown` with zero imports.

Everything else is an adapter. An adapter supplies request metadata, runtime health, the current time, and carbon signals, then acts on the core's `DecisionOutput`.

## High-level components

| Component | Path | Role |
| --- | --- | --- |
| Routing engine | `crates/rilot-core` | `plan()` / `decide()`; config model; region catalog |
| Wasm bindings | `crates/rilot-wasm` | JSON-in/JSON-out C ABI for browsers and Workers |
| JS binding | `packages/rilot-js` | shared TypeScript wrapper for the Wasm module |
| Cloudflare adapter | `adapters/cloudflare` | Worker: request metadata, Workers KV carbon cache, forwarding |
| Native HTTP adapter | `src/proxy.rs` | request context, runtime stats, forwarding, metrics |
| Carbon policy | `crates/rilot-carbon-policy` | pure freshness/refresh/fallback rules (also compiled to Wasm) |
| Carbon I/O | `crates/rilot-carbon`, `packages/rilot-carbon` | providers and caches for native and JavaScript hosts |
| Native carbon wiring | `src/carbon.rs` | maps config to providers and stores |
| Config loader | `src/config.rs` | simple config + legacy `proxies` translation |
| Wasm plugin runtime | `src/wasm_engine.rs` | optional per-route request plugins |
| Shared fixtures | `fixtures/decisions/` | same inputs/expectations for every target |

## Request lifecycle (native)

1. Resolve the routing rule for the path (the most specific rule wins; unset values inherit from the root).
2. Build the request context: `x-user-region`, optional `x-user-lat`/`x-user-lon`, and `x-rilot-*` hints.
3. `rilot_core::plan()` runs every carbon-independent step: scope, strict-local, **radius**, candidate limit, health/capacity/latency constraints. It returns the regions that still need carbon data. For a `latency` policy that list is empty.
4. `CarbonService` fetches signals **only for those regions** (cache first, provider on miss, last-known-good on failure).
5. `rilot_core::decide()` evaluates carbon freshness, scores eligible backends, applies hysteresis, and falls back if nothing is eligible.
6. Optional time-shift deferral and Wasm plugin step.
7. Forward to the selected backend's `url`; record metrics and a structured decision log.

## Carbon boundary

```text
backend regions ─▶ CarbonService ─▶ CarbonProvider ─▶ provider-specific API
                        │                                    │
                        ◀──── normalized CarbonSignal ◀──────┘
                  {region, carbon_g_per_kwh, observed_at}
```

- Rilot speaks in canonical backend regions (`us-east-1`, `eu-west-1`, ...).
- Providers own any translation to their own identifiers. For example, `ElectricityMapsProvider` maps `us-east-1 → US-MIDA-PJM` internally. Provider zone ids never reach the core.
- Caching and freshness belong to `CarbonService` (`crates/rilot-carbon` for Rust hosts, `packages/rilot-carbon` for JavaScript hosts), not to providers. Both implementations are pinned by `fixtures/carbon/*.json`; see [carbon-layer.md](carbon-layer.md). `carbon.max_age_seconds` (default 300) bounds how old a signal may be. The core double-checks age against `now` and marks older signals `stale` (→ `carbon-unavailable`).

## Region model

Backends declare a canonical `region`. The core ships a region catalog (cloud region → approximate coordinates) that is used for:

- **radius eligibility** (`radius_km`, great-circle distance from the user), and
- **latency estimates** when no measurement or configured RTT is available.

The caller's own location comes from the adapter: natively from `x-user-region` or `x-user-location: <lat>,<lon>`; at the edge from Cloudflare's `cf.latitude`/`cf.longitude`, which those same headers override so a deployed Worker can be tested from anywhere. If no location can be determined, radius is not applied and the decision says so (`radius_applied: false`).

Users never need to configure latitude/longitude. A backend may set an explicit `location` only for regions missing from the catalog. The catalog contains no carbon-provider identifiers.

## Determinism

`decide()` is a pure function of `(config, request, now, signals, runtime, previous)`. The same input produces the same selected backend natively, in Wasm, and in the browser. `fixtures/decisions/` pins this in CI through `cargo test` (core and native) and `scripts/check-wasm-fixtures.mjs` (compiled Wasm).

## Safety posture

- No eligible backend → configured `fallback` (`nearest`, `lowest-latency`, or `none`); unhealthy backends are never fallback targets.
- Missing or stale carbon → that backend is `carbon-unavailable`; routing continues with the rest or falls back.
- `strict-local` routes bypass plugins and time shifting.
- Provider calls are bounded by `carbon.provider_timeout_ms`.

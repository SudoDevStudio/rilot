# Playground Engine Comparison (Phase 5)

Before it was retired, the Policy Playground's TypeScript decision model (`examples/policy-playground/src/model/decision.ts`) was compared with `rilot-core` compiled to WebAssembly. The goal was to find out where they disagreed and why, not to force Rust to reproduce the TypeScript behavior.

## Method

- **Inputs:** the five original playground presets, plus 5,000 randomized scenarios. The sweep uses the seeded PRNG `mulberry32`, seed `20260918`, and randomizes user region, active region, geo policy, weights, every guardrail, fail-safe, and each candidate's enabled flag, latency, carbon, and reliability.
- **Mapping to core:**
  - `local-only` → `route_class: strict-local`; `prefer-local`/`global` → `flexible`
  - `failSafeToLocal` → `fallback: nearest` (else `none`)
  - reliability risk *r* → error rate *r*/100
  - active region → `previous` backend
  - disabled → `healthy: false`
- **Comparison:** the selected backend. Every disagreement was classified by comparing both engines' eligible sets and rejection reasons.

## Results

| Outcome | Scenarios | Share |
| --- | ---: | ---: |
| Same selected backend | 3,907 | 78.1% |
| Latency-delta reference differs | 367 | 7.3% |
| Fallback target differs | 288 | 5.8% |
| Min-carbon-benefit baseline differs | 225 | 4.5% |
| `prefer-local` rule (TypeScript only) | 139 | 2.8% |
| Score normalization (same eligible set) | 64 | 1.3% |
| Hysteresis comparison | 7 | 0.1% |
| Strict-local with the local backend down | 3 | 0.1% |

Presets: 4 of 5 agree. **Balanced routing** differs because of score normalization: TypeScript picks `us-west`, core picks `us-east`.

## Differences and decisions

Each difference below comes from a simplification in the old TypeScript model. **Rust was kept** in every case except one, where the comparison exposed a bug in core itself (see the end of this section).

1. **Latency-delta reference.** TypeScript measured `maxLatencyDelta` from the *local* backend, even when that backend was disabled or already over the hard latency limit, so a slow or dead local backend loosened the guardrail for everyone. Core measures it from the fastest backend that can actually serve the request.
2. **Fallback target.** TypeScript always fell back to the "local baseline", even if it was far away or failing. Core applies the configured `fallback`, which here is geographically `nearest` among healthy backends.
3. **Min-carbon-benefit baseline.** TypeScript compared against the local-region backend, and applied the check even when that backend was itself rejected. Core compares against the lowest-latency *eligible* backend, which is where latency-only routing would send the request.
4. **`prefer-local`.** This rule existed only in TypeScript (reject remote options that are neither faster nor cleaner). Such candidates rarely win on score anyway. The explicit replacements are radius, `max_latency_delta_ms`, and `min_carbon_benefit_g_per_kwh`, all of which the native runtime also enforces.
5. **Score normalization.** TypeScript used min–max scaling, which turns a 1 ms or 1 g difference into a full 0→1 swing when there are two candidates. Core divides by the maximum among eligible candidates. This is scale-invariant and is what native Rilot has always used for the published experiments.
6. **Hysteresis.** Both engines use the same rule. The scores differ because of (5), so the "gain" crosses the threshold in different places.
7. **Strict-local with the local backend down.** TypeScript silently re-pinned `local-only` traffic to a *foreign* region. Core keeps the strict-local guarantee and applies the configured fallback. With `fallback: none`, it makes no selection instead of moving data out of the region.

**Core bug found and fixed.** The sweep showed that core chose its "fastest candidate" latency reference *before* health and capacity checks. An unhealthy 5 ms backend could therefore push every healthy backend over `max_latency_delta_ms`. Core now computes the reference from healthy, unsaturated candidates. The regression test is `unhealthy_or_saturated_backends_do_not_set_the_latency_reference` in `crates/rilot-core/src/decision.rs`.

## Preset adjustment

The **Hysteresis prevents flapping** preset relied on min–max scaling to create a near-tie. Under core scoring, us-west's carbon was changed from 220 to 200 gCO2/kWh so the preset still demonstrates what it is named for: a 0.011 score gain, below the 0.09 threshold, keeps `us-east` active.

## Outcome

With every difference explained and none requiring a change to match TypeScript, the TypeScript engine was deleted (Phase 6). The playground has no routing logic of its own; `fixtures/decisions/` guards agreement between core, native Rilot, and the browser.

# Roadmap / Pending Work

What is still open in this repository. Replaces the completed `refactor-plan.md` (every phase of that plan — one shared `rilot-core`, the Wasm build, the browser adapter, retiring the TypeScript engine, and the Normal/Research playground — is done).

## Blocking for the SoftwareX submission

**1. Re-run the comparative experiment.** The previous results were produced by the pre-refactor engine and have been deleted. Scoring, fallback semantics, the latency-reference fix, and the whole carbon layer have changed since, so the old numbers no longer describe this code.

```bash
cd research-kit && ./scripts/run_comparative_experiment.sh
```

**2. Cut a release.** Versions drift: `rilot` is `0.5.0` (pre-refactor), `rilot-core` `0.2.0`, `rilot-carbon` / `rilot-carbon-policy` `0.1.0`, and `CITATION.cff` says `0.5.0`. Existing tags mix `0.2.0` and `v0.3.0` styles. Pick `0.6.0`, align `Cargo.toml` files and `CITATION.cff`, and tag `v0.6.0`.

The evaluation script already understands the current reason codes (`reason_kind()` in `run_comparative_evaluation.py`): `score-win` and `deferred-for-greener-window` count as carbon-driven, and `lowest-latency`, `hysteresis-sticky-zone`, `fallback-*` and the no-selection codes are reported separately.

## Worth doing next

**3. Measure the routing overhead.** There is no number for how long one decision takes (µs per `decide()`, native and Wasm) or how much p95 latency the proxy adds. For a routing proxy this is the first question a reviewer asks.

**4. Expose the carbon layer's events as metrics.** `CarbonService` emits `store-write`, `provider-error`, `stale-served`, `miss` and more, but `/metrics` has no carbon counters: cache hit rate, provider failures, stale-served count. See `docs/carbon-layer.md`.

**5. Make forecasting and time shifting demonstrable.** This is the last item from the old refactor plan. The engine supports `forecasting`, `time_shift` and `deferred-for-greener-window`, but the playground has no controls for them and its simulated signals carry no `forecast_g_per_kwh`, so the feature cannot be shown. Today it is reachable only by editing the config JSON by hand.

## Known limitations (documented, not bugs)

- **Cloudflare hysteresis is per isolate.** Stickiness is not global; a Durable Object would be needed. See `adapters/cloudflare/README.md`.
- **No deferral at the edge.** A `deferred-for-greener-window` decision is reported through `x-rilot-defer-seconds`; the Worker does not delay the request.
- **No `/metrics` at the edge.** Use `wrangler tail` or Workers Analytics.
- **Carbon providers are implemented twice** — Rust (`reqwest`) for native, TypeScript (`fetch`) for Workers. The *rules* are shared (`crates/rilot-carbon-policy`), but a new source still has to be written on both sides if it must run in both places.
- **Energy and CO2e are model estimates**, not measurements. See `docs/model-calibration.md`.

## Continuous integration

- `cargo clippy` and `cargo fmt --check` still do not run anywhere in CI. Five pre-existing clippy warnings in `src/wasm_engine.rs` (deref/`map_or` style) are the current backlog.
- `run-it/*.sh` is not linted; there is no shellcheck step.
- The browser apps (`examples/policy-playground`, `examples/demo-shop`) are tested and built on every push and pull request by the `browser-apps` job in `ci.yml`. Deployment stays in the Pages workflow.

## Small cleanups

- `examples/wasm-plugin/` is a standalone crate (its own `[workspace]`), so `cargo test --workspace` and CI never build it. It does build with `cargo build --release --target wasm32-wasip1` from that folder.
- The playground's Research-view candidate table scrolls sideways on desktop.

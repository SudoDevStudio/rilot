# Rilot: Carbon Cursor Edge Routing Research Tool

[![CI](https://github.com/SudoDevStudio/rilot/actions/workflows/ci.yml/badge.svg)](https://github.com/SudoDevStudio/rilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/SudoDevStudio/rilot/blob/main/LICENSE)
[![Citation](https://img.shields.io/badge/Citation-CITATION.cff-blue.svg)](https://github.com/SudoDevStudio/rilot/blob/main/CITATION.cff)

Rilot is an open-source Rust proxy for per-request carbon-aware routing at the HTTP edge.

## Highlights

- Carbon Cursor routing pipeline: classify, constrain, signal, score.
- Region-first routing (`x-user-region`) with per-zone metadata.
- Built-in multi-objective policy modes and route classes.
- Explicit policy weights that override built-in mode presets when provided.
- Per-route feature toggles for carbon, forecasting, time-shift, and plugins.
- Wasm extensibility for custom routing and energy overrides.
- Carbon provider modes: `mock`, `slow-mock`, `electricitymap`, and standalone fixture-backed `electricitymap-local`.
- Prometheus metrics, decision logs, and periodic rollups.
- Single routing engine: `crates/rilot-core` (pure Rust, also compiled to Wasm) shared by native Rilot, edge adapters, and the browser playground.
- Simple config: `backends`, `policy`, `radius_km`, `fallback`, `routing_rules` (the legacy `proxies` format is still accepted).
- Reproducible comparative evaluation kit in `research-kit/`.

## Cloudflare Worker

`adapters/cloudflare` deploys Rilot to Cloudflare Workers, running the same `rilot-core` engine as WebAssembly. Cloudflare supplies the caller's location, Workers KV holds last-known-good carbon signals, and `/__rilot/decision` explains any routing decision without forwarding traffic. See [adapters/cloudflare/README.md](adapters/cloudflare/README.md).

## Demo shop

`examples/demo-shop` is the fastest way to *see* what Rilot does: a small Astro storefront on the left, and on the right the decision Rilot made for that exact request — matched rule, carbon signals (or why they were skipped), every candidate with its verdict, and the backend that served it. Every shop page is a real URL, and that URL is the path Rilot routes. Move the shopper to another city, drag the grid clock, or set a routing policy per page in the panel's **Policy** tab (it travels as a cookie, so a real deployment honours it), and the routing changes in front of you. It deploys to GitHub Pages alongside the playground. See [examples/demo-shop/README.md](examples/demo-shop/README.md).

## Policy Playground

`examples/policy-playground` is an interactive browser-based visualization of the same Rilot decision engine used by the native runtime and edge adapters: `rilot-core` compiled to WebAssembly. It shows the matched routing rule, inherited configuration, radius eligibility, carbon signal status, and why each backend was selected or rejected. It is deployed as a static GitHub Pages site and needs no server or API keys.

## Quickstart

```bash
./run-it/check.sh        # what is installed, and what each script needs
./run-it/native.sh       # the proxy with local backends
./run-it/demo-shop.sh    # the split-screen demo
./run-it/test-all.sh     # every test suite
```

See [run-it/README.md](run-it/README.md) for all of them.

## Local quickstart (with simulators)

1. Start zone simulators:

```bash
./examples/node-apps/run-local-zones.sh
```

2. Start Rilot in another terminal:

```bash
cargo build --release
RUST_LOG=info ./target/release/rilot config.json
```

3. Send traffic:

```bash
curl -H 'x-user-region: us-east' http://127.0.0.1:8080/
curl -H 'x-user-region: us-west' http://127.0.0.1:8080/
```

## Enable ElectricityMap

In your config:

- set `carbon.provider` to `electricitymap`
- set `carbon.electricitymap_api_key`
- optional: set `carbon.electricitymap_api_token_header` if your token header differs from `auth-token`
- optionally set `carbon.electricitymap_zone_map` when route zone names differ from ElectricityMap zone IDs

Rilot uses async refresh + cache for provider calls and falls back to cached/default values on timeout.
Use `carbon.cache_ttl_seconds` for cache TTL (in seconds, default `60`).

For local/offline testing, use:

- `carbon.provider = "electricitymap-local"`
- `carbon.electricitymap_local_fixture = "<path to fixture json>"`
- set `carbon.electricitymap_local_live_reload=true` for per-request fixture reads (otherwise cached)

`carbon.cache_ttl_seconds` is the only cache TTL setting.

The research kit uses a separate local ElectricityMap-compatible API backed by a fixed CSV snapshot(ElectricityMap Sandbox data), so comparative runs do not require live external carbon API calls unless you explicitly override the provider.

## Docker research quickstart

```bash
cd research-kit
docker compose up --build -d
./scripts/run_comparative_experiment.sh
```

The primary runner writes refreshed outputs to `research-kit/get_result/comparative-results/`.

The generated `summary.md` includes explicit trade-off deltas versus baseline:

- carbon exposure saved (%)
- CO2e saved (%)
- latency p95 delta
- error rate
- sampled CPU delta
- sampled memory delta

Optional stronger-evidence runs:

- `ENABLE_FAILURE_SCENARIO=1 ./scripts/run_comparative_experiment.sh` (provider-timeout robustness)
- `python3 ./scripts/run_weight_sensitivity.py` (policy weight sensitivity)
- `node ./scripts/charts.js` (interactive charts from latest comparative run; writes `charts.html`)
- `REQUESTS_PER_REGION=1500 ./scripts/run_comparative_experiment.sh` (smaller reproducible check run)

## Core docs

- `docs/README.md` (documentation index)
- `docs/architecture.md`
- `docs/config-reference.md`
- `docs/runtime-behavior.md`
- `docs/wasm-carbon-plugin.md`
- `docs/operations.md`
- `docs/research-toolkit.md`
- `docs/model-calibration.md`
- `docs/edge-target.md`
- `docs/carbon-layer.md`
- `docs/playground-engine-comparison.md`
- `docs/roadmap.md`
- `docs/running.pa.md` (Punjabi guide, Roman script: how to run everything)
- `docs/how-it-works.pa.md` (Punjabi guide, Roman script: Rilot kiven kamm karda hai)

## Repository layout

```text
src/                      native proxy (HTTP, metrics, plugin host)
crates/
  rilot-core/             THE routing engine: rules, radius, scoring, fallback (pure, no I/O)
  rilot-carbon-policy/    carbon cache policy: serve / fetch / refresh (pure, no I/O)
  rilot-carbon/           carbon providers + caches for native Rust
  rilot-wasm/             C ABI so the two pure crates run in browsers and Workers
packages/
  rilot-js/               TypeScript binding for the Wasm engine
  rilot-carbon/           carbon providers + caches for JavaScript hosts
adapters/
  cloudflare/             Cloudflare Worker (request metadata, Workers KV, forwarding)
examples/
  policy-playground/      browser visualization of the same engine
  node-apps/              local backend simulators
  config/                 example configs
fixtures/
  decisions/              routing cases checked in Rust, Wasm and the browser
  carbon/                 carbon-layer cases checked in Rust and TypeScript
research-kit/             comparative evaluation (Docker, Prometheus, scripts)
run-it/                   one script per way of running Rilot
docker/                   default config for the container image
scripts/                  repository-level checks
docs/                     documentation
```

Two rules explain the whole layout:

1. **`crates/rilot-core` and `crates/rilot-carbon-policy` make every decision.** They are pure: no HTTP, no clock, no filesystem. They compile to WebAssembly, so native Rilot, the Cloudflare Worker and the browser all get identical answers.
2. **Everything else is an adapter.** It supplies data (request metadata, carbon signals, runtime health) and acts on the result. The shared fixtures keep them honest.

### Key files

- Routing decisions: `crates/rilot-core/src/decision.rs`
- Carbon freshness rules: `crates/rilot-carbon-policy/src/lib.rs`
- Native request path: `src/proxy.rs`
- Cloudflare Worker: `adapters/cloudflare/src/index.ts`
- Demo shop: `examples/demo-shop/src/pages/` (one file per routed path)
- Playground UI: `examples/policy-playground/src/App.tsx`
- Config schema (native, both formats): `src/config.rs`
- What is still open: `docs/roadmap.md`

## Broader Applicability

- Data center operators can use Rilot to evaluate region/zone dispatch policies under carbon and latency guardrails before production rollout.
- Cloud platforms can expose per-tenant policy profiles (latency-first, carbon-first, balanced) using the same routing core.
- Edge/API gateway teams can integrate route-level Wasm overrides for custom scoring and external signal sources without changing core proxy code.

## Data Availability Statement

All code, configuration, and experiment scripts required to reproduce the reported results are included in this repository.

- Comparative evaluation scripts: `research-kit/scripts/run_comparative_experiment.sh`, `research-kit/scripts/run_comparative_evaluation.py`
- Sensitivity analysis script: `research-kit/scripts/run_weight_sensitivity.py`
- Experiment configuration and traces: `research-kit/config.live.json`, `research-kit/carbon-traces/`
- Generated artifacts: `research-kit/get_result/comparative-results/` (summary tables, per-request CSV, Prometheus snapshots, charts) — produced by a run, not committed

## License

MIT

## How to Cite

If you use Rilot in research, please cite:

Machine-readable citation metadata is also available in `CITATION.cff`.

```bibtex
@software{maninderpreet_singh_rilot_2026,
  author = {Maninderpreet Singh, Ranvir Kaur},
  title = {Rilot: Carbon Cursor Edge Routing},
  year = {2026},
  url = {https://github.com/SudoDevStudio/rilot}
}
```

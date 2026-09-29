# Policy Playground

An interactive, browser-based visualization of **the same Rilot decision engine used by the native runtime and edge adapters**.

The playground does not contain its own routing algorithm. Every result on the page comes from `rilot-core` (`crates/rilot-core`), compiled to WebAssembly and loaded through a thin adapter:

```text
React UI state ─▶ src/rilot/config.ts ─▶ DecisionInput (JSON)
                                              │
                                     rilot-core.wasm (Rust)
                                              │
React visualization ◀─────────────── DecisionOutput (JSON)
```

It remains separate from the formal benchmark workflow in `research-kit/`: it is for inspecting *why* a backend was selected or rejected, not for producing results.

## Views

**Normal** (default) shows what an operator needs:

- request path and user region
- matched routing rule and the effective policy, radius, fallback and backends, each marked as set by the rule or inherited from the root
- carbon provider, signal source, and signal age
- candidate backends with distance, latency, carbon, and eligibility (`eligible`, `outside radius`, `carbon unavailable`, `latency constraint`, `health constraint`, `capacity constraint`, `fallback candidate`)
- selected backend and decision reason

**Research / Advanced** adds the research controls (weights, latency and carbon-benefit guardrails, error-rate threshold, hysteresis, route class, signal max age and source), per-backend simulated inputs, score breakdowns, a decision trace, and the exact normalized carbon signals sent to the engine.

## Config mode

"Edit the full config as JSON" accepts the same config native Rilot loads (`backends`, `policy`, `radius_km`, `fallback`, `routing_rules`, optional `advanced`). Enter a path such as `/checkout/pay` and the playground shows the matched rule, the inherited values, the effective config, every candidate's evaluation, and the selected backend.

## Presets

Production examples (one shared config with routing rules):

| Preset | Path | Effective policy / radius | Purpose |
| --- | --- | --- | --- |
| Checkout | `/checkout/pay` | latency · 800 km (rule) | latency-sensitive user request |
| Recommendations | `/recommendations/user/123` | balanced · 2000 km (root) | moderate carbon/latency trade-off |
| Reports | `/reports/monthly` | carbon · 5000 km (rule) | carbon-sensitive flexible workload |

Research scenarios (Research view): local pinned interactive, balanced routing, carbon-first background, cleaner but rejected, hysteresis prevents flapping.

## How a decision is computed

The playground follows the same flow as native Rilot and edge adapters (`src/rilot/config.ts#runDecision`):

1. `plan()` resolves the rule and applies radius, health, and latency checks, and returns the regions that still need carbon data. A latency policy needs none.
2. Simulated carbon signals are "fetched" only for those regions.
3. `decide()` returns the `DecisionOutput` that the page renders.

Carbon values come from a bundled fixture in the normalized JSON-provider format (`src/rilot/carbon-fixture.json`), keyed by Rilot region. No provider API is called and no secrets are needed. The simulation clock is fixed, so results are reproducible.

## Layout

```text
src/
  App.tsx                     page layout, view toggle, presets
  components/                 DecisionPanel, ResearchControls, ConfigEditor, fields
  model/ui-types.ts           editable playground state (a real RoutingConfig + simulated runtime inputs)
  model/presets.ts            production and research presets
  rilot/wasm.ts               loads rilot-core.wasm; JSON in / JSON out; UI-safe errors
  rilot/types.ts              TypeScript mirror of the core JSON interface
  rilot/config.ts             state → DecisionInput, and the plan → fetch → decide flow
  rilot/fixtures.ts           simulated carbon signals and fixed simulation clock
  rilot/carbon-fixture.json   bundled normalized carbon signals
```

The earlier TypeScript decision model was retired after a side-by-side comparison with rilot-core; see [`docs/playground-engine-comparison.md`](../../docs/playground-engine-comparison.md).

## Prerequisites

The dev, test, and build scripts compile `rilot-core` first, so you need Rust with the Wasm target:

```bash
rustup target add wasm32-unknown-unknown
```

## Run locally

```bash
cd examples/policy-playground
npm install
npm run dev
```

## Test

```bash
npm run test
```

Tests run the shared decision fixtures in `fixtures/decisions/` through the browser adapter (the same files are checked by `cargo test` for rilot-core and native Rilot), plus every preset.

## Build

```bash
npm run build
```

## Deploy to GitHub Pages

This app is prepared for static deployment on GitHub Pages.

What is already wired:

- Vite reads `VITE_BASE_PATH` so the app can build correctly under a repository subpath
- `.github/workflows/policy-playground-pages.yml` installs Rust and Node, compiles rilot-core to Wasm, runs tests, builds the app, and deploys `dist/` (including the `.wasm` asset) to Pages

Recommended repository setup:

1. Push this repo to GitHub.
2. In repository settings, enable **Pages** with **GitHub Actions** as the source.
3. Keep the app in `examples/policy-playground/`; the workflow will build and deploy from there.

The published URL will usually look like:

```text
https://<github-user>.github.io/<repository-name>/
```

Manual local check with a Pages-style base path:

```bash
cd examples/policy-playground
VITE_BASE_PATH=/rilot/ npm run build
```


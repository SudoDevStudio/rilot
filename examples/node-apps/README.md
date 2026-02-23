# Node Scenario Apps

Minimal Node.js apps to simulate all major Rilot scenarios.

## Apps and ports

- `us-east-app.js` -> `5601` (flexible traffic)
- `us-west-app.js` -> `5602` (flexible traffic)
- `checkout-local-app.js` -> `5603` (strict-local)
- `background-east-app.js` -> `5604` (background/time-shift)
- `background-west-app.js` -> `5605` (background/time-shift)
- `plugin-oracle-app.js` -> `3012` (Wasm plugin data source)

## Start everything

```bash
./examples/node-apps/run-local-zones.sh
```

Run Rilot with the scenario config (uses local ElectricityMap-style fixture):

```bash
RUST_LOG=info ./target/release/rilot examples/config/config.json
```

## One-command scenario report for reviewers

```bash
python examples/scripts/run_all_scenarios_report.py
```

This runs all scenario routes and prints:

- total requests
- carbon-safe calls
- carbon-safe call ratio (%)

## Scenario routes (with `examples/config/config.json`)

- `/checkout/*` -> strict-local route class
- `/search/*` -> flexible balanced routing
- `/content/*` -> latency-first flexible routing
- `/batch/*` -> background carbon-first + time-shift
- `/plugin-energy/*` -> plugin-enabled energy override route
- `/` -> default flexible fallback route

## Useful test calls

```bash
curl -H 'x-user-region: us-east' http://127.0.0.1:8080/checkout/ping
curl -H 'x-user-region: us-east' http://127.0.0.1:8080/search?q=phone
curl -H 'x-user-region: us-west' http://127.0.0.1:8080/content/home
curl -H 'x-user-region: us-east' http://127.0.0.1:8080/batch/reindex
curl -H 'x-user-region: us-east' http://127.0.0.1:8080/plugin-energy/demo
```

## App endpoints

Each zone/background/checkout app supports:

- `GET /health`
- `GET /energy-model`
- `GET /unstable`
- `GET /`

Plugin oracle supports:

- `GET /health`
- `GET /category/sample` (used by `examples/src/lib.rs` Wasm example)

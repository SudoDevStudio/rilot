# Rilot: Carbon Cursor Edge Routing

Rilot is a Rust reverse proxy for per-request carbon-aware edge routing.

## Highlights

- Carbon Cursor routing pipeline: classify, constrain, signal, score.
- Region-first routing (`x-user-region`) with per-zone metadata.
- Built-in multi-objective policy modes and route classes.
- Per-route feature toggles for carbon, forecasting, time-shift, and plugins.
- Wasm extensibility for custom routing and energy overrides.
- Prometheus metrics, decision logs, and periodic rollups.

## Quickstart

```bash
cargo build --release
RUST_LOG=info ./target/release/rilot config.json
```

## Docker research quickstart

```bash
cd research-kit
docker compose up --build -d
./scripts/run_experiment.sh
```

## Core docs

- `docs/README.md` (documentation index)
- `docs/architecture.md`
- `docs/config-reference.md`
- `docs/runtime-behavior.md`
- `docs/wasm-carbon-plugin.md`
- `docs/operations.md`
- `docs/research-toolkit.md`

## Key files

- Runtime: `src/proxy.rs`
- Config schema: `src/config.rs`
- Wasm runtime: `src/wasm_engine.rs`
- Default config: `config.json`
- Docker experiment config: `research-kit/config.docker.json`

## License

MIT

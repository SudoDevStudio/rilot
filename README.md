# Rilot: Carbon Cursor Edge Routing

Rilot is a Rust reverse proxy for per-request carbon-aware edge routing.

## Highlights

- Carbon Cursor routing pipeline: classify, constrain, signal, score.
- Region-first routing (`x-user-region`) with per-zone metadata.
- Built-in multi-objective policy modes and route classes.
- Per-route feature toggles for carbon, forecasting, time-shift, and plugins.
- Wasm extensibility for custom routing and energy overrides.
- Carbon provider modes: `mock`, `slow-mock`, `electricitymap`, and `electricitymap-local`.
- Prometheus metrics, decision logs, and periodic rollups.
- Shared policy crate: `crates/rilot-core` for future adapter targets.

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
Use `carbon.cache_ttl_minutes` to control how long API responses stay in memory before refresh (default `1` minute).

For local/offline testing, use:

- `carbon.provider = "electricitymap-local"`
- `carbon.electricitymap_local_fixture = "<path to fixture json>"`

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
- `docs/edge-target.md`

## Key files

- Runtime: `src/proxy.rs`
- Config schema: `src/config.rs`
- Wasm runtime: `src/wasm_engine.rs`
- Policy core: `crates/rilot-core/src/lib.rs`
- Edge adapter roadmap (future work): `adapters/edge-wasm/`
- Default config: `config.json`
- Example config: `examples/config/config.json`
- Local simulators: `examples/node-apps/`
- Docker experiment config: `research-kit/config.docker.json`

## License

MIT

## How to Cite

If you use Rilot in research, please cite:

```bibtex
@software{maninderpreet_singh_rilot_2026,
  author = {Maninderpreet Singh},
  title = {Rilot: Carbon Cursor Edge Routing},
  year = {2026},
  url = {https://github.com/SudoDevStudio/rilot}
}
```

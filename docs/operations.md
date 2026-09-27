# Operations Guide

## Local run

1. Start zone simulators:

```bash
./examples/node-apps/run-local-zones.sh
```

2. Start Rilot in another terminal:

```bash
cargo build --release
RUST_LOG=info ./target/release/rilot config.json
```

Optional env vars:

- `RILOT_HOST` (default `127.0.0.1`)
- `RILOT_PORT` (default `8080`)
- `RILOT_ENV=production` (enables Wasm component cache)
- `RILOT_EXPOSE_RESEARCH_HEADERS=true` (adds the `x-rilot-*` decision headers)
- `RILOT_ELECTRICITYMAP_API_KEY` (live carbon data)

A ready-to-run config is at `examples/config/config.json`:

```bash
cp examples/config/config.json config.json
```

## ElectricityMap provider

To enable live carbon data:

1. Set `carbon.provider` to `electricitymap`.
2. Provide the API key through `RILOT_ELECTRICITYMAP_API_KEY` (preferred) or `carbon.electricitymap_api_key`.
3. Optionally set `carbon.electricitymap_api_token_header` (default is `auth-token`).
4. Optionally set `carbon.electricitymap_zone_map`. The provider already knows the common cloud regions (for example `us-east-1 → US-MIDA-PJM`); this is only an override for regions it does not cover.

How signals are served (see [carbon-layer.md](carbon-layer.md)):

- A cached signal younger than `carbon.refresh_seconds` is used directly.
- Older than that but within `carbon.max_age_seconds`: it is served immediately and refreshed in the background.
- Missing or older than `max_age_seconds`: the provider is called on the request path, bounded by `carbon.provider_timeout_ms`. If that call fails, the last known value is passed on and the engine reports the backend as `carbon-unavailable`.

## Offline ElectricityMap-style testing

Use standalone fixture mode when you want deterministic behavior without calling the public API from a regular config:

1. Set `carbon.provider` to `electricitymap-local`.
2. Set `carbon.electricitymap_local_fixture` to a JSON file path.
3. Set `carbon.refresh_seconds` to your desired refresh window (e.g. `10`). Legacy configs may still use the old name `cache_ttl_seconds`; both are accepted.

Fixture file example is included at:

- `research-kit/carbon-traces/electricitymap-latest-sample.json`

For local ElectricityMap-compatible testing, run:

```bash
cd research-kit
./scripts/run_comparative_experiment.sh
```

This research workflow is separate from `electricitymap-local` fixture mode. It starts `scripts/carbon-signal-api.js`, keeps `carbon.provider=electricitymap`, and serves ElectricityMap-compatible `/v3/carbon-intensity/latest` responses locally from a fixed CSV source.

## Docker run

```bash
cd research-kit
docker compose up --build -d
```

Endpoints:

- Proxy: `http://127.0.0.1:8080`
- Metrics: `http://127.0.0.1:8080/metrics`
- Prometheus: `http://127.0.0.1:9090`

## Comparative experiment run

```bash
cd research-kit
./scripts/run_comparative_experiment.sh
```

Defaults:

- 10-zone profile from `config.live.json` (rewritten to temp config for the run)
- total request target `50000` (`25000` per region)
- fixed local carbon source CSV: `research-kit/carbon-traces/electricitymap-sandbox-20260328T2000Z.csv`
- provider cache minimum `5s` for experiment (`carbon.refresh_seconds>=5`)
- coverage-derived Electricity Maps zone aliases from `research-kit/2026-03-29-electricity-maps-coverage-data.csv` when present
- CSV-only local ElectricityMap-compatible provider (`scripts/carbon-signal-api.js`) is used for signals
- API serves data in-memory by default (optional snapshot write via `CARBON_API_OUT_FILE`)
- cross-region latency emulation enabled (`RILOT_EMULATE_CROSS_REGION_RTT=true`)
- stable output folder: `research-kit/get_result/comparative-results/`

If both `TOTAL_REQUESTS` and `REQUESTS_PER_REGION` are set, the runner uses `REQUESTS_PER_REGION`.
The runner refreshes the `research-kit/get_result/` workspace at the start of each run.

## Health and validation checklist

1. `curl -s http://127.0.0.1:8080/metrics`
2. Send a test request as a user in a given region:
   - `curl -H 'x-user-region: us-east-1' http://127.0.0.1:8080/`
3. Or as a user at given coordinates, which is the easiest way to exercise `radius_km`:
   - `curl -H 'x-user-location: 51.5,-0.13' http://127.0.0.1:8080/reports/monthly`
   - With `RILOT_EXPOSE_RESEARCH_HEADERS=true`, `x-rilot-zone-filter-reasons` then shows which backends fell outside the radius.
4. Check logs for `decision=` and `rollup=` entries.

## Troubleshooting

### No matching route

- Simple config: a request that matches no `routing_rules` entry uses the root config, so a 404 means the legacy format is in use.
- Legacy config: confirm `rule.path` / `rule.type`, and that each `rule.path` is unique across `proxies[]` (`contain` is an alias for `prefix`).
- `/checkout/*` matches `/checkout` and everything under it; a path without `*` is an exact match.

### No carbon-aware behavior

- Confirm the effective `policy` is `balanced` or `carbon`. The `latency` policy never looks at carbon (legacy equivalent: `carbon_cursor_enabled=true`).
- Confirm `backends` are configured and non-empty (legacy: `zones`).
- Confirm the request is not overriding behavior through `x-rilot-carbon-cursor` / `x-rilot-class`.
- With research headers on, check `x-rilot-zone-filter-reasons`: `carbon-unavailable` means the signal is missing or older than `max_age_seconds`.

### ElectricityMap not used

- Confirm `carbon.provider=electricitymap`.
- Confirm `carbon.electricitymap_api_key` is set.
- Confirm zone mapping in `carbon.electricitymap_zone_map` if names differ.
- Check logs for `electricitymap_*_failed` warnings.

### Plugin not applying

- Check `policy.plugin_enabled=true`.
- Ensure route class is not `strict-local`.
- Verify plugin path in `override_file`.
- Check timeout (`plugin_timeout_ms`) and plugin logs/stderr.

### Unexpected fallback

- Check `x-rilot-decision-reason`: `fallback-nearest` or `fallback-lowest-latency` means no backend passed the eligibility checks.
- `x-rilot-zone-filter-reasons` gives the reason per backend (`outside-radius`, `carbon-unavailable`, `latency-constraint`, `health-constraint`, `capacity-constraint`).
- A carbon provider timeout or a missing API key shows up as `carbon-unavailable` on every backend.

### High routing variance

- Increase `min_switch_interval_secs`.
- Increase `hysteresis_delta`.

## Performance tuning

- Keep `advanced.max_candidates` small.
- Reduce `metrics.decision_log_sample_rate` for high traffic.
- Use production mode for Wasm cache and startup preloading of configured override components.
- Set realistic `rtt_ms` per backend (legacy: `base_rtt_ms` per zone), or leave it unset to let the engine estimate latency from the region catalog.
- Raise `carbon.refresh_seconds` so fewer requests trigger a background refresh.

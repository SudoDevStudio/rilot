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

## ElectricityMap provider

To enable live carbon data:

1. Set `carbon.provider` to `electricitymap`.
2. Set `carbon.electricitymap_api_key`.
3. Optionally set `carbon.electricitymap_api_token_header` (default is `auth-token`).
4. Optionally set `carbon.electricitymap_zone_map` to map Rilot zone names to ElectricityMap zone IDs.

Rilot reads provider data through async refresh and cache. Requests do not block on provider calls.

## Offline ElectricityMap-style testing

Use standalone fixture mode when you want deterministic behavior without calling the public API from a regular config:

1. Set `carbon.provider` to `electricitymap-local`.
2. Set `carbon.electricitymap_local_fixture` to a JSON file path.
3. Set `carbon.cache_ttl_seconds` to your desired refresh window (e.g. `10`).

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
- provider cache minimum `5s` for experiment (`carbon.cache_ttl_seconds>=5`)
- coverage-derived Electricity Maps zone aliases from `research-kit/2026-03-29-electricity-maps-coverage-data.csv` when present
- CSV-only local ElectricityMap-compatible provider (`scripts/carbon-signal-api.js`) is used for signals
- API serves data in-memory by default (optional snapshot write via `CARBON_API_OUT_FILE`)
- cross-region latency emulation enabled (`RILOT_EMULATE_CROSS_REGION_RTT=true`)
- stable output folder: `research-kit/get_result/comparative-results/`

If both `TOTAL_REQUESTS` and `REQUESTS_PER_REGION` are set, the runner uses `REQUESTS_PER_REGION`.
The runner refreshes the `research-kit/get_result/` workspace at the start of each run.

## Health and validation checklist

1. `curl -s http://127.0.0.1:8080/metrics`
2. Send test request with region header:
   - `curl -H 'x-user-region: us-east' http://127.0.0.1:8080/`
3. Check logs for `decision=` and `rollup=` entries.

## Troubleshooting

### No matching route

- Confirm `rule.path` and `rule.type` in config.
- Ensure each `rule.path` is unique across `proxies[]`.
- Ensure request path uses expected prefix for `prefix` rules (`contain` is a legacy alias).

### No carbon-aware behavior

- Confirm `policy.carbon_cursor_enabled=true`.
- Confirm zones are configured and non-empty.
- Confirm request not forcing overrides via headers.

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

### Unexpected fallback to latency

- Carbon signals may be missing or provider timeout occurred.
- Validate provider settings and fallback `zone_current` values.

### High routing variance

- Increase `min_switch_interval_secs`.
- Increase `hysteresis_delta`.

## Performance tuning

- Keep `max_candidates` small.
- Reduce `decision_log_sample_rate` for high traffic.
- Use production mode for Wasm cache and startup preloading of configured override components.
- Set realistic `base_rtt_ms` per zone.

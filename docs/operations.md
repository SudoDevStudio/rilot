# Operations Guide

## Local run

```bash
cargo build --release
RUST_LOG=info ./target/release/rilot config.json
```

Optional env vars:

- `RILOT_HOST` (default `127.0.0.1`)
- `RILOT_PORT` (default `8080`)
- `RILOT_ENV=production` (enables Wasm component cache)

## Docker run

```bash
cd research-kit
docker compose up --build -d
```

Endpoints:

- Proxy: `http://127.0.0.1:8080`
- Metrics: `http://127.0.0.1:8080/metrics`
- Prometheus: `http://127.0.0.1:9090`

## Health and validation checklist

1. `curl -s http://127.0.0.1:8080/metrics`
2. Send test request with region header:
   - `curl -H 'x-user-region: us-east' http://127.0.0.1:8080/`
3. Check logs for `decision=` and `rollup=` entries.

## Troubleshooting

### No matching route

- Confirm `rule.path` and `rule.type` in `config.json`.
- Ensure request path uses expected prefix for `contain` rules.

### No carbon-aware behavior

- Confirm `policy.carbon_cursor_enabled=true`.
- Confirm zones are configured and non-empty.
- Confirm request not forcing overrides via headers.

### Plugin not applying

- Check `policy.plugin_enabled=true`.
- Ensure route class is not `strict-local`.
- Verify plugin path in `override_file`.
- Check timeout (`plugin_timeout_ms`) and plugin logs/stderr.

### Unexpected fallback to latency

- Carbon signals may be missing or provider timeout occurred.
- Validate `carbon.zone_current` values and provider settings.

### High routing variance

- Increase `min_switch_interval_secs`.
- Increase `hysteresis_delta`.

## Performance tuning

- Keep `max_candidates` small.
- Reduce `decision_log_sample_rate` for high traffic.
- Use production mode for Wasm cache.
- Set realistic `base_rtt_ms` per zone.

# Rilot: Carbon Cursor Edge Routing

Rilot is a Rust reverse proxy for per-request carbon-aware routing experiments.

## Carbon Cursor core

- Route classifier with per-request overrides.
- Constraint engine for candidate filtering.
- Signal cache (current + forecast) with TTL and async refresh.
- Multi-objective scoring (`carbon`, `latency`, `errors`, `cost`).
- Per-route toggles: `carbon_cursor_enabled`, `forecasting_enabled`, `time_shift_enabled`, `plugin_enabled`.
- Fail-safe fallback to lowest-latency when carbon signals are missing.
- Prometheus metrics + structured logs + periodic rollups.

## Region-first routing

Rilot uses region names (`x-user-region`) instead of lat/lon. Zone metadata uses `region` + `base_rtt_ms`.

## Config API (`config.json`)

```json
{
  "metrics": {"enabled": true, "path": "/metrics", "decision_log_sample_rate": 0.01, "rollup_interval_secs": 60},
  "carbon": {
    "provider": "mock",
    "cache_ttl_secs": 45,
    "provider_timeout_ms": 75,
    "default_carbon_intensity": 420,
    "zone_current": {"us-east": 430, "us-west": 300},
    "zone_forecast_next": {"us-east": 370, "us-west": 290}
  },
  "proxies": [
    {
      "app_name": "edge-router-demo",
      "app_uri": "http://127.0.0.1:5502",
      "rule": {"path": "/", "type": "contain"},
      "zones": [
        {"name": "us-east", "region": "us-east", "app_uri": "http://127.0.0.1:5502", "base_rtt_ms": 24, "max_in_flight": 200},
        {"name": "us-west", "region": "us-west", "app_uri": "http://127.0.0.1:5501", "base_rtt_ms": 36, "max_in_flight": 200}
      ],
      "policy": {
        "carbon_cursor_enabled": true,
        "route_class": "flexible",
        "priority_mode": "balanced",
        "constraints": {"max_candidates": 8, "zone_allowlist": [], "max_added_latency_ms": 50, "p95_latency_budget_ms": 220, "max_error_rate": 0.05},
        "weights": {"w_carbon": 0.55, "w_latency": 0.3, "w_errors": 0.15, "w_cost": 0.0},
        "forecasting_enabled": true,
        "time_shift_enabled": true,
        "forecast_window_minutes": 30,
        "forecast_min_improvement_ratio": 0.1,
        "max_defer_seconds": 0,
        "fail_safe_lowest_latency": true,
        "hysteresis_delta": 0.04,
        "min_switch_interval_secs": 20,
        "plugin_enabled": true,
        "plugin_timeout_ms": 25
      }
    }
  ]
}
```

## Metrics

- `requests_total{route,zone}`
- `errors_total{route,zone}`
- `latency_ms_bucket{route,zone,le}`
- `carbon_intensity_g_per_kwh{zone}`
- `co2e_estimated_total{route,zone}`
- `energy_joules_estimated_total{route,zone}`

## Run

```bash
cargo build --release
RUST_LOG=info ./target/release/rilot config.json
```

## Reproducible Docker testbed

```bash
cd research-kit
docker compose up --build -d
./scripts/run_experiment.sh
```

## Docs

- `docs/research-toolkit.md`
- `docs/wasm-carbon-plugin.md`

## License

MIT

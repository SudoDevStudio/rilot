# Rilot as a Reusable Carbon-Aware Routing Research Tool

## What is reproducible

- Policy model in `config.json` for route classes and constraints.
- Carbon Cursor decision pipeline: classify, filter, signal, score.
- Forecast/time-shift toggles for background traffic.
- Prometheus metrics endpoint (`/metrics`).
- Structured decision logs + periodic rollups.
- Docker testbed in `research-kit/docker-compose.yml`.
- Sample carbon traces in `research-kit/carbon-traces/us-grid-sample.csv`.

## Comparative evaluation protocol

1. Baseline routing (`policy.carbon_cursor_enabled=false`).
2. Latency-first (`priority_mode=latency-first`).
3. Carbon-first (`priority_mode=carbon-first`).
4. Balanced (`priority_mode=balanced`).

Measure:

- Carbon: `co2e_estimated_total{route,zone}`.
- Performance: latency buckets + request/error counters.
- Service quality: error rate and tail-latency budget misses.

## Ethical and practical implications

- User impact: bound latency increases with `max_added_latency_ms`.
- Fairness: use allowlists/tags and class policies to avoid persistent degradation.
- Privacy: with region routing (`x-user-region`), document retention/minimization.
- Safety: fail-safe fallback to lowest latency if carbon data is missing or provider times out.

## Known limitations

- Provider is mock-first; external APIs can be added behind the same cached signal interface.
- Energy/CO2e are estimates and should be calibrated for publication claims.

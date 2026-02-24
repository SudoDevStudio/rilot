# Rilot for Reproducible Carbon-Aware Routing Evaluation

## What is reproducible

- Policy model in `config.json` for route classes and constraints.
- Carbon Cursor decision pipeline: classify, filter, signal, score.
- Forecast/time-shift toggles for background traffic.
- Prometheus metrics endpoint (`/metrics`).
- Structured decision logs + periodic rollups.
- Docker testbed in `research-kit/docker-compose.yml`.
- Sample carbon traces in `research-kit/carbon-traces/us-grid-sample.csv`.
- Wasm plugin interface for custom routing/energy overrides.

## Comparative evaluation protocol

Run the experiment runner:

```bash
cd research-kit
./scripts/run_experiment.sh
```

Region context for experiments is provided via `x-user-region` request header.
`run_comparative_evaluation.py` defaults to synthetic header assignment (`us-east`/`us-west`) and supports:

- `USER_REGION_INPUT_MODE=header-synthetic` (default)
- `USER_REGION_INPUT_MODE=mock-fixed-east`
- `USER_REGION_INPUT_MODE=mock-fixed-west`
- `USER_REGION_INPUT_MODE=mock-random`

The workflow executes:

1. Baseline with carbon disabled + balanced policy.
2. Baseline with carbon disabled + latency-first policy.
3. Baseline with carbon disabled + strict-local class.
4. Latency-first (carbon enabled).
5. Carbon-first.
6. Balanced.

Measure:

- Carbon exposure: `carbon_intensity_exposure_total{route,zone}`.
- Carbon estimate: `co2e_estimated_total{route,zone}`.
- Performance: request latency (avg, p95) + request/error counters.
- Service quality: error rate and tail-latency budget misses.

Outputs:

- `research-kit/results/comparative-<timestamp>/summary.csv`
- `research-kit/results/comparative-<timestamp>/summary.json`
- `research-kit/results/comparative-<timestamp>/summary.md`
- Per-scenario Prometheus dumps and request-level CSV.

## Ethical and practical implications

- User impact: bound latency increases with `max_added_latency_ms`.
- Fairness: use allowlists/tags and class policies to avoid persistent degradation.
- Privacy: with region routing (`x-user-region`), document retention/minimization.
- Safety: fail-safe fallback to lowest latency if carbon data is missing or provider times out.

## Known limitations

- Provider is mock-first; external APIs can be added behind the same cached signal interface.
- Energy/CO2e are model-based estimates and should be calibrated for publication claims.

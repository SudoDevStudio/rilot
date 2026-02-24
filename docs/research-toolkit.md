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
- Performance: request latency (avg, p95), error rate, and sampled CPU overhead.
- Service quality: error rate and tail-latency budget misses.

Outputs:

- `research-kit/results/comparative-<timestamp>/summary.csv`
- `research-kit/results/comparative-<timestamp>/summary.json`
- `research-kit/results/comparative-<timestamp>/summary.md`
- Per-scenario Prometheus dumps and request-level CSV.
- CSV/Markdown trade-off deltas vs baseline (exposure saved, CO2e saved, latency delta, CPU delta).

## Reading the comparative outputs

- Carbon-aware routing can yield measurable reductions in carbon-intensity exposure without materially changing p95 latency; small reductions are expected when candidate regions have similar carbon values.
- `latency_first` is a useful control: it prioritizes responsiveness and often increases carbon exposure relative to `balanced`/`carbon_first`.
- Treat `cpu_percent_sample=0.0` as "not captured", not "no overhead". Re-run with host-level CPU capture enabled before reporting compute-cost conclusions.
- For stronger effect sizes in papers, use longer runs and carbon traces with larger regional variance.

## Ethical and practical implications

- User impact: bound latency increases with `max_added_latency_ms`.
- Fairness: use allowlists/tags and class policies to avoid persistent degradation.
- Privacy: with region routing (`x-user-region`), document retention/minimization.
- Safety: fail-safe fallback to lowest latency if carbon data is missing or provider times out.
  - Demonstrate by running baseline modes (`carbon_cursor_enabled=false`) and timeout-prone provider settings.

## Known limitations

- Provider is mock-first; external APIs can be added behind the same cached signal interface.
- Energy/CO2e are model-based estimates and should be calibrated for publication claims.

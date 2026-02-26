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

The workflow executes in this order:

1. `carbon_first`
2. `balanced`
3. `latency_first`
4. `carbon_first_provider_timeout` (enabled when `ENABLE_FAILURE_SCENARIO=1`)
5. `explicit_cross_region_to_green` (enabled when fixture indicates a clear greener region)
6. `baseline_no_carbon_strict_local`
7. `baseline_no_carbon_latency_first`
8. `baseline_no_carbon_balanced`

Measure:

- Carbon exposure: `carbon_intensity_exposure_total{route,zone}`.
- Carbon estimate: `co2e_estimated_total{route,zone}`.
- Performance: request latency (avg, p95), error rate, sampled CPU overhead, and sampled memory usage.
- Service quality: error rate and tail-latency budget misses.

Outputs:

- `research-kit/results/comparative-<timestamp>/summary.csv`
- `research-kit/results/comparative-<timestamp>/summary.json`
- `research-kit/results/comparative-<timestamp>/summary.md`
- Per-scenario Prometheus dumps and request-level CSV.
- CSV/Markdown trade-off deltas vs baseline (exposure saved, CO2e saved, latency delta, CPU delta).
- Cross-region reroute observability (`east->west`, `west->east`) in both `requests.csv` and summary outputs.

## Reading the comparative outputs

- Carbon-aware routing can yield measurable reductions in carbon-intensity exposure without materially changing p95 latency; small reductions are expected when candidate regions have similar carbon values.
- `latency_first` is a useful control: it prioritizes responsiveness and often increases carbon exposure relative to `balanced`/`carbon_first`.
- CPU overhead uses cgroup window deltas when available (`cpu_sample_method=cgroup_delta`), with `docker_stats` as fallback.
- Treat empty memory samples as "not captured", not "zero memory overhead".
- For stronger effect sizes in papers, use longer runs and carbon traces with larger regional variance.

## Fairness and user impact

- High-variance runs can shift a large share of traffic to a greener region (for example, west-origin requests rerouted to east).
- Report reroute direction counts (`east_to_west_reroutes`, `west_to_east_reroutes`) together with latency/error to show user impact transparently.
- Mitigation knobs:
  - tighten `max_added_latency_ms`
  - reduce `w_carbon` and/or increase `w_latency`
  - apply strict-local policy for user-critical routes
  - use route-level allowlists and tags to limit cross-region migration

## Model calibration status

- CO2e values are model-based and intended for comparative policy studies, not absolute billing-grade emissions accounting.
- Strengthen claims by calibrating against measured energy traces (RAPL/PDU/cloud telemetry) and reporting model error.

## Real-world case study path

- Replace mock provider with `carbon.provider=electricitymap` and real zone mapping.
- Run the same scripts against a real microservice endpoint behind each zone.
- Compare policy modes on the same workload replay to show external validity.

## Optional experiment variants

- High variance trace profile:
  - `CARBON_VARIANCE_PROFILE=high-variance ./scripts/run_experiment.sh`
  - Uses a wider east/west carbon split in `zone_current`/`zone_forecast_next`.
- Real-data provider override:
  - `CARBON_PROVIDER_OVERRIDE=electricitymap-local ELECTRICITYMAP_FIXTURE_OVERRIDE=./carbon-traces/electricitymap-latest-sample.json ./scripts/run_experiment.sh`
  - `CARBON_PROVIDER_OVERRIDE=electricitymap ELECTRICITYMAP_API_KEY_OVERRIDE=<key> ./scripts/run_experiment.sh`
- Robustness scenario toggle:
  - `ENABLE_FAILURE_SCENARIO=1 ./scripts/run_experiment.sh` (default)
  - Adds `slow-mock` + short provider timeout scenario.
- Sensitivity analysis:
  - `python3 research-kit/scripts/run_weight_sensitivity.py`
  - Produces `research-kit/results/sensitivity-<timestamp>/weights-summary.{json,md}`.
- Long-duration study:
  - `REQUESTS_PER_REGION=1000 ./scripts/run_experiment.sh`
- 10-zone live-style study with high-consuming requests:
  - `./scripts/run_live_experiment.sh`
  - writes outputs under `research-kit/result_live/`

## Ethical and practical implications

- User impact: bound latency increases with `max_added_latency_ms`.
- Fairness: use allowlists/tags and class policies to avoid persistent degradation.
- Privacy: with region routing (`x-user-region`), document retention/minimization.
- Safety: fail-safe fallback to lowest latency if carbon data is missing or provider times out.
  - Demonstrate by running baseline modes (`carbon_cursor_enabled=false`) and timeout-prone provider settings.

## Known limitations

- Provider is mock-first; external APIs can be added behind the same cached signal interface.
- Energy/CO2e are model-based estimates and should be calibrated for publication claims.

## Data availability template

Use a statement such as:

"All scripts, configs, and traces required to reproduce the reported experiments are available in `research-kit/` in this repository. Generated result artifacts include summary CSV/JSON/Markdown outputs, per-request CSV, and per-scenario Prometheus metrics dumps."

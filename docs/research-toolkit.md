# Rilot for Reproducible Carbon-Aware Routing Evaluation

## What is reproducible

- Policy model in `config.json` for route classes and constraints.
- Carbon Cursor decision pipeline: classify, filter, signal, score.
- Forecast/time-shift toggles for background traffic.
- Prometheus metrics endpoint (`/metrics`).
- Structured decision logs + periodic rollups.
- Docker testbed in `research-kit/docker-compose.live.yml`.
- Sample carbon traces in `research-kit/carbon-traces/us-grid-sample.csv`.
- Wasm plugin interface for custom routing/energy overrides.

## Comparative evaluation protocol

Run the experiment runner:

```bash
cd research-kit
./scripts/run_comparative_experiment.sh
```

Region context for experiments is provided via `x-user-region` request header.
By default, the runner uses a local ElectricityMap-compatible API backed by the fixed CSV snapshot `research-kit/carbon-traces/electricitymap-sandbox-20260328T2000Z.csv`, so no live external carbon API calls are required.
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
5. `explicit_cross_region_to_green` (always included; most informative when the configured carbon source indicates a clear greener east/west direction)
6. `baseline_no_carbon_strict_local`
7. `baseline_no_carbon_latency_first`
8. `baseline_no_carbon_balanced`

Notes for interpreting those baselines:

- The comparative runner forces `hysteresis_delta=0.0` and `min_switch_interval_secs=0` for reproducibility, so the research pipeline intentionally does not measure stickiness/flap prevention. Hysteresis behavior is covered by unit tests instead.
- On flexible routes with `carbon_cursor_enabled=false`, selection falls back to lowest-latency routing. As a result, `baseline_no_carbon_latency_first` and `baseline_no_carbon_balanced` are expected to converge unless future runtime behavior changes.

Measure:

- Carbon exposure: `carbon_intensity_exposure_total{route,zone}`.
- Carbon estimate: `co2e_estimated_total{route,zone}`.
- Performance: request latency (avg, p95), error rate, sampled CPU overhead, and sampled memory usage.
- Service quality: error rate and tail-latency budget misses.

Outputs:

- `research-kit/get_result/comparative-results/summary.csv`
- `research-kit/get_result/comparative-results/summary.json`
- `research-kit/get_result/comparative-results/summary.md`
- Per-scenario Prometheus dumps and request-level CSV.
- CSV/Markdown trade-off deltas vs baseline (exposure saved, CO2e saved, latency delta, CPU delta).
- Cross-region reroute observability (`east->west`, `west->east`) in both `requests.csv` and summary outputs.
- The latest run is written to a stable path:
  - `research-kit/get_result/comparative-results/`
- The runner refreshes `research-kit/get_result/` at the start of each run.

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

- Real-data provider override:
  - `CARBON_PROVIDER_OVERRIDE=electricitymap ELECTRICITYMAP_API_KEY_OVERRIDE=<key> ./scripts/run_comparative_experiment.sh`
- Robustness scenario toggle:
  - `ENABLE_FAILURE_SCENARIO=1 ./scripts/run_comparative_experiment.sh` (default)
  - Adds `slow-mock` + short provider timeout scenario.
- Request volume control:
  - `TOTAL_REQUESTS=50000 ./scripts/run_comparative_experiment.sh`
  - `REQUESTS_PER_REGION=1000 ./scripts/run_comparative_experiment.sh`
  - If both are set, `REQUESTS_PER_REGION` wins.
- 10-zone comparative study with high-consuming requests:
  - `./scripts/run_comparative_experiment.sh`
  - defaults to total request target `50000` (`25000` per region)
  - uses local CSV-backed ElectricityMap-compatible API (`scripts/carbon-signal-api.js`)
  - defaults to `carbon.cache_ttl_seconds>=5`
  - uses `research-kit/2026-03-29-electricity-maps-coverage-data.csv` to derive Electricity Maps zone aliases when available
  - uses CSV-only local ElectricityMap-compatible provider signals (no dynamic jitter path)
  - serves API responses in-memory by default (optional snapshot write via `CARBON_API_OUT_FILE`)
  - defaults to fixed carbon values from `research-kit/carbon-traces/electricitymap-sandbox-20260328T2000Z.csv`
  - defaults to cross-region RTT latency emulation (`RILOT_EMULATE_CROSS_REGION_RTT=true`)
  - writes outputs under `research-kit/get_result/comparative-results/`

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

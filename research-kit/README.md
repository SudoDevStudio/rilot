# Research Kit

This folder provides a reproducible Docker workflow for comparative evaluation of Rilot routing policies.

## Components

- `docker-compose.yml`: starts Rilot, two Node.js zone simulators, and Prometheus.
- `docker-compose.live.yml`: starts Rilot, ten high-consumption zone simulators, and Prometheus.
- `config.docker.json`: Docker-native routing and policy config.
- `config.live.json`: 10-zone live-style config with per-zone share cap (`max_request_share_percent`).
- `prometheus.yml`: scrape config for `/metrics`.
- `scripts/run_experiment.sh`: comparative evaluation runner (Rilot policy-mode baselines).
- `scripts/run_live_experiment.sh`: live-profile comparative runner that writes to `result_live/`.
- `scripts/run_comparative_evaluation.py`: request-level and summary report generator.
- `carbon-traces/us-grid-sample.csv`: sample trace format.
- `carbon-traces/electricitymap-latest-sample.json`: ElectricityMap-style local fixture.

## Quickstart

```bash
docker compose up --build -d
./scripts/run_experiment.sh
```

Outputs are written to `./results` by default.
`run_experiment.sh` and `run_live_experiment.sh` now also generate `charts.html` automatically in the latest comparative output folder.

Generated output includes:

- per-request latency CSV
- per-mode Prometheus snapshots
- summary CSV/JSON/Markdown tables for paper-ready comparison
- baseline-relative trade-off metrics (exposure/CO2e savings, latency delta, error rate, CPU sample delta, memory sample delta)

`requests.csv` now includes explainability fields:

- `request_region` and `selected_region`
- `cross_region_reroute` (`true`/`false`)
- `selected_carbon_intensity_g_per_kwh`
- `zone_filter_reasons` (per-zone eligibility/constraint reason, e.g. `added-latency>50`, `share-cap`, `eligible`)
- `carbon_saved_vs_worst_g_per_kwh`
- `decision_reason`

The comparative summary now also reports reroute counts per mode:

- `cross_region_reroutes`
- `east_to_west_reroutes`
- `west_to_east_reroutes`

Resource-overhead fields are also included per scenario:

- `cpu_percent_sample`, `cpu_sample_method`, `cpu_delta_percent_vs_baseline`
- `memory_mb_sample`, `memory_delta_mb_vs_baseline`

Optional region input mode:

```bash
USER_REGION_INPUT_MODE=mock-random ./scripts/run_experiment.sh
```

Run with higher carbon variance (stronger effect-size tests):

```bash
CARBON_VARIANCE_PROFILE=high-variance ./scripts/run_experiment.sh
```

Run a longer-duration case study (same setup, larger workload):

```bash
REQUESTS_PER_REGION=1000 ./scripts/run_experiment.sh
```

Run a real-data style case study using ElectricityMap-compatible signals:

```bash
# Offline fixture mode (captured ElectricityMap-format JSON)
CARBON_PROVIDER_OVERRIDE=electricitymap-local \
ELECTRICITYMAP_FIXTURE_OVERRIDE=./carbon-traces/electricitymap-latest-sample.json \
REQUESTS_PER_REGION=1000 \
./scripts/run_experiment.sh
```

Run 10-zone live-style study with high-consuming workloads:

```bash
./scripts/run_live_experiment.sh
```

This uses:

- `docker-compose.live.yml`
- `config.live.json`
- route `"/heavy?burn_ms=40"` by default
- output directory `result_live/`

```bash
# Live ElectricityMap mode (requires API key)
CARBON_PROVIDER_OVERRIDE=electricitymap \
ELECTRICITYMAP_API_KEY_OVERRIDE=<your_api_key> \
REQUESTS_PER_REGION=1000 \
./scripts/run_experiment.sh
```

Enable/disable timeout robustness scenario:

```bash
ENABLE_FAILURE_SCENARIO=1 ./scripts/run_experiment.sh
ENABLE_FAILURE_SCENARIO=0 ./scripts/run_experiment.sh
```

Run weight sensitivity analysis:

```bash
python3 ./scripts/run_weight_sensitivity.py
```

Generate an interactive chart dashboard from the latest comparative run:

```bash
node ./scripts/charts.js
```

Optional:

```bash
# Use a specific run folder
node ./scripts/charts.js --input-dir ./results/comparative-YYYYMMDDTHHMMSSZ

# Use live result base
node ./scripts/charts.js --results-base ./result_live
```

This writes `charts.html` into the selected comparative result folder.

## Interpreting results

- Carbon-aware modes can reduce carbon-intensity exposure while keeping latency stable; in many runs the gain is modest (for example, ~1-2%) when regional carbon values are close.
- `latency_first` typically minimizes response time at the cost of higher carbon exposure, which is why multi-objective modes (`balanced`, `carbon_first`) are included.
- If CPU columns are `0.0`, host CPU sampling was not captured for that run; avoid making compute-overhead claims from that dataset.
- If memory columns are empty, memory sampling was not captured for that run.
- To increase signal separation, run longer workloads and/or use traces with wider regional carbon spread (high-carbon vs low-carbon regions).

## Submission Reproduction Bundle

Run these three commands and include the generated folders in your supplementary package:

```bash
cd research-kit
CARBON_VARIANCE_PROFILE=high-variance ENABLE_FAILURE_SCENARIO=1 ./scripts/run_experiment.sh
python3 ./scripts/run_weight_sensitivity.py
```

Expected outputs:

- `results/comparative-<timestamp>/summary.{md,csv,json}`
- `results/comparative-<timestamp>/requests.csv`
- `results/comparative-<timestamp>/metrics-*.prom`
- `results/sensitivity-<timestamp>/weights-summary.{md,json}`

Failure/operational evidence is captured by scenario `carbon_first_provider_timeout` in `summary.*`.
Use this row to demonstrate timeout/fallback behavior and service stability under degraded carbon-signal conditions.

Default comparative scenario order in `summary.*`:

1. `carbon_first`
2. `balanced`
3. `latency_first`
4. `carbon_first_provider_timeout` (when `ENABLE_FAILURE_SCENARIO=1`)
5. `explicit_cross_region_to_green` (when fixture has a clear greener region)
6. `baseline_no_carbon_strict_local`
7. `baseline_no_carbon_latency_first`
8. `baseline_no_carbon_balanced`

Fairness/user-impact evidence is captured in reroute columns:

- `cross_region_reroutes`
- `east_to_west_reroutes`
- `west_to_east_reroutes`

Use these with latency/error metrics to report trade-offs and justify policy guardrails.

Fairness/locality tuning knobs (in `config.docker.json` policy):

- Reduce `w_carbon` and increase `w_latency` for user-facing routes.
- Set tighter `constraints.max_added_latency_ms` and `constraints.p95_latency_budget_ms`.
- Set `constraints.max_request_share_percent` to cap per-zone request concentration (for example `20`).
- Use `route_class=strict-local` for critical locality-sensitive routes.
- Limit migration scope via `constraints.zone_allowlist` and zone `tags`.

## Related docs

- `docs/research-toolkit.md`
- `docs/runtime-behavior.md`
- `docs/config-reference.md`

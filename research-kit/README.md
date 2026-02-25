# Research Kit

This folder provides a reproducible Docker workflow for comparative evaluation of Rilot routing policies.

## Components

- `docker-compose.yml`: starts Rilot, two Node.js zone simulators, and Prometheus.
- `config.docker.json`: Docker-native routing and policy config.
- `prometheus.yml`: scrape config for `/metrics`.
- `scripts/run_experiment.sh`: comparative evaluation runner (Rilot policy-mode baselines).
- `scripts/run_comparative_evaluation.py`: request-level and summary report generator.
- `carbon-traces/us-grid-sample.csv`: sample trace format.
- `carbon-traces/electricitymap-latest-sample.json`: ElectricityMap-style local fixture.

## Quickstart

```bash
docker compose up --build -d
./scripts/run_experiment.sh
```

Outputs are written to `./results` by default.

Generated output includes:

- per-request latency CSV
- per-mode Prometheus snapshots
- summary CSV/JSON/Markdown tables for paper-ready comparison
- baseline-relative trade-off metrics (exposure/CO2e savings, latency delta, error rate, CPU sample delta, memory sample delta)

`requests.csv` now includes explainability fields:

- `request_region`, `routing_input_region`, and `selected_zone_region`
- `route_relation` (`local` or `cross-region`) and `cross_region_reroute` (`true`/`false`)
- `selected_carbon_intensity_g_per_kwh`
- `carbon_saved_vs_worst_g_per_kwh`
- `decision_reason`

The comparative summary now also reports reroute counts per mode:

- `cross_region_reroutes`
- `east_to_west_reroutes`
- `west_to_east_reroutes`

Resource-overhead fields are also included per scenario:

- `cpu_percent_sample`, `cpu_delta_percent_vs_baseline`
- `memory_mb_sample`, `memory_delta_mb_vs_baseline`

Optional region input mode:

```bash
USER_REGION_INPUT_MODE=mock-random ./scripts/run_experiment.sh
```

Run with higher carbon variance (stronger effect-size tests):

```bash
CARBON_VARIANCE_PROFILE=high-variance ./scripts/run_experiment.sh
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

## Interpreting results

- Carbon-aware modes can reduce carbon-intensity exposure while keeping latency stable; in many runs the gain is modest (for example, ~1-2%) when regional carbon values are close.
- `latency_first` typically minimizes response time at the cost of higher carbon exposure, which is why multi-objective modes (`balanced`, `carbon_first`) are included.
- If CPU columns are `0.0`, host CPU sampling was not captured for that run; avoid making compute-overhead claims from that dataset.
- If memory columns are empty, memory sampling was not captured for that run.
- To increase signal separation, run longer workloads and/or use traces with wider regional carbon spread (high-carbon vs low-carbon regions).

## Related docs

- `docs/research-toolkit.md`
- `docs/runtime-behavior.md`
- `docs/config-reference.md`

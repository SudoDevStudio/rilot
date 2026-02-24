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

`requests.csv` now includes explainability fields:

- `requested_region` and `header_region`
- `selected_carbon_intensity_g_per_kwh`
- `carbon_saved_vs_worst_g_per_kwh`
- `decision_reason`

Optional region input mode:

```bash
USER_REGION_INPUT_MODE=mock-random ./scripts/run_experiment.sh
```

## Related docs

- `docs/research-toolkit.md`
- `docs/runtime-behavior.md`
- `docs/config-reference.md`

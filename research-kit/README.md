# Research Kit

This folder provides a reproducible Docker workflow for evaluating Rilot routing policies.

## Components

- `docker-compose.yml`: starts Rilot, two Node.js zone simulators, and Prometheus.
- `config.docker.json`: Docker-native routing and policy config.
- `prometheus.yml`: scrape config for `/metrics`.
- `scripts/run_experiment.sh`: load generation and metric snapshot export.
- `carbon-traces/us-grid-sample.csv`: sample trace format.

## Quickstart

```bash
docker compose up --build -d
./scripts/run_experiment.sh
```

Outputs are written to `./results` by default.

## Related docs

- `docs/research-toolkit.md`
- `docs/runtime-behavior.md`
- `docs/config-reference.md`

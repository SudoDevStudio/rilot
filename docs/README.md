# Rilot Documentation

This documentation set covers architecture, configuration, runtime behavior, plugin integration, and reproducible experiments.

Every way of running Rilot has a script in [`run-it/`](../run-it/README.md) — start there if you just want it running.

Primary experiment entrypoint: `research-kit/scripts/run_comparative_experiment.sh`.

## Start here

1. `README.md` (project overview + quickstart)
2. `docs/architecture.md` (system design)
3. `docs/config-reference.md` (full config schema)
4. `docs/runtime-behavior.md` (Carbon Cursor decision flow)
5. `docs/wasm-carbon-plugin.md` (plugin contract)
6. `docs/operations.md` (deploy, observe, troubleshoot)
7. `docs/research-toolkit.md` (experiment methodology)
8. `docs/model-calibration.md` (energy/CO2e model and caveats)
9. `docs/edge-target.md` (edge-Wasm deployment plan)
10. `docs/playground-engine-comparison.md` (old playground model vs rilot-core)
11. `docs/carbon-layer.md` (carbon providers, caches, and how to add a source)
12. `docs/running.pa.md` (Punjabi, Roman script: sab kujh kiven chalauna hai)
13. `docs/how-it-works.pa.md` (Punjabi, Roman script: Rilot kiven kamm karda hai ate request flow)
14. `docs/roadmap.md` (what is still open)

## Audience map

- Anyone running it locally: `run-it/README.md`, `docs/running.pa.md`
- Platform engineers: `docs/operations.md`, `docs/config-reference.md`
- Researchers: `docs/research-toolkit.md`, `docs/runtime-behavior.md`, `docs/model-calibration.md`
- Plugin developers: `docs/wasm-carbon-plugin.md`
- Adapter implementers: `docs/edge-target.md`, `docs/carbon-layer.md`, `adapters/cloudflare/README.md`

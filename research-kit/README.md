# Research Kit

This folder contains the reproducible comparative-evaluation workflow for Rilot routing policies.

## Components

- `docker-compose.live.yml`: starts Rilot, ten high-consumption zone simulators, and Prometheus.
- `config.live.json`: 10-zone comparative config with per-zone share cap (`max_request_share_percent`).
- `prometheus.yml`: scrape config for `/metrics`.
- `scripts/run_comparative_experiment.sh`: primary comparative runner (10 zones + local CSV-backed carbon API) that writes to `get_result/`.
- `scripts/run_comparative_evaluation.py`: request-level and summary report generator.
- `scripts/carbon-signal-api.js`: local ElectricityMap-compatible API for reproducible runs.
- `carbon-traces/us-grid-sample.csv`: sample trace format.
- `carbon-traces/electricitymap-latest-sample.json`: sample JSON fixture for standalone `electricitymap-local` mode.

## Quickstart

```bash
./scripts/run_comparative_experiment.sh
```

Outputs are written to `./get_result/comparative-results` by default.
The runner also generates `charts.html` automatically in that folder.

Generated output includes:

- per-request latency CSV
- per-mode Prometheus snapshots
- summary CSV/JSON/Markdown tables for side-by-side comparison
- baseline-relative trade-off metrics (exposure/CO2e savings, latency delta, error rate, CPU sample delta, memory sample delta)

`requests.csv` now includes explainability fields:

- `request_region` and `selected_region`
- `cross_region_reroute` (`true`/`false`)
- `selected_carbon_intensity_g_per_kwh`
- `zone_filter_reasons` (per-zone eligibility/constraint reason, e.g. `added-latency>50`, `share-cap`, `eligible`)
- `carbon_saved_vs_worst_g_per_kwh`
- `decision_reason`
- `decision_reason_brief`

The comparative summary now also reports reroute counts per mode:

- `cross_region_reroutes`
- `east_to_west_reroutes`
- `west_to_east_reroutes`

Resource-overhead fields are also included per scenario:

- `cpu_percent_sample`, `cpu_sample_method`, `cpu_delta_percent_vs_baseline`
- `memory_mb_sample`, `memory_delta_mb_vs_baseline`

By default, the quickstart command uses:

- `docker-compose.live.yml`
- `config.live.json` as base, rewritten into `config.live.dynamic.json` for run-time overrides
- local CSV-backed ElectricityMap-compatible API (`scripts/carbon-signal-api.js`)
- fixed carbon source CSV: `carbon-traces/electricitymap-sandbox-20260328T2000Z.csv`
- zone mapping derived from `2026-03-29-electricity-maps-coverage-data.csv` when available
- route `"/heavy?burn_ms=40"` by default
- total requests target `50000` by default (`25000` per region)
- provider cache floor enabled (`carbon.cache_ttl_seconds>=5`)
- no synthetic jitter/manipulation in default comparative run path
- output directory `get_result/comparative-results` (stable path)
- cross-region RTT emulation enabled by default (`RILOT_EMULATE_CROSS_REGION_RTT=true`)
- a fresh `get_result/` workspace each run

Useful overrides:

```bash
REQUESTS_PER_REGION=500 ./scripts/run_comparative_experiment.sh
TOTAL_REQUESTS=50000 ./scripts/run_comparative_experiment.sh
RILOT_EMULATE_CROSS_REGION_RTT=false ./scripts/run_comparative_experiment.sh
EM_USE_COVERAGE=0 ./scripts/run_comparative_experiment.sh
CARBON_CACHE_TTL_MIN_SECONDS=10 ./scripts/run_comparative_experiment.sh
CARBON_API_SOURCE_CSV=./carbon-traces/electricitymap-sandbox-20260328T2000Z.csv ./scripts/run_comparative_experiment.sh
# optional: write current CSV-backed API snapshot to a JSON file (for debugging only)
CARBON_API_OUT_FILE=./carbon-traces/electricitymap-live-dynamic.json ./scripts/run_comparative_experiment.sh
# optional: override only balanced-mode knobs (otherwise config.live.json defaults are used)
BALANCED_MAX_ADDED_LATENCY_MS=20 BALANCED_CROSS_REGION_RTT_PENALTY_MS=60 BALANCED_W_LATENCY=0.65 BALANCED_W_CARBON=0.25 ./scripts/run_comparative_experiment.sh
```

If both `TOTAL_REQUESTS` and `REQUESTS_PER_REGION` are set, `REQUESTS_PER_REGION` wins.

```bash
# Live ElectricityMap mode (requires API key)
CARBON_PROVIDER_OVERRIDE=electricitymap \
ELECTRICITYMAP_API_KEY_OVERRIDE=<your_api_key> \
REQUESTS_PER_REGION=1000 \
./scripts/run_comparative_experiment.sh
```

Enable/disable timeout robustness scenario:

```bash
ENABLE_FAILURE_SCENARIO=1 ./scripts/run_comparative_experiment.sh
ENABLE_FAILURE_SCENARIO=0 ./scripts/run_comparative_experiment.sh
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
node ./scripts/charts.js --input-dir ./get_result/comparative-results

# Use results base
node ./scripts/charts.js --results-base ./get_result
```

This writes `charts.html` into the selected comparative result folder.

## Interpreting results

- Carbon-aware modes can reduce carbon-intensity exposure while keeping latency stable; in many runs the gain is modest (for example, ~1-2%) when regional carbon values are close.
- `latency_first` typically minimizes response time at the cost of higher carbon exposure, which is why multi-objective modes (`balanced`, `carbon_first`) are included.
- If CPU columns are `0.0`, host CPU sampling was not captured for that run; avoid making compute-overhead claims from that dataset.
- If memory columns are empty, memory sampling was not captured for that run.
- To increase signal separation, run longer workloads and/or use traces with wider regional carbon spread (high-carbon vs low-carbon regions).

## Submission Reproduction Bundle

Run these commands and include the generated folders in your supplementary package:

```bash
cd research-kit
ENABLE_FAILURE_SCENARIO=1 TOTAL_REQUESTS=50000 ./scripts/run_comparative_experiment.sh
```

Expected outputs:

- `get_result/comparative-results/summary.{md,csv,json}`
- `get_result/comparative-results/requests.csv`
- `get_result/comparative-results/metrics-*.prom`
- `get_result/comparative-results/charts.html`

Failure/operational evidence is captured by scenario `carbon_first_provider_timeout` in `summary.*`.
Use this row to demonstrate timeout/fallback behavior and service stability under degraded carbon-signal conditions.

Default comparative scenario order in `summary.*`:

1. `carbon_first`
2. `balanced`
3. `latency_first`
4. `carbon_first_provider_timeout` (when `ENABLE_FAILURE_SCENARIO=1`)
5. `explicit_cross_region_to_green` (always included; most informative when the configured carbon source has a clear greener east/west direction)
6. `baseline_no_carbon_strict_local`
7. `baseline_no_carbon_latency_first`
8. `baseline_no_carbon_balanced`

Interpretation notes:

- The comparative runner sets `hysteresis_delta=0.0` and `min_switch_interval_secs=0` for all generated scenarios so repeated runs are easier to compare. This means hysteresis behavior is intentionally excluded from the comparative output and is validated separately by unit tests.
- For flexible routes with `carbon_cursor_enabled=false`, the runtime falls back to lowest-latency routing. That makes `baseline_no_carbon_latency_first` and `baseline_no_carbon_balanced` useful reporting labels, but they are expected to behave the same under the current runtime.

Fairness/user-impact evidence is captured in reroute columns:

- `cross_region_reroutes`
- `east_to_west_reroutes`
- `west_to_east_reroutes`

Use these with latency/error metrics to report trade-offs and justify policy guardrails.

Fairness/locality tuning knobs (in `config.live.json` policy):

- Reduce `w_carbon` and increase `w_latency` for user-facing routes.
- Set tighter `constraints.max_added_latency_ms` and `constraints.p95_latency_budget_ms`.
- Set `constraints.max_request_share_percent` to cap per-zone request concentration (for example `20`).
- Use `route_class=strict-local` for critical locality-sensitive routes.
- Limit migration scope via `constraints.zone_allowlist` and zone `tags`.

## Related docs

- `docs/research-toolkit.md`
- `docs/runtime-behavior.md`
- `docs/config-reference.md`

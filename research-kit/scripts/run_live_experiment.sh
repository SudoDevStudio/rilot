#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR_NAME="${RESULTS_DIR_NAME:-result_live}"
RESULTS_DIR="${SCRIPT_DIR}/../${RESULTS_DIR_NAME}"

mkdir -p "${RESULTS_DIR}"
find "${RESULTS_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

RILOT_EXPOSE_RESEARCH_HEADERS=true \
RESULTS_DIR_NAME="${RESULTS_DIR_NAME}" \
CONFIG_FILE_NAME="${CONFIG_FILE_NAME:-config.live.json}" \
COMPOSE_FILE_NAME="${COMPOSE_FILE_NAME:-docker-compose.live.yml}" \
BACKEND_SERVICES="${BACKEND_SERVICES:-zone-01,zone-02,zone-03,zone-04,zone-05,zone-06,zone-07,zone-08,zone-09,zone-10}" \
REQUESTS_PER_REGION="${REQUESTS_PER_REGION:-300}" \
ROUTE="${ROUTE:-/heavy?burn_ms=40}" \
ROUTE_METRIC_FILTER="${ROUTE_METRIC_FILTER:-/}" \
python3 "${SCRIPT_DIR}/run_comparative_evaluation.py"

if command -v node >/dev/null 2>&1; then
  node "${SCRIPT_DIR}/charts.js" --results-base "${RESULTS_DIR}"
else
  echo "Skipping chart generation: node is not installed."
fi

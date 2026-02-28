#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR_NAME="${RESULTS_DIR_NAME:-result_live}"
RESULTS_DIR="${SCRIPT_DIR}/../${RESULTS_DIR_NAME}"
CARBON_API_PID=""
CARBON_API_PORT="${CARBON_API_PORT:-18181}"
FIXED_COMPARATIVE_DIR="${RESULTS_DIR}/comparative"
TMP_CONFIG_FILE_NAME="config.live.dynamic.json"
TMP_CONFIG_PATH="${SCRIPT_DIR}/../${TMP_CONFIG_FILE_NAME}"

cleanup() {
  if [ -n "${CARBON_API_PID}" ] && kill -0 "${CARBON_API_PID}" >/dev/null 2>&1; then
    kill "${CARBON_API_PID}" >/dev/null 2>&1 || true
    wait "${CARBON_API_PID}" >/dev/null 2>&1 || true
  fi
  rm -f "${TMP_CONFIG_PATH}"
}

trap cleanup EXIT

mkdir -p "${RESULTS_DIR}"
find "${RESULTS_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

if ! command -v node >/dev/null 2>&1; then
  echo "Node is required for live dynamic carbon API mode."
  exit 1
fi

CARBON_API_PORT="${CARBON_API_PORT}" \
CARBON_API_MIN_G="${CARBON_API_MIN_G:-100}" \
CARBON_API_MAX_G="${CARBON_API_MAX_G:-700}" \
CARBON_API_UPDATE_SECONDS="${CARBON_API_UPDATE_SECONDS:-1}" \
CARBON_API_JITTER_G="${CARBON_API_JITTER_G:-70}" \
CARBON_API_FORECAST_JITTER_G="${CARBON_API_FORECAST_JITTER_G:-50}" \
CARBON_API_BASE_ZONES="${CARBON_API_BASE_ZONES:-zone-01:650,zone-02:620,zone-03:540,zone-04:500,zone-05:260,zone-06:180,zone-07:600,zone-08:420,zone-09:220,zone-10:640}" \
CARBON_API_OUT_FILE="${CARBON_API_OUT_FILE:-${SCRIPT_DIR}/../carbon-traces/electricitymap-live-dynamic.json}" \
node "${SCRIPT_DIR}/carbon-signal-api.js" &
CARBON_API_PID="$!"

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${CARBON_API_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

SRC_CONFIG_PATH="${SCRIPT_DIR}/../config.live.json" \
TMP_CONFIG_PATH="${TMP_CONFIG_PATH}" \
python3 - <<'PY'
import json
import os
from pathlib import Path

src = Path(os.environ["SRC_CONFIG_PATH"])
dst = Path(os.environ["TMP_CONFIG_PATH"])
cfg = json.loads(src.read_text(encoding="utf-8"))
carbon = cfg.setdefault("carbon", {})
carbon["provider"] = "electricitymap"
carbon["cache_ttl_seconds"] = 0
dst.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
PY

RILOT_EXPOSE_RESEARCH_HEADERS=true \
RESULTS_DIR_NAME="${RESULTS_DIR_NAME}" \
CONFIG_FILE_NAME="${CONFIG_FILE_NAME:-${TMP_CONFIG_FILE_NAME}}" \
COMPOSE_FILE_NAME="${COMPOSE_FILE_NAME:-docker-compose.live.yml}" \
BACKEND_SERVICES="${BACKEND_SERVICES:-zone-01,zone-02,zone-03,zone-04,zone-05,zone-06,zone-07,zone-08,zone-09,zone-10}" \
REQUESTS_PER_REGION="${REQUESTS_PER_REGION:-500}" \
ROUTE="${ROUTE:-/heavy?burn_ms=40}" \
ROUTE_METRIC_FILTER="${ROUTE_METRIC_FILTER:-/}" \
RILOT_BUILD_MODE="${RILOT_BUILD_MODE:-build-once}" \
RILOT_EMULATE_CROSS_REGION_RTT="${RILOT_EMULATE_CROSS_REGION_RTT:-true}" \
CARBON_PROVIDER_OVERRIDE="${CARBON_PROVIDER_OVERRIDE:-electricitymap}" \
ELECTRICITYMAP_BASE_URL_OVERRIDE="${ELECTRICITYMAP_BASE_URL_OVERRIDE:-http://host.docker.internal:${CARBON_API_PORT}}" \
ELECTRICITYMAP_API_KEY_OVERRIDE="${ELECTRICITYMAP_API_KEY_OVERRIDE:-local-dev-token}" \
CARBON_API_RESET_URL="${CARBON_API_RESET_URL:-http://127.0.0.1:${CARBON_API_PORT}/reset}" \
python3 "${SCRIPT_DIR}/run_comparative_evaluation.py"

LATEST_DIR="$(ls -dt "${RESULTS_DIR}"/comparative-* 2>/dev/null | head -n1 || true)"
if [ -n "${LATEST_DIR}" ]; then
  FIXED_COMPARATIVE_DIR="${RESULTS_DIR}/comparative-live"
  rm -rf "${FIXED_COMPARATIVE_DIR}"
  mv "${LATEST_DIR}" "${FIXED_COMPARATIVE_DIR}"
fi

if command -v node >/dev/null 2>&1; then
  node "${SCRIPT_DIR}/charts.js" --results-base "${RESULTS_DIR}"
else
  echo "Skipping chart generation: node is not installed."
fi

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR_NAME="${RESULTS_DIR_NAME:-get_result}"
RESULTS_DIR="${SCRIPT_DIR}/../${RESULTS_DIR_NAME}"
CARBON_API_PID=""
CARBON_API_PORT="${CARBON_API_PORT:-18181}"
FIXED_COMPARATIVE_DIR="${RESULTS_DIR}/comparative-results"
TMP_CONFIG_FILE_NAME="config.live.dynamic.json"
TMP_CONFIG_PATH="${SCRIPT_DIR}/../${TMP_CONFIG_FILE_NAME}"
if [ -d "${TMP_CONFIG_PATH}" ]; then
  TMP_CONFIG_FILE_NAME="config.live.dynamic.generated.json"
  TMP_CONFIG_PATH="${SCRIPT_DIR}/../${TMP_CONFIG_FILE_NAME}"
fi
CARBON_API_SOURCE_CSV="${CARBON_API_SOURCE_CSV:-${SCRIPT_DIR}/../carbon-traces/electricitymap-sandbox-20260328T2000Z.csv}"
EM_COVERAGE_FILE="${EM_COVERAGE_FILE:-${SCRIPT_DIR}/../2026-03-29-electricity-maps-coverage-data.csv}"
EM_USE_COVERAGE="${EM_USE_COVERAGE:-1}"
CARBON_CACHE_TTL_MIN_SECONDS="${CARBON_CACHE_TTL_MIN_SECONDS:-5}"

cleanup() {
  if [ -n "${CARBON_API_PID}" ] && kill -0 "${CARBON_API_PID}" >/dev/null 2>&1; then
    kill "${CARBON_API_PID}" >/dev/null 2>&1 || true
    wait "${CARBON_API_PID}" >/dev/null 2>&1 || true
  fi
  if [ -f "${TMP_CONFIG_PATH}" ]; then
    rm -f "${TMP_CONFIG_PATH}"
  fi
}

trap cleanup EXIT

mkdir -p "${RESULTS_DIR}"
find "${RESULTS_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

if ! command -v node >/dev/null 2>&1; then
  echo "Node is required for local carbon API mode."
  exit 1
fi
if [ ! -f "${CARBON_API_SOURCE_CSV}" ]; then
  echo "Missing CARBON_API_SOURCE_CSV file: ${CARBON_API_SOURCE_CSV}"
  exit 1
fi

TOTAL_REQUESTS="${TOTAL_REQUESTS:-50000}"
if ! [[ "${TOTAL_REQUESTS}" =~ ^[0-9]+$ ]]; then
  echo "TOTAL_REQUESTS must be a non-negative integer."
  exit 1
fi

if [ -z "${REQUESTS_PER_REGION:-}" ]; then
  REQUESTS_PER_REGION=$((TOTAL_REQUESTS / 2))
fi
if ! [[ "${REQUESTS_PER_REGION}" =~ ^[0-9]+$ ]]; then
  echo "REQUESTS_PER_REGION must be a non-negative integer."
  exit 1
fi
if [ "${REQUESTS_PER_REGION}" -lt 1 ]; then
  REQUESTS_PER_REGION=1
fi

CARBON_API_ZONE_ALIASES_DERIVED="$(
SRC_CONFIG_PATH="${SCRIPT_DIR}/../config.live.json" \
TMP_CONFIG_PATH="${TMP_CONFIG_PATH}" \
CARBON_API_SOURCE_CSV="${CARBON_API_SOURCE_CSV}" \
EM_COVERAGE_FILE="${EM_COVERAGE_FILE}" \
EM_USE_COVERAGE="${EM_USE_COVERAGE}" \
CARBON_CACHE_TTL_MIN_SECONDS="${CARBON_CACHE_TTL_MIN_SECONDS}" \
PYTHONPATH="${SCRIPT_DIR}${PYTHONPATH:+:${PYTHONPATH}}" \
python3 - <<'PY'
import csv
import json
import os
from pathlib import Path

from electricitymap_coverage import (
    build_zone_aliases,
    build_zone_map_from_coverage,
    config_zone_order,
    derive_zone_map,
    enforce_min_cache_ttl,
    parse_bool_flag,
)

src = Path(os.environ["SRC_CONFIG_PATH"])
dst = Path(os.environ["TMP_CONFIG_PATH"])
cfg = json.loads(src.read_text(encoding="utf-8"))
carbon = cfg.setdefault("carbon", {})
carbon["provider"] = "electricitymap"
try:
    min_cache_ttl = int(os.environ.get("CARBON_CACHE_TTL_MIN_SECONDS", "5"))
except Exception:
    min_cache_ttl = 5
enforce_min_cache_ttl(carbon, min_cache_ttl)

source_file = Path(os.environ.get("CARBON_API_SOURCE_CSV", ""))
source_zone_keys = {}
if source_file.exists() and source_file.is_file():
    with source_file.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            zone_key = str(row.get("zone", "")).strip()
            if zone_key and zone_key not in source_zone_keys:
                source_zone_keys[zone_key] = zone_key

if source_zone_keys:
    zone_map = derive_zone_map(cfg, source_zone_keys)
else:
    coverage_file = Path(os.environ.get("EM_COVERAGE_FILE", ""))
    coverage_enabled = parse_bool_flag(os.environ.get("EM_USE_COVERAGE", "1"), default=True)
    zone_map = build_zone_map_from_coverage(cfg, coverage_file, enabled=coverage_enabled)
if zone_map:
    carbon["electricitymap_zone_map"] = zone_map

dst.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
print(build_zone_aliases(zone_map, config_zone_order(cfg)), end="")
PY
)"

if [ -n "${CARBON_API_ZONE_ALIASES_DERIVED}" ]; then
  echo "Using source-derived Electricity Maps aliases from: ${CARBON_API_SOURCE_CSV}"
fi

CARBON_API_PORT="${CARBON_API_PORT}" \
CARBON_API_SOURCE_CSV="${CARBON_API_SOURCE_CSV}" \
CARBON_API_ZONE_ALIASES="${CARBON_API_ZONE_ALIASES:-${CARBON_API_ZONE_ALIASES_DERIVED}}" \
node "${SCRIPT_DIR}/carbon-signal-api.js" &
CARBON_API_PID="$!"

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${CARBON_API_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

RILOT_EXPOSE_RESEARCH_HEADERS=true \
RESULTS_DIR_NAME="${RESULTS_DIR_NAME}" \
CONFIG_FILE_NAME="${CONFIG_FILE_NAME:-${TMP_CONFIG_FILE_NAME}}" \
COMPOSE_FILE_NAME="${COMPOSE_FILE_NAME:-docker-compose.live.yml}" \
BACKEND_SERVICES="${BACKEND_SERVICES:-zone-01,zone-02,zone-03,zone-04,zone-05,zone-06,zone-07,zone-08,zone-09,zone-10}" \
TOTAL_REQUESTS="${TOTAL_REQUESTS}" \
REQUESTS_PER_REGION="${REQUESTS_PER_REGION}" \
ROUTE="${ROUTE:-/heavy?burn_ms=40}" \
ROUTE_METRIC_FILTER="${ROUTE_METRIC_FILTER:-/}" \
RILOT_BUILD_MODE="${RILOT_BUILD_MODE:-build-once}" \
RILOT_EMULATE_CROSS_REGION_RTT="${RILOT_EMULATE_CROSS_REGION_RTT:-true}" \
CARBON_PROVIDER_OVERRIDE="${CARBON_PROVIDER_OVERRIDE:-electricitymap}" \
CARBON_API_SOURCE_CSV="${CARBON_API_SOURCE_CSV}" \
ELECTRICITYMAP_BASE_URL_OVERRIDE="${ELECTRICITYMAP_BASE_URL_OVERRIDE:-http://host.docker.internal:${CARBON_API_PORT}}" \
ELECTRICITYMAP_API_KEY_OVERRIDE="${ELECTRICITYMAP_API_KEY_OVERRIDE:-local-dev-token}" \
CARBON_API_RESET_URL="${CARBON_API_RESET_URL:-http://127.0.0.1:${CARBON_API_PORT}/reset}" \
python3 "${SCRIPT_DIR}/run_comparative_evaluation.py"

LATEST_DIR="$(ls -dt "${RESULTS_DIR}"/comparative-* 2>/dev/null | head -n1 || true)"
if [ -n "${LATEST_DIR}" ]; then
  rm -rf "${FIXED_COMPARATIVE_DIR}"
  mv "${LATEST_DIR}" "${FIXED_COMPARATIVE_DIR}"
fi

if command -v node >/dev/null 2>&1; then
  node "${SCRIPT_DIR}/charts.js" --results-base "${RESULTS_DIR}"
else
  echo "Skipping chart generation: node is not installed."
fi

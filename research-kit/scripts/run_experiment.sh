#!/usr/bin/env bash
set -euo pipefail

RILOT_URL="${RILOT_URL:-http://127.0.0.1:8080}"
REQS="${REQS:-200}"
OUT_DIR="${OUT_DIR:-./results}"
ROUTE="${ROUTE:-/}"

mkdir -p "$OUT_DIR"
printf "timestamp,scenario,request,region,latency_ms,http_code\n" > "$OUT_DIR/latency.csv"

run_scenario() {
  local scenario="$1"
  local region="$2"

  for i in $(seq 1 "$REQS"); do
    local start_ms end_ms latency code ts
    start_ms=$(python3 - <<'PY'
import time
print(int(time.time()*1000))
PY
)
    code=$(curl -s -o /dev/null -w "%{http_code}" \
      -H "x-user-region: ${region}" \
      "${RILOT_URL}${ROUTE}")
    end_ms=$(python3 - <<'PY'
import time
print(int(time.time()*1000))
PY
)
    latency=$((end_ms-start_ms))
    ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    printf "%s,%s,%s,%s,%s,%s\n" "$ts" "$scenario" "$i" "$region" "$latency" "$code" >> "$OUT_DIR/latency.csv"
  done
}

run_scenario "east-user" "us-east"
run_scenario "west-user" "us-west"

curl -s "${RILOT_URL}/metrics" > "$OUT_DIR/metrics.prom"
echo "Saved experiment outputs to ${OUT_DIR}"

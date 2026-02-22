#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT INT TERM

start_app() {
  local name="$1"
  local script="$2"
  node "$ROOT_DIR/$script" &
  local pid=$!
  PIDS+=("$pid")
  echo "- started $name (pid=$pid)"
}

echo "Starting local simulator apps..."
start_app "us-east" "us-east-app.js"
start_app "us-west" "us-west-app.js"
start_app "checkout-local" "checkout-local-app.js"
start_app "background-east" "background-east-app.js"
start_app "background-west" "background-west-app.js"
start_app "plugin-oracle" "plugin-oracle-app.js"

echo ""
echo "Ports"
echo "- us-east app:         http://127.0.0.1:5601"
echo "- us-west app:         http://127.0.0.1:5602"
echo "- checkout-local app:  http://127.0.0.1:5603"
echo "- background-east app: http://127.0.0.1:5604"
echo "- background-west app: http://127.0.0.1:5605"
echo "- plugin-oracle app:   http://127.0.0.1:3012"

wait

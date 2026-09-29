#!/usr/bin/env bash
#
# The native proxy with local backend simulators.
#
#   ./run-it/native.sh              # simple config (examples/config/config.json)
#   ./run-it/native.sh --legacy     # legacy proxies config, all six simulators
#   ./run-it/native.sh --config my.json
#   PORT=9090 ./run-it/native.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

CONFIG="$ROOT/examples/config/config.json"
PORT="${PORT:-8080}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --legacy) CONFIG="$ROOT/examples/config/legacy-proxies.json"; shift ;;
    --config) CONFIG="$2"; shift 2 ;;
    -h|--help) usage "$0"; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

[[ -f "$CONFIG" ]] || die "Config not found: $CONFIG"
need_cargo

RILOT_PID=""
cleanup() {
  # The proxy runs as a background child so this trap can stop it; a plain
  # foreground child would keep running until it exited on its own.
  [[ -n "$RILOT_PID" ]] && kill -TERM "$RILOT_PID" 2>/dev/null
  stop_simulators
}
trap cleanup EXIT INT TERM

start_simulators
say "Building Rilot… (the first release build takes a few minutes)"
(cd "$ROOT" && cargo build --release --quiet) || die "cargo build failed"
free_port "$PORT"

echo
ok "Proxy: http://127.0.0.1:$PORT     config: ${CONFIG#"$ROOT/"}"
note "Try these in another terminal:"
note "  curl -i -H 'x-user-region: us-east-1'    http://127.0.0.1:$PORT/checkout/pay"
note "  curl -i -H 'x-user-location: 51.5,-0.13' http://127.0.0.1:$PORT/reports/monthly"
note "  curl http://127.0.0.1:$PORT/metrics"
note "Response headers show the decision (x-rilot-decision-reason, x-rilot-zone-filter-reasons)."
echo

cd "$ROOT"
RILOT_PORT="$PORT" RILOT_EXPOSE_RESEARCH_HEADERS=true RUST_LOG="${RUST_LOG:-info}" \
  ./target/release/rilot "$CONFIG" &
RILOT_PID=$!
wait "$RILOT_PID"

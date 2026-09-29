#!/usr/bin/env bash
#
# The proxy in a container.
#
#   ./run-it/docker.sh              # build the image and run it on :8080
#   ./run-it/docker.sh --no-build   # run the existing image
#   PORT=9090 ./run-it/docker.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

have docker || die "Docker is not installed."
[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage "$0"; exit 0; }

PORT="${PORT:-8080}"
IMAGE="rilot:local"
NAME="rilot-run-it"

if [[ "${1:-}" != "--no-build" ]]; then
  say "Building the image…"
  (cd "$ROOT" && docker build -t "$IMAGE" .) || die "docker build failed"
fi

LOGS_PID=""
cleanup() {
  [[ -n "$LOGS_PID" ]] && kill -TERM "$LOGS_PID" 2>/dev/null
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  stop_simulators
}
trap cleanup EXIT INT TERM
start_simulators

# On Linux the container needs an explicit route back to the host.
EXTRA_ARGS=()
[[ "$(uname -s)" == "Linux" ]] && EXTRA_ARGS+=(--add-host=host.docker.internal:host-gateway)

docker rm -f "$NAME" >/dev/null 2>&1 || true
say "Starting the container…"
docker run -d --name "$NAME" -p "$PORT:8080" \
  -e RILOT_EXPOSE_RESEARCH_HEADERS=true \
  ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} \
  "$IMAGE" >/dev/null
sleep 2

echo
ok "Proxy: http://127.0.0.1:$PORT   (container: $NAME, config: docker/config.json)"
note "  curl -i -H 'x-user-region: us-east-1' http://127.0.0.1:$PORT/checkout/pay"
note "Mount your own config with:  -v \"\$PWD/config.json:/app/config.json:ro\""
note "Ctrl-C stops the container and the simulators."
echo
docker logs -f "$NAME" &
LOGS_PID=$!
wait "$LOGS_PID"

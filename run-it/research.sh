#!/usr/bin/env bash
#
# The comparative experiment from research-kit: several policy modes against
# the same traffic and carbon trace, with summary tables and charts.
#
#   ./run-it/research.sh                       # full run (takes a while)
#   ./run-it/research.sh --quick               # small run, for a smoke test
#   ./run-it/research.sh --compose             # Rilot + simulators + Prometheus
#   REQUESTS_PER_REGION=500 ./run-it/research.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage "$0"; exit 0; }

if [[ "${1:-}" == "--compose" ]]; then
  have docker || die "Docker is not installed."
  say "Starting Rilot + simulators + Prometheus…"
  note "Rilot: http://localhost:8080    Prometheus: http://localhost:9090"
  cd "$ROOT/research-kit"
  exec docker compose up --build
fi

have docker || die "Docker is not installed (the experiment runs the stack in containers)."
have python3 || die "Python 3 is required for the evaluation report."

if [[ "${1:-}" == "--quick" ]]; then
  export REQUESTS_PER_REGION="${REQUESTS_PER_REGION:-200}"
  warn "Quick mode: ${REQUESTS_PER_REGION} requests per region. Not a publishable result."
  shift
fi

say "Running the comparative experiment…"
note "Results land in research-kit/get_result/comparative-results/ (regenerated each run)."
note "They are only valid for the current engine version — re-run after changing routing."
echo

cd "$ROOT/research-kit"
./scripts/run_comparative_experiment.sh "$@"

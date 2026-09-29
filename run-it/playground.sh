#!/usr/bin/env bash
#
# The Policy Playground: explore configs, policies, radius and decisions.
#
#   ./run-it/playground.sh          # dev server
#   ./run-it/playground.sh --build  # production build, then preview it
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

MODE="dev"
[[ "${1:-}" == "--build" ]] && MODE="preview"
[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage "$0"; exit 0; }

need_node
need_wasm_target
npm_setup "$ROOT/examples/policy-playground"

say "Policy Playground — the same engine, with every knob exposed"
note "Normal view: path, rule, radius, carbon, candidates, decision."
note "Research view: weights, guardrails, hysteresis, score breakdown."
echo

cd "$ROOT/examples/policy-playground"
if [[ "$MODE" == "preview" ]]; then
  npm run build
  npm run preview
else
  npm run dev
fi

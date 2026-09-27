#!/usr/bin/env bash
#
# The split-screen demo: a shop on the left, Rilot's live decisions on the right.
# An Astro site — every shop page is a real URL, and that URL is the path Rilot
# routes for it.
#
#   ./run-it/demo-shop.sh           # dev server on http://localhost:4321
#   ./run-it/demo-shop.sh --build   # production build, then preview it
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

MODE="dev"
[[ "${1:-}" == "--build" ]] && MODE="preview"
[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage "$0"; exit 0; }

need_node
need_wasm_target
npm_setup "$ROOT/examples/demo-shop"

say "GreenCart demo — every click is routed by rilot-core (compiled to Wasm)"
note "Left: the shop.  Right: matched rule, carbon, candidates, decision."
note "Move the shopper to Singapore or drag the grid clock to change the outcome."
note "Try /checkout too: the form is validated by the browser, not by JavaScript."
echo

cd "$ROOT/examples/demo-shop"
if [[ "$MODE" == "preview" ]]; then
  npm run build
  npm run preview
else
  npm run dev
fi

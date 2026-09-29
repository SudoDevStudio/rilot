#!/usr/bin/env bash
#
# The Cloudflare Worker adapter, running locally in workerd.
#
#   ./run-it/worker.sh              # wrangler dev on :8787
#   ./run-it/worker.sh --deploy     # deploy it (needs `wrangler login` + KV)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage "$0"; exit 0; }

need_node
need_wasm_target
npm_setup "$ROOT/adapters/cloudflare"

cd "$ROOT/adapters/cloudflare"

if [[ "${1:-}" == "--deploy" ]]; then
  say "Deploying to Cloudflare…"
  note "Needs: wrangler login, a CARBON_KV namespace in wrangler.toml, and"
  note "optionally: npx wrangler secret put ELECTRICITYMAP_API_KEY"
  exec npm run deploy
fi

say "Worker on http://127.0.0.1:8787 (workerd, local)"
note "Health:    curl http://127.0.0.1:8787/__rilot/health"
note "Decision:  curl 'http://127.0.0.1:8787/__rilot/decision?path=/checkout/pay'"
note "From anywhere else in the world:"
note "  curl -H 'x-user-location: 53.35,-6.26' 'http://127.0.0.1:8787/__rilot/decision?path=/reports/monthly'"
note "Without an Electricity Maps key every backend reports carbon-unavailable — that is correct."
echo

exec npm run dev

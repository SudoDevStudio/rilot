#!/usr/bin/env bash
#
# The Vercel adapter. It runs the same shared HTTP layer as the Cloudflare
# Worker, so the decisions are identical; only the host differs.
#
#   ./run-it/vercel.sh              # locally on :8788, no Vercel account needed
#   ./run-it/vercel.sh --dev        # `vercel dev` (needs the CLI and a login)
#   ./run-it/vercel.sh --deploy     # deploy it (needs the CLI and a login)
#   PORT=9000 ./run-it/vercel.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage "$0"; exit 0; }

need_node
need_wasm_target
npm_setup "$ROOT/adapters/vercel"

cd "$ROOT/adapters/vercel"

if [[ "${1:-}" == "--deploy" || "${1:-}" == "--dev" ]]; then
  have vercel || die "The Vercel CLI is not installed. Run: npm i -g vercel"
  if [[ "$1" == "--deploy" ]]; then
    say "Deploying to Vercel…"
    note "Needs: vercel login, RILOT_CONFIG set in the project's environment,"
    note "and optionally a KV store plus the ELECTRICITYMAP_API_KEY secret."
    exec npm run deploy
  fi
  say "vercel dev"
  exec npm run dev
fi

PORT="${PORT:-8788}"
free_port "$PORT"

# A routing config for the local simulators, the same two the native proxy uses.
export RILOT_CONFIG='{
  "carbon": { "provider": "static", "max_age_seconds": 300,
              "zone_current": { "us-east-1": 420, "us-west-2": 90 } },
  "backends": [
    { "id": "east", "region": "us-east-1", "url": "http://127.0.0.1:5601" },
    { "id": "west", "region": "us-west-2", "url": "http://127.0.0.1:5602" }
  ],
  "policy": "balanced",
  "radius_km": 5000,
  "fallback": "nearest",
  "routing_rules": [
    { "path": "/checkout/*", "policy": "latency", "radius_km": 800 },
    { "path": "/reports/*", "policy": "carbon" }
  ]
}'
export RILOT_EXPOSE_RESEARCH_HEADERS=true
export PORT

say "Vercel adapter on http://127.0.0.1:$PORT"
note "Health:    curl http://127.0.0.1:$PORT/__rilot/health"
note "Carbon:    curl http://127.0.0.1:$PORT/__rilot/carbon"
note "Decision:  curl 'http://127.0.0.1:$PORT/__rilot/decision?path=/reports/monthly'"
note "Vercel supplies the caller's position as x-vercel-ip-latitude/-longitude:"
note "  curl -H 'x-vercel-ip-latitude: 53.35' -H 'x-vercel-ip-longitude: -6.26' \\"
note "       'http://127.0.0.1:$PORT/__rilot/decision?path=/reports/monthly'"
note "Start the backends first with ./run-it/native.sh, or just read the decisions."
echo

exec npm run serve

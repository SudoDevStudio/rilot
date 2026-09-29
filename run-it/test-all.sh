#!/usr/bin/env bash
#
# Every test suite in the repository.
#
#   ./run-it/test-all.sh            # Rust + Wasm fixtures + all JS suites
#   ./run-it/test-all.sh --rust     # Rust only (fastest)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage "$0"; exit 0; }

FAILED=()
run_suite() { # name, dir, command...
  local name="$1" dir="$2"; shift 2
  printf '\n%s\n' "${BOLD}── $name${OFF}"
  if (cd "$dir" && "$@"); then ok "$name"; else FAILED+=("$name"); printf '%s\n' "${RED}✗ $name${OFF}"; fi
}

need_cargo
run_suite "Rust workspace (engine, carbon policy, native adapter)" "$ROOT" cargo test --workspace

if [[ "${1:-}" == "--rust" ]]; then
  [[ ${#FAILED[@]} -eq 0 ]] && { echo; ok "All Rust tests passed."; exit 0; }
  echo; die "Failed: ${FAILED[*]}"
fi

need_node
need_wasm_target

run_suite "Shared decision fixtures in compiled Wasm" "$ROOT" node scripts/check-wasm-fixtures.mjs

npm_setup "$ROOT/packages/rilot-carbon"
run_suite "Carbon layer conformance (TypeScript + Rust policy)" "$ROOT/packages/rilot-carbon" npm test

npm_setup "$ROOT/packages/rilot-http"
run_suite "Shared adapter HTTP layer" "$ROOT/packages/rilot-http" npm test

npm_setup "$ROOT/adapters/cloudflare"
run_suite "Cloudflare Worker (workerd)" "$ROOT/adapters/cloudflare" npm test

npm_setup "$ROOT/adapters/vercel"
run_suite "Vercel adapter" "$ROOT/adapters/vercel" npm test

npm_setup "$ROOT/examples/policy-playground"
run_suite "Policy Playground" "$ROOT/examples/policy-playground" npm test

npm_setup "$ROOT/examples/demo-shop"
run_suite "Demo shop" "$ROOT/examples/demo-shop" npm test

echo
if [[ ${#FAILED[@]} -eq 0 ]]; then
  ok "Everything passed."
else
  die "Failed suites: ${FAILED[*]}"
fi

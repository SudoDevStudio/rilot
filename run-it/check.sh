#!/usr/bin/env bash
# What is installed, and what each script needs.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

say "Rilot prerequisites"
echo

row() { printf '  %-28s %s\n' "$1" "$2"; }

if have cargo; then row "Rust" "$(cargo --version | cut -d' ' -f1-2)"; else row "Rust" "${RED}missing${OFF} — https://rustup.rs"; fi

if have rustup && rustup target list --installed 2>/dev/null | grep -q '^wasm32-unknown-unknown$'; then
  row "wasm32-unknown-unknown" "installed"
else
  row "wasm32-unknown-unknown" "${RED}missing${OFF} — rustup target add wasm32-unknown-unknown"
fi

if have rustup && rustup target list --installed 2>/dev/null | grep -q '^wasm32-wasip1$'; then
  row "wasm32-wasip1" "installed (only for examples/wasm-plugin)"
else
  row "wasm32-wasip1" "optional — rustup target add wasm32-wasip1"
fi

if have node; then row "Node.js" "$(node -v)"; else row "Node.js" "${RED}missing${OFF} — needs 20+"; fi
if have docker; then row "Docker" "$(docker --version | cut -d',' -f1)"; else row "Docker" "optional — only for run-it/docker.sh"; fi
if have python3; then row "Python 3" "$(python3 --version)"; else row "Python 3" "optional — only for research.sh"; fi

echo
say "Ways to run"
row "run-it/native.sh" "the proxy itself, with local backends"
row "run-it/demo-shop.sh" "split-screen shop + live routing decisions"
row "run-it/playground.sh" "config and decision explorer"
row "run-it/worker.sh" "Cloudflare Worker, locally"
row "run-it/docker.sh" "the proxy in a container"
row "run-it/research.sh" "comparative experiment (research-kit)"
row "run-it/test-all.sh" "every test suite in the repo"

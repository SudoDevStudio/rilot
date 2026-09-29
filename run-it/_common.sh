#!/usr/bin/env bash
# Shared helpers. Sourced by every script in this folder.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
else
  BOLD=''; DIM=''; GREEN=''; RED=''; YELLOW=''; OFF=''
fi

say()  { printf '%s\n' "${BOLD}$*${OFF}"; }
note() { printf '%s\n' "${DIM}$*${OFF}"; }
ok()   { printf '%s\n' "${GREEN}✓${OFF} $*"; }
warn() { printf '%s\n' "${YELLOW}!${OFF} $*"; }
die()  { printf '%s\n' "${RED}✗${OFF} $*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# Prints the comment block at the top of a script as its help text.
usage() {
  awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$1"
}

need_cargo() {
  have cargo || die "Rust is not installed. See https://rustup.rs"
}

need_wasm_target() {
  need_cargo
  if ! rustup target list --installed 2>/dev/null | grep -q '^wasm32-unknown-unknown$'; then
    die "Missing Wasm target. Run: rustup target add wasm32-unknown-unknown"
  fi
}

# 22 is the floor because wrangler requires it; everything else is happy on 20.
need_node() {
  have node || die "Node.js 22+ is not installed."
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  (( major >= 22 )) || die "Node.js 22+ required (found $(node -v))."
}

# npm install only when node_modules is missing; extra args are passed through.
npm_setup() {
  local dir="$1"; shift
  if [[ ! -d "$dir/node_modules" ]]; then
    note "Installing dependencies in ${dir#"$ROOT/"} …"
    (cd "$dir" && npm install "$@" >/dev/null) || die "npm install failed in $dir"
  fi
}

# Frees a TCP port's listener, if any (used before starting a server).
free_port() {
  local port="$1" pids=()
  # One PID per line, so read them into an array rather than splitting a string.
  while IFS= read -r pid; do [[ -n "$pid" ]] && pids+=("$pid"); done < <(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [[ ${#pids[@]} -gt 0 ]]; then
    warn "Port $port was busy; stopping the old process."
    kill "${pids[@]}" 2>/dev/null || true
    sleep 1
  fi
  return 0
}

SIM_PID=""
start_simulators() {
  need_node
  if lsof -ti tcp:5601 >/dev/null 2>&1; then
    warn "Port 5601 is already in use — assuming the simulators are already running."
    return 0
  fi
  say "Starting backend simulators (5601–5605, 3012)…"
  "$ROOT/examples/node-apps/run-local-zones.sh" >/tmp/rilot-simulators.log 2>&1 &
  SIM_PID=$!
  sleep 1.5
  kill -0 "$SIM_PID" 2>/dev/null || die "Simulators failed to start. See /tmp/rilot-simulators.log"
  ok "Simulators running (log: /tmp/rilot-simulators.log)"
}

# Stops only the simulators this script started. run-local-zones.sh cleans up
# its own children on TERM, so never pkill by pattern: that would also kill
# simulators someone else is using.
stop_simulators() {
  [[ -n "$SIM_PID" ]] || return 0
  kill -TERM "$SIM_PID" 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    kill -0 "$SIM_PID" 2>/dev/null || break
    sleep 0.3
  done
  SIM_PID=""
}

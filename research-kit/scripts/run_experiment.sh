#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[compat] run_experiment.sh now delegates to run_live_experiment.sh (paper-aligned path)."
exec "${SCRIPT_DIR}/run_live_experiment.sh" "$@"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/../results"

mkdir -p "${RESULTS_DIR}"
find "${RESULTS_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

RILOT_EXPOSE_RESEARCH_HEADERS=true \
python3 "${SCRIPT_DIR}/run_comparative_evaluation.py"

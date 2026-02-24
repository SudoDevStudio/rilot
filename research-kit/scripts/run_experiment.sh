#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RILOT_EXPOSE_RESEARCH_HEADERS=true \
python3 "${SCRIPT_DIR}/run_comparative_evaluation.py"

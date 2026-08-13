#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${DSD_LOCAL_MODEL_HOME:?DSD_LOCAL_MODEL_HOME is required}"

CALIBRATION_STATE="data/dsd/runs/w1-headwords-sampled-500/state.json"
COMMON_WAVE="common-phase1-inventory-20000"
COMMON_INVENTORY="data/dsd/runs/${COMMON_WAVE}/inventory/inventory.csv"
CAMPAIGN="corpus-common-phase1-20000"

while true; do
  if [[ -f "$CALIBRATION_STATE" ]] && grep -q '"step": "packaged"' "$CALIBRATION_STATE"; then
    break
  fi
  if [[ -f "$CALIBRATION_STATE" ]] && grep -q '"paused": true' "$CALIBRATION_STATE"; then
    echo "Calibration wave paused; refusing to start common Phase 1." >&2
    exit 1
  fi
  sleep 15
done

npm run dsd:inventory-wave -- run \
  --wave "$COMMON_WAVE" \
  --plan data/dsd/inventory/common-phase1-plan.json \
  --existing-inventory data/dsd/inventory/dsd-pilot-050.csv \
  --target 20000 \
  --cells 400 \
  --candidates-per-cell 100 \
  --candidates-per-request 25

if [[ ! -f "data/dsd/campaigns/${CAMPAIGN}/campaign.json" ]]; then
  npm run dsd:campaign -- prepare \
    --campaign "$CAMPAIGN" \
    --inventory "$COMMON_INVENTORY" \
    --wave-size 500
fi

npm run dsd:campaign -- run \
  --campaign "$CAMPAIGN" \
  --max-waves 40

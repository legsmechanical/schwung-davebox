#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MOVE_HOST="${MOVE_HOST:-move.local}"
DEST="/data/UserData/schwung/modules/tools/palette-viewer"

echo "Checking connection to ${MOVE_HOST}..."
ssh -o ConnectTimeout=5 "root@${MOVE_HOST}" "echo Connected." || { echo "Cannot reach ${MOVE_HOST}"; exit 1; }

echo "Installing palette-viewer..."
ssh "root@${MOVE_HOST}" "mkdir -p ${DEST}"
scp "${PROJECT_DIR}/palette-viewer/module.json" "root@${MOVE_HOST}:${DEST}/module.json"
scp "${PROJECT_DIR}/palette-viewer/ui.js"       "root@${MOVE_HOST}:${DEST}/ui.js"
echo "Done. Restart Schwung or rescan modules to pick it up."

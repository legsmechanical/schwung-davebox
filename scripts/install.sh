#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

MODULE_ID="seq8"
MOVE_HOST="${MOVE_HOST:-move.local}"
MOVE_USER="${MOVE_USER:-ableton}"

while [ $# -gt 0 ]; do
    case "$1" in
        --host)
            [ -z "$2" ] && { echo "Error: --host requires a value"; exit 1; }
            MOVE_HOST="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [--host <hostname>]"
            echo "  --host <hostname>   Override target (default: move.local or \$MOVE_HOST)"
            exit 0
            ;;
        *)
            echo "Unknown argument: $1"
            exit 1
            ;;
    esac
done

INSTALL_DIR="/data/UserData/schwung/modules/tools/${MODULE_ID}"

if [ ! -f "dist/${MODULE_ID}/dsp.so" ]; then
    echo "Error: Build not found. Run ./scripts/build.sh first."
    exit 1
fi

echo "Checking connection to ${MOVE_HOST}..."
if ! ssh -o ConnectTimeout=5 "${MOVE_USER}@${MOVE_HOST}" true 2>/dev/null; then
    echo "Error: Cannot reach ${MOVE_HOST}"
    echo "Make sure your Move is on and on the same network."
    exit 1
fi
echo "Connected."

echo "Installing ${MODULE_ID} to ${INSTALL_DIR} on ${MOVE_HOST}..."
ssh "${MOVE_USER}@${MOVE_HOST}" "mkdir -p ${INSTALL_DIR}"
scp -r "dist/${MODULE_ID}"/* "${MOVE_USER}@${MOVE_HOST}:${INSTALL_DIR}/"

echo ""
echo "Installation complete: ${INSTALL_DIR}"
echo "Restart Schwung or call host_rescan_modules() to pick it up."

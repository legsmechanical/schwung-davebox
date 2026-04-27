#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

MODULE_ID="seq8"
CROSS_PREFIX="${CROSS_PREFIX:-aarch64-linux-gnu-}"

# Re-enter inside Docker if we don't have a cross compiler.
if ! command -v "${CROSS_PREFIX}gcc" >/dev/null 2>&1; then
    echo "Cross compiler not found, building via Docker..."
    docker build -t seq8-builder -f Dockerfile .
    docker run --rm -v "$PROJECT_DIR:/build" -w /build seq8-builder \
        bash -c "CROSS_PREFIX=aarch64-linux-gnu- ./scripts/build.sh"
    exit $?
fi

echo "=== Building SEQ8 ==="
echo "Compiler: ${CROSS_PREFIX}gcc"

mkdir -p "dist/${MODULE_ID}"

echo "Compiling DSP..."
"${CROSS_PREFIX}gcc" -g -O3 -shared -fPIC \
    dsp/seq8.c \
    -o "dist/${MODULE_ID}/dsp.so" \
    -I. \
    -lm

cp module.json        "dist/${MODULE_ID}/"
cp ui.js              "dist/${MODULE_ID}/"
cp ui_constants.mjs   "dist/${MODULE_ID}/"
cp "MPC Metronome Click 001.wav" "dist/${MODULE_ID}/metro_click.wav"

echo ""
echo "=== Build Artifacts ==="
file "dist/${MODULE_ID}/dsp.so"
echo ""

# ----- GLIBC symbol audit (hard gate at 2.35) ------------------------------
echo "=== GLIBC Symbol Audit (max allowed: 2.35) ==="
NM_BIN="${CROSS_PREFIX}nm"
if ! command -v "$NM_BIN" >/dev/null 2>&1; then
    NM_BIN="nm"
fi

GLIBC_VERS=$("$NM_BIN" -D "dist/${MODULE_ID}/dsp.so" 2>/dev/null \
    | grep -oE 'GLIBC_[0-9]+\.[0-9]+(\.[0-9]+)?' \
    | sort -u || true)

if [ -n "$GLIBC_VERS" ]; then
    echo "$GLIBC_VERS"
fi

BAD=""
while IFS= read -r sym; do
    [ -z "$sym" ] && continue
    ver="${sym#GLIBC_}"
    major="${ver%%.*}"
    rest="${ver#*.}"
    minor="${rest%%.*}"
    if [ "$major" -gt 2 ] 2>/dev/null; then
        BAD="$BAD $sym"
    elif [ "$major" -eq 2 ] 2>/dev/null && [ "$minor" -gt 35 ] 2>/dev/null; then
        BAD="$BAD $sym"
    fi
done <<EOF
$GLIBC_VERS
EOF

if [ -n "$BAD" ]; then
    echo ""
    echo "ERROR: dsp.so requires GLIBC symbols newer than 2.35:$BAD"
    echo "Move runtime caps out at GLIBC 2.35. Rebuild without newer-glibc calls."
    exit 1
fi

echo "GLIBC check passed (all symbols <= 2.35)"
echo ""
echo "Build complete: dist/${MODULE_ID}/"

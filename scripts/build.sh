#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

MODULE_ID="davebox"
CROSS_PREFIX="${CROSS_PREFIX:-aarch64-linux-gnu-}"

# Re-enter inside Docker if we don't have a cross compiler.
if ! command -v "${CROSS_PREFIX}gcc" >/dev/null 2>&1; then
    echo "Cross compiler not found, building via Docker..."
    docker build -t davebox-builder -f Dockerfile .
    docker run --rm -v "$PROJECT_DIR:/build" -w /build davebox-builder \
        bash -c "CROSS_PREFIX=aarch64-linux-gnu- ./scripts/build.sh"
    exit $?
fi

echo "=== Building dAVEBOx ==="
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
cp ui_state.mjs       "dist/${MODULE_ID}/"
cp ui_persistence.mjs "dist/${MODULE_ID}/"
cp ui_dialogs.mjs    "dist/${MODULE_ID}/"
cp ui_scene.mjs      "dist/${MODULE_ID}/"
cp ui_leds.mjs       "dist/${MODULE_ID}/"
# Convert source (24-bit stereo 44100Hz) → normalized 16-bit mono 48000Hz for DSP render_block
python3 - <<'PYEOF'
import wave, struct, audioop, warnings
warnings.filterwarnings('ignore')   # suppress audioop deprecation on Python 3.13+
src = "MPC Metronome Click 001.wav"
dst = "dist/davebox/click-seq8.wav"
with wave.open(src, 'rb') as r:
    rate, nch, sw, nf = r.getframerate(), r.getnchannels(), r.getsampwidth(), r.getnframes()
    raw = r.readframes(nf)
# Mix down to 16-bit mono at source rate
samples = []
for i in range(0, len(raw), sw * nch):
    ch_vals = []
    for ch in range(nch):
        b = raw[i + ch*sw : i + ch*sw + sw]
        if sw == 3:
            v = struct.unpack('<i', b + (b'\xff' if b[2] & 0x80 else b'\x00'))[0] >> 8
        elif sw == 2:
            v = struct.unpack('<h', b)[0]
        else:
            v = 0
        ch_vals.append(v)
    samples.append(max(-32768, min(32767, sum(ch_vals) // len(ch_vals))))
# Normalize to full scale
peak = max(abs(s) for s in samples) if samples else 1
if peak == 0: peak = 1
samples = [max(-32768, min(32767, round(s * 32767 / peak))) for s in samples]
# Resample to 48000 Hz
raw16 = struct.pack('<' + 'h' * len(samples), *samples)
raw48, _ = audioop.ratecv(raw16, 2, 1, rate, 48000, None)
with wave.open(dst, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000)
    w.writeframes(raw48)
frames_out = len(raw48) // 2
print(f"click-seq8.wav: {frames_out} frames @ 48000 Hz, 16-bit mono (normalized, resampled from {rate} Hz)")
PYEOF

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

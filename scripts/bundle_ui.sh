#!/bin/bash
# Bundle dAVEBOx UI modules into dist/davebox/ui.js using esbuild.
#
# esbuild resolves local relative imports (./ui_*.mjs) and bundles them inline.
# Shared schwung imports (/data/UserData/schwung/shared/*) are marked external
# and kept as import statements in the output for the QuickJS runtime to resolve.
#
# Requires Node.js + esbuild (npm install). Runs on the host before Docker.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

if [ ! -f "node_modules/.bin/esbuild" ]; then
    echo "Installing build dependencies..."
    npm install --silent
fi

mkdir -p dist/davebox

echo "Bundling UI..."
node_modules/.bin/esbuild ui/ui.js \
    --bundle \
    --external:'/data/UserData/schwung/*' \
    --format=esm \
    --outfile=dist/davebox/ui.js \
    --log-level=warning

lines=$(wc -l < dist/davebox/ui.js | tr -d ' ')
bytes=$(wc -c < dist/davebox/ui.js | tr -d ' ')
echo "Bundle: dist/davebox/ui.js (${lines} lines, ${bytes} bytes)"

# Remote-UI page is a static single file; ship it on the JS-only deploy path too
# (install.sh scp's dist/davebox/*). build.sh also copies it for full builds.
if [ -f web_ui.html ]; then
    cp web_ui.html dist/davebox/web_ui.html
    echo "Copied: dist/davebox/web_ui.html ($(wc -c < web_ui.html | tr -d ' ') bytes)"
fi

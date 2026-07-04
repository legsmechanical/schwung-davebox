#!/bin/bash
# tests/js/run.sh — bundle each test_*.mjs with esbuild (aliasing the
# on-device shared constants to a stub via tests/js/build.mjs — the esbuild
# CLI's --alias flag rejects absolute-path keys, so we use esbuild's JS API
# with a resolve plugin instead), run under node.
set -e
cd "$(dirname "$0")/../.."
mkdir -p /tmp/davebox-js-tests
node tests/js/build.mjs
fail=0
for t in tests/js/test_*.mjs; do
  out="/tmp/davebox-js-tests/$(basename "$t" .mjs).js"
  if node "$out"; then echo "PASS: $(basename "$t")"; else echo "FAIL: $(basename "$t")"; fail=1; fi
done
exit $fail

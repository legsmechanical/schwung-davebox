#!/usr/bin/env bash
# Cut a release: finalize CHANGELOG [Unreleased] → versioned section,
# bump release.json, build fresh tarball, commit, tag, and push.
#
# Usage:  ./scripts/cut_release.sh <version>     (e.g. 0.2.0)
#
# Preconditions:
#   - clean working tree
#   - CHANGELOG.md [Unreleased] section has at least one entry
#   - tag v<version> does not already exist
#
# After this finishes you still need to upload dist/davebox-module.tar.gz
# to the v<version> GitHub release (the script doesn't touch GitHub).

set -euo pipefail

if [ $# -ne 1 ]; then
    echo "usage: $0 <version>   (e.g. 0.2.0)" >&2
    exit 1
fi

VERSION="${1#v}"
TAG="v${VERSION}"
DATE=$(date +%Y-%m-%d)
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# --- preflight ---------------------------------------------------------------
if ! git diff-index --quiet HEAD --; then
    echo "error: working tree is dirty. Commit or stash first." >&2
    exit 1
fi
if [ -n "$(git ls-files --others --exclude-standard)" ]; then
    echo "error: untracked files present. Clean up or commit first." >&2
    exit 1
fi
if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "error: tag $TAG already exists." >&2
    exit 1
fi

# --- update CHANGELOG.md + release.json (atomic via Python) -----------------
python3 - "$VERSION" "$DATE" <<'PYEOF'
import sys, re, json, pathlib

version, date = sys.argv[1], sys.argv[2]

# CHANGELOG: ensure [Unreleased] has content, then rename to versioned and
# insert a fresh empty [Unreleased] above.
cl = pathlib.Path("CHANGELOG.md")
text = cl.read_text()
m = re.search(r"^## \[Unreleased\]\s*\n(.*?)(?=^## \[)", text, re.MULTILINE | re.DOTALL)
if not m:
    sys.exit("CHANGELOG.md: could not locate [Unreleased] section before the next versioned heading")
body = m.group(1).strip()
if not body:
    sys.exit("CHANGELOG.md: [Unreleased] is empty — add entries before cutting a release")

new_blocks = f"## [Unreleased]\n\n## [{version}] — {date}\n"
text = re.sub(r"^## \[Unreleased\]\s*\n", new_blocks, text, count=1, flags=re.MULTILINE)
cl.write_text(text)
print(f"  CHANGELOG.md: [Unreleased] → [{version}] — {date}")

# release.json: bump version + rewrite download URL
rj = pathlib.Path("release.json")
data = json.loads(rj.read_text())
data["version"] = version
data["download_url"] = (
    f"https://github.com/legsmechanical/schwung-davebox/releases/"
    f"download/v{version}/davebox-module.tar.gz"
)
rj.write_text(json.dumps(data, indent=2) + "\n")
print(f"  release.json: version → {version}")
PYEOF

# --- build fresh tarball ----------------------------------------------------
echo
echo "Building release tarball..."
./scripts/build.sh

# --- commit, tag, push ------------------------------------------------------
git add CHANGELOG.md release.json
git commit -m "release: $TAG"
git tag -a "$TAG" -m "Release $TAG"

echo
echo "Pushing main + $TAG to origin..."
git push origin main
git push origin "$TAG"

# --- summary ----------------------------------------------------------------
echo
echo "✓ Released $TAG"
echo "  Tarball: dist/davebox-module.tar.gz"
echo
echo "Next steps (manual):"
echo "  1. Create v$VERSION release on GitHub"
echo "  2. Upload dist/davebox-module.tar.gz as the release asset"
echo "  3. Paste the [$VERSION] section from CHANGELOG.md as the release notes"

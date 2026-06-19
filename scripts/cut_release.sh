#!/usr/bin/env bash
# Cut a release: finalize CHANGELOG [Unreleased] → versioned section,
# finalize notes/tech-changelog.md [Unreleased] the same way (untracked,
# best-effort), promote MANUAL.draft.md → MANUAL.md (banner stripped), bump
# release.json, build fresh tarball, commit, tag, and push.
#
# Manual model: edit MANUAL.draft.md (tracked working copy) for user-facing
# changes as they land; the public MANUAL.md is only updated here at release
# time, so it stays pinned to releases and never documents unreleased features.
#
# Usage:  ./scripts/cut_release.sh <version>     (e.g. 0.2.0)
#
# Changelog model: write user-facing entries into CHANGELOG.md [Unreleased]
# and the matching full-technical detail into notes/tech-changelog.md
# [Unreleased] as work lands. This script finalizes both. CHANGELOG.md is
# committed; tech-changelog.md is local-only (gitignored) and never blocks a
# release if missing/empty.
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

# --- update CHANGELOG.md + tech-changelog + release.json + module.json (atomic via Python) ---
python3 - "$VERSION" "$DATE" <<'PYEOF'
import sys, re, json, pathlib

version, date = sys.argv[1], sys.argv[2]

new_blocks = f"## [Unreleased]\n\n## [{version}] — {date}\n"

def finalize_unreleased(path, text):
    """Rename [Unreleased] → [<version>] and insert a fresh empty [Unreleased]
    above it. Returns the rewritten text. Raises if no [Unreleased] section."""
    m = re.search(r"^## \[Unreleased\]\s*\n(.*?)(?=^## \[)", text, re.MULTILINE | re.DOTALL)
    if not m:
        raise ValueError(f"{path}: could not locate [Unreleased] section before the next versioned heading")
    if not m.group(1).strip():
        raise ValueError(f"{path}: [Unreleased] is empty")
    return re.sub(r"^## \[Unreleased\]\s*\n", new_blocks, text, count=1, flags=re.MULTILINE)

# CHANGELOG (tracked, user-facing): empty/missing [Unreleased] is fatal — a
# release must have public notes.
cl = pathlib.Path("CHANGELOG.md")
try:
    cl.write_text(finalize_unreleased("CHANGELOG.md", cl.read_text()))
    print(f"  CHANGELOG.md: [Unreleased] → [{version}] — {date}")
except ValueError as e:
    sys.exit(f"{e} — add entries before cutting a release")

# tech-changelog (untracked, technical): finalize the same way, but NEVER block
# a release on it. It's a local-only file (gitignored via notes/) that may be
# absent on a fresh clone or in CI — warn and skip rather than abort.
tc = pathlib.Path("notes/tech-changelog.md")
if not tc.exists():
    print("  notes/tech-changelog.md: not found — skipping (technical log not finalized)")
else:
    try:
        tc.write_text(finalize_unreleased("notes/tech-changelog.md", tc.read_text()))
        print(f"  notes/tech-changelog.md: [Unreleased] → [{version}] — {date}")
    except ValueError as e:
        print(f"  WARNING: {e} — technical log NOT finalized for this release")

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

# module.json: bump version so the tarball that build.sh produces reports
# the correct version. Without this the Module Store advertises v$VERSION
# (from release.json), downloads the tarball, finds the bundled module.json
# still pinned at the previous version, and re-offers the update forever.
mj = pathlib.Path("module.json")
mdata = json.loads(mj.read_text())
mdata["version"] = version
mj.write_text(json.dumps(mdata, indent=4) + "\n")
print(f"  module.json: version → {version}")

# MANUAL: promote the tracked working draft (MANUAL.draft.md) into the public
# MANUAL.md, stripping the WORKING-DRAFT banner. We edit MANUAL.draft.md as
# user-facing changes land so the public manual stays pinned to releases (it
# doesn't document unreleased features). Best-effort: if the draft is missing,
# leave the public manual untouched and warn.
md = pathlib.Path("MANUAL.draft.md")
if not md.exists():
    print("  MANUAL.draft.md: not found — skipping (public MANUAL.md left as-is)")
else:
    promoted = re.sub(r"<!-- DRAFT-BANNER-START -->.*?<!-- DRAFT-BANNER-END -->\n*",
                      "", md.read_text(), flags=re.DOTALL)
    pathlib.Path("MANUAL.md").write_text(promoted)
    print("  MANUAL.md: promoted from MANUAL.draft.md (banner stripped)")
PYEOF

# --- build fresh tarball ----------------------------------------------------
echo
echo "Building release tarball..."
./scripts/build.sh

# --- commit, tag, push ------------------------------------------------------
git add CHANGELOG.md release.json module.json MANUAL.md MANUAL.draft.md
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

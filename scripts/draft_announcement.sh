#!/usr/bin/env bash
# Draft a Discord-pasteable release announcement for dAVEBOx and copy it to
# the macOS clipboard. Paste it into the Schwung Discord release channel.
#
# Usage:  ./scripts/draft_announcement.sh <version>     (e.g. 0.3.6)
#
# Fetches the body of the published `v<version>` GitHub release (via `gh`),
# prepends a title line + the release URL (which Discord auto-unfurls as a
# link preview), pipes the result to `pbcopy`, and also prints it to stdout
# so you can see what landed on the clipboard. Run after `gh release create`.

set -euo pipefail

if [ $# -ne 1 ]; then
    echo "usage: $0 <version>   (e.g. 0.3.6)" >&2
    exit 1
fi

VERSION="${1#v}"
TAG="v${VERSION}"
URL="https://github.com/legsmechanical/schwung-davebox/releases/tag/${TAG}"

if ! BODY=$(gh release view "$TAG" --json body -q .body 2>/dev/null); then
    echo "error: no GitHub release found for $TAG" >&2
    echo "       publish it first with:" >&2
    echo "         python3 scripts/condense_changelog.py $VERSION > dist/release-notes-$TAG.md" >&2
    echo "         gh release create $TAG dist/davebox-module.tar.gz \\" >&2
    echo "             --title \"$TAG\" --notes-file dist/release-notes-$TAG.md" >&2
    exit 1
fi

if [ -z "$BODY" ]; then
    echo "error: GitHub release $TAG has an empty body" >&2
    exit 1
fi

# Header line + plain URL (Discord unfurls it into an embed card pointing at
# the GitHub release page) + the condensed release notes body.
MESSAGE="**dAVEBOx ${TAG} released**
${URL}

${BODY}"

if command -v pbcopy >/dev/null 2>&1; then
    printf "%s" "$MESSAGE" | pbcopy
    COPIED=1
else
    COPIED=0
fi

echo "--- announcement draft ---"
echo "$MESSAGE"
echo "--- end ---"
echo

LEN=${#MESSAGE}
if [ "$LEN" -gt 2000 ]; then
    echo "⚠ Draft is $LEN chars — Discord's regular message limit is 2000."
    echo "  Trim the release notes (e.g. gh release edit $TAG --notes-file dist/release-notes-$TAG.md)"
    echo "  or split the paste into multiple messages."
    echo
fi

if [ "$COPIED" -eq 1 ]; then
    echo "✓ Copied to clipboard. Paste into Discord with Cmd+V."
else
    echo "(pbcopy not available — copy the block above manually.)"
fi

#!/usr/bin/env python3
"""Condense the [<version>] section of CHANGELOG.md into short release notes.

Usage:
    python3 scripts/condense_changelog.py <version>

Reads CHANGELOG.md from the repo root, finds the `## [<version>]` section,
condenses each bullet down to its lead clause, and prints markdown to stdout
suitable for piping into `gh release create --notes-file -`. The output uses
`### Section` headers and `- bullet` lines that render cleanly on both the
GitHub release page and inside a Discord webhook message.

Condense heuristic per bullet:
  1. If the bullet starts with a substantial bold lead-in (`**…**`, 20–120
     chars), use that — covers entries written as `**Headline.** Body…`.
  2. Otherwise strip bold/code markup and break at the first sentence
     terminator (.!?…) or body-break em-dash (` — ` followed by lowercase),
     ignoring any terminator inside a `( … )` parenthetical.
  3. Hard char cap at 200 as final fallback.
"""

from __future__ import annotations

import pathlib
import re
import sys


CHANGELOG_URL = (
    "https://github.com/legsmechanical/schwung-davebox/blob/main/CHANGELOG.md"
)


def condense(raw: str) -> str:
    raw = raw.strip()

    mh = re.match(r"\*\*([^*]{20,120})\*\*", raw)
    if mh:
        return mh.group(1).strip().rstrip(".:;,—- ")

    s = re.sub(r"\*\*(.+?)\*\*", r"\1", raw)
    s = re.sub(r"`(.+?)`", r"\1", s)

    head_end = None
    depth = 0
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c == "(":
            depth += 1
        elif c == ")" and depth > 0:
            depth -= 1
        elif depth == 0:
            if c in ".!?…" and (i + 1 == n or s[i + 1].isspace()):
                head_end = i
                break
            # Em-dash break only when next word starts lowercase (body text).
            # `" — Capitalized"` stays inline as part of the headline.
            if (
                c == " "
                and s[i : i + 3] == " — "
                and i + 3 < n
                and s[i + 3].islower()
            ):
                head_end = i
                break
        i += 1

    head = s if head_end is None else s[:head_end]
    head = head.rstrip(".:;,—- ")
    if len(head) > 200:
        head = head[:197].rstrip() + "…"
    return head


def extract_section(changelog: str, version: str) -> str:
    m = re.search(
        rf"^## \[{re.escape(version)}\][^\n]*\n(.*?)(?=^## \[|\Z)",
        changelog,
        re.MULTILINE | re.DOTALL,
    )
    if not m:
        sys.exit(
            f"condense_changelog: no [{version}] section in CHANGELOG.md "
            f"(did you run cut_release.sh first?)"
        )
    return m.group(1).strip()


def parse_groups(section: str) -> list[tuple[str, list[str]]]:
    """Parse `### Header` blocks containing `- ` bullets into (header, [bullets])."""
    groups: list[tuple[str, list[str]]] = []
    current_header: str | None = None
    current_bullets: list[str] = []
    raw_bullet: str | None = None

    def flush_group() -> None:
        if current_header is not None and current_bullets:
            groups.append((current_header, list(current_bullets)))

    for line in section.splitlines():
        if line.startswith("### "):
            if raw_bullet is not None:
                current_bullets.append(raw_bullet)
                raw_bullet = None
            flush_group()
            current_header = line[4:].strip()
            current_bullets = []
        elif line.startswith("- "):
            if raw_bullet is not None:
                current_bullets.append(raw_bullet)
            raw_bullet = line[2:].strip()
        elif raw_bullet is not None and line.strip():
            raw_bullet += " " + line.strip()
        elif not line.strip() and raw_bullet is not None:
            current_bullets.append(raw_bullet)
            raw_bullet = None

    if raw_bullet is not None:
        current_bullets.append(raw_bullet)
    flush_group()
    return groups


def render(version: str, groups: list[tuple[str, list[str]]]) -> str:
    lines: list[str] = []
    for header, bullets in groups:
        if not bullets:
            continue
        lines.append(f"### {header}")
        for b in bullets:
            lines.append(f"- {condense(b)}")
        lines.append("")
    lines.append(f"_Full technical changelog: [CHANGELOG.md]({CHANGELOG_URL})._")
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: condense_changelog.py <version>", file=sys.stderr)
        sys.exit(1)
    version = sys.argv[1].lstrip("v")

    repo_root = pathlib.Path(__file__).resolve().parent.parent
    changelog = (repo_root / "CHANGELOG.md").read_text()

    section = extract_section(changelog, version)
    groups = parse_groups(section)
    sys.stdout.write(render(version, groups))


if __name__ == "__main__":
    main()

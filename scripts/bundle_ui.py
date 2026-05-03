#!/usr/bin/env python3
"""Bundle SEQ8 ES modules into dist/seq8/ui.js.

The Schwung shadow_ui loader only resolves imports from /data/UserData/schwung/shared/.
Imports from the tool's own directory are not supported, so we concatenate local
modules into a single file and deduplicate the shared/ imports.

Usage: python3 scripts/bundle_ui.py
"""

import re
import sys
from pathlib import Path

# Dependency order: each file must come before files that depend on it
ORDER = [
    'ui_constants.mjs',
    'ui_state.mjs',
    'ui_scene.mjs',
    'ui_persistence.mjs',
    'ui_dialogs.mjs',
    'ui_leds.mjs',
    'ui.js',
]

SHARED_PREFIX = '/data/UserData/schwung/shared/'
LOCAL_PREFIX  = '/data/UserData/schwung/modules/tools/seq8/'


def collect_import(lines, start):
    """Collect a (possibly multiline) import statement starting at lines[start].
    Returns (statement_string, next_line_index)."""
    parts = []
    i = start
    while i < len(lines):
        parts.append(lines[i])
        if ';' in lines[i]:
            break
        i += 1
    return '\n'.join(parts), i + 1


def parse_names(stmt):
    """Extract imported names from 'import { A, B as C, D } from ...'"""
    m = re.search(r'\{([^}]*)\}', stmt, re.DOTALL)
    if not m:
        return []
    names = []
    for token in re.split(r',', m.group(1)):
        token = token.strip().replace('\n', ' ')
        token = re.sub(r'\s+', ' ', token)
        if token:
            names.append(token)
    return names


def parse_module_path(stmt):
    m = re.search(r"from\s+'([^']+)'", stmt)
    return m.group(1) if m else None


# shared_imports[module_path] = ordered list of name tokens (deduped)
shared_imports = {}
# file_bodies: list of (filename, processed_text)
file_bodies = []

for fname in ORDER:
    src = Path(fname)
    if not src.exists():
        print(f'ERROR: {fname} not found — run from project root', file=sys.stderr)
        sys.exit(1)

    lines = src.read_text().split('\n')
    body = []
    i = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.lstrip()

        if stripped.startswith('import ') or stripped.startswith('import{'):
            stmt, i = collect_import(lines, i)
            module_path = parse_module_path(stmt)

            if module_path is None:
                # Side-effect import or unknown form — keep as-is
                body.append(stmt)
            elif module_path.startswith(SHARED_PREFIX):
                names = parse_names(stmt)
                if module_path not in shared_imports:
                    shared_imports[module_path] = []
                for name in names:
                    if name not in shared_imports[module_path]:
                        shared_imports[module_path].append(name)
            elif module_path.startswith(LOCAL_PREFIX):
                # Drop — code is concatenated directly
                pass
            else:
                body.append(stmt)
        else:
            # Strip 'export ' keyword from declarations
            processed = re.sub(
                r'^(\s*)export\s+(const|let|var|function\*?|class|async\s+function\*?)\s',
                lambda m: m.group(1) + m.group(2).rstrip() + ' ',
                line
            )
            body.append(processed)
            i += 1

    file_bodies.append((fname, '\n'.join(body)))

# Generate output
out = []
out.append('/* SEQ8 UI — bundled from source modules by scripts/bundle_ui.py */')
out.append('/* Source: ' + ', '.join(ORDER) + ' */')
out.append('')

# Deduplicated shared imports
for module_path, names in shared_imports.items():
    short = module_path.replace(SHARED_PREFIX, '')
    if len(names) <= 3:
        out.append(f"import {{ {', '.join(names)} }} from '{module_path}';")
    else:
        out.append('import {')
        for j, name in enumerate(names):
            comma = ',' if j < len(names) - 1 else ''
            out.append(f'    {name}{comma}')
        out.append(f"}} from '{module_path}';")

out.append('')

# Concatenated bodies
for fname, body in file_bodies:
    out.append(f'/* ---- {fname} ---- */')
    out.append(body)
    out.append('')

text = '\n'.join(out)

out_path = Path('dist/seq8/ui.js')
out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(text)

lines_out = text.count('\n') + 1
print(f'Bundle: {len(file_bodies)} files → dist/seq8/ui.js '
      f'({lines_out} lines, {len(text):,} bytes)')
print(f'Shared imports: {sum(len(v) for v in shared_imports.values())} names '
      f'from {len(shared_imports)} modules')

# Save State Confirm Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Yes/No confirmation dialog in front of the global menu's "Save state" action so a manual save can't be triggered by an accidental click.

**Architecture:** Mirror the existing `confirmClearSession` dialog at every touch point — a UI-only boolean flag + selection index in `S`, a draw function, and branches in the jog-click / jog-rotate / Back input handlers. The confirm sits in front of the unchanged `openSaveSnapshot()`, so it gates both the immediate-save and at-cap overwrite-picker paths.

**Tech Stack:** JavaScript (QuickJS via shadow_ui), bundled by `scripts/bundle_ui.py`. No JS unit-test framework exists; verification = bundler (syntax gate) + on-device hands-on test. Full Move reboot required after JS deploy.

---

### Task 1: Add confirm state fields

**Files:**
- Modify: `ui/ui_state.mjs` (near `confirmClearSession: false` ~line 354 and `confirmClearSel: 1` ~line 429)

- [ ] **Step 1: Add the state fields**

In `ui/ui_state.mjs`, add next to the existing `confirmClearSession` field:

```js
    confirmSaveState: false,
```

and next to `confirmClearSel`:

```js
    confirmSaveSel: 1,      /* default No */
    confirmSaveCount: 0,    /* snapshot count captured when confirm opens */
```

- [ ] **Step 2: Commit**

```bash
git add ui/ui_state.mjs
git commit -m "feat(ui): add Save state confirm dialog state fields"
```

---

### Task 2: Gate the menu action behind the confirm

**Files:**
- Modify: `ui/ui.js:437-439` (the `createAction('Save state', ...)` body)

- [ ] **Step 1: Replace the action body**

Current:

```js
        createAction('Save state', function() {
            openSaveSnapshot();
        }),
```

New:

```js
        createAction('Save state', function() {
            S.confirmSaveCount = loadSnapshotManifest(S.currentSetUuid).length;
            S.confirmSaveState = true;
            S.confirmSaveSel   = 1;   /* default No */
        }),
```

Note: `loadSnapshotManifest` and `S.currentSetUuid` are already in scope here
(both used by the unchanged `openSaveSnapshot()` in the same file).

- [ ] **Step 2: Commit**

```bash
git add ui/ui.js
git commit -m "feat(ui): open confirm instead of saving immediately on Save state"
```

---

### Task 3: Draw the confirm dialog

**Files:**
- Modify: `ui/ui_dialogs.mjs` (add `drawSaveStateConfirm()` after `drawClearSessionConfirm()` ~line 74; add dispatch in `drawGlobalMenu()` ~line 221)

- [ ] **Step 1: Confirm `SNAPSHOT_CAP` is importable in the dialogs module**

Run:

```bash
grep -n "SNAPSHOT_CAP\|from .*ui_persistence" ui/ui_dialogs.mjs
```

If `SNAPSHOT_CAP` is not already imported, add it to the existing
`ui_persistence.mjs` import in `ui/ui_dialogs.mjs` (it is exported from
`ui/ui_persistence.mjs:169`). If there is no such import line, add:

```js
import { SNAPSHOT_CAP } from '/data/UserData/schwung/modules/tools/davebox/ui_persistence.mjs';
```

(match the absolute import path style used by the other `.mjs` imports in this file).

- [ ] **Step 2: Add the draw function**

After `drawClearSessionConfirm()` (ends ~line 74), add:

```js
function drawSaveStateConfirm() {
    clear_screen();
    drawMenuHeader('SAVE STATE');
    print(4, 20, 'Save current session?', 1);
    print(4, 32, S.confirmSaveCount + ' of ' + SNAPSHOT_CAP + ' saved', 1);
    const noX = 6, yesX = 74, btnY = 46, btnW = 46, btnH = 13;
    if (S.confirmSaveSel === 1) {
        fill_rect(noX, btnY, btnW, btnH, 1);
        print(noX + 17, btnY + 3, 'No', 0);
    } else {
        fill_rect(noX, btnY, btnW, 1, 1);
        fill_rect(noX, btnY + btnH - 1, btnW, 1, 1);
        fill_rect(noX, btnY, 1, btnH, 1);
        fill_rect(noX + btnW - 1, btnY, 1, btnH, 1);
        print(noX + 17, btnY + 3, 'No', 1);
    }
    if (S.confirmSaveSel === 0) {
        fill_rect(yesX, btnY, btnW, btnH, 1);
        print(yesX + 14, btnY + 3, 'Yes', 0);
    } else {
        fill_rect(yesX, btnY, btnW, 1, 1);
        fill_rect(yesX, btnY + btnH - 1, btnW, 1, 1);
        fill_rect(yesX, btnY, 1, btnH, 1);
        fill_rect(yesX + btnW - 1, btnY, 1, btnH, 1);
        print(yesX + 14, btnY + 3, 'Yes', 1);
    }
}
```

- [ ] **Step 3: Add the dispatch line**

In `drawGlobalMenu()`, alongside the other confirm dispatches (after the
`confirmClearSession` line ~221):

```js
    if (S.confirmSaveState)    { drawSaveStateConfirm();    return; }
```

- [ ] **Step 4: Commit**

```bash
git add ui/ui_dialogs.mjs
git commit -m "feat(ui): draw Save state confirm dialog"
```

---

### Task 4: Wire jog-click, jog-rotate, and Back

**Files:**
- Modify: `ui/ui.js:7215` (jog-click block), `ui/ui.js:7621` (jog-rotate block), `ui/ui.js:7982` and `ui/ui.js:8295` (Back handlers)

- [ ] **Step 1: Jog-click (Yes/No commit)**

In the CC-3 `globalMenuOpen` handler, right after the `confirmClearSession`
branch (ends ~line 7220), add:

```js
        if (S.confirmSaveState) {
            const yes = S.confirmSaveSel === 0;
            S.confirmSaveState = false;
            if (yes) openSaveSnapshot();
            S.screenDirty = true;
            return;
        }
```

- [ ] **Step 2: Jog-rotate (toggle selection)**

In the jog-rotate `globalMenuOpen` chain, after the `confirmClearSession`
`else if` (~line 7621-7623), add:

```js
            } else if (S.confirmSaveState) {
                const delta = decodeDelta(d2);
                if (delta !== 0) { S.confirmSaveSel = S.confirmSaveSel === 0 ? 1 : 0; S.screenDirty = true; }
```

- [ ] **Step 3: Back handler #1**

After the `} else if (S.globalMenuOpen && S.confirmClearSession) {` branch at
~line 7982, add:

```js
            } else if (S.globalMenuOpen && S.confirmSaveState) {
                S.confirmSaveState = false;
                forceRedraw();
```

- [ ] **Step 4: Back handler #2**

After the `} else if (S.globalMenuOpen && S.confirmClearSession) {` branch at
~line 8295, add:

```js
        } else if (S.globalMenuOpen && S.confirmSaveState) {
            S.confirmSaveState = false;
            forceRedraw();
```

- [ ] **Step 5: Commit**

```bash
git add ui/ui.js
git commit -m "feat(ui): wire Save state confirm jog/back handlers"
```

---

### Task 5: Bundle, syntax-check, deploy, verify

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]` → `### Features`), `notes/tech-changelog.md` (`[Unreleased]`)

- [ ] **Step 1: Bundle the JS**

Run: `python3 scripts/bundle_ui.py`
Expected: bundles `ui/*.mjs` + `ui.js` into `dist/davebox/ui.js` with no error.
A QuickJS-incompatible syntax error surfaces here.

- [ ] **Step 2: Add changelog entries**

`CHANGELOG.md` under `[Unreleased]` → `### Features` (user-facing):

```
- Save state now asks for confirmation before saving, showing how many snapshots you have.
```

`notes/tech-changelog.md` under `[Unreleased]` (technical):

```
- feat(ui): Save state menu action gated behind a Yes/No confirm dialog
  (confirmSaveState / confirmSaveSel / confirmSaveCount in S). Confirm precedes
  openSaveSnapshot() so it gates both the under-cap immediate save and the at-cap
  overwrite picker. Mirrors confirmClearSession; body shows "<N> of SNAPSHOT_CAP saved".
```

- [ ] **Step 3: Deploy to device**

Run: `./scripts/install.sh`
Then full-reboot Move (JS change — Shift+Back does not reload JS).

- [ ] **Step 4: Hands-on device test**

Do this on the Move:
1. Open the global menu (Menu button). Scroll to **Save state**. Click it.
   → A "SAVE STATE" screen appears: "Save current session?", a "N of 16 saved"
     line, and No highlighted on the left, Yes on the right.
2. Turn the jog wheel → the highlight jumps between No and Yes.
3. With **No** highlighted, click the jog → back to the menu, no "STATE SAVED"
   flash, and Load state shows no new entry.
4. Click **Save state** again, turn to **Yes**, click → "STATE SAVED" flashes and
   Load state shows one more snapshot than before.
5. Click **Save state**, then press **Back** → returns to the menu, nothing saved.
6. (If you can reach 16 snapshots) Click **Save state** → **Yes** → the overwrite
   picker opens as before.

- [ ] **Step 5: Commit changelog**

```bash
git add CHANGELOG.md notes/tech-changelog.md
git commit -m "docs(changelog): Save state confirm dialog"
```

---

## Notes for the implementer

- **No state-version bump.** All three new fields live only in the in-memory `S`
  object; nothing is persisted to disk, so the DSP/sidecar state versions are
  untouched.
- **Coalescing is not a concern here** — no `set_param` is issued from the confirm
  path; `openSaveSnapshot()` already handles its own deferred `save`.
- **MANUAL.md:** the Save state behavior is user-visible. If MANUAL.md documents
  the Save state action, add a one-line note that it now prompts for confirmation.
  Grep `MANUAL.md` for "Save state"; if absent, skip.

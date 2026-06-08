# Confirm dialog before manual "Save state"

**Date:** 2026-06-07
**Status:** Approved, pending implementation

## Problem

The global menu's **Save state** action (`ui.js:437` → `openSaveSnapshot()`) saves
immediately with no confirmation. Under the snapshot cap it writes a new
timestamped snapshot and pops "STATE / SAVED" instantly; at the cap it opens the
overwrite picker. An accidental jog-click on the menu item commits a save with no
chance to back out. We want a Yes/No confirmation gate in front of the action.

## Behavior

Tapping **Save state** opens a Yes/No confirm instead of saving:

```
        SAVE STATE
   Save current session?
      3 of 16 saved

   [ No ]        [ Yes ]
```

- Default selection: **No** (safe), matching the Clear Sess confirm.
- **Jog turn** toggles No / Yes.
- **Jog click on Yes** → dismiss confirm, then run the existing `openSaveSnapshot()`
  unchanged. That call decides the rest:
  - under cap → writes a new snapshot, pops "STATE / SAVED";
  - at cap → opens the overwrite picker (its own pick + confirm flow).
- **Jog click on No** → dismiss confirm, return to the menu. Nothing saved.
- **Back** (`MoveBack`, and the other Back handler) → dismiss confirm, return to
  the menu. Nothing saved.

Because the confirm sits in front of `openSaveSnapshot()`, it gates **both** the
immediate-save path and the at-cap overwrite-picker path. `openSaveSnapshot()` is
not modified.

The body's count line reads `N of <SNAPSHOT_CAP> saved`, where `N` is the snapshot
count captured when the confirm opens (`SNAPSHOT_CAP` is 16).

## Implementation

Mirrors the existing `confirmClearSession` dialog at every touch point.

1. **State** (`ui_state.mjs`): add
   - `confirmSaveState: false`
   - `confirmSaveSel: 1` (default No)
   - `confirmSaveCount: 0` (snapshot count captured at open, so the draw function
     does not reload the manifest every frame).

2. **Menu action** (`ui.js:437`, the `createAction('Save state', ...)` body):
   replace the direct `openSaveSnapshot()` call with:
   - `S.confirmSaveCount = loadSnapshotManifest(S.currentSetUuid).length;`
   - `S.confirmSaveState = true;`
   - `S.confirmSaveSel = 1;`

3. **Draw** (`ui_dialogs.mjs`):
   - new `drawSaveStateConfirm()` — clone of `drawClearSessionConfirm()` with
     header `SAVE STATE`, body lines `Save current session?` and
     `<N> of <SNAPSHOT_CAP> saved` (using `S.confirmSaveCount`), and the same
     No/Yes button geometry driven by `S.confirmSaveSel`.
   - dispatch line in `drawGlobalMenu()`:
     `if (S.confirmSaveState) { drawSaveStateConfirm(); return; }`
     (placed alongside the other confirm dispatches near `confirmClearSession`).
   - `SNAPSHOT_CAP` is already importable from `ui_persistence.mjs`; ensure it's in
     scope for the dialogs module (import if not already present).

4. **Jog-click** (`ui.js:7215` block, inside the `globalMenuOpen` CC-3 handler):
   add, alongside the `confirmClearSession` branch:
   ```js
   if (S.confirmSaveState) {
       const yes = S.confirmSaveSel === 0;
       S.confirmSaveState = false;
       if (yes) openSaveSnapshot();
       S.screenDirty = true;
       return;
   }
   ```

5. **Jog-rotate** (`ui.js:7621` block): add a branch
   `else if (S.confirmSaveState) { const delta = decodeDelta(d2); if (delta !== 0) { S.confirmSaveSel = S.confirmSaveSel === 0 ? 1 : 0; S.screenDirty = true; } }`

6. **Back** (both `ui.js:7982` and `ui.js:8295`): add a branch
   `else if (S.globalMenuOpen && S.confirmSaveState) { S.confirmSaveState = false; forceRedraw(); }`

## Out of scope / non-changes

- `openSaveSnapshot()` is unchanged.
- No new DSP `set_param`/`get_param` keys.
- No DSP state-version bump (pure UI flag; nothing persisted).
- No change to the at-cap overwrite picker.
- Knob-swallow guard (`ui.js:9204`) already covers the confirm via `S.globalMenuOpen`.

## Testing (on device)

1. Open the global menu, scroll to **Save state**, click it.
   - Expect the SAVE STATE confirm to appear with No highlighted and the count
     line showing the current number of snapshots.
2. Turn the jog → highlight moves between No and Yes.
3. Click **No** (or press Back) → returns to the menu, no "STATE/SAVED" popup, no
   new snapshot.
4. Click **Yes** while under the cap → "STATE/SAVED" popup, one new snapshot in
   Load state.
5. Fill snapshots to the cap (16), click **Save state**, click **Yes** →
   overwrite picker opens (existing behavior).
6. Reboot Move (full reboot — JS change) before testing.

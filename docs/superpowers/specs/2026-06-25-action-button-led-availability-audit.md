# Action-button LED-availability — audit & implementation handoff

**Status:** AUDIT COMPLETE (2026-06-25). Implementation NOT started. Pick-up reference for a later
session. Referenced from `_worklogs/schwung-davebox.md` (2026-06-25 entry) and `_worklogs/OUTSTANDING.md`.

> Line numbers are **as of commit `ff2c9ca`** (post drum-AUTO-bank merge) and **will drift**. Anchor by
> the cited symbols (`setButtonLED(MoveX, …)`, the `if (S.shiftHeld)` block, handler function names),
> not the numbers.

---

## 1. The requirement (Josh's spec)

- An action button is **lit** iff it has a **function in the current dAVEBOx state**; otherwise **off**.
- While **Shift is held**, a button **blinks** iff it has an available **Shift-modified** function;
  otherwise off.
- **Scope — these buttons only** (CC / constant):
  Note/Session (50 `MoveMenu`/`MoveNoteSession`), Up (55 `MoveUp`), Down (54 `MoveDown`),
  Left (62 `MoveLeft`), Right (63 `MoveRight`), Capture (52 `MoveCapture`), Sample (118
  `MoveSample`/`MoveRecord`), Loop (58 `MoveLoop`), Mute (88 `MoveMute`), Copy (60 `MoveCopy`),
  Delete (119 `MoveDelete`), Undo (56 `MoveUndo`), Shift (49 `MoveShift`).
  - (`MoveRec` CC 86 is the **Record** transport button — separate from "Sample" CC 118; out of scope
    but adjacent. CC 118 has alias `MoveRecord`/`MoveSample`.)

---

## 2. Where everything lives

- **Central button-LED section:** `ui/ui.js` ~6900-7002 — part of the per-tick LED update, just before
  the `if (S.sessionView) { updateSessionLEDs() } else { updateStepLEDs() }` split (~7004). Runs in
  **both** views every tick. This is the one place to rework.
  - The **Shift-blink block** is the `if (S.shiftHeld) { … }` at ~6993-7002.
- **Press dispatch:** `_onCC_buttons(d1,d2)` (~8121) handles most button CCs; nav/page also in
  `_onCC_jog` (~Up/Down ~9045/9061, Left/Right page-nav ~8964), `_onCC_side` (~9080, scene/clip row),
  `_onCC_transport` (Play/Record). Step buttons: `_onStepButtons` (~11489).
- **Modifier-held flags** (press sets true, release false, checked everywhere): `S.shiftHeld`,
  `S.loopHeld`, `S.copyHeld`, `S.deleteHeld`, `S.muteHeld`, `S.captureHeld`. (`MoveSample`/`MoveRec`
  do **not** set a "held" flag — not modifiers.)
- **Top-level input pre-filters** (in `onMidiMessage` ~12259-12283) that swallow buttons in modals:
  `S.snapshotPicker` (allows only jog + CC50), `S.clearAutoMenu` (allows only CC50 + Delete + jog),
  `S.sessionOverlayHeld` (allows only CC50-release + Up/Down). **Buttons swallowed here are no-ops →
  LED off.**
- **LED helpers:** `setButtonLED(cc, color, force?)` and `cachedSetButtonLED` (`ui/ui_leds.mjs` ~43).
  Palette indices used here: `16` = dim "available" (RoyalBlue — **renders wrong on Sample**, see
  gotchas), `60` = custom dim grey (Loop's ambient, set in `drainLedInit` to match Delete/Copy at 16),
  `DarkGrey`=124, `White`=120, `LightGrey`=118, `VividYellow`, `Green`, `Red`.

### Gotchas (from `CLAUDE.md` "Critical constraints" + this block)
- **`reapplyPalette` resets the buttonCache** → after it, persistent button LEDs need
  `setButtonLED(cc, color, true)` (force) or the write is silently dropped (stale colour in cache).
- **POLL_INTERVAL force cadence:** some buttons force a write every `POLL_INTERVAL` ticks
  (`(S.tickCount % POLL_INTERVAL) === 0`) to re-assert over a competing LED layer (co-run shim /
  Move firmware pass-through). Note/Session and Record use this.
- **Co-run LED ownership:** in Schwung chain-edit co-run the chain editor's LED queue flushes AFTER
  dAVEBOx each frame and **wins** some buttons (e.g. CC50 painted White to "agree, not fight"); in
  Move-native co-run, Move firmware pass-through must be force-overridden to OFF. So "off in co-run"
  must be done co-run-aware, not by simply not-writing.
- **Blink timing:** button blinks use `Math.floor(S.tickCount / 24) % 2` (tick-based). Co-run side
  buttons use wall-clock (`Date.now()`) because dAVEBOx's tick rate varies under co-run — if a blink
  must look right in co-run, use wall-clock.

---

## 3. Current LED behavior (the static baseline)

| Button | Current LED (resting) | Shift-blink today? |
|---|---|---|
| Note/Session (50) | `16` + co-run(White/OFF force) + menu/tapTempo slow-blink | YES (`_sf` 16/off) |
| Up (55) | `16` **always** | no |
| Down (54) | `16` **always** | no |
| Left (62) | `16` track / `LED_OFF` session | no |
| Right (63) | `16` track / `LED_OFF` session | no |
| Capture (52) | `DarkGrey` **always** | no |
| Sample (118) | `dspMergeState`: Green(≥2)/Red(1)/DarkGrey(0) | **YES** (`_sfs` DarkGrey/off) |
| Loop (58) | `60` ambient, else state-blink (perfLock/rptLatch/TARP/latchMode) | YES, **session only** |
| Mute (88) | `124` muted / blink solo / `16` | YES, **track only** |
| Copy (60) | `16` **always** | YES (`_sf`) |
| Delete (119) | `16` **always** | **no** |
| Undo (56) | `16` **always** | YES (`_sf`) |
| Shift (49) | `16` **always** | n/a |

**Shift-blink set today (~6996-7001):** Note/Session, Sample, Undo, Copy, Loop(session), Mute(track).

---

## 4. Function-availability maps (the audit result — don't re-derive)

State axes: **view** (`S.sessionView`), **track type** (`S.trackPadMode[t]` = MELODIC_SCALE / DRUM /
CONDUCT), **bank** (`S.activeBank` 0-7; 6=AUTO, 7=ALL LANES), **modals** (snapshotPicker / clearAutoMenu
/ sessionOverlayHeld / globalMenuOpen / tapTempoOpen / confirm dialogs), **co-run**
(`S.schwungCoRunSlot>=0`, `S.moveCoRunTrack>=0`), **record** (armed / counting-in).

### Up (55) / Down (54)  — symmetric
- **Plain:** Session = scroll scene group ±4 rows (`_onCC_jog` ~9025) — no-op at `sceneRow===0` (Up) /
  `>=NUM_CLIPS-4` (Down). Track+Loop+AUTO = lane zoom/TPS ±. Track drum = drum-lane page ± (always).
  Track melodic/conduct = octave ± (no-op at ±4 clamp). Fires even with global menu / co-run open.
- **No-op states:** `snapshotPicker`, `clearAutoMenu` (swallowed); octave/scene **limits** (nuance).
- **Shift:** NONE (no `shiftHeld` branch). → should never Shift-blink (currently doesn't ✅).

### Left (62) / Right (63) — symmetric
- **Plain:** **hard-gated `!S.sessionView`** (`_onCC_jog` ~8966) → **no-op in Session**. Track+Loop+AUTO =
  CC lane resolution ∓/± (~8968-8983). Track (any) = step page ∓/± (drum uses `drumStepPage`, else
  `trackCurrentPage`) — no-op at loop-window page limits. Fires under menus/co-run.
- **No-op states:** Session (gate); `sessionOverlayHeld`, `snapshotPicker`, `clearAutoMenu` (swallowed);
  page limits (nuance).
- **Shift:** NONE. (Current LED already `LED_OFF` in session ✅ — extend to the 3 modals.)

### Note/Session (50)
- **Plain:** view toggle (tap=permanent, hold=momentary) + closes any open dialog/menu/overlay + Schwung
  co-run exit (~8267) + Move co-run FX-overlay-or-noop (~8288).
- **No-op:** Move co-run press without overlay capability; `sessionOverlayHeld` **press** (release ok).
- **Shift:** Shift+CC50 = open/close global menu (~8306), all non-co-run states.
- LED already handles co-run/menu/Shift — **best-covered button**; minimal change.

### Capture (52)
- **Plain:** **always functional** — bare tap opens bake picker (Session) / clip-bake confirm (Track)
  on **release** (~8216-8259); press cancels in-flight dialogs. Not suppressed in co-run.
- **As modifier:** Capture+drum-pad = silent lane-select (~10692/10708); Capture+scene-row = capture
  live clips (~9217). No-op modifier on melodic pads / when another modifier co-held.
- **Shift:** NONE.
- **GAP:** always has a function but LED is `DarkGrey` (reads dead) → should be lit `16`.

### Sample (118)
- **Plain:** Session release = `merge_arm` / `merge_stop` (`dspMergeState`) — functional. **Track view
  bare tap = NO-OP** (documented ~8913: "clip bake moved off Sample onto Capture"). Press cancels
  dialogs / stops running merge.
- **As modifier:** sets `sampleHeld` but **NO gesture reads `sampleHeld`** — not a modifier.
- **Shift:** press handler guarded `!S.shiftHeld` and **no Shift+Sample branch exists anywhere** →
  Shift+Sample is a complete no-op.
- **GAPS (two):** (a) lit/idle in Track view where it does nothing → off in Track, lit only in Session;
  (b) **falsely Shift-blinks** (6997) a function that doesn't exist → remove from Shift set.

### Loop (58)
- **Plain:** always functional (sets `loopHeld`; Session enters/locks Perf Mode).
- **As modifier (huge):** Track — Loop+jog length (~8010), Loop+step loop-window (~11559), Loop+L/R CC
  res (bank 6), Loop+Play restart, Loop+Delete resets, drum-repeat/TARP latch. Session — full Perf-mode
  pad grid + step preset slots. (Length gestures blocked while `recordArmed && !recordCountingIn`.)
- **Shift:** Session = toggle `perfLatchMode` (~8396) ✅. **Track = none.**
- LED already always-lit + Shift-blink session-only → **correct, no change.**

### Mute (88)
- **Plain/modifier:** Track = track mute (tap) / lane mute+solo (Mute+drum-pad) / Mute+Play=metro;
  Session = column mute, Mute+step = snapshot slots; Delete+Mute = clear all mutes.
- **No-op:** **Schwung co-run** (Mute ceded to host as slot-bypass modifier, ~8206); hard modals.
- **Shift:** Shift+Mute = **solo**, in **both** track AND session.
- **GAPS:** Shift-blink is **track-only** today → add Session; ideally off in Schwung co-run (co-run-aware).

### Copy (60)
- **Plain/modifier:** clip/drum-lane/row/step copy across track+session views; standalone press latches
  a source (no immediate effect, still "available").
- **No-op:** co-run (pad grid blanked); hard modals.
- **Shift:** Shift+Copy = **cut** (wherever copy applies) ✅.
- LED `16` + Shift-blink already ✅ — only co-run is a (secondary) gap.

### Delete (119)
- **Plain/modifier (broadest):** clear/reset clips, lanes, steps, scenes; Delete+jog = FX/groove/
  automation reset; Delete+Mute = clear mutes; Delete+knob (AUTO) = clear that lane; Delete+Play = panic;
  AUTO-bank tap = open Clear-Automation menu.
- **No-op:** co-run; hard modals (Delete only *dismisses* clearAutoMenu).
- **Shift:** **Shift+Delete = hard-reset** (factory) variant — a real function.
- **GAP:** has a Shift function but **not in the Shift-blink set** → add Delete.

### Undo (56)
- **Plain:** `undo` — **gated on `S.undoAvailable`** (no-op + popup otherwise).
- **Shift:** Shift+Undo = `redo` — **gated on `S.redoAvailable`**.
- **GAPS (two):** LED is `16` always (should be lit iff `undoAvailable`); Shift-blinks always (should
  blink iff `redoAvailable`).

### Shift (49)
- Modifier; some Shift gesture exists in nearly every state (track/bank select, step shortcuts, Shift+
  jog, Shift+Back=save, Shift+Play=restart, Shift+Step3=co-run, etc.). No-op only in co-run (forwarded)
  + hard modals.
- LED `16` always — **minor** gap (could go off in co-run / hard modals).

---

## 5. Proposed implementation

Rework the ~6900-7002 block into, per in-scope button, a **lit/off predicate** and (where it has a
Shift function) a **Shift-blink predicate**. Most inputs are already local to the block.

Suggested predicates (pseudocode — verify flag names before coding):

```
modalDead   = S.snapshotPicker || S.clearAutoMenu || S.sessionOverlayHeld
corunDead   = S.schwungCoRunSlot >= 0 || S.moveCoRunTrack >= 0   // co-run-aware off; see gotchas

Up/Down     : lit = !modalDead                                   // (optionally && not-at-limit — nuance)
Left/Right  : lit = !S.sessionView && !modalDead
Capture     : lit = true            // always functional
Sample      : lit = S.sessionView   // Track bare-tap is a no-op;  Shift: NEVER blink (no fn)
Loop        : (unchanged — always lit)
Mute        : lit = !(Schwung co-run);  Shift-blink = (track OR session)   // solo both views
Copy        : lit = !corunDead
Delete      : lit = !corunDead;     Shift-blink = ADD (Shift+Delete = hard reset)
Undo        : lit = S.undoAvailable;  Shift-blink = S.redoAvailable
Shift       : lit = !(corunDead) (minor)
Note/Session: (mostly unchanged)
```

**Shift-blink set after rework:** Note/Session, Undo(iff redoAvailable), Copy, Delete (NEW),
Mute(both views), Loop(session). **Remove Sample.** (Up/Down/Left/Right/Capture stay out — no Shift fn.)

---

## 6. Decisions deferred to on-device

- **Boundary dimming** (Up at octave +4 / top scene; L/R at first/last loop page): no-op-at-limit but
  would **flicker** as you hit edges. Recommendation: **leave lit** unless precise feedback is wanted.
- **Co-run off-states** (Mute/Copy/Delete/Shift dead in Schwung co-run): real, but the host LED layer
  partly owns these during co-run → must blank co-run-aware (force-cadence) or it fights the editor.
  Treat as a **second pass** after the standalone wins land.

## 7. Clear-wins checklist (first pass — all inputs already in the block)
1. Undo → `S.undoAvailable`; Shift-blink → `S.redoAvailable`.
2. Sample → drop Shift-blink; off in Track, lit only in Session.
3. Delete → add to Shift-blink set.
4. Capture → lit `16` (not DarkGrey).
5. Mute → Shift-blink in Session too.
6. Up/Down/Left/Right → off in `snapshotPicker`/`clearAutoMenu`/`sessionOverlayHeld`.

## 8. Verify on device
JS-only change → `bash scripts/bundle_ui.sh && ./scripts/install.sh` + service reload (no reboot
needed for JS, but Shift+Back doesn't reload — use the restart). Walk each button through:
- Undo/redo: lit only with history; blink under Shift only with redo.
- Sample: dark in Track view, lit in Session; no Shift blink.
- Delete: blinks under Shift.
- Capture: lit.
- Nav buttons: dark inside the snapshot / clear-automation / session-overlay modals.
- Regression: Loop/Copy/Note-Session/Mute behaviour unchanged in normal use + co-run.

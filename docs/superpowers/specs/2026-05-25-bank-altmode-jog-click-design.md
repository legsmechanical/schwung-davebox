# Bank alt-param mode via jog-click (replaces hold-Shift)

**Date:** 2026-05-25
**Status:** Design approved, pending spec review
**TODO origin:** `notes/TODO.md` line 22 ("Jog-click to toggle alt params on track banks").

## Problem

Several track banks expose a second set of knob parameters today only while **Shift
is held**. Holding Shift to read/tweak an alternate param is awkward during
performance and conflicts with one-handed operation. We want a **sticky, hands-free
alt-param mode** toggled by the jog-wheel click, with a clear on-screen indicator.

The blocker recorded in TODO line 22 — "jog-click is already overloaded" — turns out
not to be a real collision once you split by track type and bank (see Inventory).

## Design summary

1. Add a single transient flag `S.altMode` (boolean).
2. **Jog-click toggles `S.altMode`** on banks that have alt-params.
3. While `S.altMode` is on, the affected bank's knob turns write the **alt** param
   (and the bank renders alt labels/values) — exactly what holding Shift does today.
4. `S.altMode` auto-clears on **bank change, track change, session-view entry, and
   suspend/resume**. It is **not** persisted to the UI sidecar.
5. The **hold-Shift → alt-param** coupling is removed from all migrated sites.
6. The **drum jog-click perform-mode cycle is removed** (perform-mode switching
   already lives on Shift+step-8).
7. Banks with alt-params draw a **down-arrow icon** in the header, dim normally and
   highlighted (inverted) while `S.altMode` is on.
8. The **AUTO/CC bank (6)** is included as a special case: alt mode is a "CC-assign"
   mode — header reads **"Assign"**, **all 8 labels highlight**, and knob turns run
   the existing AT↔CC0..127 ladder.

## Banks affected (alt-param banks)

| Track   | Bank index | Bank name      | Primary → Alt                  |
|---------|------------|----------------|--------------------------------|
| Melodic | 0          | CLIP           | Shft → Nudg, Res → Zoom        |
| Melodic | 3          | DELAY          | Rate(K1) → ClkF                |
| Drum    | 0          | DRUM LANE      | Shft → Nudg, Res → Zoom        |
| Drum    | 7          | ALL LANES      | Shft → Nudg                    |
| Drum    | 5          | REPEAT GROOVE  | VEL → NUDGE (per-step K1–K8)   |
| Both    | 6          | AUTO/CC        | values → CC-assign ("Assign")  |

Banks **not** in this list have no alt-params and get no jog-click toggle and no
down-arrow icon.

## Jog-click dispatch (new precedence in `_onCC_jog`, `ui.js` ~5798+)

For a plain jog-click (`d1 === 3 && d2 === 127`, no Shift/Delete/Copy/Mute, not
session view), in order:

1. **Melodic banks 4/5 (SEQ ARP / ARP IN):** toggle `S.stepIntervalMode` (Arp Steps
   overlay). **Unchanged** — these banks have no alt-params, so no collision.
   (`ui.js:6080-6087`.)
2. **Current bank is an alt-param bank** (per the table above, for the active track
   type): toggle `S.altMode`; `computePadNoteMap()` is **not** required here (no pad
   remap); set `S.screenDirty = true; forceRedraw()`.
3. **Otherwise:** no-op.

**Removed:** the drum perform-mode cycle block at `ui.js:6090-6109`. Perform-mode
switching remains only on **Shift+step-8** (`ui.js:9313-9331`), which already
auto-jumps to REPEAT GROOVE on entering Rpt1/Rpt2.

### Confirmed edge case

Shift+step-8 into Rpt1/Rpt2 lands the user on REPEAT GROOVE (bank 5). There,
jog-click toggles **VEL ↔ NUDGE** alt-params (not perform mode). This is the intended
split: perform-mode is **only** on Shift+step-8; jog-click on REPEAT GROOVE is purely
the alt-param toggle.

## `S.altMode` lifecycle

- **Declared** in `ui/ui_state.mjs` `S` object: `altMode: false`.
- **Set/cleared** only by the jog-click toggle (item 2 above).
- **Force-cleared to `false`** at every:
  - bank change (wherever `S.activeBank` is reassigned by user action),
  - track change (`_switchActiveTrack`),
  - session-view entry,
  - init/resume reset path (transient, never restored from sidecar).
- **NOT cleared by:** knob touch/release, modal popups, global menu open/close,
  transport start/stop, palette refresh.
- **NOT persisted:** no `seq8-ui-state.json` field; sidecar version unchanged.

## `S.shiftHeld` migration audit

**Migrate these sites from `S.shiftHeld` → `S.altMode`** (both render and knob-handler
sides). This is the complete list; the implementation plan must touch all of them and
no others:

Render / label / value:
- `ui.js:3576` drum DRUM LANE labels (Nudg/Shft, Zoom/Res)
- `ui.js:3579` drum DRUM LANE nudge value display
- `ui.js:3616` drum ALL LANES label (Nudg/Shft)
- `ui.js:3619` drum ALL LANES nudge value display
- `ui.js:3663` drum REPEAT GROOVE header (VEL/NUDGE)
- `ui.js:3683-3685` drum REPEAT GROOVE per-step value display
- `ui.js:3778` melodic DELAY `_delayShiftClkF` label flip (Rate→ClkF)
- `ui.js:3788-3790` melodic DELAY ClkF value display
- `ui.js:3779-3782` generic melodic label flips (`clock_shift`→Nudg,
  `clip_resolution`→Zoom)
- Bank-gate at `ui.js:3560-3563` (the overview-render trigger currently keyed on
  `S.shiftHeld` for banks 1/3/5) — re-key to `S.altMode` for the migrated banks.

Knob handlers:
- `ui.js:7591-7609` DRUM LANE K2 clock_shift→nudge
- `ui.js:7611-7649` DRUM LANE K3 clip_resolution→zoom
- `ui.js:7750-7765` ALL LANES K2 clock_shift→all_lanes_nudge (incl. sens 4 vs 8)
- `ui.js:7881-7902` REPEAT GROOVE K1–K8 vel_scale→nudge
- `ui.js:8061` melodic DELAY shifted-nudge sens
- `ui.js:7920-7934` AUTO/CC shift+turn CC-type ladder (→ `altMode`; see below)

**Leave on `S.shiftHeld` (do NOT touch):**
- Rnd algorithm selector (Shift+touch): `3688-3706`, `8001`, `10024-10028`, `6354`
- Shift+pad bank select: `8658-8682`
- Shift+pad track select: `8683-8704`
- Step-edit blocking: `8629`
- Session-view launch quant: `6276`, `7280`
- Shift+step shortcuts incl. step-8 perform-mode: `9308-9331`
- Shift+Delete+jog reset: `5988-6016`
- Delete+jog reset (Delete-based, unrelated): `6017-6075`

## AUTO/CC bank (6) — CC-assign mode

When `S.altMode` is on and the active bank is 6:
- **Header text** changes from the normal AUTO/CC heading to **"Assign"**.
- **All 8 knob labels are highlighted** (inverted/boxed) regardless of `knobTouched`,
  to signal that turns retarget the CC/AT assignment rather than edit values.
- **Knob turns** run the existing AT↔CC0..CC127 ladder currently gated on
  `S.shiftHeld` at `ui.js:7920-7934`.
- When `S.altMode` is off, the bank behaves exactly as today (resting value / record /
  audition on turn).

## Down-arrow header icon

- A **5×3-pixel down-arrow bitmap** drawn with `fill_rect` calls (not a font glyph —
  `pixelPrint`/`print` fonts are not assumed to contain `▼`). Bitmap inverts cleanly
  under highlight by flipping the fill color.
- Rendered in the **header bar of the 6 alt-param banks only**.
- **Position:** top-right corner of the header bar, clear of existing right-aligned
  header content (e.g. ALL LANES draws `Tr<n>` at x≈106; place the icon so it does not
  overlap — pick a fixed slot in the bar, plan to verify per-header on device).
- **State:** dim (color 1 on dark / color 0 on inverted header) when `S.altMode` is
  off; highlighted (inverted) when `S.altMode` is on.
- Headers in play use `drawBankHeading`, `drawBankHeadingInverted`, and the ALL LANES
  custom `fill_rect` header — the icon-draw must account for inverted vs normal header
  background.

## Out of scope

- No change to the Rnd algorithm dialog or any non-alt-param Shift use.
- No change to Delete+jog / Shift+Delete+jog reset behavior.
- No sidecar version bump, no DSP/state changes (JS-only UI feature).
- No LED/button changes (OLED icon only).

## Test plan (device, hands-on)

1. **CLIP (melodic):** jog-click → down-arrow lights, K2/K3 labels read Nudg/Zoom,
   turning them changes nudge/zoom; jog-click again → back to Shft/Res. Holding Shift
   no longer flips them.
2. **DELAY (melodic):** jog-click → K1 reads ClkF and turning it changes clock
   feedback; off → Rate.
3. **DRUM LANE / ALL LANES (drum):** jog-click → Nudg(/Zoom) alt labels + values.
4. **REPEAT GROOVE (drum):** jog-click → header VEL↔NUDGE, per-step values switch.
5. **AUTO/CC:** jog-click → header reads "Assign", all labels highlighted, turning a
   knob retargets its CC/AT; jog-click off → values edit again. Holding Shift no longer
   does the ladder.
6. **Perform mode:** Shift+step-8 still cycles Velocity→Rpt1→Rpt2 and lands on REPEAT
   GROOVE; jog-click alone no longer cycles perform mode.
7. **Reverts:** turn alt mode on, then change bank / change track / enter session view —
   alt mode is off when you return. Suspend+resume → off.
8. **Banks 4/5 melodic:** jog-click still toggles the Arp Steps overlay (unchanged).

# dAVEBOx Manual Corrections

Discrepancies between `docs/manual.md` and what is actually implemented, verified against `ui.js`, `ui_leds.mjs`, `ui_state.mjs`, and `docs/FEATURE_REFERENCE.md`. Each entry shows what the manual says and what the code does.

---

## Section 2 — Shift+Step Shortcuts

### Step 6: Metro toggle cycle

**Manual says:** `Cnt-In → Play → Always`

**Actual:** Binary toggle — cycles between **Cnt-In** and **Always** only. Never passes through Play or Off.

**Fix:** Change to `Metro toggle (Cnt-In ↔ Always)`

*Source: `ui.js` ~6529 — `S.metronomeOn = (S.metronomeOn === 1) ? 3 : 1`*

---

### Step 8 drum description

**Manual says (§2 table and Appendix C):** "cycle Note Repeat mode"

**Actual:** Cycles the right-pad **perform mode** (Velocity → Rpt1 → Rpt2). Velocity mode is the default layout used outside of repeating — it is not a Note Repeat mode.

**Fix:** Change to "cycle right-pad mode (Velocity / Rpt1 / Rpt2)"

---

## Section 4 — Step Sequencing

### Out-of-bounds step color

**Manual says:** "Steps beyond the clip's length light white (out of bounds)."

**Actual:** OOB steps show **DarkGrey (palette index 124)**, not white.

**Fix:** Change "light white" to "light dark grey"

*Source: `ui_leds.mjs` lines 132, 177 — `if (absStep >= len) color = DarkGrey`*

---

## Section 6 — Effects Chain

### Bank count

**Manual says:** "Six banks are accessible in Track View."

**Actual:** There are **7 banks** on melodic tracks: CLIP (0), NOTE FX (1), HARMZ (2), MIDI DLY (3), SEQ ARP (4), TRACK ARP (5), CC PARAM (6). The manual itself lists 7 sub-sections (§6.1–6.7). On drum tracks, 6 banks are visible because HARMZ and SEQ ARP are hidden, but the statement applies generally.

**Fix:** Change "Six banks" to "Seven banks"

---

### Effects chain order

**Manual says:**
```
NoteFX + Harmony → Delay → Sequence Arp
```

**Actual order:**
```
TRACK ARP → NOTE FX → HARMZ → MIDI DLY → SEQ ARP
```

Two issues:
1. **TRACK ARP (Arp In) is the first stage** but only processes live input (pads + external MIDI). Sequenced notes enter at NOTE FX.
2. NOTE FX and HARMZ are **sequential**, not a single combined stage.

**Fix:** Update diagram to:
```
Live input → [TRACK ARP] → NOTE FX → HARMZ → MIDI DLY → SEQ ARP ← Sequenced notes
```
Or add a note: "Arp In intercepts live input only before the main chain; sequenced notes enter at NOTE FX."

---

### HARMZ and SEQ ARP hidden on drum tracks *(gap)*

**Manual says:** Nothing.

**Actual:** On drum tracks, HARMZ (bank 2) and SEQ ARP (bank 4) are not accessible — jog skips them and Shift+pad shortcuts for those banks are blocked. Bank falls back to DRUM LANE (0) when switching to a drum track if one of these was active.

The bank order on drum tracks is: DRUM LANE → NOTE FX → MIDI DLY → REPEAT GROOVE → CC PARAM → ALL LANES.

**Fix:** Add a note in §6.3 and §6.5 that these banks are not available on drum tracks.

---

### Bank OLED names *(informational gap)*

**Manual says:** "Harmony Bank", "Delay Bank", "Sequence Arp Bank", "Arp In Bank", "CC Automation Bank", "RPT GROOVE Bank"

**Actual on-device OLED labels:**

| Manual section title | On-device label |
|---|---|
| Harmony Bank | `HARMZ` |
| Delay Bank | `MIDI DLY` |
| Sequence Arp Bank | `SEQ ARP` / `ARP OUT` |
| Arp In Bank | `TRACK ARP` / `ARP IN` |
| CC Automation Bank | `CC PARAM` |
| RPT GROOVE Bank | `REPEAT GROOVE` (full text) |

**Fix:** Add device label to each bank section header, e.g. "6.3 Harmony Bank (`HARMZ`)"

---

## Section 6.2 — NoteFX Bank

### K6 Quantize position on drum tracks

**Manual says:** "K6 | Quantize | On drum tracks, affects the active lane only. Use ALL LANES K7 for all lanes simultaneously."

**Actual:** The drum NOTE FX overlay exposes only three knobs: **K1=Gate, K2=Vel, K3=Qnt**. K4–K8 are blocked. Quantize is at **K3**, not K6. Additionally, ALL LANES K7 is unassigned (see ALL LANES section).

**Fix:** For drum tracks, replace K6 row with: "K3 | Quantize | Drum tracks only. Affects the active lane. Use ALL LANES K4 for all lanes simultaneously."

*Source: `ui.js` ~5540 — `/* Drum NOTE FX bank (bank 1): K1=Gate K2=Vel K3=Qnt; K4-K8 blocked */`*

---

### K7/K8 Lane Note location

**Manual says:** "K7 | Oct (Lane Note) | Drum tracks only. … K8 | Note (Lane Note) | Drum tracks only." — listed in the NoteFX bank table.

**Actual:** Lane note assignment knobs are in the **DRUM LANE bank (bank 0)**, not NoteFX. Drum NOTE FX K7 and K8 are blocked. See DRUM LANE bank corrections below.

**Fix:** Remove K7/K8 from NoteFX bank table. Add them to the DRUM LANE bank table.

*Source: `ui.js` ~5437 — `/* K7 = LaneOct (±12 semitones), K8 = LaneNote (±1 semitone) */`*

---

## Section 7 — Drum Tracks

### Pad Layout: "Switch modes via DRUM LANE bank K7"

**Manual says:** "Switch modes via DRUM LANE bank K7, or jog click (cycles Velocity → Rpt1 → Rpt2 → Velocity)."

**Actual:** Mode cycling is via **jog click only**. DRUM LANE bank K7 is LaneOct (shifts the active lane's MIDI note by ±12 semitones), not Mode.

**Fix:** Remove "via DRUM LANE bank K7" — change to "Switch modes via jog click (cycles Velocity → Rpt1 → Rpt2 → Velocity)."

---

### DRUM LANE Bank — missing section header

**Manual says:** The section begins with bare text "Per-lane settings for the active lane." without a `###` heading.

**Fix:** Add `### DRUM LANE Bank` heading before the table.

---

### DRUM LANE Bank — wrong and incomplete knob list

**Manual says:** K2=Clock Shift, K3=Nudge, K7=Mode

**Actual:** All 8 knobs are assigned:

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Stretch | Per-lane beat stretch. One-shot; blocks if compression impossible. |
| K2 | Clock Shift | Shifts the active lane only |
| K3 | Nudge | Nudges the active lane only |
| K4 | Resolution | Per-lane playback resolution |
| K5 | Length | Per-lane clip length |
| K6 | SeqFollow | Per-clip auto-scroll |
| K7 | Oct (Lane Note) | Shifts the active lane's MIDI note by ±1 octave |
| K8 | Note (Lane Note) | Shifts the active lane's MIDI note by ±1 semitone |

K7 is NOT Mode — it's lane note octave adjustment.

**Fix:** Replace DRUM LANE bank table with the table above.

*Source: `ui.js` lines 5310–5451*

---

### Cross-reference to NoteFX K7/K8

**Manual says (§7 step edit section):** "use the NoteFX bank K7/K8 to change a lane's MIDI note assignment"

**Actual:** Lane note assignment is in **DRUM LANE bank K7/K8**, not NoteFX.

**Fix:** Change "NoteFX bank K7/K8" to "DRUM LANE bank K7/K8"

---

### ALL LANES Bank — wrong knob assignments

**Manual says:** K4=Resolution, K5=Length, K6=Velocity Input, K7=Quantize

**Actual:**

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Stretch | Beat stretch applied atomically to all lanes |
| K2 | Clock Shift | Shifts all lanes simultaneously |
| K3 | Nudge | Nudges all lanes simultaneously |
| K4 | Quantize | Playback quantize for all 32 lanes (`drum_lanes_qnt`) |
| K5 | VelIn | Velocity input override for this track |
| K6 | InQ | Recording input quantize (Off · 1/32 · 1/16 · 1/8 · 1/4 · 1/4T · 1/8T · 1/16T · 1/32T) |
| K7 | *(unassigned)* | — |
| K8 | *(unassigned)* | — |

Per-lane Resolution and Length are in **DRUM LANE bank K4 and K5** (active lane only), not ALL LANES.

**Fix:** Replace ALL LANES knob table with the table above. Remove K4=Resolution and K5=Length.

*Source: `ui.js` line 5453 comment + handlers 5454–5600*

---

## Section 8 — Bake

### Melodic bake dialog: wrong options, wrong condition for WRAP TAILS

**Manual says:** "The dialog always appears with options: CANCEL / 1× / 2× / 4× / **8×** (defaults to 1×)."
"After selecting **2×/4×/8×**, a second dialog asks WRAP TAILS?"

**Actual:**
- The dialog shows **1x / 2x / 4x / CANCEL** — no 8× option exists.
- Default selection is **1x** ✓
- WRAP TAILS? appears after **any** loop count selection, including 1×. It is not skipped for 1×.

**Fix:**
- Remove 8× from the options list
- Change "After selecting 2×/4×/8×" to "After selecting a loop count"

*Source: `ui.js` lines 1111–1119 (dialog rendering), 4127–4135 (always advances to wrap), 4354 (default = 1x)*

---

### Drum bake dialog: 3-step flow, not one dialog

**Manual says:** "Dialog options: CANCEL / CLIP / LANE / 1×."

**Actual:** Three separate dialogs in sequence:
1. **CLIP / LANE / CANCEL** — choose mode
2. **1x / 2x / 4x / CANCEL** — choose loop count (after selecting CLIP or LANE)
3. **WRAP TAILS? YES / NO / CANCEL** — after choosing loop count

**Fix:** Replace single-dialog description with the 3-step flow above.

*Source: `ui.js` lines 1127–1145*

---

## Section 10 — Performance Mode

### R0 pad layout: unnamed "·" is Sync

**Manual says:** `1/32 | 1/16 | 1/8 | 1/4 | 1/2 | Hold | · | Latch`

**Actual:** `1/32 | 1/16 | 1/8 | 1/4 | 1/2 | Hold | Sync | Latch`

Pad 7 (the `·`) toggles `S.perfSync`. When Sync is on, new captures wait for the next aligned clock boundary before starting. When off, capture starts immediately.

**Fix:** Replace `·` with `Sync` and add it to the R0 controls description.

*Source: `ui.js` ~6345 — `subIdx === 6 → S.perfSync = !S.perfSync`*

---

### Capture lengths: R0 goes to 1/2 only; 1-bar is step-button-only

**Manual says:** "Capture lengths: Step 1=1/32 · Step 2=1/16 · Step 3=1/8 · Step 4=1/4 · Step 5=1/2 bar · Step 6=1 bar."

**Actual:** These 6 lengths (1/32–1-bar) are available via **step buttons 1–6** when entering perf mode (Loop held). Once in perf mode, the R0 pads can also change the length, but R0 only has **5 capture length pads** (1/32–1/2). The 6th R0 pad is Hold, not 1-bar. There is no 1-bar option on R0.

**Fix:** Add a note: "R0 length pads cover 1/32–1/2 only. To capture at 1-bar, use step button 6 when entering (while holding Loop)."

*Source: `LOOPER_RATES_STRAIGHT = [12, 24, 48, 96, 192]` (5 values)*

---

## Section 14 — Global Settings

### Metro: missing Off state

**Manual says:** "Metro | Cnt-In · Play · Always"

**Actual:** Four states: **Off · Cnt-In · Play · Always**. "Off" silences the metronome completely.

**Fix:** Add Off to the list: "Metro | Off · Cnt-In · Play · Always"

Also missing from the manual: the **Mute+Play shortcut** in Track View toggles Metro on/off (switches between Off and the last non-zero state). This shortcut is not documented anywhere.

*Source: `ui.js` ~276 — `['Off', 'Cnt-In', 'Play', 'Always']`*

---

## Appendix A — LED Reference

### Step Buttons: "Inactive step within clip | Dim track color"

**Manual says:** Dim track color

**Actual:** Inactive steps within the clip are **LED_OFF (unlit)**. The only exception: when Beat Markers are enabled (default: on), steps at positions 1, 5, 9, and 13 (every 4th step) show dim track color (`TRACK_DIM_COLORS`). All other inactive steps are dark.

**Fix:** Change to: "Inactive step within clip | Off (beat-marker positions show dim track color when Beat Markers enabled)"

*Source: `ui_leds.mjs` lines 134–135, 181–183*

---

### Step Buttons: "Out of bounds | White"

**Manual says:** White

**Actual:** **DarkGrey (palette index 124)**

**Fix:** Change White to Dark grey

*Source: `ui_leds.mjs` lines 132, 177*

---

## Appendix C — Controls Quick Reference

### Performance Mode: "R0 length pads (Steps 1–6)"

**Manual says:** "R0 length pads (Steps 1–6) | Set capture length and trigger capture"

**Actual:** R0 has **5** capture length pads (1/32–1/2). The 6th R0 pad is Hold, not a capture length. Also, the Sync pad is not listed at all.

**Fix:**
- Change "(Steps 1–6)" to "(5 pads: 1/32–1/2)"
- Add a row: "R0 Sync pad | Toggle clock-aligned capture on/off"

---

### Loop View: Unimplemented controls

The following entries in the Loop/Pages View table were not found in the codebase and appear to be fabricated. Remove or verify before publishing:

- `Shift + Loop (held) + jog rotate | Adjust clip length in fine increments`
- `Step button (double-tap) | Set loop to that single bar`
- `Hold step + jog rotate | Adjust note lengths for all notes in bar`
- `Hold step + Volume encoder | Adjust note velocities for all notes in bar`
- `Hold step + +/− | Transpose all notes in bar`
- `Hold step + Left / Right arrows | Nudge all notes in bar`

These operations are not documented in `FEATURE_REFERENCE.md` and no matching handlers were found in `ui.js`.

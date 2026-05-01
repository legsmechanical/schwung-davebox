# Note Repeat User Guide

Note Repeat is a real-time performance feature for **drum tracks** in SEQ8. It retriggers drum lanes at rhythmic intervals while you hold pads, creating rolls, fills, and stutters. Two modes are available: **Repeat Play (Rpt1)** for quick single-lane repeats, and **Repeat Set (Rpt2)** for multi-lane simultaneous patterns.

Note Repeat is only available on drum tracks.

---

## Entering Repeat Mode

There are two ways to activate a repeat mode:

- **Jog click** (no modifiers held): Cycles through `Velocity → Repeat Play → Repeat Set → Velocity...`
- **K7 knob** on DRUM SEQ bank: Turn to switch between modes

The OLED header on DRUM SEQ bank shows the current mode: `Vel`, `Rpt1`, or `Rpt2`.

When switching modes, any active repeat automatically stops.

---

## Repeat Play (Rpt1) — Single-Lane Repeat

Rpt1 is the simplest mode: hold a rate pad to retrigger the current drum lane at that rate.

### Pad Layout

| Row     | Left 4 columns     | Right 4 columns       |
|---------|--------------------|-----------------------|
| Top     | Drum lanes         | Gate mask (steps 4–7) |
| Row 3   | Drum lanes         | Gate mask (steps 0–3) |
| Row 2   | Drum lanes         | Rates: 1/32T 1/16T 1/8T 1/4T |
| Bottom  | Drum lanes         | Rates: 1/32 1/16 1/8 1/4 |

### Basic Usage

1. Select the drum lane you want to repeat (left-side pads)
2. **Hold** a rate pad on the right side — the lane starts repeating at that rate immediately
3. **Release** the rate pad — repeat stops

The held rate pad lights White; other rate pads are grey.

### Changing Velocity

While holding a rate pad, pad **pressure (aftertouch)** dynamically updates the repeat velocity.

### Switching Lanes

While a repeat is active, press a different lane pad on the left — the repeat switches to that lane without stopping.

### Latching

To keep a repeat running without holding the pad:

- **Loop + rate pad**: Starts the repeat and latches it (continues after release)
- **Loop tap** (while repeat is held): Latches the current repeat
- **Loop tap** (while already latched): Stops and unlatches
- **Same rate pad tap** (while latched): Stops and unlatches

---

## Repeat Set (Rpt2) — Multi-Lane Repeat

Rpt2 allows multiple drum lanes to repeat simultaneously, each at its own rate. Instead of holding rate pads, you hold (or latch) lane pads.

### Pad Layout

| Row     | Left 4 columns     | Right 4 columns       |
|---------|--------------------|-----------------------|
| Top     | Drum lanes         | Gate mask (steps 4–7) |
| Row 3   | Drum lanes         | Gate mask (steps 0–3) |
| Row 2   | Drum lanes         | Rates: 1/32T 1/16T 1/8T 1/4T |
| Bottom  | Drum lanes         | Rates: 1/32 1/16 1/8 1/4 |

### Basic Usage

1. Set the rate for each lane: select a lane (left pads), then tap a rate pad (right side) to assign
2. **Hold** a lane pad — that lane starts repeating at its assigned rate
3. Hold additional lane pads to stack simultaneous repeats
4. **Release** a lane pad — that lane stops (unless latched)

Active/latched lanes light Cyan. The currently selected rate for the active lane lights Cyan; other rates are purple-blue.

### Assigning Rates

Tap any rate pad while a lane is selected — the rate is stored for that lane. You can pre-assign rates to multiple lanes before triggering them.

### Changing Velocity

While holding a lane pad, **aftertouch** dynamically updates that lane's repeat velocity.

### Latching

- **Loop + lane pad**: Starts the lane and latches it
- **Hold lane pad + press Loop**: Latches all currently held lanes
- **Loop hold + release** (no pad touched during hold): Stops and unlatches all
- **Lane pad tap** (already latched): Unlatches and stops that lane only

---

## RPT Groove — Per-Step Shaping

Both Rpt1 and Rpt2 use an 8-step repeating pattern. RPT Groove lets you shape this pattern by controlling which steps fire, their velocity, and their timing.

### Accessing RPT Groove

RPT Groove is shown on bank 6 when a repeat mode is active. The OLED shows `[ RPT GROOVE ]` (or the diagnostic header during development).

### Gate Pattern (8 Steps)

The top 2 rows of right-side pads (8 pads total) control the gate mask — which of the 8 repeat steps actually fire:

- **Tap a gate pad**: Toggle that step on/off
- **ON** (default): Step fires normally — pad lights in track color
- **OFF**: Step is silenced — pad is dark

The OLED shows each step as a solid bar (ON) or empty outline (OFF).

Default: all 8 steps ON (0xFF).

### Velocity Scale (Knobs K1–K8, unshifted)

Each knob controls the velocity scaling for one of the 8 steps:

- Range: **0% – 200%**
- Default: **100%** (displayed as "Live" — uses the raw pad velocity)
- Below 100%: softer hits
- Above 100%: louder hits (capped at 127)

### Nudge / Timing Offset (Knobs K1–K8, Shift held)

Each knob controls the timing offset for one step:

- Range: **-50% to +50%**
- Default: **0%** (on the grid)
- Negative: step fires earlier
- Positive: step fires later

The percentage is relative to the repeat interval.

### Resetting Groove

- **Delete + gate pad**: Reset that step's velocity scale to 100% and nudge to 0%
- **Delete + jog click** (while in Rpt1 or Rpt2 mode): Reset the entire groove for the current lane — all gates ON, all velocity 100%, all nudge 0%

---

## Rates Reference

| Pad Position | Rate   | Musical Value     |
|-------------|--------|-------------------|
| Bottom-left  | 1/32   | 32nd note         |
| Bottom+1     | 1/16   | 16th note         |
| Bottom+2     | 1/8    | 8th note          |
| Bottom+3     | 1/4    | Quarter note      |
| Row 2 left   | 1/32T  | 32nd note triplet |
| Row 2+1      | 1/16T  | 16th note triplet |
| Row 2+2      | 1/8T   | 8th note triplet  |
| Row 2+3      | 1/4T   | Quarter note triplet |

Triplet rates are 2/3 the duration of their straight equivalents, producing a faster, swung feel.

---

## Per-Lane Independence

Gate patterns, velocity scale, and nudge settings are stored **per drum lane**. Each of the 32 lanes has its own independent groove pattern. This means you can set up different rhythmic feels for kick, snare, and hi-hat repeats.

---

## Tips

- Use RPT Groove gate patterns to create rhythmic fills: disable steps to turn a straight roll into a syncopated pattern
- Velocity scale creates accents and ghost notes within repeats — set alternating steps to 60% and 120% for a dynamic feel
- Nudge adds swing to repeats independently of the global swing setting
- In Rpt2, pre-assign different rates to kick (1/4) and hi-hat (1/16) lanes, then trigger them together for instant layered patterns
- Aftertouch lets you crescendo or decrescendo a repeat in real time
- Latch a repeat, switch to a different track to add melodic content, then come back and unlatch when done

# CC PARAM Bank — User Guide

Bank 6 (CC PARAM) lets you assign, record, and play back CC automation per track and per clip on melodic tracks. Each of the 8 knobs maps to one CC lane.

## Accessing the Bank

Press **Shift + top-row pad 6** (or jog to cycle banks) to enter CC PARAM. The OLED header shows **CC PARAM** and the 8 knob slots.

---

## Assigning CC Numbers

Each knob slot starts unassigned (LED off).

- **Shift + hold knob K** → the OLED shows the current CC assignment for that knob. **Turn the jog wheel** to change the CC number (1–127).
- Release Shift to confirm. The knob LED lights **White** once a CC number is assigned.

Assignments are per-track and saved with your session.

---

## Recording CC Automation

CC automation records per-clip, the same way note data does. To record:

1. Select your clip and arm recording (**Rec** button).
2. **Turn a knob** — the value is sent immediately and recorded as an automation point, snapped to the nearest 1/32 note position. The knob LED glows **red** at a brightness matching the current value.
3. Stop or disarm recording when done.

On playback, recorded values interpolate between points. Knob LEDs glow **green** at the automation's current value.

### Touch-Record (Overwrite)

Holding a knob **without turning it** also records — it writes the current value continuously to the automation lane for as long as you hold, overwriting any existing data in that region at 1/32 note resolution.

This is useful for:
- Erasing automation in a region by holding the knob steady
- Punching in a flat value across a section without having to turn the knob repeatedly
- Overdubbing: only the region you hold is overwritten; the rest of the clip is untouched

While you're holding a knob, automation playback for that lane is suppressed so there's no fighting between the recorded value and playback.

---

## Step-Editing CC Values

You can write a specific CC value to a single step without being in record mode.

1. **Hold a step button** (like a normal step edit). The OLED switches to the CC step-edit view, showing all 8 knob slots with their current values.
2. **Turn a knob** — the value is written to that step for the full step duration (staircase hold), regardless of the clip's resolution. A 1/4-note step holds the value for a full quarter note; a 1/32-note step holds for 1/32.
3. Release the step when done.

The step is highlighted on the OLED while held. Knob labels show the CC number; the value below shows what will be written.

> **Note:** CC step-edit works on melodic tracks only. On empty steps, the "no note" dialog is suppressed — CC automation doesn't require a note to be present.

---

## LED States (Knob LEDs)

| State | LED |
|---|---|
| Unassigned (no CC number) | Off |
| Assigned, no automation | White |
| Has automation data for this clip | Vivid Yellow |
| Recording armed | Red — brightness = current knob value |
| Playback with live automation | Green — brightness = automation value at playhead |

---

## Deleting Automation

- **Delete + jog wheel** — clears all CC automation for the active clip on the active track. All 8 lanes are wiped.
- **Delete + touch a knob** (press the knob capacitive surface) — clears automation for that one knob lane only.
- **Delete + turn a knob** — same per-knob clear, triggered on the first tick of turning.

After clearing, LEDs update immediately to reflect the new state (White if assigned but no automation, Off if unassigned).

---

## Notes

- CC automation is independent of step resolution — it records at 1/32 precision regardless of the clip's note resolution setting.
- Changing clip length or resolution after recording will shift automation relative to the beat — same behavior as note data.
- Automation is saved per-clip and persists with your session.
- CC PARAM works on melodic tracks only. Drum tracks do not support CC automation.

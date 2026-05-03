# Bake and Live Merge

## Bake

Bake permanently applies a clip's effects chain to its note data, then resets all effect parameters to their defaults. Use it to "freeze" a sound design decision and free up the effects chain for something new.

### Melodic tracks

**How to bake:**

1. Select the track and clip you want to bake.
2. Press **Sample** (no modifier). A confirmation dialog appears — default is **No**.
3. Rotate the jog wheel to switch between **Yes** and **No**.
4. Press the jog wheel to confirm.
   - **Yes** → bake is applied; step LEDs and the session view update immediately.
   - **No** → nothing changes.
5. To cancel at any point, press **Sample** or **NoteSession** to dismiss the dialog.

**What gets baked:**

The full effects chain is applied offline in order: NOTE FX + HARMZ → MIDI Delay → SEQ ARP output. The resulting notes are written back into the clip. All effect parameters (delay time, harmonize intervals, arp settings, etc.) are then reset to defaults.

**Limitations:**

- If the clip is empty, nothing happens.
- Bake is undoable. Notes, steps, and effect parameter values are all restored on undo.

### Drum tracks

Drum tracks offer two bake modes. Press **Sample** to open the **BAKE DRUMS?** dialog — default is **CANCEL**.

Rotate the jog wheel to select a mode, then press the jog wheel to confirm. Press **Sample** or **NoteSession** to cancel at any point.

**CLIP mode** — bakes the full effects chain across all lanes with pitch routing:

- Each lane's effects chain (NOTE FX, HARMZ, MIDI Delay, SEQ ARP) runs offline.
- Output notes are routed to whichever drum lane matches their pitch. HARMZ can therefore move hits from one lane to another — what you hear is what you get.
- Notes at pitches with no matching lane are silently dropped.
- All lane effect parameters are reset to defaults.

**LANE mode** — bakes velocity, gate, timing, and arp effects per lane:

- Each lane is processed independently. MIDI Delay and SEQ ARP timing changes are captured.
- Velocity and gate transforms from NOTE FX are applied.
- Pitch transforms and HARMZ are **not** captured (indicated by the **No Pitch / HARMZ FX** notice in the dialog). Drum lanes always play at their fixed pitch regardless of stored pitch data, so pitch-based FX have no effect when baked per-lane.
- All lane effect parameters are reset to defaults.

**Limitations:**

- If the clip is empty (all lanes), nothing happens.
- Bake is undoable. Notes, steps, and effect parameter values are all restored on undo.
- CLIP mode uses a per-clip output pool capped at 2048 notes. Clips with very dense content across many lanes may silently drop overflow notes.

---

## Live Merge

Live Merge captures your live playing directly into a new empty clip slot on the active track. Notes pass through the full effects chain before being captured, so what you hear is what gets recorded. Both melodic and drum tracks are supported.

**How to use:**

1. Select the track you want to record into.
2. Press **Shift + Sample** to arm. The Sample LED turns **red**.
3. Start the transport if it isn't already running. Recording begins at the next step boundary — the LED turns **green**.
4. Play pads, keys, or send external MIDI. Notes are captured in real time.
5. Press **Sample** (no modifier) to stop. The LED stays green while the sequencer waits for the current 16-step page to complete, then turns off and the clip is created.

**What you get:**

- A new clip in the first available empty slot on the track.
- Clip length is always a multiple of 16 steps — it ends at the page boundary after you pressed stop.
- On melodic tracks, the captured notes appear as normal step data.
- On drum tracks, each captured note is routed to the matching drum lane (by pitch), so the result plays back correctly in the DRUM SEQ view.

**Stopping and cancelling:**

- **Stop (page-quantized):** Press **Sample** while capturing. The LED stays green until the end of the current 16-step page, then the clip is created.
- **Cancel before recording starts:** Press **Shift + Sample** again while armed (LED red) to disarm without creating a clip.
- **Force-stop:** If the transport stops, the merge is finalised immediately at the current position.

**Error popups:**

- **NO EMPTY / CLIP SLOT** — all 16 clip slots on the track are occupied. Free a slot before merging.
- **MAX LENGTH / REACHED** — you recorded more than 256 steps. The merge auto-finalised at the limit.

**Notes:**

- The effects chain is captured into the clip. If you want to keep the effects live, bake after merging.
- Live Merge and Bake can be combined: merge a performance, then bake to freeze the result.
- Only one merge can be in progress at a time across all tracks.

# SEQ8 Arpeggiators — User Guide

SEQ8 has two arpeggiators that can be used independently or together. They share the same core engine and parameter set, but serve different roles in the signal flow.

---

## Overview

```
Live input (pads / external MIDI)
        ↓
  [ TRACK ARP ]   ← bank 6 (pad 98)
        ↓
  [ NOTE FX   ]
        ↓
  [ HARMZ     ]
        ↓
  [ MIDI DLY  ]
        ↓
  [ SEQ ARP   ]   ← bank 5 (pad 97)
        ↓
     Output
```

**TRACK ARP** sits at the top of the chain and works on live input — pad presses and external MIDI. It never touches sequenced notes.

**SEQ ARP** sits at the bottom and works on what flows into it — either sequenced notes playing back from a clip, or (if TRACK ARP is on) the notes that TRACK ARP fires into the chain.

---

## TRACK ARP

Access: `Shift + pad 98`

TRACK ARP is a per-track live arpeggiator. When enabled, it intercepts pad presses and external MIDI and turns them into an arpeggiated pattern. It does not affect notes playing back from the sequencer.

Parameters are saved per track and persist across track switches and reboots.

### Knobs

| Knob | Name | Default | Range | Description |
|------|------|---------|-------|-------------|
| K1 | On/Off | Off | Off / On | Enables TRACK ARP for this track |
| K2 | Style | Up | Up–RnO | Arpeggio pattern (see Styles) |
| K3 | Rate | 1/16 | 1/32–1bar | How fast steps fire (see Rates) |
| K4 | Octaves | +1 | −4 to +4 | Octave range to span (see Octaves) |
| K5 | Gate | 50% | 1–200% | How long each note holds relative to the rate |
| K6 | Steps | Off | Off / Mute / Step | 8-step velocity pattern (see Steps Mode) |
| K8 | Latch | Off | Off / On | Whether the arp keeps running after release |

K7 is unused.

### Basic operation

Hold one or more pads — the arp fires a pattern through those pitches at the chosen Rate. Release the pads and the arp stops (Latch off) or keeps running (Latch on).

Pressing pads while the arp is running adds notes to the active set. Releasing removes them. The arp always picks from whatever is currently held.

### Latch

**Latch Off**: the arp runs only while pads are physically held. Release all pads and it stops immediately (after the current note's gate).

**Latch On**: the arp keeps running after you release. To update the chord, press new notes — the first touch of a new gesture replaces the entire latched set and the pattern restarts. Playing additional notes during the same press gesture adds them to the chord.

### Recording

With TRACK ARP on and recording armed, the arp output is what gets recorded into the clip — not the raw pad pitches. The arp fires, the fired notes land in the clip at their clock positions. The raw pads only feed the arp's held buffer.

---

## SEQ ARP

Access: `Shift + pad 97`

SEQ ARP is a per-clip arpeggiator. It works at the end of the effects chain and processes whatever notes flow into it — typically the notes playing back from the active clip. It is scale-aware: if Scale Aware is on in the Global menu, octave transpositions follow the current scale rather than raw semitones.

Parameters are saved per clip and persist across clip and track switches.

### Knobs

| Knob | Name | Default | Range | Description |
|------|------|---------|-------|-------------|
| K1 | Style | Off | Off, Up–RnO | Arpeggio pattern; Off disables SEQ ARP |
| K2 | Rate | 1/16 | 1/32–1bar | How fast steps fire |
| K3 | Octaves | +1 | −4 to +4 | Octave range to span |
| K4 | Gate | 50% | 1–200% | Note hold length relative to rate |
| K5 | Steps | Off | Off / Mute / Step | 8-step velocity pattern |
| K6 | Retrigger | On | Off / On | Whether new notes restart the pattern |

K7 and K8 are unused.

### Basic operation

Set Style to anything other than Off. Sequenced notes in the clip are held as a chord and the arp fires a pattern through them at the chosen Rate. The sequenced gate length determines how long each source note stays in the arp's held set — when a sequenced note's gate ends, it leaves the buffer.

### Retrigger

**On** (default): every new note entering the buffer resets the arp pattern to step 1. Chords and melodies always start fresh at each new event.

**Off**: the arp cycle runs continuously. New notes join the buffer mid-cycle without restarting; the pattern position is shared across all notes.

---

## Parameters in Detail

### Styles

| Value | Name | Behavior |
|-------|------|----------|
| Off | Off | Arp disabled (SEQ ARP only — TRACK ARP uses K1 On/Off) |
| 1 | Up | Low to high, repeating |
| 2 | Dn | High to low, repeating |
| 3 | U/D | Low → high → low, bouncing (end notes play once) |
| 4 | D/U | High → low → high, bouncing |
| 5 | Cnv | Converge: alternates highest / lowest inward |
| 6 | Div | Diverge: alternates from center outward |
| 7 | Ord | Play Order: pitches fire in the order they were pressed |
| 8 | Rnd | Random: uniform random pick each step |
| 9 | RnO | Random Other: random without repeating until all notes have played |

Multi-note chords interact with the style: a 3-note chord in Up mode cycles C → E → G → C → E → G; the same chord in U/D bounces C → E → G → E → C → E → …

### Rates

| Value | Name | Description |
|-------|------|-------------|
| 0 | 1/32 | Very fast — two steps per 1/16 note |
| 1 | 1/16 | Default — one step per 1/16 note |
| 2 | 1/16t | 1/16 triplet |
| 3 | 1/8 | One step per 1/8 note |
| 4 | 1/8t | 1/8 triplet |
| 5 | 1/4 | One step per quarter note |
| 6 | 1/4t | 1/4 triplet |
| 7 | 1/2 | One step per half note |
| 8 | 1/2t | 1/2 triplet |
| 9 | 1bar | One step per bar |

The arp always locks to the global master clock. Steps fire on the next clock boundary after a note is pressed, so the first hit is always in time.

### Octaves

Range: −4 to +4, skipping 0.

**Positive**: the arp ascends through the held notes, then repeats the same notes an octave higher, up to the number of octaves set. A +2 setting with three held notes gives a 6-step cycle: notes at octave 0, then notes at octave +1.

**Negative**: same expansion, but descending. −2 with three notes: notes at octave 0, then at octave −1.

The sign only affects direction. −1 and +1 both produce a single-octave pattern; the difference is whether the transposed octave is above or below.

### Gate

Percentage of the rate interval that the note sounds. 50% (default) means the note occupies half the step duration. 100% holds for the full step. Values above 100% make notes overlap into the next step. Very short gates (5–20%) produce a staccato feel; 150–200% gives legato.

### Steps Mode and the Step Editor

Steps Mode adds a velocity-shaping pattern across 8 repeating slots aligned to the master clock.

| Value | Name | Behavior |
|-------|------|----------|
| Off | Off | Every step fires at the incoming note velocity |
| Mute | Mute | Steps set to Off rest silently; cycle position still advances |
| Step | Step | Steps set to Off are skipped entirely; cycle does not advance on skipped steps |

**Editing steps**: with Steps Mode set to Mute or Step, touch and hold the Steps knob (K5 on SEQ ARP, K6 on TRACK ARP). The 8×4 pad grid becomes a velocity editor. The 8 columns are the 8 step slots; the 4 rows are velocity levels (bottom = quietest, top = full velocity). Tap a row in a column to set that level. Tap the bottom row of a column that is already at the bottom to toggle the step off (shown as no lit row). Touch any other knob or release the Steps knob to return to normal pad mode.

The 8 steps tile continuously from a fixed clock anchor regardless of how many notes are held or how fast the arp runs. A long rate (1/4) with 8 steps produces a 2-bar accent pattern; a short rate (1/32) with 8 steps produces a very tight 8/32-note pattern.

---

## Using Both Arps Together

With both arps on, TRACK ARP fires first — its output notes enter the chain and eventually reach SEQ ARP, which arpeggiates them again.

Example: hold three pads with TRACK ARP set to Up, 1/8. TRACK ARP cycles C → E → G at 1/8 intervals. Those notes land in SEQ ARP's held buffer (briefly, for the gate duration). With SEQ ARP set to Up, 1/16, each individual note from TRACK ARP gets its own 1/16 arpeggio through SEQ ARP — resulting in a much denser pattern from a single chord shape.

Combining different styles and rates creates complex rhythmic textures from minimal input. Mismatched rates are particularly effective.

---

## Bypass

- **TRACK ARP**: bypassed automatically on drum tracks. Disable via K1 On/Off to bypass on melodic tracks.
- **SEQ ARP**: set Style to Off to disable. Bypassed automatically on drum tracks.

Neither arp affects clips on drum tracks regardless of settings.

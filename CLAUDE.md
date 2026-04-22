# SEQ8

SEQ8 is a Schwung **tool module** (`component_type: "tool"`) for Ableton Move — a standalone 8-track MIDI sequencer. No audio output. Written in C (DSP) + JavaScript (UI). Appears in the **Tools menu**; `component_type: "tool"` enables background running via tool reconnect.

## Current build phase

**Phase 5 — 8 tracks, 256 steps, arpeggiator, Track View.** All subphases complete through 5q:

5a live pad input · 5b poll throttling · 5c clip length · 5d Track View banks + beat stretch + clock shift + octave shift · 5e per-step gate time · 5f polyphonic step notes (4 per step) · 5g melodic step entry UI · 5h tap vs hold step buttons · 5i phantom notes + sparse state fix (state v=2) · 5j Delete key combos · 5k atomic step/clip clear DSP params · 5l playback head indicator + chord-to-step input · 5m Session Overview overlay · 5n real-time recording + count-in · 5o recording fixes (toggle, count-in redesign, silent notes race fix) · 5q global menu via platform framework + jog click CC 3 fix + BPM editable (real-time, linear jog) + count-in duration fix

Phases 0–4 complete: scaffold → single track → 4-track → NoteTwist/play effects → clip model/Session View/background running.

## What's Built

**Transport**: Play/Stop/Panic (Shift+Play = panic). BPM is SEQ8-owned: read from `g_host->get_bpm()` once at init as a starting default, then controlled via the global menu. DSP `set_param("bpm")` updates `tick_delta` and `cached_bpm` for all tracks. No ongoing polling — BPM does not auto-follow Move after init.

**8 tracks, 16 clips, 256 steps per clip**: All tracks play simultaneously. Clip launch per-track or as scenes.

**Track View** (default): 16 step buttons = current page of active clip. Pads = live notes (isomorphic 4ths diatonic). Left/Right pages. Shift + bottom pad row = track select. Step buttons ≥ clip length light White (out-of-bounds). Playback head step always White.

**Session View** (tap CC 50): 4×8 pad grid = clips for visible scene group. Shift+step = launch scene. Up/Down (CC 54/55) scrolls scene groups.

**Session Overview** (hold CC 50 ≥200ms): Graphical 8×16 grid on OLED (8 cols=tracks, 16 rows=scenes, 16×4px cells). Release to exit. All input swallowed while held.

**Live pad input**: `shadow_send_midi_to_dsp` from JS. Velocity floor 80. Per-track octave shift (Up/Down in Track View, ±4 oct, "Octave: N" overlay for 1s).

**Melodic step entry**: Hold step button → step edit mode; tap pads to toggle note assignment (`tN_cC_step_S_toggle`). Assigned pads White. Display: track/clip/step header + note names. Release to exit. Up/Down shifts octave while held. Shift combos blocked during hold. Pad taps preview note. Tap step (< 200ms) toggles on/off preserving notes; multi-step tap simultaneous.

**Chord to step**: If pads held (`liveActiveNotes.size > 0`) when step button pressed, all held pitches assigned additively and step activated — fires immediately on press, no hold ambiguity.

**Real-time recording**: Record (CC 86) while stopped → 1-bar JS count-in (step buttons flash Red, transport silent) → transport + recording start simultaneously. Record while playing → arm immediately. Overdub-only via `tN_cC_step_S_add`. Press Record again to disarm. Stop/panic also disarms. Play LED green, Record LED red while armed.

**Delete combos**: Delete (CC 119) held modifier. Delete + step = clear step. Delete + track button = clear clip at that scene position on active track. Delete + clip pad (Session View) = clear clip. Delete in Session View swallows step/track buttons.

**Track View parameter banks**: Shift + top-row pad (92–98) selects bank. See Parameter Bank Reference. Display priority: count-in overlay → COMPRESS LIMIT → octave overlay → step edit → knob touched → jog/bank-select → normal header (+ ` REC` while recording).

**Beat Stretch** (TIMING K1, sens=16, lock): CW doubles, CCW halves clip length. Compress blocked on step collision; "COMPRESS LIMIT" overlay ~1.5s.

**Clock Shift** (TIMING K2, sens=8): Rotates all steps one position CW/CCW.

**Global menu** (Shift + CC 50 in Track View): Platform framework (`drawHierarchicalMenu`). Jog rotate = navigate; **jog click = CC 3** (0xB0 d1=3, NOT Note 3) = edit mode via `handleMenuInput`; Back = exit. Items: BPM (editable 40–250, real-time jog, linear ±1/detent — acceleration bypassed), Key (wired), Scale (wired), Swing Amt/Res/Input Vel/Inp Quant (stub, session-local). BPM jog intercept: CC 14 handled directly in `onMidiMessageInternal` when BPM selected+editing, writing to `globalMenuState.editValue` and sending `set_param("bpm")` each tick.

**Play effects chain**: Note FX (octave, offset, gate, velocity), Harmonize (unison, octaver, 2×interval), MIDI Delay (time, level, repeats, feedback). Exposed via parameter banks.

**Background running**: Shift+Back hides SEQ8. Re-entry from Tools menu reconnects instantly. Cold boot recovery via `seq8-state.json`.

**State persistence**: Written to `/data/UserData/schwung/seq8-state.json` on step change, transport, launch, destroy.

## Upcoming tasks

1. **Arpeggiator** — Port from NoteTwist. New DSP build required.
2. **Mute/Solo** — Per-track, likely Shift + track-select pads.
3. **Drum + Chromatic pad modes** — `pad_mode` wired in TRACK K3; DSP/JS logic not yet done.
4. **Global menu stubs** — Wire Swing/Vel/Quant to DSP when those features land.

## Parameter Bank Reference

Banks via **Shift + top-row pad** (92–99). Same bank again → return to TRACK (0). Pad 99 reserved.

| Bank | Pad | K1 | K2 | K3 | K4 | K5 | K6 | K7 | K8 |
|------|-----|----|----|----|----|----|----|----|----|
| 0 TRACK | 92 | Ch (stub) | Rte (route, track) | Mode (pad_mode, track) | Res (stub) | Len (clip_length, track, sens=4) | — | — | — |
| 1 TIMING | 93 | Stch (beat_stretch, action, sens=16, lock) | Shft (clock_shift, action, sens=8) | — | — | — | — | — | — |
| 2 NOTE FX | 94 | Oct (noteFX_octave, track, sens=6) | Ofs (noteFX_offset, track, sens=4) | Gate (noteFX_gate, track, sens=2) | Vel (noteFX_velocity, track) | — | — | — | — |
| 3 HARMZ | 95 | Unis (harm_unison, track, sens=4) | Oct (harm_octaver, track, sens=4) | Hrm1 (harm_interval1, track, sens=4) | Hrm2 (harm_interval2, track, sens=4) | — | — | — | — |
| 4 SEQ ARP | 96 | On (stub) | Type (stub) | Sort (stub) | Hold (stub) | OctR (stub) | Spd (stub) | — | — |
| 5 MIDI DLY | 97 | Dly (delay_time, track) | Lvl (delay_level, track) | Rep (delay_repeats, track) | Vfb (delay_vel_fb, track) | Pfb (delay_pitch_fb, track) | Gfb (delay_gate_fb, track) | Clk (delay_clock_fb, track) | Rnd (delay_pitch_random, track) |
| 6 LIVE ARP | 98 | On (stub) | Type (stub) | Sort (stub) | Hold (stub) | OctR (stub) | Spd (stub) | — | — |
| 7 RESERVED | 99 | — | — | — | — | — | — | — | — |

`track` = key as `tN_<dspKey>`; `action` = one-shot DSP trigger; `stub` = JS-only. Default sens=1; explicit `sens=N` where listed. Beat Stretch: lock = fires once per touch.

## DSP Parameter Key Reference

All `tN_` keys: N = 0..7 (track index).

| Key | Dir | Format | Notes |
|-----|-----|--------|-------|
| `tN_beat_stretch` | set | `"1"` or `"-1"` | Expand/compress active clip. |
| `tN_beat_stretch_factor` | get | `"1x"`, `"x2"`, `"/2"`, … | Current stretch exponent. |
| `tN_beat_stretch_blocked` | get | `"0"` or `"1"` | 1 if last compress was blocked. |
| `tN_clock_shift` | set | `"1"` or `"-1"` | Rotate all steps right/left by one. |
| `tN_clock_shift_pos` | get | integer string | Current shift position. |
| `tN_clip_length` | set/get | `"1"`..`"256"` | Active clip length. Saves state. |
| `tN_cC_step_S_notes` | get | space-sep MIDI note numbers or `""` | Notes on step S. |
| `tN_cC_step_S_toggle` | set | MIDI note string | Toggle note in/out of step. Saves state. |
| `tN_cC_step_S_clear` | set | any | Atomic zero + deactivate step. Saves state. |
| `tN_cC_step_S_add` | set | MIDI note string | Add-only overdub. Defers save while `recording=1`. |
| `tN_cC_clear` | set | any | Atomic wipe all steps in clip C. Saves state. |
| `tN_recording` | set/get | `"0"` or `"1"` | 1 = recording (defers save). 0 = disarm + flush. DSP clears on stop/panic. |

Other keys: `tN_active_clip`, `tN_current_step`, `tN_queued_clip`, `tN_cC_steps`, `tN_cC_length`, `tN_cC_step_S`, `tN_launch_clip`, `launch_scene`, `transport`, `playing`, `state_snapshot`, `tN_route`, `tN_pad_mode`, `tN_pad_octave`, `key`, `scale`, `bpm` (set/get — integer string, 40–250; updates `tick_delta` + all `cached_bpm`), `noteFX_octave/offset/gate/velocity`, `harm_unison/octaver/interval1/interval2`, `delay_time/level/repeats/vel_fb/pitch_fb/gate_fb/clock_fb/pitch_random`.

## DSP Struct Reference

```c
typedef struct {
    uint8_t  steps[SEQ_STEPS];            /* 256; invariant: steps[s]==1 iff step_note_count[s]>=1 */
    uint8_t  step_notes[SEQ_STEPS][4];    /* up to 4 notes per step */
    uint8_t  step_note_count[SEQ_STEPS];  /* 0..4; init=0 */
    uint8_t  step_vel[SEQ_STEPS];
    uint8_t  step_gate[SEQ_STEPS];        /* gate ticks; note-off fires here */
    uint8_t  step_gate_orig[SEQ_STEPS];   /* original before noteFX_gate scaling */
    uint16_t length;                      /* 1..256 */
    uint8_t  active;
    uint16_t clock_shift_pos;
    int8_t   stretch_exp;                 /* 0=1x, +1=x2, -1=/2. Not persisted. */
} clip_t;

typedef struct {
    /* ... */
    uint8_t pending_notes[4];    /* notes at last note-on, for note-off matching */
    uint8_t pending_note_count;
    uint8_t stretch_blocked;     /* 1 = last compress blocked by step collision */
    uint8_t recording;           /* 1 = overdub active; cleared on stop/panic */
} seq8_track_t;
```

Beat Stretch compress: dry-run with `uint8_t seen[SEQ_STEPS]`. Any two active steps mapping to the same `i/2` → `stretch_blocked=1`, abort. Atomic — no partial rewrites.

## Known limitations

- **Do not load SEQ8 from within SEQ8** — causes LED corruption (Tools menu sets `FLAG_JUMP_TO_TOOLS` 0x80 via ui_flags; no MIDI event fires so it can't be intercepted). Workaround: Shift+Back first, then re-enter from Tools menu.
- **Live pad latency floor: ~3–7ms** — structural. JS ticks at ~196Hz.
- **All 8 tracks route to the same Schwung chain** — no multi-chain path. Exhaustively tested.
- **`step_vel`, `step_gate`/`step_gate_orig` not persisted** — reset to defaults on cold boot.
- **State file v=2** — wrong/missing version → file deleted, start clean. Bump `v` on format changes. Sparse step-notes key format: `"tNcC_sn":"S:n1,n2;S2:n3;"` per clip (steps with count=0 omitted).
- **Clip lengths not persisted** — `tN_clip_length` handlers don't call `seq8_save_state`. Known gap.
- **`stretch_exp` not persisted** — resets to 0 on cold boot or JS re-entry.
- **MIDI Delay repeats: no upper clamp** — `delay_repeats` accepts 0–64; high values create long chains. TODO: clamp to 8.

## Hardware reference

**Pad rows** (bottom-to-top): 68–75 · 76–83 · 84–91 · 92–99

**Encoders**: `MoveMainKnob = 14` (CC) | `MoveMainButton = 3` (**CC**, 0xB0 d1=3 — jog click, NOT note) | `MoveMainTouch = 9` (note — jog capacitive touch)

**Step buttons**: notes 16–31, `0x90` note-on (d2 > 0 = press, d2 = 0 = release).

**LED palette**: Fixed 128-entry index. Dim pairs: Red(127)→DeepRed(65) · Blue(125)→DarkBlue(95) · VividYellow(7)→Mustard(29) · Green(126)→DeepGreen(32).

## MIDI routing

**DSP**: `host->midi_send_internal` → active Schwung chain (MIDI channel does not route to different chains). `host->midi_send_external` → USB-A via SPI — **never call from render path** (blocking, can deadlock).

**JS**: `shadow_send_midi_to_dsp([s,d1,d2])` → chain (live pads only). `move_midi_internal_send` → hardware LEDs/buttons. `move_midi_inject_to_move` → simulates pad 68–99. `move_midi_external_send` → USB-A (deferred, safe from tick).

## Key constraints

- GLIBC ≤ 2.35. No complex static initializers.
- **Schwung core on device: v0.9.7** (Apr 14 2026; no version file — confirmed from binary timestamps).
- **`g_host->get_clock_status` is NULL in v0.9.7** — DSP cannot poll Move transport state. Background transport follow not possible at DSP level; needs host update. Ableton Link also not viable (port conflict with Move's native Link instance).
- **`g_host->get_bpm` is non-null** — used once at init only. Returns `sampler_get_bpm()` fallback chain (live MIDI clock → set tempo → settings → 120). Does not reliably track BPM changes made in Move's UI while stopped, so SEQ8 owns its own BPM after init.

## Build / deploy / debug

```sh
nm -D dist/seq8/dsp.so | grep GLIBC   # run after every build
./scripts/build.sh && ./scripts/install.sh
ssh ableton@move.local "tail -f /data/UserData/schwung/seq8.log"
```

`~/schwung-notetwist` — NoteTwist reference (port source, key file `src/notetwist.c`). `SEQ8_SPEC.md` — full design spec; consult specific sections as needed, do not read in full at session start.

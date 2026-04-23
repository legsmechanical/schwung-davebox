# SEQ8

**Working rule:** Before acting on any assumed or suggested cause/fix, read the relevant code and verify the assumption is correct first.

SEQ8 is a Schwung **tool module** (`component_type: "tool"`) for Ableton Move — a standalone 8-track MIDI sequencer. No audio output. Written in C (DSP) + JavaScript (UI). Appears in the **Tools menu**; `component_type: "tool"` enables background running via tool reconnect.

## Current build phase

**Phase 5 — 8 tracks, 256 steps, arpeggiator, Track View.** All subphases complete through 5r:

5a live pad input · 5b poll throttling · 5c clip length · 5d Track View banks + beat stretch + clock shift + octave shift · 5e per-step gate time · 5f polyphonic step notes (4 per step) · 5g melodic step entry UI · 5h tap vs hold step buttons · 5i phantom notes + sparse state fix (state v=2) · 5j Delete key combos · 5k atomic step/clip clear DSP params · 5l playback head indicator + chord-to-step input · 5m Session Overview overlay · 5n real-time recording + count-in · 5o recording fixes (toggle, count-in redesign, silent notes race fix) · 5q global menu via platform framework + jog click CC 3 fix + BPM editable (real-time, linear jog) + count-in duration fix · 5r clip deactivation (stop-at-end) + Session View jog row scroll · 5s clip-launch-rework: 5-state clip model, bar-boundary launch, page-stop, scene queuing, Shift+Play=deactivate_all, Delete+Play=panic, will_relaunch persistence (state v=3) · 5t stopped-transport fixes: effectiveClip helper, LED blink corrections, scene cache + LED dedup, Shift+Play deactivates all clips when stopped · 5u launch quantization: Now/1/16/1/8/1/4/1/2/1-bar, DSP QUANT_STEPS table, pending_page_stop anchored to global_tick%16

Phases 0–4 complete: scaffold → single track → 4-track → NoteTwist/play effects → clip model/Session View/background running.

## What's Built

**Transport**: Play/Stop. Shift+Play: if playing → `deactivate_all` (arms page-stop on all playing clips, cancels queued); if stopped → `panic` (atomically clears will_relaunch + all clip state for all 8 tracks — single DSP command avoids per-track async queue races). Delete+Play = panic (full stop, clear all state). Note: per-track `tN_deactivate` calls are NOT reliable for bulk will_relaunch clearing — DSP processes them one per audio callback and pollDSP restores stale state in between. BPM is SEQ8-owned: read from `g_host->get_bpm()` once at init as a starting default, then controlled via the global menu. DSP `set_param("bpm")` updates `tick_delta` and `cached_bpm` for all tracks. No ongoing polling — BPM does not auto-follow Move after init.

**8 tracks, 16 clips, 256 steps per clip**: All tracks play simultaneously. Clip launch per-track or as scenes.

**Track View** (default): 16 step buttons = current page of active clip. Pads = live notes (isomorphic 4ths diatonic). Left/Right pages. Shift + bottom pad row = track select. Step buttons ≥ clip length light White (out-of-bounds). Playback head step always White.

**Session View** (tap CC 50): 4×8 pad grid = clips for visible scene group. Jog rotates one row at a time (clamped 0–12). Up/Down (CC 54/55) jump by group (4 rows). Shift+step = launch scene. Side buttons (CC 40–43) = launch scene. White scene indicator: when playing, all playing clips on that row; when stopped, all will_relaunch/queued clips map to that row via `effectiveClip(t)`.

**Clip state model** (5 states): Empty · Inactive-with-data · Will-relaunch (was playing when transport stopped; auto-relaunches on next play) · Queued (waiting for bar boundary) · Playing. Transitions:
- Launch → if playing: legato (inherits position mod new length); if stopped: Queued.
- Page-stop (`tN_stop_at_end`): arms `pending_page_stop`; clip stops at next 16-step boundary (step 0 for short clips). Queued clip can fire simultaneously at that boundary.
- Quantized launch: `queued_clip >= 0 && !pending_page_stop && global_tick % QUANT_STEPS[launch_quant] == 0` at tick_in_step=0. At transport play (global_tick=0), queued clips fire immediately (any quant). Now mode fires immediately in set_param (no queuing).
- Transport stop: playing clips set `will_relaunch=1`; queued/record_armed/recording cleared. `will_relaunch` is persisted.
- Transport play: `will_relaunch` clips become playing immediately.
- Deactivate (`tN_deactivate`): clears all clip state (clip_playing, will_relaunch, queued_clip, pending_page_stop, record_armed).
- `deactivate_all` (transport command): arms page-stop for all playing clips, cancels queued.

**Clip deactivation** (side buttons CC 40–43 in Track View): playing+active → stop-at-end; playing+active+pending_page_stop → cancel (re-launch); will_relaunch+active → deactivate; queued_clip===clipIdx → deactivate; else → launch. Session View side buttons always launch scene. Session View clip pads: same logic as Track View side buttons for the active track.

**Session Overview** (hold CC 50 ≥200ms): Graphical 8×16 grid on OLED (8 cols=tracks, 16 rows=scenes, 16×4px cells). Release to exit. All input swallowed while held.

**Live pad input**: `shadow_send_midi_to_dsp` from JS. Velocity floor 80. Per-track octave shift (Up/Down in Track View, ±4 oct, "Octave: N" overlay for 1s).

**Melodic step entry**: Hold step button → step edit mode; tap pads to toggle note assignment (`tN_cC_step_S_toggle`). Assigned pads White. Display: track/clip/step header + note names. Release to exit. Up/Down shifts octave while held. Shift combos blocked during hold. Pad taps preview note. Tap step (< 200ms) toggles on/off preserving notes; multi-step tap simultaneous.

**Chord to step**: If pads held (`liveActiveNotes.size > 0`) when step button pressed, all held pitches assigned additively and step activated — fires immediately on press, no hold ambiguity.

**Real-time recording**: Record (CC 86) while stopped → 1-bar JS count-in (step buttons flash Red, transport silent) → transport + recording start simultaneously. Record while playing → arm immediately. Overdub-only via `tN_cC_step_S_add`. Press Record again to disarm. Stop/panic also disarms. Play LED green, Record LED red while armed.

**Delete combos**: Delete (CC 119) held modifier. Delete + step = clear step. Delete + track button = clear clip at that scene position on active track. Delete + clip pad (Session View) = clear clip. Delete in Session View swallows step/track buttons.

**Track View parameter banks**: Shift + top-row pad (92–98) selects bank. See Parameter Bank Reference. Display priority: count-in overlay → COMPRESS LIMIT → octave overlay → step edit → knob touched → jog/bank-select → normal header (+ ` REC` while recording).

**Beat Stretch** (TIMING K1, sens=16, lock): CW doubles, CCW halves clip length. Compress blocked on step collision; "COMPRESS LIMIT" overlay ~1.5s.

**Clock Shift** (TIMING K2, sens=8): Rotates all steps one position CW/CCW.

**Global menu** (Shift + CC 50, any view): Platform framework (`drawHierarchicalMenu`). Jog rotate = navigate; **jog click = CC 3** (0xB0 d1=3, NOT Note 3) = edit mode via `handleMenuInput`; Back = exit. Items: BPM (editable 40–250, real-time jog, linear ±1/detent — acceleration bypassed), Key (wired), Scale (wired), **Launch** (wired — Now/1/16/1/8/1/4/1/2/1-bar; sends `set_param("launch_quant", "0"–"5")`), Swing Amt/Res/Input Vel/Inp Quant (stub, session-local). BPM jog intercept: CC 14 handled directly in `onMidiMessageInternal` when BPM selected+editing, writing to `globalMenuState.editValue` and sending `set_param("bpm")` each tick.

**Play effects chain**: Note FX (octave, offset, gate, velocity), Harmonize (unison, octaver, 2×interval), MIDI Delay (time, level, repeats, feedback). Exposed via parameter banks.

**Background running**: Shift+Back hides SEQ8. Re-entry from Tools menu reconnects instantly. Cold boot recovery via `seq8-state.json`.

**State persistence**: Written to `/data/UserData/schwung/seq8-state.json` on step change, transport, launch, destroy.

**JS internals**: `effectiveClip(t)` — returns `trackQueuedClip[t]` when `!playing && trackQueuedClip[t] >= 0`, else `trackActiveClip[t]`. Used everywhere in Track View for step display and input so the correct clip shows when stopped with a queued or will_relaunch clip. `cachedSceneAllPlaying[16]`/`cachedSceneAllQueued[16]` — computed once per tick at top of `tick()`. `lastSentNoteLED[128]`/`lastSentButtonLED[128]` — LED dedup cache; `invalidateLEDCache()` resets on view switch, init, reconnect, session overview entry/exit.

## Upcoming tasks

1. **Arpeggiator** — Port from NoteTwist. New DSP build required.
2. **Mute/Solo** — Per-track, likely Shift + track-select pads.
3. **Drum + Chromatic pad modes** — `pad_mode` wired in TRACK K3; DSP/JS logic not yet done.
4. **Global menu stubs** — Wire Swing/Vel/Quant to DSP when those features land.
5. **Per-set state** — Tie SEQ8 state to native Move sets (see below).

## Per-set state (planned)

**Goal**: SEQ8 state should save and load per native Move set, the same way Song Mode does.

**How Schwung exposes per-set state** (researched from `charlesvestal/schwung`):
- `/data/UserData/schwung/active_set.txt` — written by `shadow_ui.js` on every set change. Line 1: UUID, Line 2: set name.
- `/data/UserData/schwung/set_state/<UUID>/` — directory created by Schwung core during set-change handling. Song Mode writes `song_mode.json` here.
- `host_read_file`, `host_write_file`, `host_ensure_dir`, `host_file_exists` — all explicitly exposed to tool module JS context by `loadOvertakeModule()` in `shadow_ui.js`.
- **No push event exists** for set changes. A background tool must poll `active_set.txt` in `tick()` and compare against the last-seen UUID to detect a set switch.

**Why SEQ8 is different from Song Mode**: Song Mode is not background-running — it exits on dismiss, so each launch calls `init()` fresh and reads the UUID once. SEQ8 stays alive while hidden, so it must poll for UUID changes during `tick()`.

**Planned implementation (approach A — DSP path configurable)**:
1. **DSP**: Add `state_path` `set_param` key. When set, subsequent `seq8_save_state()` and `seq8_load_state()` calls use that path instead of the hardcoded `SEQ8_STATE_PATH`. Keep `SEQ8_STATE_PATH` as the default/fallback.
2. **JS init**: Read `active_set.txt`, extract UUID. If UUID found, call `set_param("state_path", "/data/UserData/schwung/set_state/<UUID>/seq8-state.json")` before the existing state load. Ensure directory exists via `host_ensure_dir`.
3. **JS tick polling**: Every ~300 ticks (~1.5s at 196Hz), re-read `active_set.txt` and compare UUID. On change: (a) send `set_param("transport", "stop")` if needed, (b) update `state_path` to old UUID path and trigger a save, (c) update `state_path` to new UUID path and trigger a load.
4. **Target file path**: `/data/UserData/schwung/set_state/<UUID>/seq8-state.json`
5. **State file version**: bump `v` when implementing (currently v=3).

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
| `tN_stop_at_end` | set | any | Arm page-stop: clip stops at next 16-step boundary. Sets `pending_page_stop=1`. |
| `tN_deactivate` | set | any | Immediately clear all clip state: clip_playing, will_relaunch, queued_clip, pending_page_stop, record_armed. |
| `tN_cC_step_S_notes` | get | space-sep MIDI note numbers or `""` | Notes on step S. |
| `tN_cC_step_S_toggle` | set | MIDI note string | Toggle note in/out of step. Saves state. |
| `tN_cC_step_S_clear` | set | any | Atomic zero + deactivate step. Saves state. |
| `tN_cC_step_S_add` | set | MIDI note string | Add-only overdub. Defers save while `recording=1`. |
| `tN_cC_clear` | set | any | Atomic wipe all steps in clip C. Saves state. |
| `tN_recording` | set/get | `"0"` or `"1"` | 1 = recording (defers save). 0 = disarm + flush. DSP clears on stop/panic. |

Other keys: `tN_active_clip`, `tN_current_step`, `tN_queued_clip`, `tN_cC_steps`, `tN_cC_length`, `tN_cC_step_S`, `tN_launch_clip`, `launch_scene`, `transport` (set: `"play"`, `"stop"`, `"panic"`, `"deactivate_all"`), `playing`, `state_snapshot`, `tN_route`, `tN_pad_mode`, `tN_pad_octave`, `key`, `scale`, `bpm` (set/get — integer string, 40–250; updates `tick_delta` + all `cached_bpm`), `noteFX_octave/offset/gate/velocity`, `harm_unison/octaver/interval1/interval2`, `delay_time/level/repeats/vel_fb/pitch_fb/gate_fb/clock_fb/pitch_random`.

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
    uint8_t pending_notes[4];      /* notes at last note-on, for note-off matching */
    uint8_t pending_note_count;
    uint8_t stretch_blocked;       /* 1 = last compress blocked by step collision */
    uint8_t recording;             /* 1 = overdub active; cleared on stop/panic */
    uint8_t clip_playing;          /* 1 = clip actively sequencing */
    uint8_t will_relaunch;         /* 1 = was playing when transport stopped; relaunch on next play. Persisted. */
    uint8_t pending_page_stop;     /* 1 = stop at next 16-step boundary */
    uint8_t record_armed;          /* 1 = enable recording=1 when queued clip launches */
    int8_t  queued_clip;           /* >=0 = clip waiting for bar boundary launch; -1 = none */
} seq8_track_t;

typedef struct {
    /* ... */
    uint32_t global_tick;          /* step counter; bar boundary = global_tick % 16 == 0; reset on transport play */
} seq8_instance_t;
```

Beat Stretch compress: dry-run with `uint8_t seen[SEQ_STEPS]`. Any two active steps mapping to the same `i/2` → `stretch_blocked=1`, abort. Atomic — no partial rewrites.

**Render logic** (per-tick at `tick_in_step==0`):
1. Bar-boundary launch: `queued_clip >= 0 && !pending_page_stop && global_tick % 16 == 0` → silence old note, set active_clip, current_step=0, clip_playing=1, fire record_armed.
2. Page-stop: `pending_page_stop && current_step % 16 == 0` → pending_page_stop=0, clip_playing=0, silence note. If queued_clip set, launch simultaneously (same as bar-boundary).
3. Note-on: `clip_playing && steps[current_step]` → send MIDI, note_active=1.

`global_tick` increments after all tracks advance `current_step` (at end of each step). Resets to 0 on transport play and count-in fire. At global_tick=0, bar-boundary condition is always true → queued clips fire immediately on play.

**state_snapshot** (52 values): `playing cs0..7 ac0..7 qc0..7 count_in cp0..7 wr0..7 ps0..7 flash_eighth flash_sixteenth`. `flash_sixteenth = global_tick % 2`; `flash_eighth = (global_tick/2) % 2`.

## Known limitations

- **Transport stop saves will_relaunch; panic does not** — stopping transport transitions playing clips to `will_relaunch=1` (persisted); they auto-relaunch on next play. Panic clears all state including will_relaunch.
- **Do not load SEQ8 from within SEQ8** — causes LED corruption (Tools menu sets `FLAG_JUMP_TO_TOOLS` 0x80 via ui_flags; no MIDI event fires so it can't be intercepted). Workaround: Shift+Back first, then re-enter from Tools menu.
- **Live pad latency floor: ~3–7ms** — structural. JS ticks at ~196Hz.
- **All 8 tracks route to the same Schwung chain** — no multi-chain path. Exhaustively tested.
- **`step_vel`, `step_gate`/`step_gate_orig` not persisted** — reset to defaults on cold boot.
- **State file v=3** — wrong/missing version → file deleted, start clean. Bump `v` on format changes. Sparse step-notes key format: `"tNcC_sn":"S:n1,n2;S2:n3;"` per clip (steps with count=0 omitted). Adds `t%d_wr` (will_relaunch) per track.
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

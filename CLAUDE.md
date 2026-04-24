# SEQ8

**Working rule:** Before acting on any assumed or suggested cause/fix, read the relevant code and verify the assumption is correct first.

## Session workflow

- **Validate before acting** — read or grep the actual code first. Never act on assumptions.
- **Commit after each logical change** — work directly on master, one commit per change.
- **Deploy and verify on device before reporting done** — always build+install and confirm on Move.
- **Reboot after every deploy** — Shift+Back does NOT reload JS from disk.
- **JS-only deploy**: `cp ui.js dist/seq8/ui.js && ./scripts/install.sh` then reboot. `build.sh` required for DSP changes (also copies JS, so always safe to run).
- **CLAUDE.md**: update at session end or after a major phase — not after routine task work.

SEQ8 is a Schwung **tool module** (`component_type: "tool"`) for Ableton Move — standalone 8-track MIDI sequencer. No audio. C (DSP) + JavaScript (UI). Background running via tool reconnect.

## Current build phase

**Phase 5 — 8 tracks, 256 steps, arpeggiator, Track View.** Current branch: `unquantized-recording`. Phase H in progress (2 items remaining).

5a live pad input · 5b poll throttling · 5c clip length · 5d Track View banks + beat stretch + clock shift + octave shift · 5e per-step gate time · 5f polyphonic step notes (4 per step) · 5g melodic step entry UI · 5h tap vs hold step buttons · 5i phantom notes + sparse state fix (state v=2) · 5j Delete key combos · 5k atomic step/clip clear DSP params · 5l playback head indicator + chord-to-step input · 5m Session Overview overlay · 5n real-time recording + count-in · 5o recording fixes (toggle, count-in redesign, silent notes race fix) · 5q global menu via platform framework + jog click CC 3 fix + BPM editable (real-time, linear jog) + count-in duration fix · 5r clip deactivation (stop-at-end) + Session View jog row scroll · 5s clip-launch-rework: 5-state clip model, bar-boundary launch, page-stop, scene queuing, Shift+Play=deactivate_all, Delete+Play=panic, will_relaunch persistence (state v=3) · 5t stopped-transport fixes: effectiveClip helper, LED blink corrections, scene cache + LED dedup, Shift+Play deactivates all clips when stopped · 5u launch quantization: Now/1/16/1/8/1/4/1/2/1-bar, DSP QUANT_STEPS table, pending_page_stop anchored to global_tick%16 · 5v per-set state: state saved/loaded per Move set UUID, DSP `state_load` takes UUID from JS, `state_uuid`/`instance_nonce` get_params, fresh launch defaults to Session View · 5w active bank global: single integer replaces per-track array, bank selection persists across track switches · 5x live recording follows track switch: switching active track mid-recording hands off DSP recording flag to new track immediately · 5y mute/solo + snapshots: per-track mute/solo with effective_mute gating, Mute button LED, OLED track-row indicators, 16-slot DSP-side snapshots, state v=4 · 5z-a 14-scale selector in global menu; `computePadNoteMap` uses `intervals.length` · 5z-b scale-aware play effects: global Scale Aware toggle in menu, DSP `scale_transpose()`, affects Note FX Offset + Harmonize intervals + MIDI Delay pitch feedback; drum tracks bypass · 5z-c full parameter persistence audit: all play effect banks, pad_mode, stretch_exp, clock_shift_pos, key/scale/launch_quant/bpm/scale_aware persisted; state v=6; all banks synced at init · 5z-d Delete+jog click resets NOTE FX/HARMZ/MIDI DLY banks via single `tN_pfx_reset` DSP command (coalescing-safe) · 5z-e clip copy (CC 60, Session View): clip-to-clip and scene-row-to-row; Delete+scene row clear · unquantized-recording Phase A: nondestructive noteFX_gate, uint16 step_gate, step_tick_offset field · Phase B: multi-step gate countdown · Phase C/D: positive/negative tick_offset deferred/lookahead note-on · Phase E: TIMING K3 quantize knob (0–100%, per-track, render-time, `effective_tick_offset()`) · Phase F: step_vel/step_gate/step_tick_offset persisted sparse (state v=7) · Phase G: beat stretch scales tick_offset proportionally (×2/÷2, clamped ±23) · Phase H (partial): step edit param overlay — K1–K5 knobs (Oct/Pitch/Dur/Vel/Nudge); 5-column OLED grid; instant activation on press; auto-assign default note on empty step; state v=8 wipes old files; default key=A minor

Phases 0–4 complete: scaffold → single track → 4-track → NoteTwist/play effects → clip model/Session View/background running.

## What's Built

**Transport**: Play/Stop. Shift+Play: playing → `deactivate_all` (page-stop all playing clips, cancel queued); stopped → `panic` (single DSP command atomically clears all clip state + will_relaunch for all 8 tracks). Delete+Play = panic. **Do not use per-track `tN_deactivate` for bulk clearing** — DSP processes one per audio callback; pollDSP restores stale state between calls. BPM: read from `g_host->get_bpm()` once at init; thereafter SEQ8-owned via global menu. `set_param("bpm")` updates `tick_delta` + `cached_bpm` for all tracks.

**Views**: Track View (default) — 16 step buttons = active clip page; pads = isomorphic 4ths diatonic; Shift+bottom-row = track select; steps ≥ clip length = White (OOB); playback head = White. Session View (tap CC 50) — 4×8 pad grid = scene clips; jog scrolls 1 row (clamped 0–12); Up/Down CC 54/55 jump by group (4 rows); Shift+step = launch scene; side buttons CC 40–43 = launch scene; White scene indicator follows `effectiveClip(t)`.

**Clip state model** (5 states): Empty · Inactive · Will-relaunch · Queued · Playing.
- Launch: playing → legato (position mod new length); stopped → Queued.
- Page-stop (`tN_stop_at_end`): `pending_page_stop=1`; stops at next 16-step boundary; queued clip can fire simultaneously.
- Quantized launch: `queued_clip >= 0 && !pending_page_stop && global_tick % QUANT_STEPS[launch_quant] == 0` at tick_in_step=0. global_tick=0 → queued fires immediately. Now mode fires immediately in set_param.
- Transport stop: playing → `will_relaunch=1`; queued/record_armed/recording cleared.
- Transport play: will_relaunch → playing immediately.
- `tN_deactivate`: clears clip_playing, will_relaunch, queued_clip, pending_page_stop, record_armed.
- `deactivate_all`: page-stop all playing, cancel queued.

**Clip deactivation** (side buttons CC 40–43, Track View): playing+active → stop-at-end; playing+pending_page_stop → cancel; will_relaunch+active → deactivate; queued===clipIdx → deactivate; else → launch. Session View side buttons always launch scene. Session View clip pads: same logic as Track View side buttons for active track.

**Session Overview** (hold CC 50 ≥200ms): 8×16 OLED grid (8 cols=tracks, 16 rows=scenes, 16×4px cells). All input swallowed while held.

**Step entry / recording**: Tap step (<200ms) = toggle on/off. Hold step → step edit immediately (no delay). Tap pads to toggle notes (`tN_cC_step_S_toggle`); Up/Down shifts octave. Pressing an empty step auto-assigns `lastPlayedNote` (or `defaultStepNote()` — scale root nearest octave 4 — if no pad has been played). Chord-to-step: if pads held when step pressed, all held pitches assigned additively. Real-time recording: CC 86 stopped → 1-bar count-in (steps flash Red) → transport+recording start. CC 86 playing → arm immediately. Overdub-only via `tN_cC_step_S_add`. CC 86 again = disarm. **Note: live recording does not yet capture tick_offset or actual gate duration** — those are stored at defaults.

**Step edit overlay** (held step, Track View): 5-column OLED grid: Oct · Pit (merged note value) · Dur · Vel · Ndg. Touched knob column highlights. K1 Oct: ±octave (sens=12); K2 Pitch: scale-aware chromatic nudge via `scaleNudgeNote()` (sens=6); K3 Dur: ±6 ticks/detent, stored as raw gate ticks; K4 Vel: ±1, range 0–127; K5 Nudge: ±1 tick, range ±23. All edits destructive via `tN_cC_step_S_vel/gate/nudge/set_notes`. Delete+step clears vel/gate/nudge to defaults. **Remaining**: nudge blink at 0 (tactile feedback), multi-note range indicator.

**Delete combos**: CC 119 held. Delete+step = clear step; Delete+track button = clear clip; Delete+clip pad (Session View) = clear clip; Delete+Mute = clear all mute/solo; Delete+jog click (Track View) = reset play effect banks (NOTE FX/HARMZ/MIDI DLY) via `tN_pfx_reset`; Delete+Play = panic. Session View swallows step/track buttons while Delete held.

**Active bank**: Single global `activeBank` — not per-track. Persists across track switches. Shift + top-row pad (92–98) selects; same bank again → TRACK (0). Display priority: count-in → COMPRESS LIMIT → octave → step edit → knob → jog/bank-select → header (+ ` REC`).

**Live recording track switch**: While `recording=1`, switching active track sends `tOLD_recording=0` then `tNEW_recording=1` with a clean note-off on the previous track first.

**Beat Stretch** (TIMING K1, sens=16, lock): CW doubles, CCW halves. Compress blocked on step collision → "COMPRESS LIMIT" overlay ~1.5s. Dry-run with `uint8_t seen[SEQ_STEPS]`; atomic, no partial writes. tick_offset and gate scaled proportionally (×2/÷2, clamped ±23). **Clock Shift** (TIMING K2, sens=8): rotates all steps one position CW/CCW. **Quantize** (TIMING K3, 0–100%, per-track): render-time only — `effective_tick_offset = raw * (100 - quantize) / 100`. Does not modify stored tick_offset. **Octave shift**: Up/Down in Track View, ±4 oct, "Octave: N" overlay 1s.

**Global menu** (Shift + CC 50): `drawHierarchicalMenu`; jog rotate = navigate; jog click = CC 3 (0xB0 d1=3) = edit via `handleMenuInput`; Back = exit. Items: **BPM** (40–250, real-time jog, linear ±1/detent, CC 14 intercepted in `onMidiMessageInternal`), **Key** (wired), **Scale** (wired), **Scale Aware** (on/off, default on), **Launch** (`set_param("launch_quant", "0"–"5")` = Now/1/16/1/8/1/4/1/2/1-bar), **Save+Unload**, Swing Amt/Res/Input Vel/Inp Quant (stub, session-local).

**Play effects chain**: Note FX (octave, offset, gate, velocity) → Harmonize (unison, octaver, 2×interval) → MIDI Delay (time, level, repeats max=16, vel_fb, pitch_fb, gate_fb, clock_fb, pitch_random). Exposed via parameter banks. `tN_pfx_reset` resets all three to init defaults atomically.

**Mute/Solo**: `effective_mute(inst, t)` = `mute[t] || (any_solo && !solo[t])`; gates render-path note-on; calls `silence_muted_tracks()` on change. Track View — Mute (CC 88): toggle mute focused; Shift+Mute: toggle solo focused. Session View — Mute+pad: toggle mute column; Shift+Mute+pad: toggle solo column. Delete+Mute: clear all. Mute LED (Track View only, focused track): blink 1/8 note = muted; solid = soloed; off = neither. OLED row: muted = inverted; soloed = blink at `tickCount/24%2`. **Snapshots** (Session View, Mute held): 16 step buttons — light purple (empty) / bright blue (saved). Shift+Mute+step = save (`snap_save "N m0..m7 s0..s7"`); Mute+step (saved) = recall (`snap_load "N"`); Mute+step (empty) = no-op. `snapshots[16]` JS mirror synced via `syncMuteSoloFromDsp()` at init/set-change/hot-reload.

**Scale definitions**: 14 scales, `SCALE_IVLS[14][8]` + `SCALE_SIZES[14]`. Index matches JS `SCALE_NAMES` exactly: Major(7)·Minor(7)·Dorian(7)·Phrygian(7)·Lydian(7)·Mixolydian(7)·Locrian(7)·Harmonic Minor(7)·Melodic Minor(7)·Pent Major(5)·Pent Minor(5)·Blues(6)·Whole Tone(6)·Diminished(8). `computePadNoteMap` uses `intervals.length`.

**Scale awareness**: Global toggle (menu, default on). When on: noteFX_offset, harm_interval1/2, delay_pitch_fb, delay_pitch_random applied via `scale_transpose(inst, note, deg_offset)` at render time — anchors to the note's own scale degree, then shifts by deg_offset scale degrees. Drum tracks (pad_mode ≠ PAD_MODE_MELODIC_SCALE) always bypass. `deg_to_semitones()` still exists for non-note interval lookups.

**State persistence**: Saved at Shift+Back (`set_param("save")`) and `destroy_instance`. Persists: all step data, clip lengths, will_relaunch, all play effect params per track, global settings (key/scale/bpm/launch_quant/scale_aware), mute/solo state, 16 snapshot slots, step_vel/step_gate/step_tick_offset (sparse, active steps only).

**JS internals**: `effectiveClip(t)` → `trackQueuedClip[t]` if `!playing && queued>=0`, else `trackActiveClip[t]`. `cachedSceneAllPlaying[16]`/`cachedSceneAllQueued[16]` computed once per tick. `lastSentNoteLED[128]`/`lastSentButtonLED[128]` LED dedup cache; `invalidateLEDCache()` on view switch, init, reconnect, overview entry/exit.

## Upcoming tasks

### Completing unquantized-recording branch
1. **Phase H remaining** — nudge blink at 0 (tactile feedback on K5); multi-note range indicator on OLED.
2. **Live recording capture** — capture actual tick_offset (note timing vs. nearest grid step) and actual gate duration (note-on to note-off) during overdub. Wire global menu Input Quantize stub: ON=snap to grid (current behavior), OFF=unquantized capture.
3. **Step copy** (Track View, CC 60) — hold Copy, press source step (blinks white), press dest step → copy all step data (notes, gate, vel, tick_offset). Same clip only. Release Copy before dest = discard.
4. **Real-time scale quantize** — at render time, snap each step note to nearest degree in current key/scale. Non-destructive DSP change in `fire_note_on_step`. Makes global menu Key/Scale changes affect existing sequences.

### After unquantized-recording branch merges
5. **Undo/Redo** — step-level history.
6. **Drum mode** — pad_mode=drum, per-lane MIDI effects. DSP + JS build.
7. **Bank param snapshots** — 16-slot play effect bank snapshots (Session View, after drum mode).
8. **Arpeggiator** — Seq ARP + Live ARP, port from NoteTwist, one DSP phase.
9. **Swing** — wire global menu stub to DSP.
10. **MIDI clock sync** — external clock follow.

## Per-set state (built)

File: `/data/UserData/schwung/set_state/<UUID>/seq8-state.json`. UUID from `active_set.txt` line 1.

- `create_instance`: reads `active_set.txt` → `inst->state_path` → `seq8_load_state`.
- `state_load` set_param: UUID value (36 chars) → DSP constructs path, resets state (no MIDI panic), loads. Empty value → fallback path.
- `state_uuid` get_param: extracts UUID from `inst->state_path`.
- `instance_nonce` get_param: `time(NULL) ^ (ptr >> 3)` — changes on DSP hot-reload.
- JS `init()`: reads UUID, compares with `state_uuid`. Mismatch or missing file → `pendingSetLoad=true` → fires `state_load=UUID` as sole set_param next tick.
- `pendingDspSync`: 5-tick countdown post-`state_load` before `syncClipsFromDsp()`.

**Critical constraints**:
- **Coalescing**: only the LAST `host_module_set_param` per JS tick reaches DSP. `state_load` must be the only param that tick. Any multi-param operation requires a single atomic DSP command.
- **No MIDI panic before state_load** — `send_panic` (8×128 note-offs) floods MIDI buffer, drops subsequent set_params. Reset fields directly.
- **Shift+Back does not reload JS** — `init()` re-runs in same runtime. JS changes need full reboot.

## Parameter Bank Reference

Banks via **Shift + top-row pad** (92–99). Same bank again → return to TRACK (0). Pad 99 reserved.

| Bank | Pad | K1 | K2 | K3 | K4 | K5 | K6 | K7 | K8 |
|------|-----|----|----|----|----|----|----|----|----|
| 0 TRACK | 92 | Ch (stub) | Rte (route, track) | Mode (pad_mode, track) | Res (stub) | Len (clip_length, track, sens=4) | — | — | — |
| 1 TIMING | 93 | Stch (beat_stretch, action, sens=16, lock) | Shft (clock_shift, action, sens=8) | Qnt (quantize, track, 0–100) | — | — | — | — | — |
| 2 NOTE FX | 94 | Oct (noteFX_octave, track, sens=6) | Ofs (noteFX_offset, track, sens=4) | Gate (noteFX_gate, track, sens=2) | Vel (noteFX_velocity, track) | — | — | — | — |
| 3 HARMZ | 95 | Unis (harm_unison, track, sens=4) | Oct (harm_octaver, track, sens=4) | Hrm1 (harm_interval1, track, sens=4) | Hrm2 (harm_interval2, track, sens=4) | — | — | — | — |
| 4 SEQ ARP | 96 | On (stub) | Type (stub) | Sort (stub) | Hold (stub) | OctR (stub) | Spd (stub) | — | — |
| 5 MIDI DLY | 97 | Dly (delay_time, track) | Lvl (delay_level, track) | Rep (delay_repeats, track, max=16) | Vfb (delay_vel_fb, track) | Pfb (delay_pitch_fb, track) | Gfb (delay_gate_fb, track) | Clk (delay_clock_fb, track) | Rnd (delay_pitch_random, track) |
| 6 LIVE ARP | 98 | On (stub) | Type (stub) | Sort (stub) | Hold (stub) | OctR (stub) | Spd (stub) | — | — |
| 7 RESERVED | 99 | — | — | — | — | — | — | — | — |

`track` = key as `tN_<dspKey>`; `action` = one-shot DSP trigger; `stub` = JS-only. Default sens=1. Beat Stretch: lock = fires once per touch.

## DSP Parameter Key Reference

All `tN_` keys: N = 0..7.

| Key | Dir | Format | Notes |
|-----|-----|--------|-------|
| `tN_beat_stretch` | set | `"1"` or `"-1"` | Expand/compress active clip. |
| `tN_beat_stretch_factor` | get | `"1x"`, `"x2"`, `"/2"`, … | Current stretch exponent. |
| `tN_beat_stretch_blocked` | get | `"0"` or `"1"` | 1 if last compress blocked. |
| `tN_clock_shift` | set | `"1"` or `"-1"` | Rotate all steps right/left by one. |
| `tN_clock_shift_pos` | get | integer string | Current shift position. |
| `tN_clip_length` | set/get | `"1"`..`"256"` | Active clip length. Saves state. |
| `tN_stop_at_end` | set | any | Arm page-stop (next 16-step boundary). |
| `tN_deactivate` | set | any | Clear clip_playing, will_relaunch, queued_clip, pending_page_stop, record_armed. |
| `tN_cC_step_S_notes` | get | space-sep note numbers or `""` | Notes on step S of clip C. |
| `tN_cC_step_S_toggle` | set | MIDI note string | Toggle note in/out of step. Saves state. |
| `tN_cC_step_S_clear` | set | any | Atomic zero + deactivate step; resets vel/gate/nudge. Saves state. |
| `tN_cC_step_S_add` | set | MIDI note string | Add-only overdub. Defers save while recording. |
| `tN_cC_step_S_vel` | set/get | `"0"`–`"127"` | Step velocity. No-op if step inactive. Saves state. |
| `tN_cC_step_S_gate` | set/get | `"1"`–`"6144"` | Step gate ticks. No-op if step inactive. Saves state. |
| `tN_cC_step_S_nudge` | set/get | `"-23"`–`"23"` | Step tick offset. No-op if step inactive. Saves state. |
| `tN_cC_step_S_pitch` | set | signed delta string | Shift all notes in step by N semitones. No-op if step inactive. Saves state. |
| `tN_cC_step_S_set_notes` | set | space-sep note numbers | Replace all notes in step. No-op if step inactive. Saves state. |
| `tN_cC_clear` | set | any | Atomic wipe all steps in clip C. Saves state. |
| `tN_recording` | set/get | `"0"` or `"1"` | 1 = overdub active (defers save). 0 = disarm + flush. |
| `tN_pfx_reset` | set | any | Atomically reset NOTE FX + HARMZ + MIDI DLY to init defaults. |

Other keys: `tN_active_clip`, `tN_current_step`, `tN_queued_clip`, `tN_cC_steps`, `tN_cC_length`, `tN_cC_step_S`, `tN_launch_clip`, `launch_scene`, `transport` (set: `"play"`, `"stop"`, `"panic"`, `"deactivate_all"`), `playing`, `state_snapshot`, `tN_route`, `tN_pad_mode`, `tN_pad_octave`, `key`, `scale`, `scale_aware` (set/get `"0"`/`"1"`), `bpm` (set/get integer 40–250), `launch_quant` (set/get `"0"`–`"5"`), `noteFX_octave/offset/gate/velocity`, `harm_unison/octaver/interval1/interval2`, `delay_time/level/repeats/vel_fb/pitch_fb/gate_fb/clock_fb/pitch_random`.

## DSP Struct Reference

```c
typedef struct {
    uint8_t  steps[SEQ_STEPS];            /* 256; invariant: steps[s]==1 iff step_note_count[s]>=1 */
    uint8_t  step_notes[SEQ_STEPS][4];    /* up to 4 notes per step */
    uint8_t  step_note_count[SEQ_STEPS];  /* 0..4 */
    uint8_t  step_vel[SEQ_STEPS];
    uint16_t step_gate[SEQ_STEPS];        /* raw gate ticks; scaled by noteFX_gate at render */
    int8_t   step_tick_offset[SEQ_STEPS]; /* ±23 within-step offset; 0=quantized; clamped, note stays on its step */
    uint16_t length;                      /* 1..256 */
    uint8_t  active;
    uint16_t clock_shift_pos;             /* Persisted. */
    int8_t   stretch_exp;                 /* 0=1x, +1=x2, -1=/2. Persisted. */
} clip_t;

typedef struct {
    uint8_t  pending_notes[4];     /* notes at last note-on, for note-off matching */
    uint8_t  pending_note_count;
    uint16_t pending_gate;         /* effective gate stored at note-on (step_gate * gate_time/100) */
    uint8_t  stretch_blocked;      /* 1 = last compress blocked by step collision */
    uint8_t  recording;            /* 1 = overdub active; cleared on stop/panic */
    uint8_t  clip_playing;
    uint8_t  will_relaunch;        /* relaunch on next play. Persisted. */
    uint8_t  pending_page_stop;    /* stop at next 16-step boundary */
    uint8_t  record_armed;         /* enable recording=1 when queued clip launches */
    int8_t   queued_clip;          /* >=0 = waiting for bar-boundary launch; -1 = none */
} seq8_track_t;

typedef struct {
    uint32_t global_tick;          /* bar boundary = global_tick % 16 == 0; reset on transport play */
    uint8_t  scale_aware;          /* 1 = play effects use scale degrees. Persisted. */
} seq8_instance_t;
```

**Render logic** (per-tick at `tick_in_step==0`):
1. Bar-boundary launch: `queued_clip >= 0 && !pending_page_stop && global_tick % 16 == 0` → set active_clip, current_step=0, clip_playing=1, fire record_armed.
2. Page-stop: `pending_page_stop && current_step % 16 == 0` → clip_playing=0. If queued_clip set, launch simultaneously.
3. Note-on: `clip_playing && steps[current_step]` → MIDI send.

`global_tick` increments after all tracks advance. Resets to 0 on transport play / count-in fire. At global_tick=0, bar-boundary always true.

**state_snapshot** (52 values): `playing cs0..7 ac0..7 qc0..7 count_in cp0..7 wr0..7 ps0..7 flash_eighth flash_sixteenth`. `flash_sixteenth = global_tick%2`; `flash_eighth = (global_tick/2)%2`.

## Recording architecture (JS-side)

Live pad note capture for overdub recording is done in JS (not DSP). The alternatives were investigated:

- **DSP-side (tick-accurate)**: `on_midi` in seq8.c is empty — it receives nothing. `shadow_send_midi_to_dsp` routes MIDI directly to the active Schwung audio chain, bypassing the SEQ8 module's `on_midi` entirely. Achieving DSP-side capture would require intercepting pads before they reach the chain, rerouting audio delivery, or a separate inter-module IPC mechanism — none of which are available in the current Schwung API without a major architectural refactor.
- **JS-side (chosen)**: JS captures `tickCount` at note-on/note-off and maps to step index via polled `trackCurrentStep`. Jitter source: `POLL_INTERVAL = 4` JS ticks (~20ms). Within-step timing for `step_tick_offset` is approximated from `tickCount` delta. Note duration converted via `dsp_ticks = js_ticks * bpm / 122.5`. **Currently only pitch is captured** — tick_offset and gate duration capture during recording are not yet implemented (upcoming task).

To revisit DSP-side capture: check if a future Schwung API version exposes a pre-chain MIDI hook, or whether `on_midi` can be wired to receive pad input through a different signal path.

## Known limitations

- **Transport stop saves will_relaunch; panic does not.**
- **Do not load SEQ8 from within SEQ8** — LED corruption (Tools menu sets `FLAG_JUMP_TO_TOOLS` 0x80; no MIDI event to intercept). Workaround: Shift+Back first.
- **Live pad latency floor: ~3–7ms** — structural. JS ticks ~196Hz.
- **All 8 tracks route to the same Schwung chain.**
- **State file v=8** — wrong/missing version → file deleted, clean start. Sparse step-notes: `"tNcC_sn":"S:n1,n2;S2:n3;"`. Per-clip `t%dc%d_se`/`t%dc%d_cs` (stretch_exp/clock_shift_pos, omitted if zero). Per-clip sparse `t%dc%d_sv` (step_vel ≠ 100), `t%dc%d_sg` (step_gate ≠ 12), `t%dc%d_to` (step_tick_offset ≠ 0); active steps only; format `"S:V;"` (V signed for _to).

## Hardware reference

**Pad rows** (bottom-to-top): 68–75 · 76–83 · 84–91 · 92–99

**Encoders**: `MoveMainKnob = 14` (CC) | `MoveMainButton = 3` (**CC** 0xB0 d1=3 — jog click, NOT note) | `MoveMainTouch = 9` (note)

**Step buttons**: notes 16–31, `0x90` (d2>0 = press, d2=0 = release).

**LED palette**: Fixed 128-entry index. Dim pairs: Red(127)→DeepRed(65) · Blue(125)→DarkBlue(95) · VividYellow(7)→Mustard(29) · Green(126)→DeepGreen(32).

## MIDI routing

**DSP**: `host->midi_send_internal` → Schwung chain. `host->midi_send_external` → USB-A via SPI — **never from render path** (blocking, can deadlock).

**JS**: `shadow_send_midi_to_dsp([s,d1,d2])` → chain (live pads). `move_midi_internal_send` → hardware LEDs/buttons. `move_midi_inject_to_move` → simulates pads 68–99. `move_midi_external_send` → USB-A (deferred, safe from tick).

## Key constraints

- GLIBC ≤ 2.35. No complex static initializers.
- **Schwung core: v0.9.7** (Apr 14 2026; confirmed from binary timestamps).
- **`g_host->get_clock_status` is NULL** — DSP cannot poll transport state. Background transport follow not possible; Ableton Link not viable (port conflict).
- **`g_host->get_bpm` is non-null** — used once at init. Returns `sampler_get_bpm()` chain. Does not track Move BPM changes while stopped.

## Build / deploy / debug

```sh
./scripts/build.sh && ./scripts/install.sh   # DSP change (also copies JS)
cp ui.js dist/seq8/ui.js && ./scripts/install.sh  # JS-only
nm -D dist/seq8/dsp.so | grep GLIBC         # verify after every build
ssh ableton@move.local "tail -f /data/UserData/schwung/seq8.log"
```

`~/schwung-notetwist` — NoteTwist reference (port source, key file `src/notetwist.c`). `SEQ8_SPEC_CC.md` — full design spec; consult specific sections as needed.

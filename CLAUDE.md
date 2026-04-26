# SEQ8

**Working rule:** Before acting on any assumed or suggested cause/fix, read the relevant code and verify the assumption is correct first.

## Session workflow

- **Start of session**: run `~/schwung-docs/update.sh` and report the result. The Schwung docs in `~/schwung-docs/` are the source of truth for all Schwung platform API, module development, and framework behavior. Consult them before making assumptions about platform capabilities or constraints.
- **Validate before acting** — read or grep the actual code first. Never act on assumptions.
- **Commit after each logical change** — work directly on master, one commit per change.
- **Deploy and verify on device before reporting done** — always build+install and confirm on Move.
- **Reboot after every deploy** — Shift+Back does NOT reload JS from disk.
- **JS-only deploy**: `cp ui.js dist/seq8/ui.js && ./scripts/install.sh` then reboot. `build.sh` required for DSP changes (also copies JS, so always safe to run).
- **CLAUDE.md**: update at session end or after a major phase — not after routine task work.

SEQ8 is a Schwung **tool module** (`component_type: "tool"`) for Ableton Move — standalone 8-track MIDI sequencer. No audio. C (DSP) + JavaScript (UI). Background running via tool reconnect.

## Build history (current branch: `unquantized-recording`)

Phases 0–4 complete: scaffold → single track → 4-track → NoteTwist/play effects → clip model/Session View/background running.

**5a–5z-e** (complete): live pads · banks · beat stretch/clock shift/octave · step entry/hold/chord · recording+count-in · clip model (5-state) · session view · launch quantization · per-set state (UUID) · mute/solo/snapshots · 14 scales · scale-aware play effects · full persistence audit (state v=6) · clip copy.

**unquantized-recording A–I**: nondestructive noteFX_gate · uint16 step_gate · deferred/lookahead note-on · quantize knob (render-time) · sparse persistence (v=7) · beat stretch scales offsets · step edit overlay K1–K5 (v=8, default key=A minor) · live recording (tick_offset/gate/vel) · Input Vel + Inp Quant.

**Phase J**: `note_t` + `notes[]` absolute-position model · 8-note polyphony · per-note `note_tick_offset[256][8]` · per-tick notes[] scan in render · `rec_pending[]` + `finalize_pending_notes` for gate capture at disarm · state v=9.

**Phase K**: `step_muted` field — inactive steps preserve notes, suppress MIDI · dark gray step LED (clipSteps=2) · `_steps` 3-value ('0'/'1'/'2') · beat stretch compress second pass for inactive steps · `_vel/_gate/_nudge` guard changed to `step_note_count==0` · state v=11.

**Phase L**: `_reassign` DSP command — moves/merges notes between step slots on hold-release · live step boundary crossing (poll re-reads `_steps` while held) · `stepWasHeld` JS flag (hold threshold clears `stepBtnPressedTick` before release fires — can't use it to detect hold) · deferred `pendingStepsReread` syncs mirror after release · merge: dst pitch takes precedence; active source activates inactive dst.

## What's Built

**Transport**: Play/Stop. Shift+Play: playing → `deactivate_all`; stopped → `panic`. Delete+Play = panic. **Do not use per-track `tN_deactivate` for bulk clearing** — DSP processes one per audio callback; pollDSP restores stale state between calls. BPM owned by SEQ8 after init; `set_param("bpm")` updates `tick_delta` + `cached_bpm`.

**Views**: Track View — 16 step buttons = active clip page; pads = isomorphic 4ths diatonic; Shift+bottom-row = track select; OOB steps = White; playback head = White. Session View (tap CC 50) — 4×8 pad grid; jog scrolls rows; Up/Down CC 54/55 jump 4 rows; Shift+step = launch scene; side buttons CC 40–43 = launch scene.

**Clip state model** (5 states): Empty · Inactive · Will-relaunch · Queued · Playing.
- Launch: playing → legato; stopped → Queued.
- Page-stop (`tN_stop_at_end`): stops at next 16-step boundary; queued clip can launch simultaneously.
- Quantized launch: `queued_clip >= 0 && !pending_page_stop && global_tick % QUANT_STEPS[launch_quant] == 0` at tick_in_step=0.
- Transport stop → `will_relaunch=1`; transport play → will_relaunch fires immediately.
- `tN_deactivate`: clears clip_playing, will_relaunch, queued_clip, pending_page_stop, record_armed.

**Clip deactivation** (side buttons CC 40–43, Track View): playing+active → stop-at-end; playing+pending_page_stop → cancel; will_relaunch → deactivate; queued===clipIdx → deactivate; else → launch. Session View side buttons always launch scene.

**Step entry / recording**: Tap (<200ms) = toggle. Hold = step edit (no delay). Active steps = track colour; inactive-with-notes = dark gray; empty = off. Pads toggle notes (`tN_cC_step_S_toggle`); Up/Down shifts octave. Empty step auto-assigns `lastPlayedNote` or `defaultStepNote()`. Chord-to-step: held pads assigned additively. Recording: CC 86 stopped → 1-bar count-in → transport+record; CC 86 playing → arm immediately; CC 86 again = disarm (held notes get real gates via `finalize_pending_notes`). Live recording: tick_offset via JS stepBoundaryTick+BPM, gate via noteOnTick map, nearest-grid reassignment (offset >12 → next step). Input Quantize ON zeroes offset.

**Step edit overlay** (held step): 5-column OLED: Oct · Pit · Dur · Vel · Ndg. K1 Oct (sens=12) · K2 Pitch scale-aware · K3 Dur ±6 ticks/detent · K4 Vel ±1 · K5 Nudge ±1 tick. Multi-note: lowest note + "+N". Nudge moves all notes in step as unit; crossing ±12 ticks moves display to adjacent step live; `_reassign` commits on hold-release. Nudging into occupied step merges (dst pitch wins; active src activates inactive dst). Delete+step clears to defaults.

**Delete combos**: CC 119 held. Delete+step = clear step · Delete+track button = clear clip · Delete+clip pad (Session) = clear clip · Delete+Mute = clear all mute/solo · Delete+jog click (Track View) = `tN_pfx_reset` · Delete+Play = panic.

**Active bank**: Single global `activeBank`. Shift + top-row pad (92–98); same bank → TRACK (0). Display priority: count-in → COMPRESS LIMIT → octave → step edit → knob → jog/bank-select → header (+` REC`).

**Beat Stretch** (TIMING K1, sens=16, lock): CW doubles, CCW halves. Compress blocked on collision → "COMPRESS LIMIT" ~1.5s. Atomic dry-run. tick_offset + gate scaled ×2/÷2 (clamped ±23). Compress: active steps first, then inactive-with-notes second pass (placed in empty slots, stay inactive). **Clock Shift** (TIMING K2, sens=8): rotates steps CW/CCW. **Quantize** (TIMING K3): render-time `effective_tick_offset = raw * (100-q) / 100`.

**Global menu** (Shift + CC 50): jog navigate, jog click edit, Back exit. Items: BPM (40–250) · Key · Scale · Scale Aware · Launch (Now/1/16/1/8/1/4/1/2/1-bar) · Input Vel (0=Live, 1–127=fixed) · Inp Quant (ON=snap recording) · Save+Unload (stub) · Swing (stub).

**Play effects**: Note FX → Harmonize → MIDI Delay. `tN_pfx_reset` resets all atomically. Scale-aware: noteFX_offset/harm_intervals/delay_pitch via `scale_transpose()` at render time; drum tracks bypass.

**Mute/Solo**: `effective_mute(t)` = `mute[t] || (any_solo && !solo[t])`; gates render note-on. Mute LED (Track View, focused): blink=muted, solid=soloed. OLED row: inverted=muted, blink=soloed. Snapshots (Session View, Mute held): 16 step buttons; Shift+Mute+step = save; Mute+step = recall.

**Scale**: 14 scales, `SCALE_IVLS[14][8]`. `computePadNoteMap` uses `intervals.length`. Scale-aware play effects: `scale_transpose(inst, note, deg_offset)` anchors to note's degree then shifts.

**State persistence**: v=11. Saved at Shift+Back and `destroy_instance`. Note format: `tick:pitch:vel:gate:sm;`. Per-clip stretch_exp/clock_shift_pos if nonzero. `step_muted=1` preserves inactive-step notes through reload.

**JS internals**: `effectiveClip(t)` → queued if stopped+queued else active. `pendingDspSync` (5-tick countdown after state_load). `pendingStepsReread` (2-tick countdown after `_reassign`). `stepWasHeld` flag set at hold threshold, cleared on release/press/cancel — required because `stepBtnPressedTick` is -1 for both tap and hold at release time.

## Upcoming tasks

### Current branch (unquantized-recording)
1. **DSP-side recording** — set_param on pad press; DSP reads `tick_in_step + current_step`, adds note with placeholder gate; note-off param sends gate. Eliminates stepBoundaryTick jitter. See `RECORDING_HANDOFF.md`.
2. **Clip resolution** — per-clip TICKS_PER_STEP (1/32·1/16·1/8·1/4·1/2·1-bar). Stored in `clip_t`. Move Len+Res to CLIP bank.
3. **Step copy** (Track View, CC 60) — hold Copy, source step blinks, press dest → copy notes/gate/vel/offsets. Same clip only.
4. **Off-grid step LED** — dim track colour for steps with any non-zero note_tick_offset.
5. **Scale-aware key/scale changes** — global option to transpose all clip notes on key/scale change.

### After current branch merges
6. **Undo/Redo** — 3 levels.
7. **Drum mode** — per-lane monophonic, per-lane MIDI effects.
8. **State snapshots** — 16 slots, full instance state.
9. **Arpeggiator** — Seq ARP + Live ARP.
10. **Swing** — wire global menu stub to DSP.
11. **MIDI clock sync** — external clock follow.

## Per-set state

File: `/data/UserData/schwung/set_state/<UUID>/seq8-state.json`.

JS `init()` reads UUID, compares with `state_uuid` get_param. Mismatch → `state_load=UUID` as sole set_param next tick → `pendingDspSync=5` → `syncClipsFromDsp()`.

**Critical constraints**:
- **Coalescing**: only the LAST `set_param` per JS tick reaches DSP. Multi-field operations require a single atomic DSP command.
- **No MIDI panic before state_load** — floods MIDI buffer, drops the load param.
- **Shift+Back does not reload JS** — `init()` re-runs in same runtime. Full reboot required for JS changes.

## Parameter Bank Reference

Banks via **Shift + top-row pad** (92–99). Same bank again → TRACK (0).

| Bank | Pad | K1 | K2 | K3 | K4 | K5 | K6 | K7 | K8 |
|------|-----|----|----|----|----|----|----|----|----|
| 0 TRACK | 92 | Ch (stub) | Rte | Mode | Res (stub) | Len (sens=4) | — | — | — |
| 1 TIMING | 93 | Stch (sens=16, lock) | Shft (sens=8) | Qnt (0–100) | — | — | — | — | — |
| 2 NOTE FX | 94 | Oct (sens=6) | Ofs (sens=4) | Gate (sens=2) | Vel | — | — | — | — |
| 3 HARMZ | 95 | Unis (sens=4) | Oct (sens=4) | Hrm1 (sens=4) | Hrm2 (sens=4) | — | — | — | — |
| 4 SEQ ARP | 96 | On | Type | Sort | Hold | OctR | Spd | — | — |
| 5 MIDI DLY | 97 | Dly | Lvl | Rep (max=16) | Vfb | Pfb | Gfb | Clk | Rnd |
| 6 LIVE ARP | 98 | On | Type | Sort | Hold | OctR | Spd | — | — |

All stubs JS-only. Beat Stretch lock = fires once per touch.

## DSP Parameter Key Reference

All `tN_` keys: N = 0..7.

| Key | Dir | Format | Notes |
|-----|-----|--------|-------|
| `tN_beat_stretch` | set | `"1"` or `"-1"` | Expand/compress active clip. |
| `tN_beat_stretch_factor` | get | `"1x"`, `"x2"`, `"/2"`, … | Current stretch exponent. |
| `tN_beat_stretch_blocked` | get | `"0"` or `"1"` | 1 if last compress blocked. |
| `tN_clock_shift` | set | `"1"` or `"-1"` | Rotate all steps right/left by one. |
| `tN_clock_shift_pos` | get | integer string | |
| `tN_clip_length` | set/get | `"1"`..`"256"` | Active clip length. Saves state. |
| `tN_stop_at_end` | set | any | Arm page-stop. |
| `tN_deactivate` | set | any | Clear clip_playing, will_relaunch, queued_clip, pending_page_stop, record_armed. |
| `tN_cC_step_S_notes` | get | space-sep MIDI notes or `""` | |
| `tN_cC_step_S_toggle` | set | `"note [vel]"` | Toggle note. Sets step_vel on first note. Saves state. |
| `tN_cC_step_S_clear` | set | any | Atomic zero + deactivate; resets vel/gate/nudge. Saves state. |
| `tN_cC_step_S_add` | set | `"pitch [offset [vel]]"` | Add-only overdub. Defers save while recording. |
| `tN_cC_step_S_vel` | set/get | `"0"`–`"127"` | No-op if step has no notes. Saves state. |
| `tN_cC_step_S_gate` | set/get | `"1"`–`"6144"` | No-op if step has no notes. Saves state. |
| `tN_cC_step_S_nudge` | set/get | `"-23"`–`"23"` | Moves all notes in step as unit. No-op if step has no notes. Saves state. |
| `tN_cC_step_S_reassign` | set | dest step index | Move/merge notes to dest. Empty dest: simple move. Occupied dest: merge (dst pitch wins; active src activates inactive dst). Always clears src. Saves state. |
| `tN_cC_step_S_pitch` | set | signed delta | Shift all notes by N semitones. No-op if step has no notes. Saves state. |
| `tN_cC_step_S_set_notes` | set | space-sep MIDI notes | Replace all notes. No-op if step has no notes. Saves state. |
| `tN_cC_clear` | set | any | Atomic wipe all steps. Saves state. |
| `tN_recording` | set/get | `"0"` or `"1"` | 1 = overdub (defers save). 0 = disarm + flush. |
| `tN_pfx_reset` | set | any | Atomically reset NOTE FX + HARMZ + MIDI DLY. |

Other keys: `tN_active_clip`, `tN_current_step`, `tN_queued_clip`, `tN_cC_steps` (get: 256-char '0'/'1'/'2', midpoint-based position), `tN_cC_length`, `tN_cC_step_S` (set '0'/'1' = deactivate/activate without touching notes), `tN_launch_clip`, `launch_scene`, `transport` (set: `"play"`, `"stop"`, `"panic"`, `"deactivate_all"`), `playing`, `state_snapshot`, `tN_route`, `tN_pad_mode`, `tN_pad_octave`, `key`, `scale`, `scale_aware`, `bpm`, `launch_quant`, `input_vel`, `inp_quant`, noteFX/harm/delay params.

## DSP Struct Reference

```c
typedef struct {
    uint32_t tick;               /* absolute clip tick 0..clip_len*TPS-1 */
    uint16_t gate;
    uint8_t  pitch, vel, active;
    uint8_t  suppress_until_wrap; /* skip until clip wraps (recording suppressor) */
    uint8_t  step_muted;          /* from inactive step; suppressed from MIDI */
    uint8_t  pad[1];
} note_t; /* 12 bytes */

typedef struct {
    uint8_t  steps[SEQ_STEPS];               /* 0=off/1=on; step may have notes even when 0 */
    uint8_t  step_notes[SEQ_STEPS][8];       /* up to 8 notes per step */
    uint8_t  step_note_count[SEQ_STEPS];     /* 0..8 */
    uint8_t  step_vel[SEQ_STEPS];
    uint16_t step_gate[SEQ_STEPS];
    int16_t  note_tick_offset[SEQ_STEPS][8]; /* per-note ±23 ticks */
    uint16_t length;
    uint8_t  active;
    uint16_t clock_shift_pos;   /* Persisted. */
    int8_t   stretch_exp;       /* 0=1x, ±1=×2/÷2. Persisted. */
    note_t   notes[512];        /* absolute-position list; rebuilt from step arrays at init/edit */
    uint16_t note_count;        /* active+tombstoned; not decremented on removal */
    uint8_t  occ_cache[32];     /* 256-bit occupancy bitmap */
    uint8_t  occ_dirty;
} clip_t;

typedef struct {
    clip_t    clips[NUM_CLIPS];
    uint8_t   active_clip;
    int8_t    queued_clip;
    uint16_t  current_step;
    uint16_t  pending_gate, gate_ticks_remaining;
    uint8_t   pending_notes[8], pending_note_count;
    play_fx_t pfx;
    uint8_t   recording, clip_playing, will_relaunch, pending_page_stop, record_armed, stretch_blocked;
    struct { uint8_t pitch; uint32_t tick_at_on; } rec_pending[10];
    uint8_t   rec_pending_count;
    struct { uint8_t pitch; uint16_t ticks_remaining; } play_pending[32];
    uint8_t   play_pending_count;
    uint32_t  current_clip_tick;  /* current_step*TPS + tick_in_step */
} seq8_track_t;

typedef struct {
    seq8_track_t tracks[NUM_TRACKS];
    uint8_t  playing;
    uint32_t global_tick;       /* bar boundary = % 16 == 0 */
    uint8_t  scale_aware, input_vel, inp_quant, pad_key, pad_scale, launch_quant;
    uint8_t  mute[NUM_TRACKS], solo[NUM_TRACKS];
    /* + snapshots[16], instance_nonce, state_path, ext_queue */
} seq8_instance_t;
```

**Render logic** (per tick):
1. At `tick_in_step==0`: bar-boundary launch (`queued_clip >= 0 && !pending_page_stop && global_tick % QUANT_STEPS[launch_quant] == 0`). Page-stop (`pending_page_stop && global_tick % 16 == 0`).
2. Gate countdown: decrement `play_pending[].ticks_remaining`; `pfx_note_off` at 0.
3. Note-on: if `clip_playing && !effective_mute`, scan `notes[]` for `effective_note_tick(n) == current_clip_tick`. Skip `step_muted` and `suppress_until_wrap`. Add to `play_pending[]`.

**Important**: `clip_migrate_to_notes` must be called after every step-array edit to keep `notes[]` in sync with playback. All existing DSP commands call it; new commands must too.

**state_snapshot** (52 values): `playing cs0..7 ac0..7 qc0..7 count_in cp0..7 wr0..7 ps0..7 flash_eighth flash_sixteenth`.

## Recording architecture

Current approach: JS-side timing via polled `trackCurrentStep`. ~20ms jitter from `POLL_INTERVAL=4` ticks. `stepBoundaryTick[t]` updated on step change (−2 bias). `recordBpm` cached at arm.

**Known bug**: `recordNoteOff` sends absolute gate ticks to `_gate` (a delta handler) — gate recording broken; notes record with default gate. Fix: send gate as 4th field of `_add`.

**DSP-side (next task)**: JS sends pitch+vel via set_param on press; DSP handler reads `tick_in_step + current_step` at arrival, adds note with placeholder gate. Note-off: JS sends `tN_record_note_off "pitch"`; DSP computes gate with loop-wrap. 10-slot `rec_pending[]`. See `RECORDING_HANDOFF.md`.

## Known limitations

- Transport stop saves will_relaunch; panic does not.
- Do not load SEQ8 from within SEQ8 — LED corruption. Workaround: Shift+Back first.
- Live pad latency floor: ~3–7ms structural.
- All 8 tracks route to the same Schwung chain.
- State file v=11 — wrong/missing version → deleted, clean start.
- `g_host->get_clock_status` is NULL — no background transport follow.
- `g_host->get_bpm` non-null but doesn't track BPM changes while stopped.
- See `SCHWUNG_SEQ8_LIMITATIONS.md` for framework interaction patterns and gotchas.

## Hardware reference

**Pad rows** (bottom-to-top): 68–75 · 76–83 · 84–91 · 92–99

**Encoders**: `MoveMainKnob = 14` (CC) | `MoveMainButton = 3` (CC, jog click) | `MoveMainTouch = 9` (note)

**Step buttons**: notes 16–31, `0x90` (d2>0=press, d2=0=release).

**LED palette**: Fixed 128-entry. Dim pairs: Red(127)→DeepRed(65) · Blue(125)→DarkBlue(95) · VividYellow(7)→Mustard(29) · Green(126)→DeepGreen(32).

## MIDI routing

**DSP**: `midi_send_internal` → Schwung chain. `midi_send_external` → USB-A — **never from render path** (blocking, deadlock risk).

**JS**: `shadow_send_midi_to_dsp` → chain · `move_midi_internal_send` → LEDs/buttons · `move_midi_inject_to_move` → simulates pads · `move_midi_external_send` → USB-A (deferred).

## Build / deploy / debug

```sh
./scripts/build.sh && ./scripts/install.sh   # DSP change
cp ui.js dist/seq8/ui.js && ./scripts/install.sh  # JS-only
nm -D dist/seq8/dsp.so | grep GLIBC         # verify GLIBC ≤ 2.35
ssh ableton@move.local "tail -f /data/UserData/schwung/seq8.log"
```

Schwung core: v0.9.7. GLIBC ≤ 2.35. No complex static initializers.

`~/schwung-notetwist` — NoteTwist reference. `SEQ8_SPEC_CC.md` — full design spec.

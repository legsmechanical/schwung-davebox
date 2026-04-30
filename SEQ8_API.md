# SEQ8 API Reference

DSP parameter keys, C structs, recording architecture, and algorithm details.
Read this when writing DSP calls or modifying DSP/pfx code.

## Parameter Bank Reference

Banks via **Shift + top-row pad** (92–99). Same bank again → TRACK (0).

| Bank | Pad | K1 | K2 | K3 | K4 | K5 | K6 | K7 | K8 |
|------|-----|----|----|----|----|----|----|----|----|
| 0 TRACK | 92 | Ch (stub) | Rte | Mode | — | — | — | — | Lpr |
| 1 CLIP (melodic) | 93 | Stch (sens=16, lock) | Shft (sens=8) | Ndg (sens=8) | Res (sens=16) | Len (sens=4) | — | — | SqFl |
| 1 DRUM SEQ (drum) | 93 | Stch (sens=16, lock) | Shft (sens=8) | Ndg (sens=8) | Res (sens=16) | Len (sens=4) | Qnt (0–100) | LnN | SqFl |
| 2 NOTE FX | 94 | Oct (sens=6) | Ofs (sens=4) | Gate (sens=2) | Vel | Qnt (0–100) | — | — | — |
| 3 HARMZ | 95 | Unis (sens=4) | Oct (sens=4) | Hrm1 (sens=4) | Hrm2 (sens=4) | — | — | — | — |
| 4 MIDI DLY | 96 | Dly | Lvl | Rep (max=16) | Vfb | Pfb | Gfb | Clk | Rnd |
| 5 SEQ ARP | 97 | Styl (0=Off..9=RnO) | Rate | Oct (-4..+4 skip 0) | Gate | Stps | Rtrg | — | — |
| 6 LIVE ARP | 98 | On | Type | Sort | Hold | OctR | Spd | — | — |

## DSP Parameter Keys

All `tN_` keys: N = 0..7. All writes save state unless noted.

| Key | Dir | Format | Notes |
|-----|-----|--------|-------|
| `tN_beat_stretch` | set | `"1"` or `"-1"` | Expand/compress active clip. |
| `tN_beat_stretch_factor` | get | `"1x"`, `"x2"`, `"/2"`, … | |
| `tN_beat_stretch_blocked` | get | `"0"` or `"1"` | 1 if last compress blocked. |
| `tN_clock_shift` | set | `"1"` or `"-1"` | Rotate all steps right/left. |
| `tN_clock_shift_pos` | get | integer string | |
| `tN_clip_length` | set/get | `"1"`..`"256"` | Active clip length. |
| `tN_clip_resolution` | set | `"0"`–`"5"` | tps index into TPS_VALUES. Proportional rescale. No-op while recording. |
| `tN_cC_tps` | get | integer string | ticks_per_step for clip C. |
| `tN_stop_at_end` | set | any | Arm page-stop. |
| `tN_deactivate` | set | any | Clear clip_playing, will_relaunch, queued_clip, pending_page_stop, record_armed. |
| `tN_cC_step_S_notes` | get | space-sep MIDI notes or `""` | |
| `tN_cC_step_S_toggle` | set | `"note [vel]"` | Toggle note; sets step_vel on first note. |
| `tN_cC_step_S_clear` | set | any | Atomic zero + deactivate; resets vel/gate/nudge. |
| `tN_cC_step_S_add` | set | `"pitch [offset [vel]]"` | Add-only overdub. Defers save while recording. |
| `tN_cC_step_S_vel` | set/get | `"0"`–`"127"` | No-op if step empty. |
| `tN_cC_step_S_gate` | set/get | `"1"`–`"6144"` | No-op if step empty. |
| `tN_cC_step_S_nudge` | set/get | `"-23"`–`"23"` | Moves all notes as unit. No-op if step empty. |
| `tN_cC_step_S_reassign` | set | dest step index | Move/merge. Empty=move; occupied=merge (dst pitch wins; active src activates inactive dst). Clears src. |
| `tN_cC_step_S_copy_to` | set | dest step index | Copy notes/vel/gate/offsets to dest; overwrites. |
| `tN_cC_step_S_pitch` | set | signed delta | Shift all notes N semitones. No-op if step empty. |
| `tN_cC_step_S_set_notes` | set | space-sep MIDI notes | Replace all notes. No-op if step empty. |
| `tN_cC_clear` | set | any | Atomic wipe all steps + deactivate. |
| `tN_cC_clear_keep` | set | any | Wipe all steps; preserves clip_playing/will_relaunch. Silences in-flight notes. |
| `tN_cC_hard_reset` | set | any | `clip_init` (length=16, tps=24, all cleared). Undo snapshot, silence, pfx_sync. |
| `tN_recording` | set/get | `"0"` or `"1"` | 1=overdub (defers save); 0=disarm+flush. |
| `tN_pfx_reset` | set | any | Atomically reset NOTE FX + HARMZ + MIDI DLY. |
| `tN_pfx_snapshot` | get | 31 space-sep ints | [0-16]=NOTE FX K0-K4 / HARMZ K0-K3 / MIDI DLY K0-K7; [17-22]=SEQ ARP style/rate/oct/gate/steps/retrigger; [23-30]=step_vel[0..7]. |
| `tN_seq_arp_style` | set | 0–9 | Off/Up/Down/UpDown/DownUp/Converge/Diverge/PlayOrder/Random/RandOther. Off silences + clears held. |
| `tN_seq_arp_rate` | set | 0–9 | 1/32..1-bar. |
| `tN_seq_arp_octaves` | set | -4..-1, +1..+4 | 0 skipped; positive=ascend, negative=descend. |
| `tN_seq_arp_gate` | set | 1..200% | |
| `tN_seq_arp_steps_mode` | set | 0/1/2 | Off/Mute/Skip. |
| `tN_seq_arp_retrigger` | set | 0/1 | Default 1. |

**Perf Mode**: `perf_mods` (set, uint32 bitmask 24 bits; JS ORs toggled+held+recalled, sends on every change; see `PERF_MOD_*` in seq8.c and `PERF_MOD_PAD_MAP` in ui.js). `looper_retrigger "ticks"` (atomic stop+arm at new rate).

**Other keys**: `clip_copy "srcT srcC dstT dstC"` · `clip_cut "srcT srcC dstT dstC"` (copy+hard-reset src, `undo_begin_clip_pair`) · `row_copy "srcRow dstRow"` · `row_cut "srcRow dstRow"` (`undo_begin_row_pair`) · `tN_active_clip` · `tN_current_step` · `tN_current_clip_tick` (get: `current_step*TPS+tick_in_step`) · `tN_queued_clip` · `tN_cC_steps` (get: 256-char '0'/'1'/'2') · `tN_cC_length` · `tN_cC_step_S` (set '0'/'1'=deactivate/activate) · `tN_launch_clip` · `launch_scene` · `transport` ("play"/"stop"/"panic"/"deactivate_all") · `playing` · `state_snapshot` · `tN_route` · `tN_pad_mode` · `tN_pad_octave` · `key` · `scale` · `scale_aware` · `bpm` · `launch_quant` · `input_vel` · `inp_quant` · `midi_in_channel` (0=All, 1–16).

## Drum Lane Keys

All operate on active clip's lane L of track N.

`tN_lL_lane_note` (get/set midi_note) · `tN_lL_clip_length` (set) · `tN_lL_steps` (get: 256-char '0'/'1'/'2'; **active-clip-implicit** — defer JS read 2 ticks after clip switch; step-centric, reads `steps[s]`/`step_note_count[s]` directly) · `tN_lL_note_count` · `tN_lL_length` · `tN_lL_current_step` · `tN_lL_step_S_toggle "vel"` · `tN_lL_step_S_clear` · `tN_lL_step_S_vel` · `tN_lL_step_S_gate` · `tN_lL_step_S_nudge` · `tN_lL_step_S_reassign` (move/merge to dest step) · `tN_lL_copy_to "dstLane"` (copy all step data; preserves dst midi_note; undo snapshots full drum clip) · `tN_lL_cut_to "dstLane"` (copy_to + `clip_init` src + silence src; preserves both midi_notes; undo snapshots full clip) · `tN_lL_mute "0|1"` · `tN_lL_solo "0|1"` · `tN_drum_mute_all_clear` · `tN_drum_lane_mute` (get: uint32 bitmask) · `tN_drum_lane_solo` (get: uint32 bitmask) · `tN_cC_drum_has_content` (get: '1' if any lane has notes) · `tN_drum_active_lanes` (get: bitmask, bit L set if lane has hit at current step) · `tN_drum_lanes_qnt "0–100"` (set quantize on all 32 lanes atomically).

**Global drum clip**: `drum_clip_copy "srcT srcC dstT dstC"` (all 32 lanes; preserves dst midi_notes; undo snapshots dst only) · `drum_clip_cut "srcT srcC dstT dstC"` (copy + silence + `clip_init` each src lane; restores src midi_notes).

**Drum nudge reassign**: fire `_reassign` when `|stepEditNudge| > tps/2` (strictly; `>= tpsMid+1` for negative to avoid offset=+tps/2 which `note_step()` maps wrong).

## DSP Structs

```c
typedef struct {
    uint32_t tick;               /* absolute clip tick 0..clip_len*TPS-1 */
    uint16_t gate;
    uint8_t  pitch, vel, active;
    uint8_t  suppress_until_wrap; /* recording only; skip until clip wraps */
    uint8_t  step_muted;          /* inactive step; suppressed from MIDI out */
} note_t;

typedef struct {
    uint8_t  steps[SEQ_STEPS];               /* 0=off/1=on */
    uint8_t  step_notes[SEQ_STEPS][8];
    uint8_t  step_note_count[SEQ_STEPS];
    uint8_t  step_vel[SEQ_STEPS];
    uint16_t step_gate[SEQ_STEPS];
    int16_t  note_tick_offset[SEQ_STEPS][8]; /* per-note ±23 ticks */
    uint16_t length;
    uint8_t  active;
    uint16_t clock_shift_pos;
    int8_t   stretch_exp;        /* 0=1x, ±1=×2/÷2 */
    uint16_t ticks_per_step;     /* TPS_VALUES[0..5]={12,24,48,96,192,384}; default 24 */
    clip_pfx_params_t pfx_params;
    note_t   notes[512];
    uint16_t note_count;         /* active+tombstoned; never decremented */
    uint8_t  occ_cache[32];      /* 256-bit occupancy bitmap */
    uint8_t  occ_dirty;
} clip_t;

typedef struct {
    clip_t  clip;
    uint8_t midi_note;           /* DRUM_BASE_NOTE + lane_index */
} drum_lane_t;

typedef struct { drum_lane_t lanes[DRUM_LANES]; } drum_clip_t;

typedef struct {
    clip_t    clips[NUM_CLIPS];
    uint8_t   active_clip;
    int8_t    queued_clip;
    uint16_t  current_step;
    uint32_t  tick_in_step;
    play_fx_t pfx;
    uint8_t   recording, clip_playing, will_relaunch, pending_page_stop, record_armed, stretch_blocked;
    struct { uint8_t pitch; uint32_t tick_at_on; } rec_pending[10];
    struct { uint8_t pitch; uint16_t ticks_remaining; } play_pending[32];
    uint32_t  current_clip_tick; /* current_step*ticks_per_step + tick_in_step */
    uint8_t   pad_mode;          /* 0=MELODIC_SCALE, 1=DRUM */
    drum_clip_t drum_clips[NUM_CLIPS];
    uint16_t  drum_current_step[DRUM_LANES];
    uint32_t  drum_tick_in_step[DRUM_LANES];
} seq8_track_t;

typedef struct {
    seq8_track_t tracks[NUM_TRACKS];
    uint8_t  playing;
    uint32_t global_tick;           /* bar boundary = % 16 == 0 */
    uint32_t master_tick_in_step;   /* 24-tick master clock; drives global_tick + launch-quant */
    uint8_t  scale_aware, input_vel, inp_quant, midi_in_channel, pad_key, pad_scale, launch_quant;
    uint8_t  mute[NUM_TRACKS], solo[NUM_TRACKS];
    uint8_t  metro_on;              /* 0=Off,1=Count,2=On,3=Rec+Ply; default 1 */
    uint8_t  metro_vol;             /* 0–100; default 80 */
    uint32_t metro_beat_count;      /* JS polls for change → playMetronomeClick() */
    uint32_t perf_mods_active;
    uint32_t looper_cycle;          /* increments each LOOPING wrap */
    uint8_t  looper_sync;           /* 1=wait for clock boundary (default) */
    uint8_t  looper_pending_silence;
    uint8_t  perf_emitted_pitch[NUM_TRACKS][128]; /* raw→emitted pitch, 0xFF=not sounding */
    struct { uint8_t raw_pitch, emitted_pitch, track; uint16_t fire_at; } perf_staccato_notes[16];
    uint8_t  perf_staccato_count;
    uint8_t  drum_undo_valid, drum_undo_track, drum_undo_clip;
    uint8_t  drum_redo_valid, drum_redo_track, drum_redo_clip;
    uint32_t snap_drum_eff_mute[16][NUM_TRACKS];
    drum_rec_snap_lane_t drum_undo_lanes[DRUM_LANES]; /* step-data-only; ~237 KB/slot */
    drum_rec_snap_lane_t drum_redo_lanes[DRUM_LANES];
    /* + snapshots[16], instance_nonce, state_path, ext_queue */
} seq8_instance_t;
```

**Hybrid model**: Step arrays = edit surface; notes[] = playback surface. All set_param handlers write step arrays then call `clip_migrate_to_notes` (one-way rebuild; never modify notes[] directly). `clip_build_steps_from_notes` runs only at state load. `active`=tombstone flag; `step_muted`=MIDI suppression for inactive steps; `suppress_until_wrap`=recording only.

**Render logic** (per tick):
1. `tick_in_step==0`: bar-boundary launch (`queued_clip>=0 && !pending_page_stop && global_tick % QUANT_STEPS[launch_quant]==0`). Page-stop (`pending_page_stop && global_tick%16==0`).
2. Gate countdown: decrement `play_pending[].ticks_remaining`; `pfx_note_off` at 0.
3. Note-on: `clip_playing && !effective_mute` → scan `notes[]` for `effective_note_tick(n)==current_clip_tick`. Skip `step_muted` and `suppress_until_wrap`.

**state_snapshot** (52 values): `playing cs0..7 ac0..7 qc0..7 count_in cp0..7 wr0..7 ps0..7 flash_eighth flash_sixteenth`.

## Recording Architecture

JS sends pitch+vel on pad press; DSP timestamps at arrival (`tick_in_step+current_step`). Note-off: `tN_record_note_off "pitch"`; DSP computes gate with loop-wrap. 10-slot `rec_pending[]`. Input Quantize snaps to step boundary. Disarm: `finalize_pending_notes`. Accuracy ≤2.9ms.

**Gate capture**: `record_note_off` and `finalize_pending_notes` scan notes[] by `pitch+tick+active` only — do **not** require `suppress_until_wrap`. `clip_migrate_to_notes` rebuilds all notes with `suppress_until_wrap=0`; requiring that flag would lose the gate when any step op runs mid-hold.

**Drum live undo**: at arm time, `undo_begin_drum_clip()` snapshots all 32 lanes into `drum_undo_lanes[]`. `drum_undo_valid` and `undo_valid` are mutually exclusive. JS undo dispatches `undo_restore`/`redo_restore` regardless; DSP checks `drum_undo_valid` first.

## SEQ ARP Details

Intercepts note-on/off in `pfx_send` when `arp.style!=0 && !arp_emitting` → `arp_add_note`/`arp_remove_note`. Emits via `pfx_send` with `arp_emitting=1` (bypasses further processing). `arp_tick` runs per 96-PPQN master tick from `render_block` (also free-runs when transport stopped).

**Retrigger** (default On): cycle position + step column reset to 0 on new note entry (via `pending_retrigger` drained in `arp_tick`) and at clip loop wrap (`ns2==0` in `render_block`). Off: `master_anchor` stays 0, pattern free-runs on master clock.

**First-note clock sync**: empty→non-empty sets `pending_first_note=1`; first emission waits until `((arp_master_tick−master_anchor) % rate)==0`.

**Steps**: 8-entry level array (0=step off, 1–4=vel tiers; level 1=vel 10, level 4=incoming vel; intermediate lerp). Mute=rest but advance cycle; Skip=no fire, no advance. Column = `((arp_master_tick−master_anchor)/rate) & 7`.

**Gate** = `rate * gate_pct / 100`, clamped `[1, rate-1]` so note-off fires before next note-on.

`arp_silence(inst,tr)`: drops held + silences sounding; called from `silence_track_notes_v2`, Off-transition, `pfx_seq_arp_reset`, `pfx_reset`.

## Performance Effect Mode — Mod List

`perf_mods` bitmask bits 0–23. Drum tracks bypass all pitch mods (R1).

**R1 pitch** (bits 0–7): 0=Oct↑ (±12st/cycle alt) · 1=Oct↓ · 2=Sc↑ (ascending scale degrees, 4 cycles) · 3=Sc↓ · 4=5th (5th/10th/15th ascending) · 5=Tritone · 6=Drift (±1 scale deg/cycle accumulates) · 7=Storm (random ±6 scale deg/event)

**R2 vel/gate** (bits 8–15): 8=Decrsc (vel×(1−0.15×cycle)) · 9=Swell (16-cycle triangle) · 10=Cresc (vel×(1+0.15×cycle)) · 11=Pulse (even=full/odd=quiet) · 12=Sidechain (each note 15% quieter) · 13=Staccato (gate=cap/8) · 14=Legato (gate=cap−1) · 15=RampGate (gate ramps across notes)

**R3 wild** (bits 16–23): 16=½time (suppress odd cycles) · 17=3Skip (suppress every 3rd) · 18=Phantom (ghost −12st) · 19=Sparse (~50% suppress) · 20=Glitch (±2 scale deg random) · 21=Stagger (note N+N scale deg) · 22=Shuffle (randomise pitch order/cycle) · 23=Backwards (reverse pitch order)

`perf_apply()` runs in `pfx_send` for every looper-emitted event. Note-offs look up `perf_emitted_pitch[tr][raw]`. `looper_cycle` drives cycle-based animation. Staccato/Legato/RampGate use `perf_staccato_notes[16]` queue.

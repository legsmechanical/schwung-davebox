# SEQ8

**Working rule:** Before acting on any assumed or suggested cause/fix, read the relevant code and verify the assumption is correct first.

## Session workflow

- **Start of session**: run `~/schwung-docs/update.sh` and report the result. If unsure about a specific platform API or behavior, grep `~/schwung-docs/` rather than assuming.
- **Validate before acting** — read or grep the actual code first. Never act on assumptions.
- **Commit after each logical change** — work directly on master, one commit per change.
- **Deploy and verify on device before reporting done** — always build+install and confirm on Move.
- **Reboot after every deploy** — Shift+Back does NOT reload JS from disk.
- **JS-only deploy**: `cp ui.js dist/seq8/ui.js && cp ui_constants.mjs dist/seq8/ && ./scripts/install.sh` then reboot. `build.sh` required for DSP changes (also copies all JS).
- **CLAUDE.md**: update at session end or after a major phase — not after routine task work.

SEQ8 is a Schwung **tool module** (`component_type: "tool"`) for Ableton Move — standalone 8-track MIDI sequencer. No audio. C (DSP) + JavaScript (UI). Background running via tool reconnect.

## Build history (on master)

Phases 0–4, 5a–5z-e, unquantized-recording A–L, Post-A–L (complete): full sequencer — transport, clip model (5-state), step entry/recording, session view, mute/solo/snapshots, 14 scales, scale-aware play effects, clip copy; `note_t`+`notes[]` absolute model, `step_muted`/inactive steps, `_clear_keep`, `pixelPrint`/`pixelPrintC`, `knobTurnedTick[]`. Persistence v=11.

**per-clip-resolution**: per-clip `ticks_per_step` in `clip_t` · `master_tick_in_step` drives global_tick/launch-quant; per-track `tick_in_step` uses `cl->ticks_per_step` · `clip_resolution` set_param: proportional note+gate rescaling, rescales `tick_in_step`, blocked while recording (guard also in JS `applyBankParam`) · `knobTurnedTick[d1] = -1` on touch-on prevents stale turn-timeout clearing overview · persistence v=12.

**per-clip-params**: `clip_pfx_params_t` (17 fields, 68B/clip) in `clip_t` · `pfx_sync_from_clip()` at active_clip assignment; `PFX_SET_BOTH` macro writes `tr->pfx` + active clip's `pfx_params` simultaneously · pfx_reset/_clear/_clear_keep/row_clear reinitialize; clip_copy/row_copy propagate · `lastDspActiveClip[]` prevents pollDSP race; triggers `refreshPerClipBankParams(t)` on change · persistence v=13.

**bank-param-LEDs**: `bankParams[t][b][k] !== pm.def` lights knob LED White in Track View for banks 2/3/4/5; `cachedSetButtonLED` deduplicates. Track switch refreshes per-clip banks.

**ui-fixes + per-clip-display**: Action pop-ups now show in session view · undo/redo use `showActionPopup` (~500ms) · clip hard-reset resets `trackCurrentPage` to 0 · track-view clip button: playing=eighth-note flash dim↔bright, will-relaunch=slow pulse (~1Hz) dim↔bright, inactive-focused=solid bright · DSP `tN_cC_pfx_snapshot` reads `clip[C].pfx_params` directly (bypasses `tr->pfx` coalescing race) · `refreshPerClipBankParams` uses clip-specific snapshot; also refreshes CLIP bank Res (K3) + Len (K4); called at all track-switch and clip-switch sites unconditionally · DSP `launch_clip` when stopped: immediately advances `active_clip` + `pfx_sync_from_clip` for JS display.

**playhead-dot + loop-jog + sticky-clipboard**: Position bar (y=57–61) gains a 1px playhead dot mapped across full 128px width; inverted (black) when overlapping the solid view-page block; only shown during playback · Loop held + jog in Track View adjusts active clip length ±1 step (1–256), same set_param as CLIP K5 · Clipboard stays live until Copy button released — clip/row copy: source blinks until release; cut: after first paste `copySrc` updates to destination as copy-kind so subsequent pastes duplicate from there; step copy: source step keeps blinking for repeated pastes.

**code-organization**: sens=16 baseline for knobs, fine-tuned per-knob · `dsp/seq8_set_param.c` via `#include` (single translation unit) · `ui_constants.mjs` (ES module) for constants/palette/fmt/MCUFONT.

**undo/redo**: 1-level undo/redo via hardware Undo button (CC 56); Shift+Undo = redo. DSP owns two snapshot buffers (`undo_clips[]`/`redo_clips[]`, `UNDO_MAX_CLIPS=16` slots each, ~214KB per buffer). `undo_begin_single(t,c)` / `undo_begin_row(row_c)` / `undo_begin_clip_pair(srcT,srcC,dstT,dstC)` / `undo_begin_row_pair(srcRow,dstRow)` snapshot before mutation. `apply_clip_restore` handles recording disarm, memcpy restore, `clip_migrate_to_notes`, `pfx_sync_from_clip`. `undo_restore`/`redo_restore` set_params do the swap and call `seq8_save_state`. JS: `undoAvailable`/`redoAvailable` flags; SEQ ARP (JS-only bank 4) has a parallel `undoSeqArpSnapshot`/`redoSeqArpSnapshot`. After restore: `pendingDspSync=5` + `refreshPerClipBankParams` for all tracks. OLED flash on undo/redo/nothing-to-undo/nothing-to-redo.

## What's Built

**Transport**: Play/Stop. Shift+Play: playing → `deactivate_all`; stopped → `panic`. Delete+Play = panic. **Do not use per-track `tN_deactivate` for bulk clearing** — DSP processes one per audio callback; pollDSP restores stale state between calls. BPM owned by SEQ8 after init; `set_param("bpm")` updates `tick_delta` + `cached_bpm`.

**Views**: Track View — 16 step buttons = active clip page; pads = isomorphic 4ths diatonic; Shift+bottom-row = track select; OOB steps = White; playback head = White. Loop (CC 58) held → pages view: pages with notes pulse, empty pages = solid track color, out-of-clip = DarkGrey; **Loop held + jog = adjust active clip length ±1 step**. Session View (CC 50) — 4×8 pad grid; jog/Up(54)/Down(55) scroll; Shift+step or side buttons (CC 40–43) = launch scene. **Knob LEDs (CC 71-78)**: Session View = active-track indicator (White); Track View + bank 2/3/4/5 = dirty-param indicators (White when param ≠ default). **Clip buttons (CC 40–43, Track View)**: playing = flash dim↔bright (eighth note); will-relaunch (stopped) = slow pulse dim↔bright; focused inactive = solid bright; non-focused inactive-only = DarkGrey; with active notes = dim track color; empty = off.

**Clip state model** (5 states): Empty · Inactive · Will-relaunch · Queued · Playing.
- Launch: playing → legato; stopped → Queued.
- Page-stop (`tN_stop_at_end`): stops at next 16-step boundary; queued clip can launch simultaneously.
- Quantized launch: `queued_clip >= 0 && !pending_page_stop && global_tick % QUANT_STEPS[launch_quant] == 0` at tick_in_step=0.
- Transport stop → `will_relaunch=1`; transport play → will_relaunch fires immediately.
- `tN_deactivate`: clears clip_playing, will_relaunch, queued_clip, pending_page_stop, record_armed.

**Clip deactivation** (side buttons CC 40–43, Track View): playing+active → stop-at-end; playing+pending_page_stop → cancel; will_relaunch → deactivate; queued===clipIdx → deactivate; else → launch. Session View side buttons always launch scene.

**Step entry / recording**: Tap (<200ms) = toggle. Hold = step edit. Active steps = track colour; inactive-with-notes = dark gray; empty = off. Pads toggle notes; Up/Down shifts octave. Empty step auto-assigns `lastPlayedNote` or `defaultStepNote()`. Chord: held pads assigned additively. External MIDI + pads interchangeable: held step + external note toggles pitch (auto-assigned step → `_set_notes` replace; otherwise `_toggle` additive). CC 86 stopped → count-in → transport+record; playing → arm immediately; CC 86 again = disarm (`finalize_pending_notes`).

**Step edit overlay** (held step): 5-column OLED: Oct · Pit · Dur · Vel · Ndg. K1 Oct (sens=12) · K2 Pitch scale-aware · K3 Dur ±6 ticks/detent · K4 Vel ±1 · K5 Nudge ±1 tick. Multi-note: lowest note + "+N". Nudge moves all notes as unit; crossing ±(tps/2) moves display to adjacent step live; `_reassign` commits on hold-release. Occupied dst merges (dst pitch wins; active src activates inactive dst). Delete+step clears to defaults. K3 (Dur) touch: step LEDs show gate length (White = full steps, DarkGrey = partial remainder); wraps at clip end. Active column inverted on touch or turn; labels large font, values `pixelPrintC` small font.

**Copy combos** (CC 60 held): Copy+step (Track View) = step-to-step copy within active clip — src blinks white, press dest to copy notes/vel/gate/tick offsets; release Copy to cancel · Copy+track button (Track View) or Copy+pad (Session View) = clip-to-clip copy · Copy+scene row button (Session View) = row copy. Mixed kinds swallowed.

**Cut combos** (Shift+Copy held, then press source): **Shift+Copy+clip button** (Track View) or **Shift+Copy+clip pad** (Session View) = cut source select (`kind: 'cut_clip'`) · **Shift+Copy+scene row** (Session View) = cut source select (`kind: 'cut_row'`). Source blinks white (same as copy). Source NOT cleared immediately. **Paste** = same gesture as copy paste (press destination clip or scene row): fires `clip_cut`/`row_cut` DSP command — atomically copies src→dst and hard-resets src in one snapshot. "CUT" popup on source select; "PASTED" on paste. Undo restores both src and dst. Cancel = press Copy again before pasting.

**Delete combos**: CC 119 held. Delete+step = clear step · Delete+track button = clear clip (Track View: keeps playing if clip was active via `_clear_keep`; Session View: deactivates) · Delete+clip pad (Session View) = clear clip + deactivate · Delete+Mute = clear all mute/solo · Delete+jog click (Track View) = `tN_pfx_reset` (NOTE FX + HARMZ + MIDI DLY) · **Shift+Delete+jog click** (Track View) = full reset: NOTE FX + HARMZ + MIDI DLY + SEQ ARP · **Shift+Delete+clip button** (Track View) = hard reset via `tN_cC_hard_reset`: undo snapshot, silence, `clip_init` (length=16, tps=24, all cleared); clip stays in transport; "CLIP CLEARED" pop-up · **Shift+Delete+clip pad** (Session View) = same hard reset for that one clip · **Shift+Delete+scene button** (Session View) = hard reset all 8 clips in that row; "CLIPS CLEARED" pop-up · Delete+Play = panic.

**Active bank**: Single global `activeBank`. Shift + top-row pad (92–98); same bank → TRACK (0). OLED display priority: count-in → COMPRESS LIMIT → action pop-ups (~500ms; defers to step edit / bank overview while knob touched) → no-note flash → undo/redo flash → octave → step edit → bank overview (knob touched or bank-select timeout; K1–K8 abbrevs+values; touched column inverted) → header (+` REC`). **Knob highlight**: `knobTouched` on capacitive touch (note 0-7) and CC turn (71-78); touch-release clears immediately; turn-only clears after ~600ms via `knobTurnedTick[]`.

**Action pop-ups** (~500ms OLED): COPIED (copy clip/row src selected) · CUT (cut clip/row src selected) · PASTED (copy or cut dst confirmed) · SEQUENCE CLEARED (Delete+clip) · SEQUENCES CLEARED (Delete+scene row) · BANK RESET (Delete+jog click) · CLIP PARAMS RESET (Shift+Delete+jog click) · CLIP CLEARED (Shift+Delete+clip, any view) · CLIPS CLEARED (Shift+Delete+scene row). Step copy/clear: no pop-up.

**CLIP bank**: Beat Stretch (K1, sens=16, lock): CW doubles, CCW halves; compress blocked on collision → "COMPRESS LIMIT"; per-touch display label. Clock Shift (K2, sens=8): rotates steps; per-touch signed delta display. Clip Nudge (K3, sens=8): shifts all note_tick_offsets ±1; crosses ±(tps/2) to adjacent step; cumulative display. Clip Resolution (K4, sens=16): per-clip ticks_per_step 1/32–1bar; proportional rescale; blocked while recording. Clip Length (K5, sens=4): steps 1–256. **Seq Follow** (K8, JS-only): per-clip toggle (default ON). When ON, step display auto-pages to follow playhead while playing. When OFF, view stays on user-navigated page. Resets to ON on reboot (not persisted). **Quantize** (NOTE FX K5): render-time `effective_tick_offset = raw * (100-q) / 100`.

**Global menu** (Shift + CC 50): jog navigate, jog click edit, Back exit. Items: BPM (40–250) · Key · Scale · Scale Aware · Launch (Now/1/16/1/8/1/4/1/2/1-bar) · Input Vel (0=Live, 1–127=fixed) · Inp Quant (ON=snap recording) · MIDI In (All/1–16, channel filter for external USB-A MIDI) · Save+Unload (stub) · Swing (stub) · Quit (saves state + calls `host_exit_module`).

**External MIDI routing**: `onMidiMessageExternal` → `activeTrack` (always last Track View focus). Channel filter from MIDI In (0=All). Note-on: `effectiveVelocity`; updates `lastPlayedNote`/`lastPadVelocity`; if armed → `recordNoteOn`. Note-off: via `extHeldNotes` map. Track switch: `extNoteOffAll` before changing track. Step integration: same as pads (replace vs additive based on auto-assign state).

**Play effects**: Note FX → Harmonize → MIDI Delay. Per-clip: each clip carries its own NOTE FX/HARMZ/MIDI DLY params (`clip_pfx_params_t`); switching clips loads that clip's params via `pfx_sync_from_clip`. `tN_pfx_reset` resets active clip's params atomically. Scale-aware: noteFX_offset/harm_intervals/delay_pitch via `scale_transpose()` at render time; drum tracks bypass.

**Mute/Solo**: `effective_mute(t)` = `mute[t] || (any_solo && !solo[t])`; gates render note-on. Mute LED (Track View, focused): blink=muted, solid=soloed. OLED row: inverted=muted, blink=soloed. Snapshots (Session View, Mute held): 16 step buttons; Shift+Mute+step = save; Mute+step = recall.

**Scale**: 14 scales, `SCALE_IVLS[14][8]`. `computePadNoteMap` uses `intervals.length`. Scale-aware play effects: `scale_transpose(inst, note, deg_offset)` anchors to note's degree then shifts.

**State persistence**: v=13. Saved at Shift+Back and `destroy_instance`. Note format: `tick:pitch:vel:gate:sm;`. Per-clip stretch_exp/clock_shift_pos/ticks_per_step if nonzero/non-default. Per-clip pfx params sparse (`t%dc%d_nfo` etc.) if non-default. `step_muted=1` preserves inactive-step notes through reload.

**JS internals**: `effectiveClip(t)` → queued if stopped+queued else active. `pendingDspSync` (5-tick countdown after state_load). `pendingStepsReread` (2-tick countdown after `_reassign`/`_copy_to`; re-reads `_steps` bulk). `stepWasHeld` set at hold threshold, cleared on release/press/cancel — `stepBtnPressedTick` is -1 for both paths at release time so can't be used. `seqNoteOnClipTick`/`seqNoteGateTicks`: clip-tick gate expiry for pad highlight; `seqActiveNotes` cleared when elapsed ≥ gate (wrap-safe). `pollDSP` unconditionally overwrites `trackActiveClip[t]` when playing; `lastDspActiveClip[t]` tracks last DSP-reported value — change triggers `refreshPerClipBankParams(t)`. `clipTPS[t][c]`: JS mirror of per-clip ticks_per_step; used for Dur display, gate LED viz, K3 gate max, K5 nudge range, clip-tick computation. Synced at state load via `t{n}_c{c}_tps` get_param. `bankParams[t][b][k]`: JS mirror of bank knob values; per-clip banks (1=CLIP K3/K4/K7, 2=NOTE FX, 3=HARMZ, 5=MIDI DLY) refreshed on clip/track switch via `refreshPerClipBankParams(t)` using `tN_cC_pfx_snapshot`. `clipSeqFollow[t][c]`: JS-only per-clip flag (default true); K8 in CLIP bank reads/writes it; synced at `refreshPerClipBankParams` and at all `activeTrack` switch sites. OLED `drawPositionBar(t)`: segmented bar at y=57–61 — solid=view page, outline=playhead page, bottom-edge=others; 1px playhead dot mapped 0–127px, inverted on solid block; always shown in normal Track View.

## Upcoming tasks

1. **Scale-aware key/scale changes** — global option: changing Key/Scale transposes all clip notes to fit new scale. Design TBD.
2. **Step/note editing fixes** — see pending fixes in planning doc.
3. MIDI Delay Rnd refinement · 4. Full instance reset · 5. Drum mode · 6. State snapshots (16 slots) · 7. Arpeggiator · 8. Swing (wire stub) · 9. MIDI clock sync

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
| 0 TRACK | 92 | Ch (stub) | Rte | Mode | — | — | — | — | — |
| 1 CLIP | 93 | Stch (sens=16, lock) | Shft (sens=8) | Ndg (sens=8) | Res (sens=16) | Len (sens=4) | ClpS (stub) | ClpE (stub) | SqFl |
| 2 NOTE FX | 94 | Oct (sens=6) | Ofs (sens=4) | Gate (sens=2) | Vel | Qnt (0–100) | — | — | — |
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
| `tN_clip_resolution` | set | `"0"`–`"5"` | Per-clip ticks_per_step index into TPS_VALUES. Rescales notes proportionally. No-op while recording. Saves state. |
| `tN_cC_tps` | get | integer string | Current ticks_per_step for clip C of track N. |
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
| `tN_cC_step_S_copy_to` | set | dest step index | Copy all step data (notes, vel, gate, tick offsets) to dest; overwrites dest; src unchanged. Saves state. |
| `tN_cC_step_S_pitch` | set | signed delta | Shift all notes by N semitones. No-op if step has no notes. Saves state. |
| `tN_cC_step_S_set_notes` | set | space-sep MIDI notes | Replace all notes. No-op if step has no notes. Saves state. |
| `tN_cC_clear` | set | any | Atomic wipe all steps + deactivate track. Saves state. |
| `tN_cC_clear_keep` | set | any | Atomic wipe all steps; preserves clip_playing/will_relaunch. Silences in-flight notes. Saves state. |
| `tN_cC_hard_reset` | set | any | Full factory reset via `clip_init` (length=16, tps=24, all steps/notes/pfx cleared). Undo snapshot, silence, pfx_sync if active clip. Clip stays in transport. Saves state. |
| `tN_recording` | set/get | `"0"` or `"1"` | 1 = overdub (defers save). 0 = disarm + flush. |
| `tN_pfx_reset` | set | any | Atomically reset NOTE FX + HARMZ + MIDI DLY. |
| `tN_pfx_snapshot` | get | 17 space-sep integers | Batch read of active clip's pfx params in bank-knob order: NOTE FX K0-K4, HARMZ K0-K3, MIDI DLY K0-K7. One IPC call vs 17 individual reads. |

Other keys: `clip_copy "srcT srcC dstT dstC"` · `row_copy "srcRow dstRow"` · `clip_cut "srcT srcC dstT dstC"` (copy src→dst + hard-reset src, `undo_begin_clip_pair` snapshot) · `row_cut "srcRow dstRow"` (all 8 tracks, `undo_begin_row_pair` snapshot) · `tN_active_clip`, `tN_current_step`, `tN_current_clip_tick` (get: `current_step*TPS+tick_in_step`), `tN_queued_clip`, `tN_cC_steps` (get: 256-char '0'/'1'/'2', midpoint-based position), `tN_cC_length`, `tN_cC_step_S` (set '0'/'1' = deactivate/activate without touching notes), `tN_launch_clip`, `launch_scene`, `transport` (set: `"play"`, `"stop"`, `"panic"`, `"deactivate_all"`), `playing`, `state_snapshot`, `tN_route`, `tN_pad_mode`, `tN_pad_octave`, `key`, `scale`, `scale_aware`, `bpm`, `launch_quant`, `input_vel`, `inp_quant`, `midi_in_channel` (0=All, 1–16), noteFX/harm/delay params.

## DSP Struct Reference

```c
typedef struct {
    uint32_t tick;               /* absolute clip tick 0..clip_len*TPS-1 */
    uint16_t gate;
    uint8_t  pitch, vel, active;
    uint8_t  suppress_until_wrap; /* skip until clip wraps (recording suppressor) */
    uint8_t  step_muted;          /* from inactive step; suppressed from MIDI */
    uint8_t  pad[1];
} note_t;

typedef struct {
    uint8_t  steps[SEQ_STEPS];               /* 0=off/1=on; step may have notes even when 0 */
    uint8_t  step_notes[SEQ_STEPS][8];
    uint8_t  step_note_count[SEQ_STEPS];
    uint8_t  step_vel[SEQ_STEPS];
    uint16_t step_gate[SEQ_STEPS];
    int16_t  note_tick_offset[SEQ_STEPS][8]; /* per-note ±23 ticks */
    uint16_t length;
    uint8_t  active;
    uint16_t clock_shift_pos;   /* Persisted. */
    int8_t   stretch_exp;       /* 0=1x, ±1=×2/÷2. Persisted. */
    uint16_t ticks_per_step;    /* TPS_VALUES[0..5]={12,24,48,96,192,384}. Default 24. Persisted if non-default. */
    clip_pfx_params_t pfx_params; /* per-clip NOTE FX/HARMZ/MIDI DLY params (17 fields, 68B). */
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
    uint32_t  tick_in_step;     /* per-track; uses cl->ticks_per_step */
    uint16_t  pending_gate, gate_ticks_remaining;
    uint8_t   pending_notes[8], pending_note_count;
    play_fx_t pfx;
    uint8_t   recording, clip_playing, will_relaunch, pending_page_stop, record_armed, stretch_blocked;
    struct { uint8_t pitch; uint32_t tick_at_on; } rec_pending[10];
    uint8_t   rec_pending_count;
    struct { uint8_t pitch; uint16_t ticks_remaining; } play_pending[32];
    uint8_t   play_pending_count;
    uint32_t  current_clip_tick;  /* current_step*ticks_per_step + tick_in_step */
} seq8_track_t;

typedef struct {
    seq8_track_t tracks[NUM_TRACKS];
    uint8_t  playing;
    uint32_t global_tick;           /* bar boundary = % 16 == 0 */
    uint32_t master_tick_in_step;   /* always 24-tick master clock; drives global_tick + launch-quant */
    uint8_t  scale_aware, input_vel, inp_quant, midi_in_channel, pad_key, pad_scale, launch_quant;
    uint8_t  mute[NUM_TRACKS], solo[NUM_TRACKS];
    /* + snapshots[16], instance_nonce, state_path, ext_queue */
} seq8_instance_t;
```

**Render logic** (per tick):
1. At `tick_in_step==0`: bar-boundary launch (`queued_clip >= 0 && !pending_page_stop && global_tick % QUANT_STEPS[launch_quant] == 0`). Page-stop (`pending_page_stop && global_tick % 16 == 0`).
2. Gate countdown: decrement `play_pending[].ticks_remaining`; `pfx_note_off` at 0.
3. Note-on: if `clip_playing && !effective_mute`, scan `notes[]` for `effective_note_tick(n) == current_clip_tick`. Skip `step_muted` and `suppress_until_wrap`. Add to `play_pending[]`.

**Hybrid model**: Step arrays = edit surface; notes[] = playback surface. All set_param handlers write step arrays then call `clip_migrate_to_notes` (one-way rebuild; never modify notes[] directly). `clip_build_steps_from_notes` runs only at state load. `active`=tombstone flag; `step_muted`=MIDI suppression for inactive steps; `suppress_until_wrap`=recording only. See `SCHWUNG_SEQ8_LIMITATIONS.md`.

**state_snapshot** (52 values): `playing cs0..7 ac0..7 qc0..7 count_in cp0..7 wr0..7 ps0..7 flash_eighth flash_sixteenth`.

## Recording architecture (DSP-owns-timing)

JS sends pitch+vel via set_param on pad press; DSP reads `tick_in_step + current_step` at arrival → absolute tick, inserts note with placeholder gate (1 tick). Note-off: JS sends `tN_record_note_off "pitch"`; DSP computes gate with loop-wrap. 10-slot `rec_pending[]` map. Input Quantize ON snaps to step boundary. Disarm: `finalize_pending_notes` closes all pending note-ons. Accuracy ≤2.9ms (same render block). DSP-owns-timing is the only viable approach on v0.9.7 (on_midi → JS only; host_module_send_midi undefined).

## Known limitations

- Transport stop saves will_relaunch; panic does not.
- Do not load SEQ8 from within SEQ8 — LED corruption. Workaround: Shift+Back first.
- Live pad latency floor: ~3–7ms structural.
- All 8 tracks route to the same Schwung chain.
- State file v=13 — wrong/missing version → deleted, clean start.
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
./scripts/build.sh && ./scripts/install.sh   # DSP change (also copies all JS files)
cp ui.js dist/seq8/ui.js && cp ui_constants.mjs dist/seq8/ && ./scripts/install.sh  # JS-only
nm -D dist/seq8/dsp.so | grep GLIBC         # verify GLIBC ≤ 2.35
ssh ableton@move.local "tail -f /data/UserData/schwung/seq8.log"
```

**JS file structure**: `ui.js` (main, 3001 lines) + `ui_constants.mjs` (hardware constants, palette, fmt functions, MCUFONT, pixelPrint — 206 lines). Both must be deployed together. `build.sh` copies both automatically. JS-only deploy requires copying both (see above).

**DSP file structure**: `dsp/seq8.c` (2103 lines) includes `dsp/seq8_set_param.c` (1435 lines) via `#include`. Single translation unit — no extern declarations, no build changes. `seq8_set_param.c` covers all `set_param` handlers.

Schwung core: v0.9.7. GLIBC ≤ 2.35. No complex static initializers.

`~/schwung-notetwist` — NoteTwist reference. `SEQ8_SPEC_CC.md` — full design spec.

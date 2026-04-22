# SEQ8

SEQ8 is a Schwung **tool module** (`component_type: tool`) for Ableton Move — a standalone 8-track MIDI sequencer inspired by the Yamaha RS7000. No audio output. Written in C (DSP engine) + JavaScript (UI).

**Important:** SEQ8 is `component_type: "tool"` (not `"overtake"`). This enables the interactive tool reconnect path for background running. It appears in the **Tools menu**, not the Overtake module menu.

## Current build phase

**Phase 5 — 8 tracks, 256 steps, arpeggiator, Track View.**
- Phase 5a complete — live pad input via `shadow_send_midi_to_dsp`, polyphony, no stuck notes.
- Phase 5b complete — latency investigation, poll throttling, batch `state_snapshot`.
- Phase 5c complete — clip length control via Loop + step buttons.
- Phase 5d complete — Track View parameter banks: Beat Stretch, Clock Shift, Note FX, Harmonize, MIDI Delay, per-track live pad octave shift, step out-of-bounds LEDs.
- Phase 5e complete — Gate time shortening fix: per-step `step_gate`/`step_gate_orig` arrays in `clip_t`; render loop fires note-off at `step_gate[current_step]` ticks instead of fixed GATE_TICKS; `noteFX_gate` destructively scales all active steps; range extended to 0–400%; clock_shift and beat_stretch preserve gate arrays; Gate knob K3 NOTE FX bank wired, sens=2.
- Phase 5f complete — Polyphonic step data model: `step_note[256]` replaced with `step_notes[256][4]` + `step_note_count[256]` in `clip_t`; `pending_note` replaced with `pending_notes[4]` + `pending_note_count` in `seq8_track_t`; render loop fires note-on/off for each note in the step; clock_shift and beat_stretch rotate/compress all note columns atomically; new get param `tN_cC_step_S_notes`, new set param `tN_cC_step_S_toggle`; state file persists step notes as sparse format; version-gated load (wrong/missing `"v":1` → delete file, start clean).
- Phase 5g complete — Melodic step entry UI: hold step button → step edit mode; tap pads to toggle note assignment via `tN_cC_step_S_toggle`; assigned pads light White, unassigned scale pads render normally; display shows track/clip/step header + note names; release step button exits; Up/Down shifts octave (pad LEDs update immediately, no octave overlay); session view switch / Loop press clears held step; shift combos blocked while step held; preview note fires on pad tap.
- Phase 5h complete — Step entry UX refinements (JS only): tap vs hold distinction for step buttons (STEP_HOLD_TICKS=40 ~200ms threshold); tap = toggle on/off preserving note data; hold = enter step edit mode; `lastPlayedNote` tracks last live pad pitch and assigns it on tap-activation when step has default C4; octave overlay restored during step edit (Up/Down sets overlay regardless of mode); pad grid always reflects currently sounding notes (liveActiveNotes + seqActiveNotes → White highlight regardless of mode).
- Phase 5i complete — Bug fixes: phantom notes + stale seqActiveNotes; volume knob (CC 79) pass-through via `move_midi_internal_send` so firmware handles output level. (1) DSP: `clip_init` now sets `step_note_count[s]=0` (was 1) so `_notes` returns `""` for all unedited steps — invariant `steps[s]==1 iff count[s]>=1` holds from init; same change applied to beat_stretch expand fill and compress tmp init; state file bumped to `"v":2` (old v=1 files deleted on load); sparse save now skips steps with count=0 rather than count=1+note=60. (2) JS: `refreshSeqNotesIfCurrent()` immediately updates `seqActiveNotes` after tap-toggle and step-edit note changes, eliminating stale pad highlights when the sequencer is parked on the changed step.
- Phase 5j complete — Delete key combos (JS only, no DSP changes): Delete (CC 119) acts as a held modifier. Delete + step button (Track View) = clear all notes from that step and deactivate it (reads notes via `tN_cC_step_S_notes`, toggles each off via `tN_cC_step_S_toggle`). Delete + track button (Track View) = clear entire active clip on active track (iterates active steps only, calls clearStep per step). Delete + clip pad (Session View) = clear that clip. Delete held in Session View swallows step and track buttons to prevent accidental launches. No DSP changes — JS helpers `clearStep` and `clearClip` use existing params.
- Phase 5k complete — Two fixes: (1) Atomic step/clip clear (DSP + JS): added `tN_cC_step_S_clear` (zeroes all note data for one step atomically) and `tN_cC_clear` (wipes all steps in a clip atomically) DSP params; `clearStep`/`clearClip` in JS now use these instead of N×`_toggle` calls, eliminating race conditions and orphaned play-effect voices. (2) Multi-step tap toggle (JS only): `stepBtnPressedTick` changed from scalar to `new Array(16).fill(-1)` per-button, `stepBtnPressedIdx` removed; multiple step buttons can now be tapped simultaneously, each toggling independently; step-edit hold still applies to one step at a time.
- Phase 5l complete — Two UI fixes (JS only): (1) Playback head indicator: step button at current sequencer position always shows White regardless of step active state, making it visually distinct from track-colored active steps at all times. (2) Chord input via hold-pads + press step: if any pads are held (`liveActiveNotes.size > 0`) when a step button is pressed in Track View, all held pitches are assigned additively to that step via `_toggle` and the step is activated; no tap/hold ambiguity — this path fires immediately on press and does not enter step edit mode.
- Phase 5m complete — Session Overview (JS only): CC 50 gains tap/hold distinction (NOTE_SESSION_HOLD_TICKS=40, ~200ms). Tap = switch views (existing behavior preserved). Hold = show Session Overview for duration of hold; release exits. Display: pure graphical 8×16 grid filling the 128×64 OLED via `fill_rect()` — 8 columns=tracks, 16 rows=scenes, each cell 16×4 px. Cell states: active clip on active track → blink (solid ↔ center bar via `pulseUseBright`); active clip on other track → solid fill; has content not active → center bar (14×2); empty → nothing. All input swallowed during hold except CC 50 release. `overviewCache[8][16]` pre-built on overlay entry; `trackActiveClip[]` read live for blink/solid. No DSP changes.
- Phase 5n complete — Real-time recording (DSP + JS): Press Record (CC 86) while stopped → arm active track, count-in (one full cycle), then start capturing; Record LED red while armed. Recording is always additive overdub — uses new `tN_cC_step_S_add` DSP param (add-only: no-op if note already present or 4-note limit reached; skips `seq8_save_state` while `tr->recording=1`). Save is deferred and triggered by `tN_recording=0` on disarm. Auto-disarm after one full cycle. Press Record again while playing → re-arm count-in for another overdub pass. Stop/panic clears `recording` flag in DSP (all tracks). Play LED green when transport running. Display shows COUNT-IN overlay while waiting; `REC` tag on KNOB line during active recording. JS state: `recordArmed`, `recordCountingIn`, `recordArmedTrack`, `recordPrevStep`, `recordGotNonZero`, `playingPrev`; `disarmRecord()` helper handles all cleanup.
- Phase 5o complete — Recording fixes (DSP + JS): (1) **Record toggle**: Record always disarms when pressed while armed — no auto-disarm after one cycle; user controls when to stop recording. (2) **Count-in redesign**: Stopped → press Record → JS-side 1-bar silent pause (transport does NOT start, step buttons flash Red at quarter-note rate, BPM read via `get_param("bpm")`) → transport + recording start simultaneously. Playing → press Record → arm immediately with no count-in. Count-in timer uses `countInStartTick` + `countInQuarterTicks` JS tick vars; `countInQuarterTicks = round(196 * 60 / bpm)`. (3) **Silent notes fix**: race condition in `_toggle` and `_add` DSP handlers where `steps[sidx]=1` was written before `step_notes[]` and `step_note_count` — audio thread could see an active step with zero notes. Fixed by writing note+count first, setting `steps[sidx]=1` last in both handlers.

Phase 4 complete — clip model, Session View, background running via tool suspend.
Phase 3 complete — 4-track expansion with Note View LEDs and track selection.
Phase 2 complete — NoteTwist port + play effects chain (Note FX, Harmonize, MIDI Delay).
Phase 1 complete — single-track 16-step sequencer, transport, step LEDs, BPM 140.
Phase 0 complete — scaffold, MIDI buffer stress test, and button logging.

## What's Built (current feature summary)

Intended as a quick-start for a new session. Verify against code before acting on anything here.

**Transport**: Play/Stop/Panic via Move Play button. Shift+Play = panic. BPM follows host (cached every 512 blocks).

**8 tracks, 16 clips each, 256 steps per clip**: Full clip model in DSP and JS. Step sequencer running on all 8 tracks simultaneously. Clip launch per-track or as scenes (all tracks at once).

**Two views — Track View and Session View**:
- **Track View** (default): 16 step buttons show current page of active clip. Pads play live notes (isomorphic 4ths diatonic layout). Left/Right nav between pages. Track selection via Shift + bottom pad row.
- **Session View** (toggle via CC 50): 4×8 pad grid shows all clips for the visible scene group. Step buttons show scene map. Up/Down (CC 54/55) scrolls scene groups. Shift+step launches scene. Track buttons launch clips or scenes.

**Clip length control** (Phase 5c): Hold Loop (CC 58) + press step button N → clip length = (N+1)×16 steps (16..256). Step LEDs show pages-in-use (bright) vs unused (dim) while held. Page is clamped on shrink.

**Step out-of-bounds indicator** (Phase 5d): In Track View, step buttons whose absolute index is ≥ clip length light White, making the clip boundary visible while editing.

**Live pad input**: Pads play notes through the active Schwung chain via `shadow_send_midi_to_dsp` directly from JS. No C DSP involvement. Isomorphic 4ths diatonic layout, per-track octave. Velocity floor at 80 (`Math.max(80, d2)`).

**Per-track live pad octave shift** (Phase 5d): Up button (CC 55) / Down button (CC 54) shifts `trackOctave[activeTrack]` ±1 (range −4..+4) while in Track View. Applied as `trackOctave[activeTrack] * 12` to the base pitch at note-on, clamped to 0–127. `padPitch[32]` stores the shifted pitch sent at note-on so the matching note-off is always correct. Display shows a 1-second "Octave: ±N" overlay after each shift.

**Play effects chain** (full NoteTwist port in C DSP): Note FX (octave, offset, gate, velocity), Harmonize (unison, octaver, interval 1+2), MIDI Delay (time, level, repeats, feedback). Applied to sequencer MIDI output. Fully exposed via Track View parameter banks.

**Melodic step entry** (Phase 5g): Hold any step button → step edit mode. Tap pads to toggle note assignment for that step via `tN_cC_step_S_toggle`; assigned pads light White; unassigned scale pads render in track color/DarkGrey as usual. Display shows track/clip/step header + assigned note names (e.g. "C4 E4 G4"). Release step button exits. Up/Down shifts octave (pad LEDs update immediately; no octave overlay while held). Session view switch and Loop press clear held step. Shift combos (bank select, track select) are blocked while a step is held. Pad taps preview the note via `shadow_send_midi_to_dsp`; note-off fires on pad release.

**Real-time recording** (Phase 5n/5o): Press Record (CC 86, `MoveRec`) while stopped → arm active track + JS-side 1-bar count-in (step buttons flash Red at quarter-note rate, transport silent) → transport + recording start simultaneously after 1 bar. Press Record while playing → arm immediately with no count-in. Record LED red while armed. Notes played on pads are captured into the active clip at the current step position via `tN_cC_step_S_add` (add-only overdub, never removes existing notes). Recording stays armed until user presses Record again (no auto-disarm). Stop/panic always disarms. Play LED green when transport running.

**Track View parameter banks** (Phase 5d): 8 knob-driven parameter banks accessible via Shift + top-row pad (notes 92–98). See **Parameter Bank Reference** below for full table. Display priority state machine:
1. Count-in overlay (while Record armed and counting in)
2. Compress Limit overlay (~1500ms after blocked beat-stretch compress)
3. Octave overlay (~1000ms after Up/Down octave shift)
4. Step edit display (while step button held)
5. State 1 (knob touched) — single parameter name + value
6. States 2/3 (jog touched or bank-select timeout) — 4-knob overview grid
7. State 4 (normal) — track/clip/page header (+ ` REC` tag when actively recording)

**Beat Stretch** (Phase 5d): Knob 1 of TIMING bank (lock=true, sens=16). CW doubles clip length (expand); CCW halves it (compress). Compress is blocked entirely if any two active steps would map to the same destination — `stretch_blocked` flag set in DSP, checked by JS after set_param. "COMPRESS LIMIT" overlay shown for ~1500ms on block. `stretch_exp` tracks the current stretch exponent (0=1x, +1=x2, −1=/2).

**Clock Shift** (Phase 5d): Knob 2 of TIMING bank (continuous rotation, sens=8). CW/CCW rotates all steps in the active clip by one position. JS mirrors the rotation in `clipSteps`.

**Delete key combos** (Phase 5j/5k): Delete (CC 119) is a held modifier. Delete + step button (Track View) = clear all notes from that step and deactivate it. Delete + track button (Track View) = clear the clip at that track button's scene position (`sceneGroup * 4 + (3 - idx)`) on the active track; active clip does not change. Delete + clip pad (Session View) = clear that clip. While Delete is held in Session View, step and track buttons are swallowed to prevent accidental scene launches.

**Session Overview** (Phase 5m): Hold CC 50 (≥200ms) → graphical 8×16 grid fills the OLED. Release to return to previous view. 8 columns = tracks, 16 rows = scenes, each cell 16×4 px. Cell states: active clip on active track blinks (solid ↔ center bar); active clip on other track = solid fill; has content = center bar; empty = nothing. All input swallowed while held. Tap CC 50 (< 200ms) still toggles views as before.

**Background running**: Shift+Back hides SEQ8 (DSP stays alive, MIDI keeps playing). Re-entry via Tools menu reconnects instantly (JS-only reload). Cold boot recovery via `seq8-state.json`.

**State persistence**: Clips, lengths, active clips written to `/data/UserData/schwung/seq8-state.json` on every step change, transport change, launch, and destroy.

## Upcoming tasks (in order)

1. **Arpeggiator** — Port sequencer arpeggiator from NoteTwist reference. New DSP build required.
3. **Mute/Solo** — Per-track mute/solo, likely via Shift + track-select pads.
4. **Drum + Chromatic pad modes** — `pad_mode` param already wired in TRACK bank K3; DSP and JS logic not yet implemented.
5. **Global menu** — BPM, key, scale, swing controls accessible from a top-level menu.

## Parameter Bank Reference

Banks are selected via **Shift + top-row pad** (notes 92–99). Pressing the same bank again returns to TRACK (0). Pad 99 (bank 7) is reserved and ignored.

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

**Scope notes**: `track` = key sent as `tN_<dspKey>`; `action` = one-shot DSP trigger (no bounded value), read-back via `tN_<dspKey><actionSuffix>`; `stub` = JS-only, no DSP call.

**Sensitivity**: default sens=1 (1 tick per unit). Slow knobs listed above with explicit `sens=N`.

**Lock**: Beat Stretch only — fires once per touch, then blocks until knob is released.

## DSP Parameter Key Reference

All `tN_` keys accept N = 0..7 (track index).

| Key | Direction | Format | Notes |
|-----|-----------|--------|-------|
| `tN_beat_stretch` | set | `"1"` or `"-1"` | Expand (+1) or compress (−1) active clip. Compress silently no-ops if blocked. |
| `tN_beat_stretch_factor` | get | `"1x"`, `"x2"`, `"x4"`, `"/2"`, `"/4"`, … | Current stretch exponent as formatted string. |
| `tN_beat_stretch_blocked` | get | `"0"` or `"1"` | 1 if last compress attempt was blocked by step collision. |
| `tN_clock_shift` | set | `"1"` or `"-1"` | Rotate all steps in active clip right (+1) or left (−1) by one position. |
| `tN_clock_shift_pos` | get | integer string | Current shift position (0..length−1). |
| `tN_clip_length` | set/get | integer string `"1"`..`"256"` | Active clip length in steps. Clamps current_step if needed. Calls `seq8_save_state`. |
| `tN_cC_step_S_notes` | get | space-separated MIDI note numbers, or `""` if count=0 | Notes assigned to step S of clip C on track N. e.g. `"60"`, `"60 64 67"`. |
| `tN_cC_step_S_toggle` | set | MIDI note number as string, e.g. `"64"` | Toggle note into/out of step S. Adds if absent (up to 4-note limit), removes if present. Activates/deactivates step automatically. Calls `seq8_save_state`. |
| `tN_cC_step_S_clear` | set | any value (ignored) | Atomically zero all note data for step S and deactivate it. Single write — no race against render thread. Calls `seq8_save_state`. |
| `tN_cC_step_S_add` | set | MIDI note number as string, e.g. `"64"` | Add-only: adds note to step S if not already present and count < 4. No-op if note exists or limit reached. Skips `seq8_save_state` when `tr->recording=1` (deferred to disarm). Used for overdub recording. |
| `tN_cC_clear` | set | any value (ignored) | Atomically wipe all steps in clip C on track N (zeros steps[], step_notes[][], step_note_count[], sets active=0). Single write — no race against render thread. Calls `seq8_save_state`. |
| `tN_recording` | set/get | `"0"` or `"1"` | Set to `"1"` to enable recording mode (defers saves). Set to `"0"` to disarm — triggers `seq8_save_state` flush. DSP also clears this flag on transport stop/panic. |

Previously existing keys (for reference): `tN_active_clip`, `tN_current_step`, `tN_queued_clip`, `tN_cC_steps`, `tN_cC_length`, `tN_cC_step_S`, `tN_launch_clip`, `launch_scene`, `transport`, `playing`, `state_snapshot`, `tN_route`, `tN_pad_mode`, `tN_pad_octave`, `key`, `scale`, `noteFX_octave/offset/gate/velocity`, `harm_unison/octaver/interval1/interval2`, `delay_time/level/repeats/vel_fb/pitch_fb/gate_fb/clock_fb/pitch_random`.

## DSP Struct Reference

### `clip_t` (current fields)
```c
typedef struct {
    uint8_t  steps[SEQ_STEPS];            /* 256 steps, 0/1 */
    uint8_t  step_notes[SEQ_STEPS][4];    /* up to 4 notes per step; [0] = primary */
    uint8_t  step_note_count[SEQ_STEPS];  /* 0..4; invariant: steps[s]==1 iff count[s]>=1; init=0 */
    uint8_t  step_vel[SEQ_STEPS];
    uint8_t  step_gate[SEQ_STEPS];        /* gate ticks 1..GATE_TICKS; render loop fires note-off here */
    uint8_t  step_gate_orig[SEQ_STEPS];   /* original gate before noteFX_gate scaling; init=GATE_TICKS */
    uint16_t length;                      /* active length, 1..256 */
    uint8_t  active;
    uint16_t clock_shift_pos;             /* current rotation offset; wraps at length */
    int8_t   stretch_exp;                 /* beat stretch exponent: 0=1x, +1=x2, -1=/2. Not persisted. */
} clip_t;
```

### `seq8_track_t` (relevant fields)
```c
typedef struct {
    /* ... */
    uint8_t   pending_notes[4];     /* notes fired at last note-on; used for note-off matching */
    uint8_t   pending_note_count;   /* number of valid entries in pending_notes */
    uint8_t   stretch_blocked;      /* 1 if last compress was blocked by step collision; cleared on expand or non-blocked compress */
    uint8_t   recording;            /* 1 = actively recording (overdub); _add skips seq8_save_state; cleared on stop/panic */
} seq8_track_t;
```

### Beat Stretch compress — collision detection

Dry-run using `uint8_t seen[SEQ_STEPS]` before any mutations. If any two active steps in the current clip would map to the same destination (`i/2`), sets `stretch_blocked=1` and returns without touching `steps[]` or `stretch_exp`. This ensures atomicity — no partial rewrites.

## JS State Variables (Phase 5d / 5g additions)

```js
let activeBank     = new Array(NUM_TRACKS).fill(0);   /* active bank index 0-7 per track; 0 = TRACK (default) */
let knobTouched    = -1;                              /* 0-7 = which knob is currently touched; -1 = none */
let jogTouched     = false;                           /* jog wheel capacitive touch (MoveMainTouch = note 9) */
let knobAccum      = new Array(8).fill(0);            /* raw encoder tick accumulator per knob */
let knobLastDir    = new Array(8).fill(0);            /* last direction per knob for reversal detection */
let knobLocked     = new Array(8).fill(false);        /* blocks further firing until touch release (lock=true params) */
let bankSelectTick = -1;                              /* tickCount at last bank select; -1 = timeout not active */
const BANK_DISPLAY_TICKS = 392;                       /* ~2000ms at 196Hz */
let stretchBlockedEndTick = -1;                       /* tickCount deadline for COMPRESS LIMIT overlay; -1 = inactive */
const STRETCH_BLOCKED_TICKS = 294;                    /* ~1500ms at 196Hz */
let trackOctave = new Array(NUM_TRACKS).fill(0);      /* per-track live pad octave shift, -4..+4 */
let octaveOverlayEndTick = -1;                        /* tickCount deadline for octave overlay; -1 = inactive */
const OCTAVE_OVERLAY_TICKS = 196;                     /* ~1000ms at 196Hz */
let bankParams = Array.from({length: NUM_TRACKS}, () =>
    BANKS.map(bank => bank.knobs.map(k => k.def)));   /* [track][bankIdx][knobIdx] = integer value */

/* Step entry state (Phase 5g/5h) */
let heldStepBtn        = -1;       /* physical step button index 0-15 currently held; -1=none */
let heldStep           = -1;       /* absolute step index (page*16+btn) being edited; -1=none */
let heldStepNotes      = [];       /* MIDI note numbers assigned to heldStep (up to 4) */
const STEP_HOLD_TICKS  = 40;       /* ~200ms at 196Hz: below = tap, at/above = hold */
let stepBtnPressedTick = new Array(16).fill(-1); /* tickCount per button when press is pending; -1 = none */
let lastPlayedNote     = 60;       /* MIDI note of last live pad press; fallback for empty step activation */
let liveActiveNotes    = new Set(); /* pitches currently held via live pad input */
let seqActiveNotes     = new Set(); /* pitches currently playing from sequencer (active track) */
let seqLastStep        = -1;       /* last step index queried for seqActiveNotes */
let seqLastClip        = -1;       /* last clip index queried for seqActiveNotes */
let deleteHeld         = false;    /* true while Delete (CC 119) is held */

/* Session overview overlay (Phase 5m) */
let noteSessionPressedTick  = -1;    /* tickCount when CC 50 pressed; -1 = not pending */
let sessionOverlayHeld      = false; /* true while CC 50 held for graphical overview */
const NOTE_SESSION_HOLD_TICKS = 40;  /* ~200ms at 196Hz */
let overviewCache           = null;  /* null or Array[NUM_TRACKS][NUM_CLIPS] of booleans */

/* Real-time recording state (Phase 5n) */
let recordArmed         = false; /* true = Record pressed; count-in or actively recording */
let recordCountingIn    = false; /* true = JS-side count-in phase (transport not yet started) */
let recordArmedTrack    = -1;    /* track armed when Record was pressed */
let countInStartTick    = -1;    /* tickCount when count-in began; -1 = inactive */
let countInQuarterTicks = 0;     /* JS ticks per quarter note at BPM read on arm */
let playingPrev         = false; /* previous `playing` value, for stop-transition detection */
```

## Known limitations

- **Do not load SEQ8 from within SEQ8** — selecting SEQ8 from the Tools menu while already inside SEQ8 causes LED corruption. The Tools menu button sets `SHADOW_UI_FLAG_JUMP_TO_TOOLS` (0x80) via the shim's ui_flags bitmask; shadow_ui.js polls this with `shadow_get_ui_flags()` and calls `enterToolsMenu()` directly. `onMidiMessageInternal` is never called — there is no MIDI event to intercept. Workaround: hide first (Shift+Back), then re-enter from the Tools menu.
- **Live pad latency floor: ~3–7ms** — structural, cannot be closed. JS runtime ticks at ~196Hz; pad press arriving mid-tick waits up to 5ms plus dispatch overhead.
- **All 8 tracks route to the same Schwung chain** — no confirmed multi-chain path exists. Exhaustively tested: MIDI channel routing, move_midi_inject_to_move, dlsym, SHM inject — all dead ends.
- **`step_vel`, `step_gate`/`step_gate_orig` not persisted** — The state file stores `steps[]`, `length`, `active_clip`, and `step_notes`/`step_note_count` (sparse). Per-step velocity and gate values reset to defaults on cold boot (vel=100, gate=GATE_TICKS). Acceptable until step entry UI is built.
- **State file is version-gated** — Format field `"v":2` required at load time. Any file with a different or missing version is deleted and SEQ8 starts clean. No backward compatibility — bump `v` when format changes. (v=1 was pre-5i; v=2 changes the default step_note_count from 1 to 0.)
- **`step_notes`/`step_note_count` persist format** — State file uses sparse key `"tNcC_sn":"S:n1,n2;S2:n3;"` per clip. Steps with count=0 (default) are omitted; absent key means all steps have count=0 for that clip.
- **MIDI Delay repeats: no upper clamp enforced** — the `delay_repeats` param accepts 0–64 but high values can create very long feedback chains. TODO: clamp to 8 in DSP `set_param` handler and update BANKS range to match.
- **Clip lengths not persisted via state file** — `tN_clip_length` and `tN_cC_length` set_param handlers do not call `seq8_save_state`. Cold boot restores step data but not clip lengths. Known gap, acceptable for now.
- **`stretch_exp` not persisted** — Beat Stretch exponent resets to 0 on every cold boot or JS re-entry. Not saved to state file.

## Hardware reference

**Move pad row layout** (confirmed on hardware): 32 pads in 4 rows of 8, notes increase bottom-to-top:
- Bottom row (nearest player): notes **68–75** | Row 2: **76–83** | Row 3: **84–91** | Top row: **92–99**

**Move encoder constants** (from `/data/UserData/schwung/shared/constants.mjs`):
- `MoveMainKnob = 14` (CC, no LED) | `MoveMainButton = 3` (note) | `MoveMainTouch = 9` (note)

**Step buttons**: notes 16–31, fire as `0x90` note-on (d2 > 0 = press, d2 = 0 = release).

**LED palette**: Fixed 128-entry color index palette — NOT a brightness scale. `setLED(note, velocity)` selects palette color by index. Dim color pairs for Session View:
- Red (127) → DeepRed (65) | Blue (125) → DarkBlue (95) | VividYellow (7) → Mustard (29) | Green (126) → DeepGreen (32)

## MIDI routing reference

### C DSP routing

- **`host->midi_send_internal`**: Routes to the **active Schwung chain**. MIDI channel does NOT route to different chains. All 8 SEQ8 tracks play through whichever chain is active.
- **`host->midi_send_external`**: Sends to USB-A via SPI. **CRITICAL — never call from the render path.** SPI I/O is blocking; causes audio cracking and can deadlock `suspend_overtake`.

### JS routing

- **`shadow_send_midi_to_dsp([status, d1, d2])`**: Live pad MIDI output to the Schwung chain. Used for live pad input only — sequencer output uses `host->midi_send_internal` from C.
- **`move_midi_internal_send([cable|CIN, status, d1, d2])`**: Move hardware MIDI (LEDs, button lights) — NOT for instrument notes.
- **`move_midi_inject_to_move([cable|CIN, status, d1, d2])`**: Simulates pad presses for notes 68–99 (clip launch). Does NOT play arbitrary pitches on chain instruments.
- **`move_midi_external_send([cable|CIN, status, d1, d2])`**: USB-A external MIDI. Safe from JS tick (deferred); never call from render path.

## Key constraints

- GLIBC max 2.35 on Move — nothing newer may be linked.
- No complex static initializers.
- Cache BPM every 512 render blocks (not per-block).
- **Schwung core on device: v0.9.7** (installed Apr 14 2026; no version file — date confirmed from binary timestamps).

## Always run after every build

```sh
nm -D dist/seq8/dsp.so | grep GLIBC
```

## Deploy

```sh
./scripts/build.sh && ./scripts/install.sh
```

## Debug log

DSP plugin writes directly to `/data/UserData/schwung/seq8.log` (stdout/stderr go to /dev/null on device).

```sh
ssh ableton@move.local "tail -f /data/UserData/schwung/seq8.log"
```

`debug.log` contains only the Schwung shim's own output.

## NoteTwist reference

`~/schwung-notetwist` — working Schwung MIDI FX module; porting source for SEQ8 DSP stages. Key file: `src/notetwist.c`.

`SEQ8_SPEC.md` — Full design specification. Read at the start of every session and consult when making architectural decisions.

# Conductor Tracks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Conductor" track type that non-destructively transposes all playing melodic clips in real time based on the note the Conductor is playing, with per-clip control over which tracks respond, per-track octave offset, and held-note transition behavior.

**Architecture:** New `PAD_MODE_CONDUCT` track mode. The Conductor sequencer runs internally and emits no MIDI; on each Conductor note-on the DSP computes one signed transposition offset (scale degrees or semitones) relative to a fixed reference pitch (session root at MIDI octave 4). At every responder note-emit the offset (+ per-track octave, scale-aware) is folded into the pitch via the existing `scale_transpose()`. Bake and export have opt-in/dummy paths. All state additive; no state-version bump.

**Tech Stack:** C DSP (`dsp/seq8.c` + `dsp/seq8_set_param.c`, single translation unit), JS UI on QuickJS (`ui/ui.js` + `ui/ui_*.mjs`, bundled by `scripts/bundle_ui.py`). Build: `./scripts/build.sh` (DSP) or `python3 scripts/bundle_ui.py` (JS-only), deploy `./scripts/install.sh`, then full reboot of Move (Shift+Back does NOT reload JS).

**Spec:** `docs/superpowers/specs/2026-06-05-conductor-tracks-design.md`

---

## Conventions for every task

- **Compile gate (DSP tasks):** `./scripts/build.sh` must succeed AND `nm -D dist/davebox/dsp.so | grep GLIBC` must show no symbol `> 2.35`.
- **Compile gate (JS tasks):** `python3 scripts/bundle_ui.py` must succeed (it writes `dist/davebox/ui.js`). QuickJS — `node --check` is NOT authoritative; watch for member-expressions-as-object-keys.
- **Deploy:** `./scripts/install.sh` (auto-restarts the stack). For JS changes a full reboot is required (per CLAUDE.md). Verify on device before checking a verification step done.
- **Commit** at the end of each task. Do not commit without the user's standing approval already given for this branch (`conductor-tracks`). One commit per logical change. Add a `CHANGELOG.md` `[Unreleased]` entry on every `feat:`/`fix:`. Update `MANUAL.md` when user-visible behavior changes.
- **DSP routing constraint:** new keys MUST be per-track-prefixed (`tN_*`). The host silently drops new *global* set_param keys. Verify a new key reaches DSP with a one-line `seq8_ilog` at the top of its handler before building on it.
- **Coalescing constraint:** only the last `set_param` per key per buffer reaches DSP, and `set_param` shares the delivery channel with `shadow_send_midi_to_dsp`. Multi-field operations = one atomic DSP command; defer pushes to `tick()` where needed.

---

## Phase 1 — Track model: Conduct mode, routing, conversion, color, mute/solo

Outcome after this phase: you can route any track to Conductor (turns white, emits no MIDI, Solo inert, Mute works), only one Conductor allowed, and converting preserves the note sequence while clearing pfx/tarp/auto. No transposition yet.

### Task 1.1: Add the `PAD_MODE_CONDUCT` constant (DSP + JS)

**Files:**
- Modify: `dsp/seq8.c:53-54` (mode defines)
- Modify: `ui/ui_constants.mjs:372-373` (JS mode constants)

- [ ] **Step 1: Add the DSP constant.** After `#define PAD_MODE_DRUM 1` at `dsp/seq8.c:54`, add:

```c
#define PAD_MODE_CONDUCT        2   /* Conductor: drives transposition, emits no MIDI */
```

- [ ] **Step 2: Add the JS constant.** After the `PAD_MODE_MELODIC_SCALE` export in `ui/ui_constants.mjs`, add:

```javascript
export const PAD_MODE_CONDUCT = 2;
```

Import it in `ui/ui.js` alongside `PAD_MODE_DRUM, PAD_MODE_MELODIC_SCALE` (line 76).

- [ ] **Step 3: Compile gate.** Run `./scripts/build.sh` and `python3 scripts/bundle_ui.py`. Expected: both succeed.

- [ ] **Step 4: Commit.**

```bash
git add dsp/seq8.c ui/ui_constants.mjs ui/ui.js
git commit -m "feat(conduct): add PAD_MODE_CONDUCT constant"
```

### Task 1.2: DSP — per-track conductor role state + save/load migration

**Files:**
- Modify: `dsp/seq8.c` instance struct (near `mute[NUM_TRACKS]` at ~851)
- Modify: `dsp/seq8.c` `seq8_save_state` (~1450), `seq8_load_state` (~1750)

- [ ] **Step 1: Add role state to the instance struct.** Near the `mute`/`solo` arrays (`dsp/seq8.c:851-853`), add:

```c
    int8_t   conductor_track;   /* track index that is the Conductor, or -1 = none */
```

Initialize to `-1` in `create_instance` (wherever `mute`/`solo` get zeroed) and in the hard-reset/clear-session path.

- [ ] **Step 2: Save it (sparse).** In `seq8_save_state`, near where global scalars are written (the `key`/`scale` block), add a sparse write (omit when none):

```c
    if (inst->conductor_track >= 0)
        fprintf(fp, "\"cndt\":%d,", inst->conductor_track);
```

- [ ] **Step 3: Load it with default.** In `seq8_load_state`, default `inst->conductor_track = -1;` before parsing, then parse the `cndt` key if present (follow the existing scalar-parse pattern for `key`/`scale`). Validate range `0..NUM_TRACKS-1`, else leave `-1`.

- [ ] **Step 4: Compile gate** (`./scripts/build.sh` + GLIBC check).

- [ ] **Step 5: Device check.** Deploy, reboot. With no Conductor set, save+reload a set → no "Incompatible State" dialog (state still v=36). Confirm `seq8.log` shows a clean load.

- [ ] **Step 6: Commit.**

```bash
git add dsp/seq8.c
git commit -m "feat(conduct): persist per-session conductor_track (sparse, no version bump)"
```

### Task 1.3: DSP — conversion handlers (to-conduct / from-conduct) with one-Conductor enforcement

**Files:**
- Modify: `dsp/seq8.c` — add `convert_track_to_conduct()` / reuse `convert_track_conduct_to_melodic()` modeled on `convert_track_drum_to_melodic` (`seq8.c:8197/8315`)
- Modify: `dsp/seq8_set_param.c` — add `tN_convert_to_conduct` handler (model on the existing `tN_convert_to_drum`/`_to_melodic` handlers)

- [ ] **Step 1: Write `convert_track_to_conduct`.** Model on `convert_track_drum_to_melodic` (`seq8.c:8315`). It must: disarm recording; **preserve** each clip's `notes[]`/step arrays (note+duration+iter+probability are already in `clip_t` — do NOT clear them); reset pfx/tarp/auto to defaults (call the existing per-clip pfx init + clear TARP/automation the same way a fresh track would — reuse the helpers the existing convert paths call, e.g. `pfx_params_init` per clip, TARP reset); set `tr->pad_mode = PAD_MODE_CONDUCT`; `silence_track_notes_v2`; `inst->state_dirty = 1`.

```c
/* Melodic/Drum -> Conduct: keep clip note/step data (note+dur+iter+prob),
 * clear pfx/tarp/automation. Conductor emits no MIDI; its sequencer only
 * drives transposition. */
static void convert_track_to_conduct(seq8_instance_t *inst, int t) {
    seq8_track_t *tr = &inst->tracks[t];
    tr->recording = 0; tr->record_armed = 0; tr->recording_pending_page = 0;
    if (tr->pad_mode == PAD_MODE_DRUM) convert_track_drum_to_melodic(inst, t); /* fold drum data into melodic notes first */
    for (int c = 0; c < NUM_CLIPS; c++) {
        pfx_params_init(&tr->clips[c].pfx_params);   /* clear per-clip pfx */
        /* clear per-clip automation lanes here (reuse existing auto-clear helper) */
    }
    /* clear TARP + per-track auto assignments (reuse existing reset path) */
    tr->pad_mode = PAD_MODE_CONDUCT;
    silence_track_notes_v2(inst, tr);
    inst->state_dirty = 1;
}
```

> NOTE for executor: confirm the exact pfx-init and automation/TARP-clear helper names by reading `convert_track_drum_to_melodic`'s tail (`seq8.c:8376+`) and the track-config reset path; reuse them verbatim. Converting *back* uses the existing `convert_track_conduct_to_melodic` you add as a thin wrapper that just sets `pad_mode = PAD_MODE_MELODIC_SCALE` (note data already melodic) and clears the conductor role.

- [ ] **Step 2: Add the set_param handlers.** In `dsp/seq8_set_param.c`, alongside the `tN_convert_to_drum` handler, add `tN_convert_to_conduct`:

```c
/* one-Conductor enforcement: refuse if another track already holds the role */
if (inst->conductor_track >= 0 && inst->conductor_track != t) {
    seq8_ilog(inst, "convert_to_conduct refused: conductor exists");
    return; /* JS reads back conductor_track and shows the OLED message */
}
convert_track_to_conduct(inst, t);
inst->conductor_track = (int8_t)t;
inst->state_dirty = 1;
```

And extend the existing `tN_convert_to_melodic` handler: if `inst->conductor_track == t`, clear `inst->conductor_track = -1` after converting.

- [ ] **Step 3: Add a `conductor_track` get_param.** Add a get handler returning `inst->conductor_track` as a string (so JS can read the authoritative role and detect refusal). Missing get handler → JS reads 0, which would be wrong, so this is required.

- [ ] **Step 4: Verify the new key reaches DSP.** Put a `seq8_ilog(inst, "convert_to_conduct hit")` at the top of the handler. Deploy, reboot, trigger from JS (Task 1.4), confirm the log line. Then remove the temporary log.

- [ ] **Step 5: Compile gate.**

- [ ] **Step 6: Commit.**

```bash
git add dsp/seq8.c dsp/seq8_set_param.c
git commit -m "feat(conduct): DSP convert-to-conduct handler + one-conductor enforcement"
```

### Task 1.4: JS — route menu entry, conversion call, refusal message

**Files:**
- Modify: `ui/ui.js:233-242` (the convert menu/confirm trigger) and `convertTrackType` (`ui.js:3015`)

- [ ] **Step 1: Add a "Conductor" option to the track Route menu** — `createEnum('Route', …)` in `buildGlobalMenuItems` (NOT the Keys/Drums Mode enum). Conductor is a 4th route value (v===3); `get()` returns 3 while `pad_mode===CONDUCT` (else `trackRoute[t]`); selecting it opens the confirm dialog; selecting Move/Schwung/Ext on a Conductor converts back to Keys then applies the route. Hide the Keys/Drums Mode enum while the track is a Conductor. Add a confirm dialog state mirroring `confirmConvertToDrum` (`S.confirmConvertToConduct`) warning "Clears FX/ARP/Auto. Keeps notes." with Yes/No.

- [ ] **Step 2: Add `convertTrackToConduct(t)`** modeled on `convertTrackType` (`ui.js:3015`):

```javascript
function convertTrackToConduct(t) {
    host_module_set_param('t' + t + '_convert_to_conduct', '1');
    S.trackPadMode[t] = PAD_MODE_CONDUCT;
    /* read back authoritative role next tick to detect refusal */
    S.pendingConductReadback = t;
}
```

- [ ] **Step 3: Refusal handling.** In `tick()`/poll, when `S.pendingConductReadback != null`, read `host_module_get_param('conductor_track')`. If it != t, the convert was refused → revert `S.trackPadMode[t]` to its prior value and `showActionPopup('CONDUCTOR', 'EXISTS ON T' + (val+1))`. Clear `pendingConductReadback`.

- [ ] **Step 4: Convert-back path.** Routing a Conductor track back to Keys/melodic calls the existing `convertTrackType(t, false)` (sends `tN_convert_to_melodic`), which now also clears the DSP role.

- [ ] **Step 5: Compile gate** (`bundle_ui.py`).

- [ ] **Step 6: Device verification matrix.** Deploy, reboot. Plain-language checks:
  - Route track 2 → Conductor: confirm dialog appears, says it keeps notes.
  - After Yes: track 2's existing melodic notes are still there (switch to its clip, see the steps).
  - Try to route track 5 → Conductor while track 2 is the Conductor: you get "CONDUCTOR EXISTS ON T2" and track 5 stays as it was.
  - Route track 2 back to Keys: it converts; now routing track 5 → Conductor is allowed.

- [ ] **Step 7: Commit.**

```bash
git add ui/ui.js
git commit -m "feat(conduct): route a track to Conductor with confirm + one-conductor refusal"
```

### Task 1.5: Conductor identity — white/light-gray color, no MIDI, mute ok, solo disabled

**Files:**
- Modify: `ui/ui_constants.mjs` (add white/light-gray palette indices), `ui/ui.js` (add `trackColor`/`trackDimColor` helpers, route existing `TRACK_COLORS[t]`/`TRACK_DIM_COLORS[t]` reads through them)
- Modify: `dsp/seq8.c` render/emit path (suppress Conductor MIDI), mute/solo (`seq8.c:851-853`)

- [ ] **Step 1: Color helpers.** In `ui/ui.js` add:

```javascript
/* White / light-gray for the Conductor track; indexed color otherwise. */
function trackColor(t)    { return (S.trackPadMode[t] === PAD_MODE_CONDUCT) ? White     : TRACK_COLORS[t]; }
function trackDimColor(t) { return (S.trackPadMode[t] === PAD_MODE_CONDUCT) ? LightGrey : TRACK_DIM_COLORS[t]; }
```

Define `White` and `LightGrey` palette constants in `ui/ui_constants.mjs` (use the existing palette-index scheme; pick the white index and a light-gray dim index consistent with how `TRACK_COLORS`/`TRACK_DIM_COLORS` are defined at lines 50-54).

- [ ] **Step 2: Route color reads through the helpers.** Replace `TRACK_COLORS[t]` / `TRACK_DIM_COLORS[t]` reads in LED/pad/OLED code (`ui/ui_leds.mjs`, `ui/ui.js`) with `trackColor(t)` / `trackDimColor(t)`. Use graphify/grep to find all sites; do them all so the white color is consistent everywhere a track color appears.

- [ ] **Step 3: Suppress Conductor MIDI output (DSP).** In the note-emit choke point (`pfx_emit`/`pfx_send`, `seq8.c:2381-2388`), early-return without sending when the emitting track's `pad_mode == PAD_MODE_CONDUCT`. The Conductor's sequencer still advances (so the offset state in Phase 3 updates); only the outbound MIDI is suppressed.

- [ ] **Step 4: Disable solo for the Conductor.** In the solo handler/UI, ignore solo on the Conductor track (control inert). Mute remains functional. Guard `solo[]` application so a Conductor is never treated as soloed.

- [ ] **Step 5: Compile gate** (both build + bundle).

- [ ] **Step 6: Device verification matrix.**
  - Conductor track shows white in session view and on its clip LEDs; dim/inactive shows light gray.
  - Playing the Conductor's pads / running its sequence produces NO sound and NO external MIDI.
  - Mute on the Conductor toggles (we'll verify its transposition effect in Phase 3).
  - Solo on the Conductor does nothing (no solo state engaged).

- [ ] **Step 7: Commit.**

```bash
git add ui/ui_constants.mjs ui/ui.js ui/ui_leds.mjs dsp/seq8.c
git commit -m "feat(conduct): white track color, MIDI suppression, solo disabled"
```

---

## Phase 2 — The four Conductor banks (Conduct / Responder / Octave / When)

Outcome: a Conductor track's jog wheel cycles exactly Conduct, Responder, Octave, When. Conduct behaves like CLIP. Responder/Octave/When show the 2×4 `Tr1..Tr8` grid and store values per Conductor clip. No transposition effect yet (Phase 3 reads these).

### Task 2.1: DSP — per-Conductor-clip arrays (responder / octave / when) + save/load

**Files:**
- Modify: `dsp/seq8.c` `clip_t` struct (near step trig fields ~443-451)
- Modify: `dsp/seq8.c` clip init, `seq8_save_state`, `seq8_load_state`

- [ ] **Step 1: Add fields to `clip_t`.** After the step-trig arrays (`seq8.c:451`), add:

```c
    uint8_t cond_resp[NUM_TRACKS];   /* responder on/off per track; default 1 */
    int8_t  cond_oct [NUM_TRACKS];   /* octave offset per track -4..+4; default 0 */
    uint8_t cond_when[NUM_TRACKS];   /* 0=Next, 1=Now; default 0 */
```

- [ ] **Step 2: Defaults in `clip_init`.** Set `cond_resp[*]=1`, `cond_oct[*]=0`, `cond_when[*]=0` for all tracks.

- [ ] **Step 3: Save (sparse, only on the Conductor track's clips).** In `seq8_save_state`, for the track equal to `inst->conductor_track`, write per-clip arrays only when they differ from defaults. Use compact keys: `t%dc%d_crsp` (responder mask as an 8-char "0"/"1" string), `t%dc%d_coct` (8 signed values), `t%dc%d_cwhn` (8-char "0"/"1"). Omit when all-default.

- [ ] **Step 4: Load with defaults.** Parse those keys when present; otherwise the `clip_init` defaults stand (migration-safe). Validate ranges.

- [ ] **Step 5: get/set handlers.** Add per-track-prefixed handlers so JS can read/write each: `tN_cC_cond_resp` / `_cond_oct` / `_cond_when` (set takes a track index + value; get returns the 8-wide string). Since these are per-clip on the Conductor, key on the Conductor track's active clip. Add `seq8_ilog` verification then remove.

- [ ] **Step 6: Compile gate; device check** save+reload preserves values; no version dialog.

- [ ] **Step 7: Commit.**

```bash
git add dsp/seq8.c dsp/seq8_set_param.c
git commit -m "feat(conduct): per-conductor-clip responder/octave/when arrays + persistence"
```

### Task 2.2: JS — Conductor bank set + cycling + Conduct bank reuse

**Files:**
- Modify: `ui/ui_constants.mjs` (`BANKS` — append Responder/Octave/When), `ui/ui.js` (bank cycling + visibility gating)

- [ ] **Step 1: Append three banks to `BANKS`** (`ui/ui_constants.mjs:355`, after ALL LANES). These use custom rendering/handlers (like AUTO), so knob defs are placeholders:

```javascript
    /* 8 — RESPONDER (conduct) — per-track on/off, custom handling */
    { name: 'RESPONDER', knobs: [_X,_X,_X,_X,_X,_X,_X,_X] },
    /* 9 — OCTAVE (conduct) — per-track octave -4..+4, custom handling */
    { name: 'OCTAVE',    knobs: [_X,_X,_X,_X,_X,_X,_X,_X] },
    /* 10 — WHEN (conduct) — per-track Next/Now, custom handling */
    { name: 'WHEN',      knobs: [_X,_X,_X,_X,_X,_X,_X,_X] },
```

Add exported index constants, e.g. `export const BANK_RESPONDER = 8, BANK_OCTAVE = 9, BANK_WHEN = 10;`.

- [ ] **Step 2: Conduct bank visibility.** In the bank-cycling logic (where melodic vs drum bank lists are gated), add a Conduct branch: when `S.trackPadMode[activeTrack] === PAD_MODE_CONDUCT`, the available banks are `[0 (CLIP, shown as "Conduct"), BANK_RESPONDER, BANK_OCTAVE, BANK_WHEN]` only. Relabel bank 0's header to "CONDUCT" when in conduct mode (header draw reads a label override).

- [ ] **Step 3: Compile gate.** Device check: a Conductor track's jog cycles exactly those four; a melodic track is unchanged (never shows the three new banks).

- [ ] **Step 4: Commit.**

```bash
git add ui/ui_constants.mjs ui/ui.js
git commit -m "feat(conduct): four-bank set for Conductor tracks (Conduct/Responder/Octave/When)"
```

### Task 2.3: JS — 2×4 Tr[n] OLED rendering for Responder/Octave/When

**Files:**
- Modify: `ui/ui.js` `drawUI()` (custom bank render branches, near the AUTO/ALL-LANES custom branches)

- [ ] **Step 1: Add a shared per-track-grid renderer.**

```javascript
/* Standard header + 2x4 (rows x cols) Tr1..Tr8 grid. valFn(t) -> short string. */
function drawConductTrackGrid(header, valFn) {
    clear_screen();
    drawMenuHeader(header);
    for (let i = 0; i < 8; i++) {
        const col = i % 4, row = Math.floor(i / 4);
        const x = 2 + col * 31, y = 18 + row * 22;
        const isCond = (i === S.conductorTrack);
        print(x, y, 'Tr' + (i + 1), 1);
        print(x, y + 9, isCond ? 'Cndct' : valFn(i), 1);
    }
}
```

Adjust x/y/spacing to match the display metrics used by other bank renderers (read a neighboring custom render branch for exact coordinates).

- [ ] **Step 2: Wire the three banks** in `drawUI()`:

```javascript
if (bank === BANK_RESPONDER) {
    drawConductTrackGrid('RESPONDER', t => S.condResp[S.condActiveClip][t] ? 'ON' : 'off');
} else if (bank === BANK_OCTAVE) {
    drawConductTrackGrid('OCTAVE', t => { const o = S.condOct[S.condActiveClip][t]; return o === 0 ? '--' : (o > 0 ? '+'+o : ''+o); });
} else if (bank === BANK_WHEN) {
    drawConductTrackGrid('WHEN', t => S.condWhen[S.condActiveClip][t] ? 'Now' : 'Next');
}
```

(For Octave/When the Conductor's own cell shows '--'/blank via the `isCond` branch in the grid renderer; refine the renderer so Octave/When show '--' for the conductor cell rather than 'Cndct' — pass an `inertLabel` arg.)

- [ ] **Step 3: JS state mirrors.** In `ui/ui_state.mjs` add `condResp`, `condOct`, `condWhen` as `[NUM_CLIPS][NUM_TRACKS]` arrays (defaults 1 / 0 / 0) and `conductorTrack` (-1), `condActiveClip` (mirrors the conductor's active clip). Sync from DSP in the sync path (Task 6.x reads them back via the get_params from 2.1).

- [ ] **Step 4: Compile gate; device check** — the three banks render the 2×4 Tr1..Tr8 grid with correct labels; conductor's own cell shows Cndct/--.

- [ ] **Step 5: Commit.**

```bash
git add ui/ui.js ui/ui_state.mjs
git commit -m "feat(conduct): 2x4 Tr[n] OLED layout for Responder/Octave/When banks"
```

### Task 2.4: JS — knob handlers for Responder/Octave/When (single-fire toggles + ranges)

**Files:**
- Modify: `ui/ui.js` knob-turn dispatch (where `applyBankParam` routes custom banks)

- [ ] **Step 1: Handle knob turns** for the three banks. Knob `k` (0..7) maps to track `k`. Skip when `k === S.conductorTrack` (inert). On change, update the JS mirror for `S.condActiveClip` AND push to DSP via the per-clip set_params:
  - Responder: single-fire toggle on any turn → flip 0/1, push `tN_cC_cond_resp` with `k` + new value (N = conductor track, C = active conductor clip).
  - Octave: clamp to -4..+4, push `tN_cC_cond_oct`.
  - When: toggle Next/Now, push `tN_cC_cond_when`.

```javascript
function applyConductGridKnob(bank, k, delta) {
    if (k === S.conductorTrack) return;          /* own cell inert */
    const c = S.condActiveClip, N = S.conductorTrack;
    if (bank === BANK_RESPONDER) {
        S.condResp[c][k] = S.condResp[c][k] ? 0 : 1;   /* single-fire toggle */
        host_module_set_param('t'+N+'_c'+c+'_cond_resp', k + ' ' + S.condResp[c][k]);
    } else if (bank === BANK_OCTAVE) {
        S.condOct[c][k] = Math.max(-4, Math.min(4, S.condOct[c][k] + (delta > 0 ? 1 : -1)));
        host_module_set_param('t'+N+'_c'+c+'_cond_oct', k + ' ' + S.condOct[c][k]);
    } else if (bank === BANK_WHEN) {
        S.condWhen[c][k] = S.condWhen[c][k] ? 0 : 1;
        host_module_set_param('t'+N+'_c'+c+'_cond_when', k + ' ' + S.condWhen[c][k]);
    }
    forceRedraw();
}
```

Wire this into the knob dispatch where the active track is a Conductor and the bank is one of the three.

- [ ] **Step 2: Confirm DSP receipt.** The 2.1 set handlers parse `"<trackIdx> <value>"`. Add a temporary `seq8_ilog` to confirm, then remove.

- [ ] **Step 3: Compile gate; device matrix.**
  - Responder bank: turning any knob toggles that track ON/off (single-fire); conductor's own knob does nothing.
  - Octave bank: knob ramps -4..--..+4; center shows --.
  - When bank: knob toggles Next/Now.
  - All three persist across a save+reload and are per Conductor clip (switch conductor clips → values differ).

- [ ] **Step 4: Commit.**

```bash
git add ui/ui.js
git commit -m "feat(conduct): knob handlers for Responder/Octave/When banks"
```

---

## Phase 3 — Transposition engine (the core)

Outcome: with a Conductor playing, responder melodic clips transpose in real time per the reference pitch, scale-aware setting, and per-track octave. "Next" transition only (Now in Phase 4). Snap-to-zero on empty step / Conductor mute.

### Task 3.1: DSP — reference pitch + offset computation helpers

**Files:**
- Modify: `dsp/seq8.c` near `scale_transpose` (`seq8.c:3289`)

- [ ] **Step 1: Add an absolute-degree helper** (factor out the logic already inside `scale_transpose`):

```c
/* Absolute scale-degree index of a note relative to eff key/scale: oct*n + nearest-degree. */
static int note_abs_degree(seq8_instance_t *inst, int note) {
    int s = eff_pad_scale(inst); if (s < 0 || s >= 14) s = 0;
    int n = (int)SCALE_SIZES[s];
    const uint8_t *ivals = SCALE_IVLS[s];
    int key = eff_pad_key(inst);
    int rel = note - key, oct = rel / 12, pc = rel % 12;
    if (pc < 0) { pc += 12; oct--; }
    int deg = 0, best = 13;
    for (int d = 0; d < n; d++) { int dist = (int)ivals[d] - pc; if (dist < 0) dist = -dist; if (dist < best) { best = dist; deg = d; } }
    return oct * n + deg;
}
```

- [ ] **Step 2: Add live offset state** to the instance struct (transient, not persisted):

```c
    uint8_t conductor_sounding;     /* 1 while a Conductor note is held this step */
    int16_t conductor_off_deg;      /* scale-degree offset (scale-aware path) */
    int16_t conductor_off_semi;     /* semitone offset (chromatic path) */
```

Init all to 0 in `create_instance`.

- [ ] **Step 3: Reference + offset compute function.**

```c
/* Reference R = root pitch-class at MIDI octave 4 (key + 60). */
static void conductor_set_offset_from_note(seq8_instance_t *inst, int played) {
    int R = eff_pad_key(inst) + 60;
    inst->conductor_off_semi = (int16_t)(played - R);
    inst->conductor_off_deg  = (int16_t)(note_abs_degree(inst, played) - note_abs_degree(inst, R));
    inst->conductor_sounding = 1;
}
static void conductor_clear_offset(seq8_instance_t *inst) {
    inst->conductor_sounding = 0;
    inst->conductor_off_deg = 0; inst->conductor_off_semi = 0;
}
```

- [ ] **Step 4: Compile gate; commit.**

```bash
git add dsp/seq8.c
git commit -m "feat(conduct): reference pitch + offset computation helpers"
```

### Task 3.2: DSP — drive offset from the Conductor's playback

**Files:**
- Modify: `dsp/seq8.c` `render_block`/`_tickImpl` (where a track fires its step notes, ~4668 / ~9450)

- [ ] **Step 1: On the Conductor track's step advance**, when a note fires call `conductor_set_offset_from_note(inst, pitch)`; when the Conductor step is empty (no note) OR the Conductor is muted (`inst->mute[conductor_track]`) call `conductor_clear_offset(inst)`. The Conductor is monophonic, so a step has 0 or 1 notes — take that note's pitch. (The MIDI is already suppressed by Task 1.5 Step 3; here we only set the offset.)

- [ ] **Step 2: Mute edge.** Each tick, if `inst->conductor_track >= 0 && inst->mute[inst->conductor_track]`, force `conductor_clear_offset`. This makes Conductor mute = snap to zero immediately.

- [ ] **Step 3: Compile gate; device sanity.** Temporarily `seq8_ilog` the offset on change; confirm playing higher/lower Conductor notes changes the logged offset and empty steps/mute zero it. Remove the log.

- [ ] **Step 4: Commit.**

```bash
git add dsp/seq8.c
git commit -m "feat(conduct): drive transposition offset from Conductor playback"
```

### Task 3.3: DSP — apply offset at responder note-emit (Next behavior)

**Files:**
- Modify: `dsp/seq8.c` note-emit choke point (`pfx_emit`/`pfx_send`, ~2381) — the same place Task 1.5 suppresses Conductor MIDI

- [ ] **Step 1: Apply at emit.** For a note about to be emitted on track `t`, BEFORE sending, if all of: `inst->conductor_track >= 0`, `inst->conductor_sounding`, `t != inst->conductor_track`, the emitting clip is **melodic** (not drum), and the active Conductor clip's `cond_resp[t]` is on — then transpose:

```c
if (inst->conductor_track >= 0 && inst->conductor_sounding && t != inst->conductor_track
    && tr->pad_mode == PAD_MODE_MELODIC_SCALE) {
    clip_t *cc = &inst->tracks[inst->conductor_track].clips[inst->tracks[inst->conductor_track].active_clip];
    if (cc->cond_resp[t]) {
        int oct = cc->cond_oct[t];
        if (eff_scale_aware(inst)) {
            int n = (int)SCALE_SIZES[eff_pad_scale(inst)];
            pitch = scale_transpose(inst, pitch, inst->conductor_off_deg + oct * n);
        } else {
            pitch = clamp_i(pitch + inst->conductor_off_semi + oct * 12, 0, 127);
        }
    }
}
```

> NOTE: use the project's existing scale-aware accessor (the global Scale-Aware flag; the explore noted `scale_aware` at `seq8.c:861`). Name it `eff_scale_aware` or inline `inst->scale_aware`. Apply to ALL emitted notes (primary + harmony + arp) by being at the single choke point — verify `pitch` here is each individual outgoing note.

- [ ] **Step 2: Compile gate.**

- [ ] **Step 3: Device verification matrix (the headline feature).** Set up: C major, Scale-Aware ON. Track 1 = a simple melodic loop. Track 2 = Conductor with a clip playing single notes.
  - Conductor plays C4 (root, octave 4) → track 1 plays at written pitch (no shift).
  - Conductor plays D4 → track 1 shifts up one scale step.
  - Conductor plays the C below (C3) → track 1 shifts down an octave-ish (negative degrees).
  - Turn Scale-Aware OFF, Conductor plays D4 → track 1 shifts up exactly 2 semitones.
  - Octave bank: track 1 = +1 → track 1 jumps an additional octave while the Conductor sounds.
  - Responder bank: track 1 = off → track 1 ignores the Conductor; a still-on track 3 follows.
  - Empty Conductor step → responders snap back to written pitch that step.
  - Mute the Conductor → all responders snap to written pitch.

- [ ] **Step 4: Commit.**

```bash
git add dsp/seq8.c
git commit -m "feat(conduct): apply transposition to responder clips at note-emit (Next mode)"
```

---

## Phase 4 — "When = Now" held-note retrigger

Outcome: tracks set to "Now" cut and retrigger sounding notes immediately when the Conductor offset changes; "Next" tracks (default) keep Phase 3 behavior.

### Task 4.1: DSP — track sounding notes + retrigger on offset change for Now tracks

**Files:**
- Modify: `dsp/seq8.c` (offset-change detection in tick; per-track sounding-note bookkeeping; emit path)

- [ ] **Step 1: Detect offset change.** Keep `prev_off_deg`/`prev_off_semi` (or a generation counter `conductor_off_gen` incremented whenever the offset changes in Task 3.2). On any change, for each track `t` where the active Conductor clip's `cond_when[t] == 1` (Now) AND `cond_resp[t]` is on AND the track has a sounding note: send note-off for the currently-sounding pitch and re-emit at the newly-transposed pitch, preserving the original note's remaining gate / note-off tick.

> NOTE for executor: the engine already tracks active/held notes for gate-off scheduling (see the note-off / gate machinery used by playback). Reuse that per-track held-note record to know the original pitch and remaining gate. Send the off via the same emit choke point (which will re-suppress for the Conductor track itself, not relevant here). Respect the Move voice-allocator constraints (per-note offs; avoid CC123 — see project memory).

- [ ] **Step 2: Compile gate.**

- [ ] **Step 3: Device matrix.**
  - When bank: track 1 = Now. Play a long sustained note on track 1; change the Conductor note mid-sustain → track 1's note jumps to the new pitch immediately, ending at its original time.
  - Track 3 = Next: same test → track 3's sustained note holds its pitch; only its next note uses the new offset.
  - Mixed: with track 1 Now and track 3 Next playing simultaneously, both behave per their own setting.

- [ ] **Step 4: Commit.**

```bash
git add dsp/seq8.c
git commit -m "feat(conduct): When=Now live retrigger of sounding responder notes"
```

---

## Phase 5 — Bake "Apply Conductor?"

Outcome: baking a responder melodic clip while a Conductor clip is active and that track responds appends an "Apply Conductor? Yes/No/Cancel" dialog; Yes folds the Conductor's time-varying transposition (evaluated in lockstep across the N baked loops) into the baked notes.

### Task 5.1: JS — append the dialog to the bake flow

**Files:**
- Modify: `ui/ui.js` `drawBakeConfirm` (`ui.js:1495`) + the bake state machine (`confirmBake*` in `ui_state.mjs:366`) + the place that finalizes a bake and sends the DSP bake command

- [ ] **Step 1: Gate the new stage.** Only when: the track being baked is melodic, `S.conductorTrack >= 0`, and the active Conductor clip's `condResp[condActiveClip][track]` is on. Add a `S.confirmBakeApplyConductor` phase (sel: 0=Yes, 1=No, 2=Cancel) shown AFTER the existing melodic bake stage(s), BEFORE the bake command is sent.

- [ ] **Step 2: Render it** in `drawBakeConfirm` (follow the `_btn` 3-button pattern from the WRAP TAILS branch):

```javascript
} else if (S.confirmBakeApplyConductor) {
    drawMenuHeader('APPLY CONDUCTOR?');
    print(4, 16, 'Bake the conductor', 1);
    print(4, 25, 'transposition into', 1);
    print(4, 34, 'this clip?', 1);
    const bW = 38, bH = 13, bY = 50;
    _btn(4,  bY, bW, bH, S.confirmBakeApplyConductorSel === 0, 'YES',    9);
    _btn(45, bY, bW, bH, S.confirmBakeApplyConductorSel === 1, 'NO',    14);
    _btn(86, bY, bW, bH, S.confirmBakeApplyConductorSel === 2, 'CANCEL', 1);
}
```

- [ ] **Step 3: Wire selection** to set a flag passed into the bake DSP command (e.g. include `apply_conductor=1` in the bake set_param payload, or a paired `tN_cC_bake_apply_cond` push immediately before the bake command — single atomic command preferred). Cancel aborts the whole bake.

- [ ] **Step 4: Compile gate; device check** — the dialog appears only in the gated case; No/Cancel behave; Yes proceeds to DSP (effect verified in 5.2).

- [ ] **Step 5: Commit.**

```bash
git add ui/ui.js ui/ui_state.mjs
git commit -m "feat(conduct): bake 'Apply Conductor?' dialog stage"
```

### Task 5.2: DSP — apply Conductor transposition during bake (lockstep N loops)

**Files:**
- Modify: `dsp/seq8.c` `bake_clip` (`seq8.c:7523`, loop at 7573, `step_trig_pass` at 7589)

- [ ] **Step 1: Add an `apply_conductor` parameter** to `bake_clip` (and plumb it from the set_param handler). When set and `inst->conductor_track >= 0`:
  - Build the Conductor's per-tick offset timeline for one Conductor loop. For each baked loop `loop` (0..loops-1) and each responder note at absolute tick `t` in that loop, find the active Conductor step at `t mod (conductor_clip_len * conductor_tps)`.
  - Evaluate that Conductor step's trig conditions with `step_trig_pass(condClip, condSidx, (uint32_t)loop, &fx.rng)` — exactly like the responder's own bake passes — so iteration advances per loop and probability rolls fresh per occurrence with the bake RNG.
  - If it fires, compute the offset from that Conductor step's note via `conductor_set_offset_from_note`-style math and fold it (plus `cond_oct[t]`, scale-aware) into the baked note pitch (reuse the Task 3.3 transposition expression). If it doesn't fire → offset 0 for that note.

> NOTE for executor: read the existing `bake_clip` note loop to apply the offset at the same point pitches are written into the baked output list. The Conductor clip is `inst->tracks[inst->conductor_track].clips[active_clip]`.

- [ ] **Step 2: Compile gate.**

- [ ] **Step 3: Device matrix.**
  - Track 1 melodic loop, Conductor playing a rising line. Bake track 1 with Apply Conductor → Yes (1x): the baked clip's notes now follow the Conductor's transposition; the Conductor no longer needs to be present for the (now baked) pitches.
  - Bake 4x with a probability step on the Conductor → different loops show different results (the dice roll is per-loop, matching regular bake).
  - Bake with Apply Conductor → No: baked notes are at written pitch.

- [ ] **Step 4: Commit.**

```bash
git add dsp/seq8.c dsp/seq8_set_param.c
git commit -m "feat(conduct): bake applies Conductor transposition in lockstep across loops"
```

---

## Phase 6 — Ableton export (dummy track) + final persistence/sync polish

### Task 6.1: JS — export ignores live Conductor, emits dummy track

**Files:**
- Modify: `ui/ui_export.mjs` (`buildSong` ~370, `resolveTrackInstrument` ~176)

- [ ] **Step 1: Skip live transposition.** Export already renders baked notes via the DSP export param; responder clips export at written pitch (no live Conductor applied) — confirm nothing in the export path consults `conductor_*` state.

- [ ] **Step 2: Conductor → dummy track.** In `buildSong`, when a track is the Conductor (`S.trackPadMode[t] === PAD_MODE_CONDUCT`), emit a dummy track placeholder (the existing Dummy-Drift mechanism) with no clips/notes, preserving the 8-track layout. Use the white track color index for it if the export color map supports it; otherwise a neutral color.

- [ ] **Step 3: Compile gate; device/inspection check.** Export a set with a Conductor on track 2 → the exported `.als`/project has 8 tracks; track 2 is a silent dummy; responder tracks contain their written-pitch notes (or Conductor-baked notes if you baked them).

- [ ] **Step 4: Commit.**

```bash
git add ui/ui_export.mjs
git commit -m "feat(conduct): Ableton export emits dummy track for the Conductor"
```

### Task 6.2: JS — sync conductor state from DSP on load/resume

**Files:**
- Modify: `ui/ui.js` sync path (`syncClipsFromDsp` / `restoreUiSidecar` / `pendingDspSync` completion)

- [ ] **Step 1: Read role + per-clip arrays.** In the DSP sync path, read `conductor_track` (get_param), set `S.conductorTrack` and `S.trackPadMode[that] = PAD_MODE_CONDUCT`. For the Conductor's clips, read `tN_cC_cond_resp/_oct/_when` into `S.condResp/condOct/condWhen`. Set `S.condActiveClip` from the Conductor track's active clip.

- [ ] **Step 2: Sidecar.** Persist `conductorTrack` + conduct UI bits in the existing `seq8-ui-state.json` sidecar (it already carries per-track UI). Migrate (default missing) rather than bump the sidecar version if the existing reader tolerates unknown/missing keys; otherwise bump the sidecar version only (low-risk — not the DSP confirm path).

- [ ] **Step 3: Compile gate; device matrix.**
  - Build a Conductor session (role + responder/octave/when per clip), save, fully reboot, reload the set → Conductor is white again, its four banks show the saved per-clip values, transposition works immediately. No "Incompatible State" dialog.
  - Suspend (Back) and resume → state intact.

- [ ] **Step 4: Commit.**

```bash
git add ui/ui.js ui/ui_state.mjs
git commit -m "feat(conduct): restore Conductor role + per-clip banks on load/resume"
```

### Task 6.3: Docs — MANUAL + CHANGELOG + CLAUDE notes

**Files:**
- Modify: `MANUAL.md` (new "Conductor tracks" section), `CHANGELOG.md` `[Unreleased]`, `CLAUDE.md` (brief feature note if warranted)

- [ ] **Step 1: MANUAL.md** — document: routing a track to Conductor (one per session, keeps notes), the four banks (Conduct/Responder/Octave/When) with the 2×4 Tr[n] layout, white color, mute = pause transposition, no solo/bake, the reference pitch (root @ octave 4), scale-aware vs chromatic, the Octave bank, Next/Now, bake "Apply Conductor?", and export-as-dummy.
- [ ] **Step 2: CHANGELOG.md** — add `### Features` entries under `[Unreleased]` summarizing the Conductor feature.
- [ ] **Step 3: Commit.**

```bash
git add MANUAL.md CHANGELOG.md CLAUDE.md
git commit -m "docs(conduct): MANUAL + CHANGELOG for Conductor tracks"
```

---

## Final verification (whole-feature, on device)

Run the spec's Testing list (spec §Testing) end to end on the device after Phase 6:
1. Route → white, solo inert, mute works.
2. Second Conductor refused.
3. C4 = no transpose; D4 = +1 interval (SA on) / +2 semis (off).
4. Conductor mute → snap to zero.
5. Responder off → that track ignores; others follow.
6. Octave +1 → extra octave (scale-aware = +scale_size degrees).
7. When Now → immediate jump; Next → next-note.
8. Empty step → written pitch.
9. Bake Apply Conductor Yes/No/Cancel (probability re-rolled per loop).
10. Export → Conductor is a silent dummy; responders at written pitch.
11. Save/reload → everything restores, no version dialog.

---

## Self-review notes (author)

- **Spec coverage:** mode (1.1), role+one-conductor (1.2-1.4), color/MIDI/mute/solo (1.5), four banks + per-clip storage (2.x), reference R + scale-aware/chromatic + octave fold + snap-to-zero + Next (3.x), Now (4.1), bake dialog + lockstep loops (5.x), export dummy (6.1), persistence/sync (1.2/2.1/6.2), docs (6.3). All spec sections mapped.
- **Open items deferred to execution** (each flagged inline with a NOTE): exact pfx/TARP/automation-clear helper names in the convert path; exact OLED coordinates for the grid; exact held-note record reused for Now retrigger; the scale-aware accessor name; whether the sidecar needs a version bump. These require reading the specific function at execution time and are not guessable without it — the executor resolves them by reading the cited anchors.
- **Type/name consistency:** DSP keys `cndt`, `tN_cC_cond_resp/_oct/_when`, `tN_convert_to_conduct`, get `conductor_track`; JS state `conductorTrack`, `condActiveClip`, `condResp/condOct/condWhen`, bank consts `BANK_RESPONDER/OCTAVE/WHEN`; helpers `trackColor/trackDimColor`, `note_abs_degree`, `conductor_set_offset_from_note/conductor_clear_offset`. Used consistently across tasks.

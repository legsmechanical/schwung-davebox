# Drum AUTO Bank — Full Engine Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AUTO / CC-automation bank (bank index 6) function identically on drum tracks and melodic tracks — recording, playback, step-editing, per-param loop length, LED states, and pads — because CC automation is track-level (emits on the track's channel/route) and is NOT drum-lane-aware.

**Architecture:** A prior commit (`6615403`) un-gated the bank-6 *display/nav/transport* paths but left the *input* and *DSP* paths melodic-only. This plan removes the remaining `pad_mode == MELODIC` / `PAD_MODE_DRUM` gates in three layers: (1) DSP record/playback in `render_block` + the `cc_send`/`live_at`/stop-re-emit handlers, driving the playhead off the lane-independent master clock (`_abs_tick`) since drum tracks freeze the track-level playhead; (2) JS input handlers (touch-record, step-edit, delete/clear, double-fill); (3) LED + pad rendering. No struct or state-format changes — `clip_cc_auto[]`/`clip_at_auto[]` already exist and persist for drum clips, so **no state-version bump**.

**Tech Stack:** C DSP (`dsp/seq8.c` + `dsp/seq8_set_param.c`, single translation unit), off-device native test harness (`tests/run.sh`), QuickJS UI (`ui/ui.js`, `ui/ui_leds.mjs`, esbuild bundle via `scripts/bundle_ui.sh`), Move device deploy via `scripts/install.sh`.

**Verification model:** DSP logic changes use the native harness (`tests/run.sh`) FIRST per `dsp/CLAUDE.md`, then on-device. JS/LED/pad changes are device-verified (no JS harness exists). Build DSP with `./scripts/build.sh` (Docker, GLIBC ≤ 2.35).

**Reference (working melodic behavior to mirror):**
- DSP CC playback + latch record + AT: `dsp/seq8.c:11277-11381`
- DSP `cc_send` record latch: `dsp/seq8_set_param.c:3213`
- DSP `live_at` record: `dsp/seq8_set_param.c:5659`
- DSP transport-stop rest re-emit: `dsp/seq8_set_param.c:371-383`
- JS knob-write (already unified): `ui/ui.js:9991-10093`

---

## Phase 1 — DSP: CC + AT record & playback on drum tracks

The structural fact (from `dsp/seq8.c:11392-11419`): drum tracks advance only per-lane counters; `tr->current_step`/`tr->tick_in_step` are frozen. The CC engine's default path reads the playhead from those (`_ct`, line 11281). BUT `_abs_tick` (master clock, line 11286) is already computed and the per-CC-lane-loop path already uses it (line 11303). Fix = drive the default `_ct`, the AT `_ct`, and the latch `_rec_tick` from `_abs_tick` wrapped to the active clip window when the track is drum, and remove the `pad_mode == MELODIC` gates.

### Task 1: Harness test — drum CC automation records and plays back

**Files:**
- Test: `tests/test_drum_cc_automation.c` (create)
- Reference: `tests/README.md`, `tests/test_smoke.c` (white-box `hx_*` API)

- [ ] **Step 1: Write the failing test**

```c
/* test_drum_cc_automation.c — CC automation must record + play back on a DRUM track,
 * identically to melodic. Automation is track-level (emits on the track channel),
 * not drum-lane-aware. White-box harness (#includes seq8.c via harness.h). */
#include "harness/harness.h"

static void test_drum_cc_records_and_plays(void) {
    hx_t *h = hx_create();
    /* Make track 0 a drum track: first tN_lL_* write allocates drum clips + sets pad_mode
     * (see dsp/CLAUDE.md "Drum clip allocation"). Use a benign lane write. */
    hx_set_param(h, "t0_l0_clip_length", "16");
    seq8_track_t *tr = &h->inst->tracks[0];
    HX_ASSERT(tr->pad_mode == PAD_MODE_DRUM, "track 0 should be drum after lane write");

    /* Assign knob 0 to CC 74 (type 0). */
    hx_set_param(h, "t0_cc_type_assign", "0 0 74");

    /* Arm record + start playing, then latch knob 0 by sending a live value. */
    hx_set_param(h, "t0_recording", "1");
    tr->clip_playing = 1;            /* white-box: simulate transport running */
    hx_set_param(h, "t0_cc_send", "0 100");   /* knob 0 -> value 100, latches */

    /* Advance enough ticks for the latch-record to write at least one point. */
    hx_render(h, 64);

    cc_auto_t *ca = &tr->clip_cc_auto[tr->active_clip];
    HX_ASSERT(cc_auto_has_points(ca, 0), "knob-0 lane should have recorded points on a drum track");

    /* Stop recording; verify playback emits the recorded CC on the track channel. */
    hx_set_param(h, "t0_recording", "0");
    hx_clear_capture(h);
    hx_render(h, 64);
    HX_ASSERT(hx_seen_cc(h, tr->channel & 0x0F, 74), "recorded CC 74 should play back on a drum track");

    hx_destroy(h);
}

int main(void) {
    test_drum_cc_records_and_plays();
    return hx_report();
}
```

- [ ] **Step 2: Add the harness helpers the test needs (if missing)**

Check `tests/harness/harness.h` for `cc_auto_has_points`, `hx_seen_cc`. If absent, add minimal white-box helpers:
```c
/* cc_auto_has_points: any non-empty lane breakpoint store for knob k. */
static inline int cc_auto_has_points(cc_auto_t *ca, int k) { return ca->lane_count[k] > 0; }
/* hx_seen_cc: scan captured MIDI for a CC (0xB0|ch, num, any val). */
int hx_seen_cc(hx_t *h, int ch, int num);
```
(Match the actual `cc_auto_t` field names in `dsp/seq8.c` — grep `cc_auto_t` for the breakpoint count field; adjust `lane_count` accordingly.)

- [ ] **Step 3: Run the test — verify it FAILS**

Run: `tests/run.sh`
Expected: `test_drum_cc_automation` FAILS — `cc_auto_has_points` is false (record latch gated to melodic at `seq8_set_param.c:3213`) and/or no CC plays back (engine gated at `seq8.c:11277`).

### Task 2: Un-gate the `cc_send` record latch

**Files:** Modify `dsp/seq8_set_param.c:3213`

- [ ] **Step 1: Drop the melodic-only condition (keep `tr->recording`)**

Find (around `seq8_set_param.c:3213`):
```c
if (tr->recording && tr->pad_mode == PAD_MODE_MELODIC_SCALE) {
```
Change to:
```c
if (tr->recording) {
```
(Live emit above this is already ungated; this is the latch that sets `cc_latched` so `render_block` writes the lane.)

### Task 3: Un-gate the `live_at` record path

**Files:** Modify `dsp/seq8_set_param.c:5659`

- [ ] **Step 1: Drop the melodic-only condition**

Find (around `:5659`):
```c
if (tr->recording && tr->pad_mode == PAD_MODE_MELODIC_SCALE) {
```
Change to:
```c
if (tr->recording) {
```

### Task 4: Un-gate the CC/AT playback engine + drive the playhead from `_abs_tick` on drum

**Files:** Modify `dsp/seq8.c:11277-11381`

- [ ] **Step 1: Change the block gate to run for drum (with the drum_clips guard)**

Find:
```c
if (tr->pad_mode == PAD_MODE_MELODIC_SCALE && tr->clip_playing) {
```
Change to (per `dsp/CLAUDE.md`: every drum path in render_block must guard `drum_clips[active_clip]`):
```c
if (tr->clip_playing &&
    (tr->pad_mode != PAD_MODE_DRUM || tr->drum_clips[tr->active_clip])) {
```

- [ ] **Step 2: Compute a drum-safe default playhead `_ct`**

The default `_ct` (line 11281-11282) is frozen on drum. Replace its computation so drum derives it from the already-present `_abs_tick` (line 11286) wrapped to the clip window. Move the `_abs_tick` computation ABOVE `_ct`, then:
```c
uint32_t _abs_tick = (uint32_t)inst->global_tick * (uint32_t)TICKS_PER_STEP
                   + (uint32_t)inst->master_tick_in_step;
uint32_t _tps = _acl->ticks_per_step;
uint32_t _winlen = (uint32_t)_acl->length * _tps;            /* clip window in ticks */
uint32_t _ct;
if (tr->pad_mode == PAD_MODE_DRUM) {
    _ct = (uint32_t)_acl->loop_start * _tps
        + (_winlen ? (_abs_tick % _winlen) : 0);              /* master-clock-driven */
} else {
    _ct = (uint32_t)tr->current_step * _tps + tr->tick_in_step; /* unchanged melodic */
}
```
Keep `_ws`/`_we` as-is. The per-CC-lane-loop path (11291-11304) already uses `_abs_tick` → unchanged and works for drum as-is.

- [ ] **Step 3: Drive the latch-record default `_rec_tick` from the same `_ct`**

At line 11341-11343 the no-lane-length fallback uses `_ct`. Since `_ct` is now drum-correct, no change is needed there — confirm it reads the new `_ct`. (The lane-length path at 11340 already uses `_abs_tick`.)

- [ ] **Step 4: AT playback uses `_ct`**

The AT block (11371) evaluates at `_ct` — now drum-correct. No change beyond Step 2.

- [ ] **Step 5: Run the harness — verify Task 1 test PASSES**

Run: `tests/run.sh`
Expected: `test_drum_cc_automation` PASS (records points + plays back the CC on the track channel). All other tests still green.

### Task 5: Un-gate the transport-stop resting-value re-emit

**Files:** Modify `dsp/seq8_set_param.c:371-383`

- [ ] **Step 1: Remove the drum skip**

Find (around `:373`):
```c
if (_tr->pad_mode != PAD_MODE_MELODIC_SCALE) continue;
```
Delete that line so drum tracks also re-assert `rest_val[]` on stop.

- [ ] **Step 2: Add a harness assertion for stop re-emit**

In `test_drum_cc_automation.c`, after setting a resting value on a drum track and toggling transport to stopped, assert the resting CC is re-emitted. Run `tests/run.sh` → PASS.

### Task 6: Build, deploy, device-verify Phase 1

- [ ] **Step 1: Build the DSP**

Run: `./scripts/build.sh && nm -D dist/davebox/dsp.so | grep GLIBC`
Expected: build OK; all GLIBC symbols ≤ 2.35.

- [ ] **Step 2: Deploy + device-verify**

Run: `./scripts/install.sh` (scp + restart). On device, drum track, AUTO bank: arm record + play, turn a knob → automation records and plays back on the next loop; stop → resting values hold. Confirm melodic AUTO bank unchanged.

- [ ] **Step 3: Commit**

```bash
git add dsp/seq8.c dsp/seq8_set_param.c tests/test_drum_cc_automation.c tests/harness/harness.h
git commit -m "fix(dsp): record + play back CC/AT automation on drum tracks (master-clock playhead)"
```

---

## Phase 2 — JS: input-handler guards (touch-record, step-edit, delete/clear, double-fill)

All sites from the JS audit. Bundle with `scripts/bundle_ui.sh` after each cluster; device-verify.

### Task 7: Un-gate touch-record arm/disarm (the JS half of "knob doesn't record")

**Files:** Modify `ui/ui.js:12237-12239`, `ui/ui.js:12293-12294`

- [ ] **Step 1: Remove the drum guard on touch-record arm**

At ~`ui.js:12237`, the `cc_touch` engage is wrapped in `S.activeBank === 6 && ... && S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM`. Remove the `&& S.trackPadMode[...] !== PAD_MODE_DRUM` term so touch-record arms on drum.

- [ ] **Step 2: Remove the drum guard on touch-record disarm (lockstep)**

At ~`ui.js:12293`, remove the matching `&& ... !== PAD_MODE_DRUM` so touch-record disengages on release for drum. (Must change together with Step 1.)

- [ ] **Step 3: Bundle + device-verify**

Run: `bash scripts/bundle_ui.sh && ./scripts/install.sh`. On drum AUTO bank: touch a knob while armed+playing → lane latches and records (pairs with Phase 1 DSP latch).

### Task 8: Step-editing — un-gate CC step editor + bank-gate the drum trig editor (atomic set)

**Files:** Modify `ui/ui.js:9298`, `ui/ui.js:9250`, `ui/ui.js:10034`

- [ ] **Step 1: Bank-gate the drum note trig-condition editor**

At ~`ui.js:9297`, the drum trig editor fires on `S.heldStep >= 0 && S.heldStepNotes.length > 0 && drum` with NO bank check, shadowing bank 6. Add `&& S.activeBank !== 6` to its condition so it does not fire on the AUTO bank.

- [ ] **Step 2: Un-gate the CC step editor for drum**

At ~`ui.js:9250`, remove `S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM` from `_onCC_stepedit`'s bank-6 condition so held-step + knob writes CC automation at the step on drum.

- [ ] **Step 3: Simplify the held-step bail in the knob handler**

At ~`ui.js:10034`, change:
```js
if (S.heldStep >= 0 && S.trackPadMode[t] !== PAD_MODE_DRUM) return;
```
to:
```js
if (S.heldStep >= 0) return;
```
so drum defers to the (now-enabled) CC step editor instead of double-writing via the normal path.

- [ ] **Step 4: Bundle + device-verify**

On drum AUTO bank: hold a step + turn a knob → writes a per-step automation point (not a drum-note trig edit). On DRUM LANE bank: hold a step + knob still edits drum-note trig conditions (unchanged). No double-writes.

### Task 9: Remaining simple guard removals

**Files:** Modify `ui/ui.js:8080`, `ui/ui.js:8097-8099`, `ui/ui.js:12210`, `ui/ui.js:12224-12225`, `ui/ui.js:11593`

- [ ] **Step 1: Loop+Delete lane reset (`:8080`)** — remove `!== PAD_MODE_DRUM` (the sibling reset at `:8410` already has no guard).
- [ ] **Step 2: Clear-Automation menu arm (`:8097`)** — remove the `!== PAD_MODE_DRUM` term.
- [ ] **Step 3: Knob-touch sets `ccActiveLane` (`:12210`)** — remove the drum guard (the knob-turn at `:9996` already sets it unconditionally).
- [ ] **Step 4: Delete+knob-touch clear (`:12224`)** — remove the drum guard (Delete+turn at `:10037` is already unified).
- [ ] **Step 5: Shift+Step15 double-fill (`:11593`)** — first READ `doLaneDoubleFill()` to confirm no melodic-only assumptions; if clean, route drum AUTO bank to `doLaneDoubleFill()` (per-CC-lane double) like melodic. If it has melodic assumptions, leave and note it.
- [ ] **Step 6: Bundle + device-verify; commit**

```bash
git add ui/ui.js
git commit -m "fix(auto): un-gate CC-automation input paths on drum (touch-record, step-edit, clear, double-fill)"
```

---

## Phase 3 — LED states + pads

### Task 10: Step-LED gradient + loop-pages on drum AUTO bank

**Files:** Modify `ui/ui_leds.mjs` (the bank-6 block at ~`:260` and the loop-pages block at ~`:139`)

- [ ] **Step 1: Hoist the bank-6 CC step-LED block above the drum branch**

In `updateStepLEDs()`, the drum branch (~`:201`) returns at ~`:254` BEFORE the bank-6 CC gradient/playhead block (~`:260`). Add an early `if (S.activeBank === 6) { ...CC gradient/playhead... return; }` ahead of the `PAD_MODE_DRUM` branch (mirror the knob-LED ordering which is already unified at ~`:793`), so drum AUTO shows the CC automation gradient + playhead + breakpoint blips.

- [ ] **Step 2: Loop-pages view uses the CC lane window on bank 6**

At ~`:139`, when `S.activeBank === 6`, compute the Loop-held page pulse from the active CC lane's window (`ccLaneLength`/`ccLaneLoopStart`) regardless of pad mode, instead of `drumLaneLength`.

- [ ] **Step 3: Bundle + device-verify**

On drum AUTO bank: step LEDs show the automation gradient + moving playhead; Loop-held pages reflect the CC lane window.

### Task 11: Drum AUTO pads — gray, still play sounds

**Files:** Modify `ui/ui_leds.mjs` (drum pad grid ~`:592-693`, note the existing `_autoGrey = S.activeBank === 6` flag at `:693`), `ui/ui.js` (`_onPadPressTrackView` drum path ~`:10386`)

- [ ] **Step 1: Read the pad paths first**

Read `ui_leds.mjs:592-693` (drum pad LED grid: cols 0-3 lane selectors, cols 4-7 vel zones, plus `_autoGrey`) and `ui.js:10386` `_onPadPressTrackView` drum branch to see whether the AUTO bank currently routes pads to lane-selection vs sound-play.

- [ ] **Step 2: LED — render drum AUTO pads gray**

Use/extend the existing `_autoGrey` flag so on `S.activeBank === 6` the drum pad grid renders as gray automation pads (matching melodic) instead of lane-selector/vel-zone colors.

- [ ] **Step 3: Input — pads play drum sounds on the AUTO bank**

Ensure the drum pad press on bank 6 triggers the drum sound (same path other drum banks use to sound a lane), NOT lane-selection. Mirror how the melodic AUTO bank still plays notes. Verify with the existing `drum_record_note_on`/live-note path (`ui.js:6986`, `:10671`).

- [ ] **Step 4: Bundle + device-verify; commit**

On drum AUTO bank: pads are gray and play the drum sounds. Commit:
```bash
git add ui/ui_leds.mjs ui/ui.js
git commit -m "feat(auto): drum AUTO pads gray + sound-playing, CC step-LED gradient on drum"
```

### Task 12 (DEFERRED — confirm with user before doing): record drum hits into lanes from the AUTO bank

Melodic tracks can record notes into the clip from the AUTO bank while armed. The drum equivalent — recording drum hits into their lanes from the AUTO bank pads while record is on — is explicitly deferred (user: "we can defer that if it's complicated"). When picked up: route the bank-6 drum pad press through the same `drum_record_note_on` recording path used on the DRUM LANE bank while `recordArmed`. Investigate `_onPadPressTrackView` drum-record branch (`ui.js:10671`) for bank gating; add a harness test for drum note recording from bank 6 if the DSP path differs.

---

## Self-Review Notes

- **Spec coverage:** recording (Tasks 2,7), playback (Task 4), step-edit (Task 8), per-param loop length (Task 4 lane-length path already `_abs_tick`-driven + Task 10 Step 2), LED states (Task 10), pads gray+playing (Task 11), record-into-lanes (Task 12, deferred). ✔
- **No state bump:** `clip_cc_auto[]`/`clip_at_auto[]` pre-exist for drum clips; storage + save/load already ungated. ✔
- **Risk:** Task 4 touches RT `render_block` timing (has crashed the device before). Mitigations: harness TDD first (Task 1), `_abs_tick` already proven in the per-lane path, melodic path left byte-identical (drum-only branch), GLIBC audit, no struct change. Verify melodic regression on device after Task 6.
- **Drum playhead semantics:** all 8 CC knobs share ONE timeline (not 32 lanes) — driven by `_abs_tick` wrapped to the clip window / each lane's own loop length, never by per-drum-lane counters. Matches "automation is not drum-lane-aware."

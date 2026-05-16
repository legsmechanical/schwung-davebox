# Phase 1 Plan — Inbound MIDI Rewire

**Status:** Planning. Not started. Decisions captured below; written for non-technical walkthrough.

Companion to: `notes/audit-davebox-arch.md` (the deep audit).

---

## What Phase 1 does (plain English)

Today, when you press a pad on Move:
1. Move firmware sends a MIDI message.
2. The Schwung shim hands it to JavaScript.
3. JavaScript runs a stack of input transformations (scale-aware pitch, velocity scaling, Rpt1/Rpt2 logic, count-in preroll, etc.) and *queues* the result into a buffer.
4. On the next JavaScript "tick" (~94 times per second), JavaScript drains that buffer and sends a `set_param` message to the DSP.
5. DSP receives the note and records / plays / emits it.

That's the **slow-brain stack**: steps 2–4 add unpredictable delay and cause the chord-drop / chord-stagger bugs we've been fighting.

**Phase 1 deletes steps 2–4.** Instead:
1. Move firmware sends MIDI.
2. The shim hands it directly to DSP on the audio thread.
3. DSP runs the input transformations natively (in C, at audio-block cadence — ~375 times per second instead of 94, and with deterministic timing).
4. DSP records / plays / emits the note.

Result: chord cohesion preserved by design, lower latency, no more JS-tick timing band-aids.

---

## Why we need to patch Schwung

The Schwung shim already receives pad-press MIDI from Move. It just routes those messages to "chain slot" plugins — not to overtake tools like dAVEBOx. Without a shim patch, dAVEBOx's new DSP entry point would sit empty, never called.

The patch is ~10–20 lines and adds one delivery site in the shim: "when you see an internal pad press, also hand it to the overtake tool's DSP." Mirrors two existing delivery sites that already work (external USB MIDI, external clock).

**This patch is load-bearing.** Without it, all we'd be doing is reshuffling JS code, which won't fix the slow-brain problem.

---

## The capability gate (safety net for stock-Schwung users)

dAVEBOx ships publicly via Module Store. Most users run plain (unmodified) Schwung. If Phase 1 deletes the JS path entirely, those users would launch dAVEBOx and pads would silently do nothing.

**Capability gate:** at startup, dAVEBOx checks whether the patched Schwung is delivering pad MIDI to its DSP.
- **Yes → patched Schwung:** new fast path is live. JS skips its enqueue entirely.
- **No → stock Schwung:** fall back to today's JS path.

The user never sees the gate. It's silent. On patched Schwung the new architecture owns the input path entirely; the JS path is *quarantined to stock-Schwung compatibility*, not used as a fallback we'd reach for on the fork.

This is the same capability-gate pattern already documented in `docs/SCHWUNG_PATCHES.md` and used today for chain-edit / Move-native co-run (`typeof shadow_xxx === 'function'` runtime check). Phase 1 reuses the established pattern, not inventing a new one.

---

## Three bundles, three branches

Each bundle is its own branch off `main`. Land on main only after device-verifying. Cut a release between bundles. If we abandon mid-refactor, unmerged branches just go away; main is untouched.

### Bundle 1 — Skeleton + scale-aware port (M, 3–4 days)
What it does:
- Populate the empty `on_midi` function in DSP so it can receive MIDI on the audio thread.
- Port "pad number → resolved pitch" logic (`computePadNoteMap`) from JS to C.
- Patch the Schwung shim to deliver internal pad presses to that new entry point.
- Add the capability gate in JS.

User-visible win: **chord stagger / chord drops fixed by design.** Lower input latency.

**Day-1 task before any shim edits:** read the existing fork diff (`~/schwung/patches/davebox-local.patch`) and identify the exact insertion point in `schwung_shim.c` for the new pad-delivery site. The existing Move-native co-run patch already modifies the overtake-2 forward area (~line 6515); the new delivery site needs to be planned to coexist cleanly. Result: a one-paragraph note in the Bundle 1 commit log identifying the chosen insertion point and why it doesn't conflict with the existing patch.

### Bundle 2 — VelIn + velocity zones + Rpt1/Rpt2 (M, 4–6 days)
What it does: port the velocity-scaling, drum velocity-zone, and Rpt1/Rpt2 dispatch logic from JS to DSP. These are coupled (Rpt consumes vel zones; VelIn needs zone bypass), so land them as one bundle in the order: vel zones → VelIn → Rpt.

User-visible win: cleaner velocity expression, no more JS-tick wobble on Rpt patterns.

### Bundle 3 — Count-in preroll (M, 3–5 days)
What it does: port the preroll capture buffer + chord drain + gate-after-toggle pattern to DSP. Replaces the JS-tick → DSP-tick ratio with native DSP-tick timing. Preserves the TARP-on bail-out exactly.

User-visible win: tighter feel on count-in capture, especially for chords pressed during preroll.

**Required device test before Bundle 3 lands:**
- TARP-on track + count-in armed → press a 3-note chord during preroll → confirm chord is NOT recorded into the clip, and arp output IS recorded. (This is the bail-out behavior the JS path has today; Bundle 3 must preserve it byte-for-byte.)

### Cleanup (XS–S, folds into final bundle)
Delete `pendingLiveNotes`, `_drainLiveNotes`, `queueLiveNoteOn/Off`, `tN_live_notes` payload parser, JS preroll arrays. Looper / scale-transpose-output / TARP aggregation are *already* DSP-native — just delete the JS no-ops.

**Also review/rebalance JS-tick-calibrated timeout constants** (`STEP_HOLD_TICKS`, `NO_NOTE_FLASH_TICKS`, `STEP_SAVE_HOLD_TICKS`, `STEP_SAVE_FLASH_TICKS`, etc.). These were calibrated for ~94 Hz JS-tick assumptions. Phase 1 doesn't change the JS tick rate itself, but any constants that paired with the JS-driven note path may become dead code once that path is gone. Audit each: delete if unreachable, rebalance if still active.

---

## Coexistence with existing Schwung patches

**What's already on the fork (`legsmechanical/schwung:main`):**
- **Chain-edit co-run** (5 commits) — pure JS-side input intercept in `onMidiMessageInternal`. Does NOT touch shim MIDI delivery flow. **No interaction with Phase 1.**
- **Move-native co-run** (2 commits) — modifies the shim filter list at the overtake-2 forward in `schwung_shim.c` (~line 6515). Filters nav-CCs / touch-notes out of the JS dispatch path during co-run. **Does not filter pads** — pads always flow through.

**The conflict point:** `schwung_shim.c` is the file Phase 1's new pad-delivery site has to land in. Move-native co-run already lives there. Not a design conflict — the new delivery is additive — but **every upstream Schwung rebase will require manual conflict resolution in this file** as both patch families touch overlapping line ranges.

**What's safe:**
- `shadow_drain_ui_midi_dsp` (the optional second patch for full MPE, JS-routed CC/AT/PB → overtake) is **untouched** by existing patches. Clean surface.
- `shadow_constants.h` reserved-bytes consumption is layout-stable; Phase 1 grabs the next byte if needed.
- `shadow_ui.c` / `shadow_ui.js` are touched by chain-edit co-run but Phase 1 doesn't need to modify either (no new JS bindings; state queryable via existing `get_param`).
- Pad-flow promise is preserved: Move-native co-run explicitly keeps pads flowing to the tool during co-run; Phase 1's new audio-thread path inherits the same promise.

**Three filter lists to keep in mind** (only two exist today, Phase 1 adds the third):
1. `sh_midi` filter — what Move firmware reads.
2. `shadow_ui_midi_shm` forward filter — what JS dispatches.
3. **NEW: overtake `on_midi` delivery** — what DSP audio thread receives.

Today's two are mirrors of each other (per `docs/SCHWUNG_PATCHES.md` line 170). Phase 1's third path mirrors them for pads (always delivered). If a future co-run-like feature wants to gate pads from DSP too, all three need synchronized updates — worth flagging in the patch itself.

---

## Rollback / safety

The git branch IS the safety net.

**dAVEBOx side:**
- Each bundle on its own branch off `main`. Today's working code stays on `main`, untouched.
- Ship a bundle: fast-forward merge.
- Abandon: don't merge. Delete the branch. Main never knew.

**Schwung patch side — mechanics:**

Patches live on the **fork** (`legsmechanical/schwung`), not in this repo. The patch artifact `patches/davebox-local.patch` is regenerated from the fork's branches and committed to the fork as a snapshot for reproducibility.

Two-branch model for Phase 1:
- **`legsmechanical/schwung:main`** — current co-run patches (chain-edit + Move-native). Untouched during Phase 1 dev.
- **`legsmechanical/schwung:phase-1-inbound`** — new pad-delivery + audio-thread surface. Branched off `main`. All Phase 1 shim work commits here.

For dev/test: check out `phase-1-inbound` in `~/schwung`, build, deploy. The shim Move runs is built from this branch; both old (co-run) and new (Phase 1) patches are active simultaneously.

For deploy to users:
- **Option A (recommended):** when Phase 1 ships, merge `phase-1-inbound` → `main`. Regenerate `patches/davebox-local.patch` to include all patches. Ship as a single shim bundle.
- **Option B:** keep two patches as separate files (`patches/davebox-local.patch` + `patches/davebox-inbound.patch`), maintain a `dist` branch that merges both for builds. More overhead, isolates the patch domains.

**To roll back to today's behavior:**
1. In `~/schwung`: `git checkout main && ./scripts/build.sh`. Deploy the resulting `schwung-shim.so` to `/data/UserData/schwung/`. Reboot.
2. In `~/schwung-davebox`: `git checkout main && ./scripts/install.sh`. Reboot.

You're back to exactly today's behavior — the Phase 1 fork branch is unmerged and inert.

**Why separate fork branches (not commits on one branch):**
A clean-slate rebuild shouldn't pattern-match against the existing co-run patch code. Two branches means the new architecture is developed against vanilla upstream Schwung + the audit's understanding, not via osmosis from existing patches. If Phase 1 is abandoned, the branch is simply not merged — nothing on `main` to clean up.

---

## Open question — feasibility validation

**High confidence, not 100% confidence.** We know from source reading that the audio-thread plumbing exists. What we *don't* know empirically:
- No overtake tool today exercises `on_midi` consumption — the wiring is real but the consumer pattern is unproven on this platform.
- Move firmware's pad-press timing under chord load — assumed reasonable, not measured.

**Pre-Phase-1 validation probe (½–1 day):**
1. Add a 5-line `on_midi` body in `dsp/seq8.c` that just logs received events via `seq8_ilog`.
2. Add a ~10-line shim patch that delivers internal pad notes to overtake `on_midi`.
3. Deploy. Press pads. Confirm events appear in `seq8.log` with sane timing.
4. **Pass → green-light Phase 1 with high confidence.**
5. **Fail → diagnose obstacle before investing three weeks.**

**Pre-Phase-1 baseline probe (½ day):**
- TARP-armed track, single 4-note chord pad press.
- Capture `seq8.log` note-on timestamps with `debug_log` enabled.
- Repeat after Bundle 1.
- One scenario, two captures. Quantifies the chord-stagger improvement.

Both probes are cheap. Recommend doing them as Day 1 of Bundle 1.

---

## Total effort estimate

**~3 weeks** at sustained pace.
- Bundle 1: 3–4 days (was 2–3 before the Schwung patch was confirmed required).
- Bundle 2: 4–6 days.
- Bundle 3: 3–5 days.
- Probes + device verification + release cuts: ongoing.

---

## Risks flagged

- **Rpt2 stability** — per audit, Rpt2 is the less mature of the two; handle carefully in Bundle 2.
- **Preroll TARP-on bail-out semantics** — must be preserved exactly in Bundle 3.
- **Held-step coalescing under chord-spanning external MIDI** — known coalescing failure mode; severity unknown. Phase 1's `on_midi` path likely resolves it as a side effect.
- **Schwung rebase risk** — `schwung_shim.c` is touched by both the existing Move-native co-run patch AND Phase 1's new delivery site. Every upstream Schwung version bump will require manual conflict resolution in this file. Splitting Phase 1's work onto a separate fork branch isolates the patch domains but doesn't eliminate the rebase conflict — it relocates it from "patch authoring" to "branch merging." Expect 15–30 min of manual conflict resolution per Schwung upgrade going forward.

---

## Decision log

1. **Branch strategy:** per-bundle branches off `main`. Each bundle is its own deployable unit. ✓
2. **Capability gate:** keep it. Acts as quarantine wall for stock-Schwung users; new architecture owns the input path on patched Schwung. ✓
3. **Pre-Phase-1 device probes:** lightweight feasibility probe + chord-stagger baseline, both Day 1 of Bundle 1. ✓
4. **Patch location:** new fork branch `legsmechanical/schwung:phase-1-inbound` off `main`. Existing `:main` (co-run patches) untouched. Patch artifacts live on the fork at `patches/*.patch` — NOT in `schwung-davebox`. ✓

---

## Next steps when we pick this up

1. Walk through this doc together first.
2. In `~/schwung-davebox`: cut branch `phase-1-bundle-1` off `main`.
3. In `~/schwung` (fork): cut branch `phase-1-inbound` off `main`.
4. Read the existing fork diff to identify the shim insertion point (Bundle 1 Day-1 task).
5. Run feasibility probe (5-line DSP log + 10-line shim patch on the fork branch).
6. If green: proceed to full Bundle 1 implementation.

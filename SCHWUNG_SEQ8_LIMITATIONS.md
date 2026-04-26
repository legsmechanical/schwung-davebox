# Schwung Framework — SEQ8 Limitations & Lessons

Practical lessons learned building SEQ8 within the Schwung framework. Complements
CLAUDE.md (which documents what's built); this document explains *why* things are
built the way they are and what to watch for in future work.

---

## 1. JS Mirror (`clipSteps`) Can Diverge From DSP State

`clipSteps[t][c][s]` is the JS-side model of what's in each step. It is populated
from DSP `get_param` calls and updated optimistically after `set_param` commands.

**The divergence problem**: `_steps` returns the *display position* of each note
(midpoint-based: `(tick + 12) / 24 % len`), not the *data position* (which slot
owns the note). When a note is nudged past a step's midpoint, `_steps` reports it
in the adjacent step even though the data still lives in the original slot.

When `pollDSP` re-reads `_steps` while a step is held, it populates `clipSteps`
with display positions. This means:
- `clipSteps[dstStep]` gets set to 1 even though `dstStep` has no data
- Tap-toggle on that step sees `wasOn=true` and sends a deactivate command to an
  empty DSP slot — data corruption
- Any guard like `if (clipSteps[dst] === 0)` checking "is destination empty" fails

**Pattern that works**: while a step is held and the poll is updating `clipSteps`
for live preview, do not use `clipSteps` as the authoritative data model. After
release, fire a deferred re-read (`pendingStepsReread`) to resync the mirror from
the ground truth (DSP).

**Opportunity**: a dedicated `displaySteps` buffer separate from `clipSteps` would
cleanly separate "where notes fire" (display) from "where data lives" (editing).
The current approach uses the same array for both, which requires careful management
of when each meaning is in effect.

---

## 2. Hold-vs-Tap Disambiguation: `stepBtnPressedTick` Is Cleared Before Release

When the hold threshold fires (~200ms), the hold detection code sets
`stepBtnPressedTick[heldStepBtn] = -1` to close the tap window. The button release
event fires later — but at that point, `stepBtnPressedTick` is already `-1` for
*both* the tap path (cleared inside the tap branch) and the hold path (cleared at
threshold). You cannot check `stepBtnPressedTick >= 0` at release time to determine
which path occurred.

**The fix**: a separate boolean `stepWasHeld` set to `true` only when the hold
threshold fires. Cleared on press and on all step-cancel paths. The release handler
checks `stepWasHeld` to determine if the hold path occurred.

**Generalizes**: any logic that must run "only on hold-release, not tap-release"
needs its own flag. The timing of `stepBtnPressedTick` makes it unusable for this
purpose at release time.

---

## 3. `set_param` Is Fire-and-Forget; Confirmation Requires a Subsequent Tick

`host_module_set_param` sends to the DSP audio thread asynchronously. There is no
return value or acknowledgment. A `get_param` call in the *same* JS tick reads
pre-set_param state (the audio thread hasn't processed it yet).

**Pattern for confirmation**: optimistic local update + deferred re-read.
1. Apply the change optimistically to the JS mirror (e.g. `clipSteps[src] = 0`)
2. Send `set_param` (e.g. `_reassign`)
3. Set `pendingStepsReread = 2` (2-tick countdown)
4. When countdown reaches 0, do `get_param("_steps")` and overwrite the mirror

The 2-tick delay ensures the audio thread has processed the command before JS reads
back the result. A 1-tick delay is usually sufficient but 2 is safer under load.

**Corollary**: `pendingDspSync` (5 ticks after `state_load`) follows the same
pattern but uses a longer delay because state load is heavier than a single command.

---

## 4. Multi-Field Operations Must Be Expressed as One Atomic DSP Command

The coalescing constraint (last `set_param` per JS tick wins) means a sequence of
JS `set_param` calls that logically form one operation will drop all but the last.
Worse: `pollDSP` runs every 4 ticks and restores stale JS-side state from DSP
between calls, so even across ticks, JS reading back partial state during a
multi-step JS-driven sequence sees inconsistent results.

**The rule**: any operation that must atomically modify multiple DSP fields should
be implemented as a single DSP command (like `_reassign`, `tN_pfx_reset`, `panic`,
`deactivate_all`). Do not try to build atomic multi-field operations from sequences
of JS `set_param` calls.

**Example that failed before `_reassign` existed**: trying to move step data by
doing `set_param(_clear, src)` + `set_param(_toggle, dst, note)` across ticks —
the render thread fires between ticks and could play notes from the wrong state.

---

## 5. `clip_migrate_to_notes` Is the Synchronization Point

The DSP maintains two representations of clip data:
- Step arrays (`step_notes`, `step_note_count`, `note_tick_offset`, `steps`) — the
  editing model; addressed by step index
- `notes[]` array — the absolute-position playback model; addressed by absolute tick

Every `set_param` command that modifies step arrays must call `clip_migrate_to_notes`
at the end to rebuild `notes[]` from the step data. Missing this call leaves `notes[]`
stale and playback will not reflect the edit.

All existing DSP commands (`_toggle`, `_add`, `_clear`, `_reassign`, etc.) call it.
Any new DSP command that touches step data must also call it.

**Direction of truth**: step arrays → `notes[]` (one-way rebuild). Never modify
`notes[]` directly; always go through step arrays. The exception is the recording
path which appends to `notes[]` directly for performance, then calls
`clip_build_steps_from_notes` (the reverse) at specific points.

---

## 6. `steps[s] == 0` No Longer Means "No Data"

Before Phase K (inactive steps), the invariant was: `steps[s] == 1` iff
`step_note_count[s] >= 1`. Code throughout the DSP used `if (!cl->steps[sidx]) return`
as a guard meaning "nothing here, ignore."

After Phase K, a step can have `step_note_count[s] > 0` with `steps[s] == 0`
(inactive-with-notes = dark gray LED). Guards that used `!steps[sidx]` as "empty"
will silently skip inactive steps and prevent editing them.

**The correct guard** for "nothing to act on" is:
```c
if (cl->step_note_count[sidx] == 0) return;
```

Any new DSP command operating on step data should use this guard. The `steps[sidx]`
field now means only "will this step generate MIDI output" — not "does data exist."

---

## 7. `notes[]` Tombstones Accumulate; `note_count` Doesn't Shrink on Removal

When a note is removed (via `_toggle`, `_clear`, etc.), its slot in `notes[]` is
tombstoned (`active = 0`) but `note_count` is not decremented — the slot is not
reclaimed. `clip_migrate_to_notes` rebuilds `notes[]` from scratch (which does
reclaim all tombstones), but individual note removals accumulate tombstones until
the next full rebuild.

`MAX_NOTES_PER_CLIP = 512`. A clip with 256 steps × 8 notes = 2048 logical slots,
but the hard ceiling of 512 means fully dense clips are only possible up to ~64
active steps. In practice, `clip_migrate_to_notes` is called after every step edit,
so tombstones are reclaimed frequently. But be aware:
- Heavy recording passes accumulate tombstones in `notes[]` faster than rebuilds
- If `note_count` approaches 512, `clip_insert_note` silently fails
- The recording path appends directly to `notes[]` without calling `clip_migrate_to_notes`
  (deferred for performance); flush is triggered at disarm

---

## 8. The O(N) Render Scan

The note-centric playback model scans all `note_count` entries in `notes[]` every
render tick per track. At 8 tracks × 512 notes/track × ~196 ticks/second = ~800K
iterations/second worst case (assuming fully dense clips on all tracks).

This is fine at current scale. The `occ_cache` 256-bit occupancy bitmap was added
but is currently used only in recording occupancy checks, not to short-circuit the
render scan. If performance becomes a concern, using `occ_cache` to skip the scan
for clips with no note at the current tick would reduce this significantly.

---

## 9. `_steps` Display Position vs Data Position — The Midpoint Formula

`_steps` reports which step each note "belongs to" for display purposes using the
midpoint formula: `step = (tick + TICKS_PER_STEP/2) / TICKS_PER_STEP % length`.

At `TICKS_PER_STEP = 24`: `step = (tick + 12) / 24 % length`.

A note at tick `T` is displayed in step `S` if `S*24 - 12 <= T < S*24 + 12`. This
means a note at tick 11 (just before midpoint of step 0) shows in step 0, but a
note at tick 13 (just past midpoint) shows in step 1 — even though the data slot is
still step 0 in both cases.

**Implication**: `_steps` is the right source of truth for "where should this step
LED light up" but is unreliable for "which step slot do I send edit commands to."
For editing, the step slot index from the press event (or `heldStep`) is the correct
address — not what `_steps` says.

---

## 10. Opportunities Not Yet Taken

**DSP-side recording** would eliminate the biggest remaining source of JS-mirror
complexity. Currently, live recording timing is computed in JS from polled
`trackCurrentStep` with ~20ms jitter. DSP-side capture via `on_midi` stores
`tick_in_step + current_step` at the exact interrupt, giving sub-block precision.
The JS mirror doesn't need to track timing at all — it just sends the note and the
DSP fills in the timing.

**Dirty flag + background sync** instead of explicit `pendingStepsReread`. A single
`clipsDirty` flag that triggers a full `syncClipsFromDsp` on the next tick would
replace all the ad-hoc deferred re-read variables (`pendingDspSync`,
`pendingStepsReread`). Cost: slightly over-reads; benefit: no more per-operation
confirmation bookkeeping.

**`occ_cache` in render path** — using the 256-bit occupancy bitmap to skip the
full `notes[]` scan for steps with no active note would reduce render CPU when clips
are sparse (the common case early in a session).

**Clip resolution (per-clip TICKS_PER_STEP)** — the absolute-position model in
`notes[]` already supports arbitrary tick positions. Adding a per-clip step size
(1/32 through 1-bar) requires only changing how `current_step` advances and how
the midpoint formula is parameterized. The data model already handles it; the
remaining work is UI + render timing.

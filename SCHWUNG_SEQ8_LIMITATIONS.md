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

## 10. `midi_inject_to_move` From set_param Context Does Not Release Move Synth Voices

`midi_inject_to_move` can be called from two contexts: the render_block audio thread
and set_param (the Schwung param-dispatch thread). Both calls write into the inject
SHM ring successfully — the ring accepts the packet regardless of which thread called.
However, **Move's voice allocator only acts on inject packets that arrive from the
render_block (audio thread) context**. Packets injected from set_param context are
received by Move but do not cause it to release held voices.

**Observed symptom**: note-offs injected in stop/panic handlers reach the ring
(`inject=1, sent=N` in log) but ROUTE_MOVE synth voices continue sounding.

**The correct pattern for ROUTE_MOVE note-offs on stop/panic**:
1. Call `silence_track_notes_v2` — uses `pfx_note_off`, which queues note-offs into
   `fx->events[]` (with `fire_at` set to a future sample count) and clears `active_notes`.
2. Reschedule all queued events to fire immediately: `events[i].fire_at = fx->sample_counter`.
3. Do NOT clear `event_count` — let `pfx_q_fire` drain the queue in the next render_block.
4. Skip ROUTE_MOVE tracks in `send_panic`: the 128-note flood would overflow the inject
   ring (64 packets, drains at 8/SPI tick) and most note-offs would be lost anyway.

`pfx_q_fire` runs unconditionally in render_block *before* the `if (!inst->playing) return`
guard, so it drains the queue even when transport is stopped.

**Contrast with ROUTE_SCHWUNG**: `midi_send_internal` works correctly from any context,
so SCHWUNG tracks can clear `event_count` and send via `send_panic` as before.

**Related**: the inject SHM ring holds 64 packets and drains at 8 packets per SPI tick
(~2.9ms). `send_panic`'s 128-note × 4-track = 512 inject packets would take ~187ms to
drain and most would be silently dropped if the ring fills.

---

## 11. Live Note Flush Coalescing With Step Toggle set_params

When a step button is pressed or released, a `pendingLiveNotes` flush (to silence any
held pad notes) can be dispatched in the same JS tick as a step-toggle `set_param`.
Due to the coalescing rule (last set_param per tick wins), the step toggle is dropped.

**Symptom**: toggling a step activates/deactivates multiple other steps in a seemingly
random pattern (the live-note flush overwrites the intended toggle, and the DSP acts on
stale step state).

**Fix**: set `stepOpTick = tickCount` at both step press and step release. The flush
guard checks `tickCount !== stepOpTick` before dispatching, preventing the flush from
sharing a tick with any step-button event.

---

## 12. Cable-2 Echo Cascade — ROUTE_MOVE Live External MIDI Input

### What happens

In overtake mode, Move passes cable-2 (external USB-A MIDI) through to its native
track instruments AND echoes every cable-2 event it receives back on MIDI_OUT cable-2.
The shim delivers MIDI_OUT cable-2 to `onMidiMessageExternal`. This means:

- A note from a keyboard plugged into USB-A arrives in `onMidiMessageExternal`
- If SEQ8 injects that note back to Move (to remap the channel), Move echoes the
  inject on MIDI_OUT cable-2
- `onMidiMessageExternal` fires again → another inject → another echo → ∞ cascade
- The cascade fills the 64-packet inject SHM ring within milliseconds → crash

### Why the refcount approach fails

The natural fix is a per-pitch inject-echo refcount: increment on inject, decrement
when the echo arrives, drop the echo. This does not work reliably because:

- MIDI_OUT has only 20 slots per SPI frame
- Cable-0 hardware events (pads, buttons, LEDs) routinely consume 11+ of those slots
- When MIDI_OUT is full, cable-2 echoes are silently dropped
- Dropped echoes mean the refcount never decrements → refcount leaks → subsequent
  real keyboard presses are treated as echoes and dropped

This is documented in `~/schwung-docs/MIDI_INJECTION.md` as a known-broken pattern.

### The fix (current SEQ8 behaviour)

Never inject in `onMidiMessageExternal` for ROUTE_MOVE tracks. Move's native
cable-2 passthrough plays keyboard notes on whatever Move track has a matching
MIDI In channel — no SEQ8 involvement needed. The `liveSendNote` call is guarded
by `if (!routeIsMove)` for all message types (note-on, note-off, CC/AT/PB).

Pad notes still inject (they are cable-0 events; Move does not auto-route them to
track instruments in overtake mode). The sequencer injects from DSP `render_block`
context, which is unaffected.

### Consequence: no channel remapping for live external MIDI

The keyboard always plays the Move track whose MIDI In matches the keyboard's
channel. SEQ8's Ch knob (which drives sequencer and pad routing) has no effect on
live external MIDI. The user must set their controller to send on the channel
matching the Move track they want to address.

### Recording echo at loop end

When recording is armed and the clip loops back to the beginning, the sequencer
starts playing the recorded notes via DSP inject. Those inject echoes arrive in
`onMidiMessageExternal`. With `isRec = true`, they would be passed to `recordNoteOn`
— recording duplicates every loop, accumulating exponentially until Move freezes.

Fix: `seqActiveNotes.has(d1)` guard before `recordNoteOn`. `seqActiveNotes` is the
JS-polled Set of pitches the sequencer is currently playing on the active track.
If the incoming note-on pitch is already active in the sequencer, it is a playback
echo — skip recording. Known edge case: if the user holds the exact same pitch as
a currently-playing sequencer note, the gate for that keyboard note may be missed.

### Shim-level fix (not yet implemented — see section 13)

True channel remapping requires shim intervention. See section 13 for the full spec.

---

## 13. Shim Feature Request: Cable-2 MIDI Channel Remapping

This section is a specification for the Schwung shim developer. It describes a
general-purpose shim feature that would allow any overtake module to channelize
incoming external MIDI to Move's native track instruments without cascade.

### Problem

Move plays cable-2 MIDI_IN on whichever native track has a matching MIDI In channel.
There is no way from JS or DSP to intercept and remap that channel before Move
processes it — without also triggering an inject echo cascade (see section 12).

### Proposed shim feature: cable-2 channel remap table

Add a small shared memory segment (suggested name: `/schwung-ext-midi-remap`) with
the following layout:

```c
typedef struct {
    uint8_t version;          /* bump to 1 when feature is live */
    uint8_t remap[16];        /* remap[in_ch] = out_ch (both 0-indexed).
                               * 0xFF = passthrough (no remap).
                               * Written by module; read by shim on each SPI ioctl. */
    uint8_t _pad[47];         /* reserved, zero-fill */
} schwung_ext_midi_remap_t;   /* 64 bytes total */
```

The shim opens this SHM on startup (create if absent, zero-init). On each SPI ioctl,
for every cable-2 event in the MIDI_IN buffer, before passing the buffer to Move:

```c
uint8_t in_ch  = pkt[1] & 0x0F;
uint8_t mapped = remap->remap[in_ch];
if (mapped != 0xFF) {
    pkt[1] = (pkt[1] & 0xF0) | (mapped & 0x0F);
}
```

Move sees the remapped channel, plays the correct track, and echoes the remapped
channel on MIDI_OUT — so the echo also arrives at the correct channel with no
double-note on the wrong track. No inject required, no cascade possible.

### Module responsibilities

On load (overtake init): open `/schwung-ext-midi-remap`, write the desired remap.
On unload: set all 16 entries back to `0xFF` (passthrough) and close.

SEQ8 example: when `activeTrack` changes or the Ch knob changes on a ROUTE_MOVE
track, write `remap[0] = activeTrack_channel` (assuming the controller sends on
ch1). This remaps all incoming ch1 to the current track's configured channel.

### Why not shadow_control_t?

`shadow_control_t` is currently exactly 64 bytes. Extending it risks breaking binary
compatibility with existing shim/module pairs. A separate SHM segment is cleaner
and allows the feature to be added without touching the existing control struct.

### SEQ8 implementation plan (once shim feature is available)

1. Open `/schwung-ext-midi-remap` in `init()`.
2. Write `remap[0] = bankParams[activeTrack][0][0] - 1` (Ch knob, 0-indexed) on
   any track/channel change that involves a ROUTE_MOVE track.
3. Re-enable `liveSendNote` for ROUTE_MOVE in `onMidiMessageExternal` (with the
   shim remapping, the echo arrives on the correct channel — but since it's already
   being played by native passthrough at the correct channel, the inject is still
   unnecessary; the remap alone is sufficient without any SEQ8 inject).
4. Clear all remap entries to `0xFF` on unload.

With this in place, external MIDI on ROUTE_MOVE tracks behaves identically to the
sequencer: notes play on the correct Move track regardless of which channel the
controller sends on.

---

## 14. Opportunities Not Yet Taken

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

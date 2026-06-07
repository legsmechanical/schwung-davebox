# Conductor Tracks — Design Spec

**Date:** 2026-06-05
**Status:** Approved design, pre-implementation
**Module:** dAVEBOx (Schwung tool module for Ableton Move; C DSP + JS UI)

## Summary

A **Conductor** track is a new track type that non-destructively transposes, in
real time, the note data of all *playing melodic clips* on tracks that opt in to
respond. The extent of transposition is driven by the note the Conductor is
currently playing, measured relative to a fixed reference pitch (the session
root in octave 4). Transposition can be scale-aware (interval steps) or
chromatic (semitones), following the session's global Scale-Aware setting.

Any track can be routed to become the Conductor, but **only one Conductor may
exist per session**. The Conductor emits no MIDI of its own — its sequencer runs
only to drive the transposition state.

## Goals / non-goals

**Goals**
- A new `Conduct` track mode that presents like Keys/melodic on the pads.
- Real-time, non-destructive transposition of responder clips at note-emit time.
- Per-Conductor-clip control over which tracks respond, per-track octave offset,
  and how held notes transition.
- A bake path that can permanently apply the Conductor's effect to a responder
  clip.
- Ableton export that ignores the live Conductor and emits a dummy track in its
  place.

**Non-goals**
- Polyphonic Conductor (steps are monophonic — see Decisions).
- Conductor driving anything other than melodic-clip pitch (no FX/automation
  conducting).
- A state-version bump (all new state is additive + migrated).

## Decisions (resolved with product owner)

| Topic | Decision |
|---|---|
| Conductor polyphony | **Monophonic** — Conductor steps hold one note each. |
| Held-note transition | Per-track, per-Conductor-clip, on a new **"When"** bank: **Next** (latch at next note-on) or **Now** (cut + retrigger sounding note at new pitch, inheriting the cut note's note-off position). |
| Scale-aware source | **Follows the global Scale-Aware setting.** |
| Routing / conversion | Conductor is the 3rd **Type/Mode** option (Keys/Drums/Cond). Type menu is **commit-deferred** (scroll previews, click commits behind confirm). **Destructive-with-confirm, but sequence data preserved** — clears pfx/tarp/automation; note+duration+iteration+probability survive (both directions). |
| Empty step / Conductor mute | **Snap to zero** (responders play written pitch). |
| Reference pitch `R` | **Root pitch-class + 60 (MIDI octave 4 / C4 in C major)**, matching the existing `defaultStepNote` convention. |
| Octave bank scale-awareness | Octave offset is applied in the **same space** as the Conductor offset: one octave = `scale_size` degrees when scale-aware, ×12 semitones when chromatic. Folded into a single transpose op. |
| Bake "Apply Conductor?" | **SCENE bake only** (not clip bake): folds each responder clip against its scene's Conductor clip (full chain incl. NoteFX + CdLk + per-track Octave, lockstep across N loops), then **auto-disables** that Conductor clip's Responder flags for the baked tracks so live playback doesn't double-apply. |
| "Cannot be baked" | The Conductor track has **no bake action** of its own (it can be live-merged). |
| Track color | Conductor keeps its **pre-assigned per-index track color** (the always-white idea was dropped as confusing). |

## Engine approach (chosen)

**Emit-time degree/semitone offset.** The Conductor sequencer runs internally and
drives a single live transposition offset. At each responder note emit, the
offset is applied via the existing `scale_transpose()` (scale-aware) or a
chromatic `pitch + semitones`. Non-destructive by construction; reuses the proven
emit pipeline; the "Next" transition falls out for free.

Rejected alternative: per-track dynamic LUTs rebuilt every Conductor step
(extends the static `xpose_lut` idea) — more memory/churn, no benefit over the
emit-time math because the Conductor changes every step.

## Detailed design

### 1. Track model, routing, conversion

- New mode `PAD_MODE_CONDUCT = 2` (joins `MELODIC_SCALE=0`, `DRUM=1` at
  `dsp/seq8.c:53`). Pad grid presents like melodic/Keys (scale-aware layout).
- The Conductor emits **no MIDI** and has **no MIDI channel** — its sequencer
  only drives the transposition state.
- **Routing in:** the Conductor is the third option in the track **Type/Mode**
  menu (Keys / Drums / **Cond**). The Type menu is **commit-deferred**: scrolling
  only previews the selected type (no conversion, no dialog); the conversion fires
  on the commit **click**, behind a confirm. (This also fixes Keys↔Drums, which
  previously confirmed mid-scroll.) Conversion is destructive-with-confirm: a
  dialog warns pfx/tarp/automation will be cleared; note+duration+iteration+
  probability survive into the Conduct clips. Converting back to Keys keeps that
  sequence data and starts pfx/tarp/auto fresh.
- **One Conductor per session:** enforced DSP-side. Routing a second track to
  Conductor is refused with an OLED message ("Conductor exists on T*n*"); the
  user converts the existing one back first. Routing goes via a per-track
  `tN_conduct` set_param (host drops new *global* keys).
- **Color:** keeps its pre-assigned per-index track color (see §9).
- **Mute:** allowed — temporarily deactivates transposition (responders snap to
  zero).
- **Solo:** disabled for the Conductor (control inert/hidden on that track).
- **Bake:** the Conductor track has no bake action.

### 2. The five Conductor banks

The Conductor's jog wheel cycles exactly five banks (no pfx/tarp/auto), in order
**Conduct → NoteFX → Responder → Octave → When**.

1. **Conduct** — reuses the CLIP bank (`ui/ui_constants.mjs:267`): Res, Stch,
   Shft, Lgto, InQ, **CdLk** (K6, Conductor-only — the CLIP bank's K6 is otherwise
   unassigned), Dir, SqFl. Header relabeled "Conduct".
   - **CdLk** (Conductor Lock, per Conductor clip): **Off** = gate-hold (current —
     transposition lasts the Conductor note's gate, snaps to zero in gaps).
     **Lock** = sample-and-hold — the transposition persists through gaps and only
     changes when the Conductor plays the next note (never self-reverts to zero;
     play the root@oct4 to return to no-transpose). Mute still snaps to zero in
     both modes.
2. **NoteFX** — a slimmed reuse of the melodic NOTE FX bank (index 1), exposing
   **Octave** (K1), **Offset** (K2), **Random** (K8), and **Random-mode** (Shift+K8,
   uniform/gaussian/walk); other knobs greyed. **Per Conductor clip** (uses the
   existing per-clip pfx storage + `tN_cC_pfx_set`/`_snapshot`). These transform
   the Conductor's own note coming out of its sequencer/pads **before** the
   transposition offset is computed (and before the per-track Octave bank). I.e.
   the Conductor's effective note = its played note through NOTE FX
   octave/offset/random; the offset is derived from that (`gen[0]`). Octave/Offset
   are master shifts on all responders; Random jitters the whole transposition
   per Conductor note. Reuses melodic NOTE FX scale-aware behavior.
3. **Responder** — 8 knobs, one per dAVEBOx track, single-fire on/off toggles.
   On = responds; off = ignores. **Default on** for all tracks. The Conductor's
   own track-index knob shows **"Cndct"** (inert). **Per Conductor clip.**
4. **Octave** — 8 knobs, one per track. Range **−4…+4**, center shows **"--"**
   (= 0). Added on top of the Conductor transposition, scale-aware (§4). Only
   takes effect when the Conductor is sounding a note AND that track is On in
   Responder. Conductor's own slot inert. **Per Conductor clip.**
5. **When** — 8 knobs, one per track. **Next** / **Now** (held-note transition,
   §4). Conductor's own slot inert. **Per Conductor clip.**

Conductor steps carry **iteration and probability** per step, using the existing
melodic step trig-condition editing (`step_iter`, `step_random`).

**OLED layout (Responder / Octave / When banks):** standard bank header + a 2×4
(rows × columns) label/param grid. Each of the 8 cells is labeled **"Tr1"…"Tr8"**
(the track number) in all three banks, with the param value rendered under the
label — on/off for Responder, the octave value (or "--") for Octave, and
Next/Now for When. The Conductor's own track cell reads "Cndct" (truncated to
"Cndc" by the fixed-width cell) and is inert in all three banks — distinct from
Octave's "--" center value, so the conductor's own row is unambiguous.

### 3. Reference pitch

Zero transposition = the session **root note at MIDI octave 4** = `padKey + 60`
(C4 in C major), matching `defaultStepNote` (`ui/ui.js:2080`). The Conductor's
pad octave naturally scales the offset (playing an octave higher yields +1
octave of transposition).

### 4. Transposition engine

On each Conductor note-on, compute one signed offset from `R` to the played note
`P`:
- **Scale-Aware ON:** offset = scale-degree count from `R` to `P`.
- **Scale-Aware OFF:** offset = semitone distance `P − R`.

At each responder note emit, if (Conductor routed) AND (Conductor currently
sounding a note) AND (this track On in the active Conductor clip's Responder
bank):
1. Compute total offset **in the active space**:
   - scale-aware: `total_degrees = conductor_degrees + octave × scale_size`
   - chromatic: `total_semitones = conductor_semitones + octave × 12`
2. Apply once (`scale_transpose(note, total_degrees)` or `note + total_semitones`).
3. Clamp 0–127.

Clip note data is never mutated. Octave folded into the same transpose op so
out-of-scale notes are treated consistently with the Conductor shift.

**Snap to zero:** empty Conductor step (no note) OR Conductor muted → offset 0.

**Held-note transition ("When" bank):**
- **Next:** offset latched at each responder note-on; sounding notes untouched.
- **Now:** when the offset changes while a responder note sounds, cut and
  re-emit it at the new transposed pitch, keeping the original note-off tick.
  Only runs for tracks set to "Now".

Mixed Next/Now across responder tracks is supported — the offset is global state;
each track reads it per its own When setting.

### 5. Bake — "Apply Conductor?" (SCENE bake only)

**Decision (revised):** Conductor bake lives on **scene bake**, NOT clip bake. The
Conductor is a cross-track, scene-wide modulator — a responder clip's
transposition is only well-defined relative to the Conductor clip playing in the
same scene. Clip bake in isolation would have to assume a Conductor clip + phase
and freeze a context-dependent result. Scene bake (bake all tracks at clip index
C) has the whole scene in hand, so it folds each responder clip against **its own
scene's Conductor clip** (the Conductor's clip at index C). Clip bake has **no**
Apply-Conductor option.

When scene-baking at clip index C AND a Conductor exists AND its clip C has any
responder track On, append **"Apply Conductor?" — Yes / No / Cancel** to the
scene-bake flow.

- **Yes:** for each responder track baked at scene C, fold the Conductor's
  transposition into the baked notes. The offset for a baked responder note at
  absolute tick `t` is reconstructed offline from Conductor clip C, replicating
  the live chain: the Conductor note sounding at `t` (honoring **gate-hold vs
  CdLk Lock**, and the Conductor clip's iteration/probability trig conditions,
  lockstep across the N baked loops) → its NOTE FX (octave/offset/random →
  `gen[0]`) → degree/semitone offset (scale-aware) → **+ per-track Octave
  (`cond_oct`)**. Each responder note takes the offset at its own onset (Next-
  style; "Now" live-retrigger doesn't apply to a flattened note). Conductor clip
  C wraps at its own length (`t mod conductor_clip_len`).
- **Then auto-disable (model b):** after baking, set the Conductor clip C's
  Responder flag **off** (`cond_resp[track] = 0`) for each baked track, so live
  playback of the now-baked scene does **not** double-apply the transposition.
- **No:** bake ignores the Conductor (written pitches only).
- **Cancel:** backs out of the whole scene bake.

(The Conductor track itself is never baked — it has no output. Export already
ignores the live Conductor, so a baked-then-exported scene is clean either way.)

### 6. Ableton export

The Conductor track exports as a **dummy track** placeholder (existing Dummy-Drift
mechanism in `ui/ui_export.mjs`) — empty clips, preserving the 8-track layout.

**Apply-Conductor on export (non-destructive, opt-in).** When the session has a
Conductor, the export confirm flow offers **"Apply Conductor?"**:
- **No** (default): responder clips export at their **written** pitch (the live
  Conductor is ignored).
- **Yes**: each exported responder clip has the Conductor's transposition folded
  in **at export time only — the live session is NOT modified** (the export render
  `render_melodic_clip` already renders to a scratch buffer; the fold reuses
  `conductor_bake_offset` + the bake's LCM auto-extend so multi-page conductors are
  fully captured). Only scenes whose **Conductor clip at that index has notes** are
  folded (others export written pitch); a responder track that's Off in that
  Conductor clip's Responder bank also exports written pitch. Exposed via a new
  per-track-prefixed get_param `tN_cC_export_cond` (avoids the dropped-global-key
  issue; per-track keys reach DSP reliably). No auto-disable needed — nothing in
  the session changes, so there's no live double-apply.

### 7. State & persistence

**No state-version bump.** All new fields additive + migrated in
`seq8_load_state` (missing keys default). State stays **v=36**.

New DSP state (per-track):
- `conduct_role[NUM_TRACKS]` — Conductor flag (0/1), default 0. One-Conductor
  invariant enforced at set-time; on load, first wins if >1.

New DSP state (per Conductor clip) — three 8-wide arrays on the clip, defaults on
migration:
- Responder mask (8× on/off) — default all-on.
- Octave offsets (8× −4…+4) — default 0.
- When modes (8× Next/Now) — default Next.

Conductor note/duration/iteration/probability ride the existing clip step model
(`step_iter`, `step_random` at `seq8.c:443,449`) — no new step fields.

Live transposition state (transient, not persisted): current offset + sounding
flag, recomputed each tick from Conductor playback (mirrors
`xpose_preview_active`).

JS sidecar (`seq8-ui-state.json`): active-Conductor track index + Conductor-mode
UI bits piggyback on existing per-track sidecar; migrate rather than bump if
possible (sidecar bump is low-risk — not the DSP confirm-dialog path).

### 8. Platform constraints honored

- Role/routing changes via per-track `tN_*` set_params (never new global keys —
  host silently drops new globals).
- Multi-field Conductor operations pushed as a single atomic DSP command (avoid
  set_param coalescing).
- `get_param` handlers added for every new key (missing handler → JS reads 0).

### 9. Track color

`TRACK_COLORS[t]` / `TRACK_DIM_COLORS[t]` reads are routed through `trackColor(t)`
/ `trackDimColor(t)` helpers (a single color-lookup seam). The Conductor keeps its
pre-assigned per-index color — the always-white treatment was dropped as
confusing. The helpers currently just return the indexed color; the seam is kept
in case per-track color overrides return.

## Key file anchors

| Area | File | Line(s) |
|---|---|---|
| Track-mode enum | dsp/seq8.c | 53–54 |
| `pad_mode` in track struct | dsp/seq8.c | 557 |
| Mode conversion | dsp/seq8.c | 8197, 8315 |
| BANKS definition | ui/ui_constants.mjs | 266–355 |
| `bankParams` init | ui/ui.js | 5325–5328 |
| `scale_transpose()` | dsp/seq8.c | 3289–3314 |
| Transpose preview state | dsp/seq8.c | 822–829 |
| Bake clip + loops | dsp/seq8.c | 7523, 7573, 7589 |
| `step_trig_pass` | dsp/seq8.c | 9362 |
| Bake dialog | ui/ui.js | 1495–1554 |
| Step trig fields | dsp/seq8.c | 443, 449 |
| Mute/solo | dsp/seq8.c | 851–853 |
| Export buildSong | ui/ui_export.mjs | 370+ |
| Track colors | ui/ui_constants.mjs | 50–54 |
| Pad note map / reference | ui/ui.js | 1835, 2078–2090 |
| State save/load | dsp/seq8.c | 1450+, 1750+ |

## Open implementation questions (to resolve in planning)

- Whether the JS sidecar can carry the new per-clip arrays without a sidecar
  version bump, or whether a low-risk sidecar bump is cleaner.
- The precise set of fields cleared vs preserved on Conductor conversion, and the
  atomic DSP command shape for it.

## Testing (hands-on, on device)

1. Route track 2 to Conductor → keeps its track color; Solo is inert; Mute works.
2. Try to route a second track to Conductor → refused with OLED message.
3. With a C-major session: Conductor plays C4 → no transposition. Plays D4 →
   melodic clips shift up 1 interval (Scale-Aware on) / 2 semitones (off).
4. Conductor mute → all responders snap back to written pitch.
5. Responder bank: turn track 3 off → track 3 ignores the Conductor; others
   follow.
6. Octave bank: track 1 = +1 → track 1's responding notes also jump an octave
   (scale-aware: +scale_size degrees).
7. When bank: track 1 = Now, hold a long note, change Conductor note → track 1's
   sounding note jumps immediately; a Next track waits for its next note.
8. Empty Conductor step → responders play written pitch that step.
9. Bake a responder clip with a Conductor active → "Apply Conductor?" appears;
   Yes bakes the transposition (probability re-rolled per loop), No bakes written
   pitch, Cancel aborts.
10. Ableton export → Conductor exports as a silent dummy track; responders export
    at written pitch.
11. Save/reload set → Conductor role, Responder/Octave/When per-clip values, and
    sequence data all restore (no version-mismatch dialog).

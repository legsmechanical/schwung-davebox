# Don't auto-launch a focused clip that has note data

**Date:** 2026-06-08
**Status:** Approved, pending implementation

## Problem

In Track View, the focused clip of a track is auto-launched implicitly in two
situations:

1. **Scroll into a track** while transport is running (jogwheel or Shift+pad) —
   `_switchActiveTrack` launches the track's focused clip so it goes live.
2. **Transport start** — pressing play auto-launches the focused clip of the
   active track ("focused-clip-by-default").

This overrides the user's intent: if they deliberately left a clip *off*
(programmed content, but not currently playing), scrolling into the track or
hitting play re-activates it. The arrangement the user set up is not preserved.

## Rule

Implicit auto-launch of a focused clip happens **only when the focused clip is
empty**. If the focused clip has note data, leave the track's play state
untouched — whatever was playing (or nothing) stays as-is.

Empty focused clips still auto-launch as before: harmless, since nothing sounds,
and it keeps the clip "selected/live" for the common workflow.

## Emptiness definition

"Has data" = **note/hit content only**, never CC-lane automation.

Reuse the existing cached flags, which are already computed from note steps
(`clipSteps`) and drum hits only:

- Melodic / CC tracks: `S.clipNonEmpty[t][c]`
- Drum tracks: `S.drumClipNonEmpty[t][c]` (selected by
  `S.trackPadMode[t] === PAD_MODE_DRUM`)

A clip with only CC-lane automation and no notes counts as **empty** (will still
auto-launch) — this is intended.

## Implementation

Add shared local helpers (clip-index form + focused-clip convenience form):

```js
function _clipIsEmpty(t, c) {
    return (S.trackPadMode[t] === PAD_MODE_DRUM)
        ? !S.drumClipNonEmpty[t][c]
        : !S.clipNonEmpty[t][c];
}
function _focusedClipIsEmpty(t) {
    return _clipIsEmpty(t, S.trackActiveClip[t]);
}
```

Three gated launch sites:

1. **`_switchActiveTrack`** (ui/ui.js ~1347) — the running-transport auto-launch
   block. Add `&& _focusedClipIsEmpty(...)`. Centralized here, so the gate covers
   all track-switch entry points (jogwheel, Shift+pad, co-run track switches).
2. **Transport-start block** (ui/ui.js ~2686) — the focused-clip-by-default
   block. Add `&& _focusedClipIsEmpty(...)`.
3. **Session-View Shift+pad clip launch** (ui/ui.js ~10967) — wrap the
   `launch_clip` call so it fires only when `S.playing || _clipIsEmpty(t, clipIdx)`.

## Session-View Shift+pad behavior (extension)

Shift+pad means "open this clip for editing" (focus + jump to Track View). It
should no longer *turn on* a stopped clip that has notes.

- **Stopped + clip has notes** → focus the clip (set `trackActiveClip`, page,
  bank params, drum resync) and switch to Track View, but **skip `launch_clip`**.
  The clip stays off; since it has notes it also won't auto-start on the next
  Play (gate #2 above).
- **Playing** → still launch (unchanged). While playing, `pollDSP` overwrites
  `trackActiveClip` from the DSP's playing clip every tick (ui.js:2524), so a
  clip can only be shown/edited by making it the DSP's active clip — i.e.
  launching it. Editing an off-clip silently while others play would require a
  separate focus/play split (deferred, see plan note).
- **Empty clip** (stopped or playing) → still launch (unchanged).

This makes the gestures consistent: plain clip pad (Session) and clip side
button (Track View) = "turn it on"; Shift+pad = "open to edit, leave off when
stopped".

## Explicitly unchanged

- Session-View **plain clip pad** launch — still turns the clip on.
- Track-View **clip side button** launch — explicit manual launch.
- Session-View **scene side-button** (whole-row scene launch) — still launches
  notes-clips.
- The **record-armed + Play** auto-launch path — focused notes-clip still
  auto-starts for overdub.
- Per-track `trackClipPlaying` / `trackWillRelaunch` / `trackQueuedClip` guards.

## Net behavior

Scroll into a track, or press Play → empty focused clip still goes live (silent,
harmless); focused clip with note content is left exactly as the user set it.
Shift+pad a stopped notes-clip → opens it for editing without turning it on.

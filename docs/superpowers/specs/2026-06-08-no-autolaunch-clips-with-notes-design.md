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

Add a shared local helper:

```js
function _focusedClipIsEmpty(t) {
    const c = S.trackActiveClip[t];
    return (S.trackPadMode[t] === PAD_MODE_DRUM)
        ? !S.drumClipNonEmpty[t][c]
        : !S.clipNonEmpty[t][c];
}
```

Two call sites, each gaining one extra guard (`&& _focusedClipIsEmpty(...)`):

1. **`_switchActiveTrack`** (ui/ui.js ~1347) — the running-transport auto-launch
   block. Centralized here, so the gate covers all track-switch entry points
   (jogwheel, Shift+pad, co-run track switches).
2. **Transport-start block** (ui/ui.js ~2686) — the focused-clip-by-default
   block.

## Explicitly unchanged

- Session View **Shift+Clip** launch — still activates the clip.
- Tapping a clip pad in Track View — explicit manual launch, unaffected.
- The **record-armed** auto-launch path (already gates on `clipNonEmpty` in its
  own direction).
- Per-track `trackClipPlaying` / `trackWillRelaunch` / `trackQueuedClip` guards.

## Net behavior

Scroll into a track, or press play → empty focused clip still goes live (silent,
harmless); focused clip with note content is left exactly as the user set it.

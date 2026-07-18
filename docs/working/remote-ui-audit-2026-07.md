# Remote-UI audit & fix pass — 2026-07 (branch `remote-ui-audit-fixes`)

> Working progress record for the remote-UI reliability + responsivity work. Branch-resident
> so the arc travels with the code (the day-to-day worklog lives outside the repo). Host half
> is in `schwung` branch `remote-ui-responsivity` (see that repo's `patches/README.md`).

## Why
A 3-surface audit of the browser clip editor (`web_ui.html` / DSP snapshot+writes / the
`schwung-manager` bridge) turned up a cluster of "edits don't reliably reach / show up" bugs
plus a responsivity-vs-hardware-load problem. Goal: make the browser editor trustworthy and
snappy **without** taxing the RT audio/MIDI path.

## What shipped on this branch

| Commit | Area | Fix |
|---|---|---|
| `f3ceff1` | DSP rev-bumps | ~50 `set_param` handlers mutated snapshot-visible state but never bumped `rui_rev`, so the rev-gated browser poll showed stale data for up to ~30s. All now call `rui_mark`/`rui_touch`: entire CC-automation family, undo/redo + clip/row copy/cut + row_clear, melodic step-edit + `_loop_set` + cc-lane geom + conductor + clears, drum lane-mgmt + `_step_*` **and the tail** (`_mute`/`_solo`/`_clip_length`/`_playback_dir`/`_clip_resolution`/`_beat_stretch`/`_clock_shift`/`_nudge`/`_clip_resolution_zoom`/`_pfx_reset`), all `all_lanes_*`. Skipped (no `rui_*` field): `_playback_audio_reverse`, `_at_clear`, repeat-groove. Bonus: drum `_nudge` moved notes without `state_dirty` (persistence gap) — fixed. Pinned by ~130 asserts in `test_rui_rev.c`. |
| `f775428` | DSP snapshot | 64KB snapshot could truncate mid-token on a dense drum clip → invalid JSON → manager silently drops it → editor bricked for that clip. `seq8_remote_snapshot` now reserves `RUI_TAIL_RESERVE` (96B) so the unbounded fields (`rui_dnotes`/`rui_notes`/`rui_cc`) stop before the buffer end and the JSON always closes (degrades to fewer notes, never garbage). `rui_cc` moved to the object tail so a big focused CC lane can't starve structural fields. New `test_rui_budget.c` pathological-overflow case (65479B, still valid). |
| `9d12add` | Browser | (a) Multi-note edits (shift-vel/move-all/multi-delete/box-nudge/multi-vel-drag) fired N per-note set_params → per-buffer coalescing dropped all but one → next snapshot reverted the rest. Now ONE atomic `tN_cC_notes_op`. (b) Stale-snapshot clobber: `pullSoon` no longer zeroes the suppress window; `refresh(force)` runs the reconcile past it while `applyParams` still rejects a not-caught-up rev. (c) Session-grid clip drag guards `applyParams` via `clipDrag` (+`ondragend`). (d) Playhead NaN guard. |
| `f42b3af` | Browser | Step-edit strip mapped note→step with `floor(tick/tps)` while the DSP `note_step()` rounds `(tick+tps/2)/tps`; for off-grid notes (InQ-Off / nudge / sub-step) they disagreed by one step → the step a note was drawn in wasn't selectable (empty steps aren't selectable — intentional) while the neighbour was. Added shared `noteStep()`; all 7 sites route through it. Empty-step non-selectability kept (per Josh). |

Off-branch (gitignored `notes/tech-changelog.md`) has the exhaustive per-handler/per-site detail.

## Status
- **Off-device tested:** `tests/run.sh` 24/24 native + JS green; `web_ui.html` node-syntax clean.
- **Deployed to device 2026-07-18** (WiFi, md5-verified): `dsp.so` + `web_ui.html`. Running for hands-on test.
- **Merged to `main` (fast-forward) 2026-07-18; NOT pushed.** Hands-on device verification (checklist below) is
  still owed — merged on Josh's call ahead of it.

## Device test checklist (owed)
- [ ] Multi-note edits stick (select several notes → shift vel / nudge / move / delete — all change, none snap back).
- [ ] Step-edit strip selects the step you clicked, incl. an off-grid / nudged note (repro: clip recorded with Input Quantize **off**).
- [ ] On-device / second-tab edits (CC automation, drum lane mute/solo/length, undo/redo, clears) show in the browser promptly (not ~30s later).
- [ ] Dense drum clip doesn't blank the editor.
- [ ] General device→browser snappiness (host branch) + no hardware stutter while editing hard.

## Open follow-ups (next session)
- **F4 true push (host)** — emit an overtake "dirty" into the shim notify ring on `rui_touch` so the manager pushes on-change and the `rui_poll` tick disappears (last responsivity gain; needs shim + DSP plumbing).
- **Ticker write backpressure (host)** — parallelize the manager's per-client fan-out only if a wedged client stalls a tick.
- **(parked) live-take rev-staleness** — recorded CC/notes via the render path; separate trigger.

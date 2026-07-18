# dAVEBOx Remote UI — Architecture & Reference

A browser-based clip editor for dAVEBOx: piano-roll (melodic + drum), CC automation, a
conductor responder panel, transport + live playhead, per-track route/channel/mute/solo,
and edge zoom bars — driven over the network, in sync with the hardware.

This is the **master reference** for how the remote UI works end-to-end, for future
iteration and refactoring. For the exhaustive per-key parameter list see
[`DAVEBOX_API.md`](DAVEBOX_API.md); for the host bridge see
[`SCHWUNG_PATCHES.md`](SCHWUNG_PATCHES.md).

---

## 1. Where the pieces live

| Piece | Repo / file | Role |
|---|---|---|
| **Browser editor** | `web_ui.html` (this repo) | The entire UI — one standalone HTML file (inline `<script>` + `<canvas>`). **NOT** part of the `ui/` esbuild bundle; runs in a real browser (Chromium), not QuickJS. |
| **DSP snapshot + write handlers** | `dsp/seq8.c` (`seq8_remote_snapshot()`) + `dsp/seq8_set_param.c` | Emits the read snapshot; handles all writes. |
| **Host bridge** | `schwung-manager/` (upstream PR `charlesvestal/schwung#148`) | Discovers the active overtake tool, serves its `web_ui.html` under a **Tool tab**, bridges params over the `overtake_dsp:` SHM prefix. |

dAVEBOx is a `component_type: "tool"` (overtake) module — it has no chain slot, so the
manager reaches it through the shim's `overtake_dsp:` prefix rather than a slot's
`synth:`/`fxN:` prefix.

---

## 2. The spine — data flow

```
 browser (web_ui.html)                 schwung-manager                 DSP (seq8.c)
 ─────────────────────                 ───────────────                 ────────────
   getParam(k)  ────────────►  (seeded from snapshot; no live read) 
                               probe overtake_dsp:module_id → "davebox"
                               poll overtake_dsp:rui_poll  ──────────►  get_param("rui_poll")
                               (rev changed?) ── yes ──►               "rev:on:tick:bpm"
                               get_param("state") ─────────────────►  seq8_remote_snapshot()
                               ◄──── flat JSON of rui_* fields ───────  → out buffer (64 KB)
   applyParams(kv) ◄── push ── seed browser KV with rui_* fields
   parseModel() → M
   render

   setParam(k,v) ──────────►  set_param WS message
                              shadow_direct_set_param("overtake_dsp:"+k) ─►  seq8_set_param.c
```

**Two hard rules that shape everything:**

1. **Reads are snapshot-only.** The WS protocol (`schwung-manager/remote_ui.go`) has message
   types `subscribe / set_param / get_hierarchy / …` but **no `get_param` round-trip**. The
   browser's `getParam(k)` only returns fields the manager already pushed. So **anything the
   UI displays must be emitted as a `rui_*` field** in the `state` snapshot. The pre-existing
   per-page getters (`tN_cC_ccsv_*`, etc.) are *not* reachable from the browser.

2. **Writes are arbitrary passthrough.** `setParam(P+key, val)` (P = `"overtake_dsp:"`) reaches
   the DSP's `set_param` for any `tN_*`-prefixed key. So all *editing* reuses existing set keys.

**Snapshot buffer ceiling = 64 KB** (`SHADOW_PARAM_VALUE_LEN`, `schwung/src/host/shadow_constants.h`).
Large per-clip data (automation curves) is therefore **gated** — see `rui_cc`.

**Rev-gated poll (perf).** While playing, the manager reads the cheap `rui_poll` digest each
tick and only re-reads the heavy `state` snapshot when the content rev changed, pushing just
the playhead otherwise. Any DSP edit the UI should see must call **`rui_touch(inst)`** to bump
`rui_rev`.

---

## 3. The `rui_*` snapshot contract (the fragile seam)

Every field below is emitted by `seq8_remote_snapshot()` (`dsp/seq8.c`, ~line 5386) as a
string value in a flat JSON object, and parsed by `parseModel()` (`web_ui.html`, ~line 459).
**Field ORDER is NOT a contract** — both the manager (`json.Unmarshal` into a map) and the
browser (`get()` by key) parse by key, so fields may be emitted in any order and reordered
freely (that's how `rui_cc` was moved to the tail; see §8 item 2). What *is* a contract is
each field's **intra-value delimiter format** — the web parser splits each value on its `:` /
`,` / `;` / `|` separators, so a value's own layout must match the parser. All are scoped to
the *selected* track/clip/lane (`rui_sel`) unless noted. Adding a field is additive; the web
parser is tolerant of missing/short forms.

| Field | Format | Notes |
|---|---|---|
| `rui_rev` | `<uint>` | Monotonic edit counter (`rui_touch()`); drives the rev-gated poll. |
| `rui_play` | `on:tick:bpm` | `on` 0/1; `tick` = selected track's `current_clip_tick` (u32, wraps in the **loop window**); `bpm` int. |
| `rui_sel` | `track:clip:lane` | Selection. `lane` = −1 melodic, else drum lane index. |
| `rui_clip` | `len:tps:loop_start:dir` | Grid-reference clip (drum → active drum clip lane 0; melodic → selected clip). Steps + ticks/step. |
| `rui_glob` | `key:scale:swing_amt:swing_res:launch_quant:scale_aware` | Globals, all ints. |
| `rui_scale` | 12 chars `010…` | Pitch-class membership (key applied); shades roll rows / folds. |
| `rui_pfx` | 29 colon-sep ints, or `""` | Per-clip FX (Note FX + delay + seq-arp). Order defined at the emit site. Drum → selected lane's pfx. |
| `rui_lane` | `len:tps:loop_start:dir`, or `""` | Selected **drum lane** geometry. |
| `rui_ccmeta` | 8 groups `;`, each `assign,type,hasdata,rest,curval,ls,len,tps,restps` | CC-automation overview (always). `type` 0 CC / 1 aftertouch / 2 Schwung-knob; `rest`/`curval` 255 = unset/"—". Drum indexes the active clip. |
| `rui_steps` | sparse `s:iter:rand:ratch:nudge;`, or `""` | Non-default melodic step trig conditions. |
| `rui_dsteps` | same, selected drum lane | |
| `rui_index` | 8 records `;`, each `pm:ac:qc:pl:<16 has-bits>:route:chan:mute:solo` | Per-track session state. `pm` 0 melodic / 1 drum / 2 conductor; 16 has-bits (drum scans `drum_clips[]`); `route` 0 Schwung / 1 Move / 2 External; `chan` 1-based; `mute`/`solo` 0/1. |
| `rui_cond` | `condTrk:condClip:lock;resp,oct,when;…×8`, or `-1:-1:0` | Conductor + per-track responder map, from the conductor track's active clip. |
| `rui_dlanes` | 32 records `;`, each `note,has,mute,solo,length,loop_start,tps` | Drum mode only. |
| `rui_dnotes` | `L\|tick:vel:gate,…;L2\|…` | Drum hits per non-empty lane. |
| `rui_notes` | `tick:pitch:vel:gate;`, or `""` | Melodic clip notes (absolute clip ticks). |
| `rui_cc` | `k\|tick:val,tick:val,…`, or `""` | **Gated** breakpoints for the focused knob only (set via `tN_cC_cc_focus`, bumps rev). Keeps the snapshot lean. Emitted **last** (after the note content) so an over-large focused CC lane can only starve itself — see §8 item 2. |
| `rui_trunc` | `1` (JSON number), or absent | Set to `1` only when a reserve-guarded loop (`rui_dnotes` / `rui_notes` / `rui_cc`) dropped content at the 64 KB budget; absent otherwise. Drives the browser's non-blocking "clip too dense — some notes hidden" badge. |
| `rui_poll` (standalone get_param) | `rev:on:tick:bpm` | Cheap digest for the rev-gated poll; not inside `state`. |

**When you change a format, update the parser in `web_ui.html` *and* the test in
`tests/test_remote_snapshot.c` in the same commit.** This is the seam a regression harness
should pin (see §9).

---

## 4. Write keys (families)

All writes are `R.setParam(P+key, value)` (P = `"overtake_dsp:"`), each followed by
`afterEdit()` and usually `pullSoon()`. Full signatures in [`DAVEBOX_API.md`](DAVEBOX_API.md).

- **Global:** `bpm`, `key`, `scale`, `swing_amt`/`swing_res`, `launch_quant`, `scale_aware`,
  `transport` (`play`/`stop`/`restart`/`play_focus:T:C`), `launch_scene`, `mute_all_clear`,
  `undo_restore`/`redo_restore`, `bake`, `clip_copy`/`drum_clip_copy`.
  > ⚠️ **New global keys are silently dropped by the host** (see repo CLAUDE.md). Only
  > grandfathered globals work; otherwise piggyback onto a `tN_*` push.
- **Per-track:** `tN_route` (`schwung`/`move`/`external`), `tN_channel` (1-based), `tN_mute`,
  `tN_solo`, `tN_convert_to_conduct`/`_melodic`/`_drum`, `tN_launch_clip`,
  `tN_cc_assign`/`_type_assign`/`_send`/`_rest`, `tN_cc_auto_set`/`_set2`/`_clear_*`,
  `tN_all_lanes_*`.
- **Per-clip (`tN_cC_*`):** `ruisel` (select), `clear`/`hard_reset`, `loop_set` (packed
  `(ls<<16)|len`), `resolution`, `dir`, `pfx_set`, `cond_resp`/`_oct`/`_when`/`_lock`,
  `cc_focus` (gate `rui_cc` + `rui_touch`), `kK_cc_loop_set`/`cc_lane_*`, `step_S_*`,
  `notes_op` (atomic multi-op batch — format `"op args;op args;…"` with ops `a`/`d`/`m`/`r`/`v`;
  the browser's `emitBatch()` packs a whole multi-note edit into one write + one rev bump).
- **Per-drum-lane (`tN_lL_*`):** `note_add`/`_del`/`_move`/`_resize`/`_vel`, `loop_set`,
  `clear`, `mute`/`solo`, `lane_note`, `euclid_stamp`, `pfx_set`. (The reliable drum-clip
  allocation trigger — see DSP CLAUDE.md.)

**Coalescing constraint:** only the **last** `set_param` per audio buffer reaches the DSP, and
`shadow_send_midi_to_dsp` shares that channel. Multi-field operations must be a **single atomic
key** (e.g. `loop_set` packs `ls`+`len`); otherwise defer to `tick()` via a pending variable.

---

## 5. DSP side (`dsp/seq8.c`)

- **`seq8_remote_snapshot(inst, out, out_len)`** (~5386, in a ~6735-line file) — builds the flat JSON with the guarded
  `APP(...)` snprintf-cursor macro. Reads `inst->rui_sel_track`/`_clip`/`_lane` for scoping and
  `inst->rui_cc_focus` for the gated `rui_cc`. Read-only + side-effect free (does not touch
  `state_dirty`).
- **`rui_touch(inst)`** — increments `rui_rev`; call it from any `set_param` handler whose change
  the browser must re-read (content edits; focus changes).
- **Selection is DSP state:** `tN_cC_ruisel` sets `rui_sel_track`/`_clip`; drum lane via
  `rui_sel_lane`. The snapshot is always for the current selection.
- **Storage the snapshot reads:** melodic notes `tracks[t].clips[c].notes[]`; drum
  `tracks[t].drum_clips[c]->lanes[l].clip.notes[]`; CC automation `tracks[t].clip_cc_auto[c]`
  (`cc_auto_t`: breakpoint `ticks[8][]`/`vals[8][]`, `rest_val[8]`, per-lane geometry) +
  track-level `cc_assign[8]`/`cc_type[8]`/`cc_auto_cur_val[8]`; conductor `inst->conductor_track`
  + per-clip `cond_resp/oct/when[NUM_TRACKS]`/`cond_lock`; mute/solo `inst->mute[]`/`solo[]`.
- **No RT-thread logging** from the render/tick path (drops audio); log only from set/get_param.

---

## 6. Web UI side (`web_ui.html`)

### 6.1 Transport API + mock shim
`R = window.schwungRemote` (injected by the manager): `getParam(k) → Promise`, `setParam(k,v)`,
`onParamChange(cb)` (manager pushes). `P = "overtake_dsp:"`.

A **mock shim** (`if (!window.schwungRemote) { … }`, ~line 284) synthesizes the `rui_*` fields
and honors writes so the whole editor **previews in a plain browser** — invaluable for
iteration. Serve the file and open it; it seeds a sample set. Keep the shim in sync when you add
a field or key. ⚠️ A **backgrounded browser tab throttles `requestAnimationFrame` to 0**, so the
playhead appears frozen in a hidden preview tab — not a bug; foreground it, or unit-test the
math in node.

### 6.2 Model + poll cycle
- **`parseModel()`** (~459) reads the KV and builds **`M`** — `{play, sel, clip, glob, scaleMask,
  pfx, notes, dnotes, dlanes, laneInfo, tracks[], ccmeta, cc, cond, rev, …}`. Small parsers per
  field (`parseCcMeta`, `parseCc`, `parseCond`, …).
- **`applyParams(params)`** (~1925) merges pushed `rui_*` keys into `kv`, re-parses `M`, re-anchors
  the playhead, and renders. Guards a post-edit **suppress window** so an in-flight optimistic
  edit isn't clobbered by a stale snapshot, and a `dragging` guard.
- **`refresh()`** (~1954) polls all `rui_*` keys (or `R.resubscribe()`), then `applyParams`.
  **`pullSoon()`** schedules a `refresh` ~130 ms after an edit; **`afterEdit()`** marks local
  optimism.

### 6.3 Coordinate system (shared across all three bands)
```
ZB = 12                          // edge zoom-band thickness
GUTTER = 48 + ZB (=60)           // left gutter (pitch labels; zoom bar occupies the left ZB)
RULER  = 24 + ZB (=36)           // top ruler (bar numbers + loop brace; zoom bar in top ZB)
STEPBAND = 28                    // bottom step-edit band
PXPERTICK = 0.6 (H zoom)  ROWH = 14 (V zoom)  scrollX/scrollY
xOfTick(t) = GUTTER + t*PXPERTICK - scrollX     tickOfX = inverse
yOfRow(r)  = RULER  + r*ROWH     - scrollY
BEAT_TICKS = 96   BAR_TICKS = 384   TICKS_PER_STEP = 24 (default tps)
```
The **velocity** and **automation** bands (below the roll) map x through the **same `xOfTick`
(same `GUTTER`)** as the roll — so notes, velocity stems, and automation stay column-aligned.
Bumping `GUTTER`/`RULER` shifts all three equally (that's how the zoom bars got their reserved
bands without breaking alignment).

### 6.4 Render pipeline
- `renderChrome()` transport/status; `renderSession()` the track headers + scene grid (badges:
  conductor `C`, responder `•`, mute `M`, solo `S`; the `☰` gear opens route/channel);
  `layout()` sizes the canvas + rows; `draw()` paints the roll (ruler, gutter, notes/drum hits,
  loop brace, step band); `renderSidePanels()`/`renderInspector()` the accordion inspector
  (Clip / FX / Conductor panels + note/step/drum edit bars); `drawVel()`/`drawAuto()` the bands.
- **Playhead** `phStep()` (~1972): a `#playhead` DOM overlay moved by `translateX` each rAF frame
  via **client-side tempo extrapolation** — `est = anchorTick + elapsed·(BEAT_TICKS·bpm/60000)`,
  re-anchored to the device tick every poll, **wrapped within the device loop window
  `loopTicks()`** (NOT `displayTicks()`, which rounds up to a bar). rAF runs only while playing.
- **Zoom bars** `wireZoomStrip()` (~2028): the `.zh`/`.zv` overlays live in the reserved ruler/
  gutter ZB bands; drag adjusts `PXPERTICK`/`ROWH` within the same clamps as the H/V buttons,
  then `clampScroll()` + `draw()`.

---

## 7. Subsystem map (where each feature lives)

| Feature | Web (`web_ui.html`) | DSP read | DSP write |
|---|---|---|---|
| Session grid + launch | `renderSession`, `launchScene`/`launchClip`, `selectClip`, `dropClip` | `rui_index` | `launch_scene`, `tN_launch_clip`, `tN_cC_ruisel`, `clip_copy` |
| Piano roll (melodic) | `draw`, note gestures, `renderNoteEdit` | `rui_notes`, `rui_clip`, `rui_scale` | `tN_lL_note_*` (drum) / melodic step+note keys |
| Drum lanes | `renderDrumPanel`, `drumHitAt`, `drumAdd/Delete` | `rui_dlanes`, `rui_dnotes`, `rui_lane` | `tN_lL_*` |
| Step edit | `renderStepEdit` | `rui_steps`/`rui_dsteps` | `tN_cC_step_S_*` |
| CC automation | `renderCcPicker`, `renderCcCtl`, `drawAuto`, `ccClip()`, `focusCc` | `rui_ccmeta`, `rui_cc` | `tN_cC_cc_focus`, `tN_cc_auto_*`, `tN_cc_rest`, `tN_cc_type_assign`, `tN_cC_kK_cc_loop_set` |
| Conductor | `renderCondPanel`, `condEligible`, session badges | `rui_cond`, `rui_index.pm` | `tN_cC_cond_resp/oct/when/lock` |
| Transport + playhead | `renderChrome` `#xport`, `phStep` | `rui_play` | `transport` |
| Per-track gear / mute / solo | `openTrackGear`, header click/right-click | `rui_index` (`route`,`chan`,`mute`,`solo`) | `tN_route`, `tN_channel`, `tN_mute`, `tN_solo` |
| Loop brace | `setLoop`, `loopHandleAt` | `rui_clip`/`rui_lane` | `tN_cC_loop_set` / `tN_lL_loop_set` / `tN_all_lanes_loop_set` (drum all-lanes) |
| Zoom | `wireZoomStrip`, H/V buttons | — (view state) | — |
| Collapsible bands | `saveBands`, `bandsApply` | — | localStorage (`dbx_velOpen`/`dbx_autoOpen`) |

---

## 8. Invariants & gotchas (hard-won)

1. **Display = snapshot fields only.** No live `getParam` round-trip. New UI data ⇒ new `rui_*` field.
2. **64 KB snapshot budget — truncation-safe.** Gate large per-clip data (automation curves via `rui_cc`
   focus) so a full snapshot stays small. `seq8_remote_snapshot` reserves `RUI_TAIL_RESERVE` (96 B) of tail
   headroom: the unbounded loops (`rui_dnotes`, `rui_notes`, `rui_cc`) stop before the buffer end so the
   closing `"}` ALWAYS fits — an over-large clip degrades to fewer notes, never a mid-token truncation
   (which the manager silently drops → bricked editor). `rui_cc` is emitted **last** (after the structural
   fields + note content) so an over-large focused CC lane can only ever starve itself, not the session grid.
   Field order is NOT load-bearing (manager parses JSON by key; browser `get()` by key), so this reordering
   is safe. When any guarded loop truncates, the snapshot emits `rui_trunc:1` before the closing brace
   (≈14 B, fits inside the reserve) → the browser shows a non-blocking "clip too dense — some notes hidden"
   badge. Pinned by the pathological-overflow + CC-tail-overflow cases in `tests/test_rui_budget.c` (both
   assert a valid `}` close and `rui_trunc:1`; the realistic case asserts it is ABSENT).
3. **Playhead wraps the loop window, not `displayTicks()`.** The device wraps `current_clip_tick`
   in `[loop_start, loop_start+length)·tps` (`playback_audible_cct`). Wrapping the extrapolation
   at the bar-rounded `displayTicks()` made it overshoot/jump on non-bar clips.
4. **Hidden-tab rAF throttling** freezes the playhead in a backgrounded preview tab (not a bug).
5. **Coalescing:** last `set_param` per buffer wins; multi-field edits must be one atomic key.
6. **`rui_touch()`** on content edits, or the rev-gated poll won't re-read.
7. **Alignment:** roll / velocity / automation all use `GUTTER` + `xOfTick`.
8. **`web_ui.html` is standalone** (not the `ui/` bundle). Deploy = `build.sh` copies it into
   `dist/`, or `cp web_ui.html dist/davebox/ && install.sh` for a web-only change (no DSP recompile).
9. **Mock shim** must learn every new field/key or browser preview drifts from device.
10. **Optimistic edits + suppress window:** local mutation renders immediately; a `~130 ms`
    `pullSoon()` reconciles; `applyParams` ignores stale snapshots during the suppress window.

---

## 9. Extending / refactoring

**Add a read field (something new to display):**
1. Emit it additively in `seq8_remote_snapshot()` (choose a compact format; keep parsers tolerant).
   Gate it behind a focus/visibility key if it can be large.
2. Parse it in `parseModel()` → `M.<field>`; teach the **mock shim** to synthesize it.
3. Consume it in the relevant render fn.
4. Pin its shape in `tests/test_remote_snapshot.c` (drive the DSP to emit it, assert the string).

**Add a write (something new to edit):**
1. Use a `tN_*`-prefixed `set_param` (avoid new *global* keys — silently dropped; piggyback a
   per-track push). Handle it in `dsp/seq8_set_param.c`; call `rui_touch()` if the UI should re-read.
2. Wire the gesture in `web_ui.html` (`R.setParam(P+key,val); afterEdit(); pullSoon()`), and honor
   it in the mock shim's `setParam` so preview reflects the edit.

**Regression-safety seam (TODO).** The `rui_*` DSP-emit ↔ web-`parseModel` format is the fragile
contract — a DSP format tweak can silently break the UI. A harness that drives the DSP to emit
each `rui_*` field and pins its shape (extending `tests/test_remote_snapshot.c`), and/or a shared
schema both sides assert, would catch this. Not yet built.

---

## 10. Testing

- **Off-device:** `tests/run.sh` (white-box; `#include`s `seq8.c` + stub host).
  `tests/test_remote_snapshot.c` pins the snapshot fields; `tests/test_remote_note_edit.c` the
  note write path.
- **Browser preview:** serve `web_ui.html` and open it (mock shim). Verify rendering + non-rAF
  interactions; foreground the tab to see the playhead animate; unit-test animation math in node.
- **On-device:** the manager serves the file live; `build.sh`+`install.sh` (or `cp`+`install.sh`
  for web-only), then reboot/reload. md5-verify the deployed `web_ui.html`/`dsp.so`.

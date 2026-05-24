# dAVEBOx → Ableton (.ablbundle) export — implementation plan

**Goal:** A Global-Menu action that exports the current dAVEBOx session (8 tracks × 16 clips) as a
self-contained `.ablbundle` desktop Ableton Live opens — with the mapped Move track instruments +
samples carried over, baked ("what you hear") MIDI, and route-aware track names.

**Companion docs:** `notes/ableton-export-bundle.md` (full format spec + the 6 finalized
UX decisions + bake/loop-brace design). Verify on-device per task (this project has no unit
harness; verification = build/deploy/observe, per CLAUDE.md). Not TDD-stepped for that reason.

---

## Architecture (proposed)

Three responsibilities, split by capability:

- **JS (`ui/ui_export.mjs`, new)** — all JSON + orchestration (text only, which host FS supports):
  read the loaded Move `Song.abl` (`host_read_file` + `JSON.parse`) for per-track instrument
  subtrees/colors/`midiInputMode`; read Schwung `shadow_chain_config.json`; trigger per-clip
  non-destructive render and read baked notes (DSP `get_param`, text); build the export `Song.abl`
  (8×16, instruments, names, region/loop-brace framing, relative `Samples/` refs); emit a
  **sample manifest** (text: `src_abs_path → Samples/<dest>`); write both to a request/staging dir.
- **DSP (`dsp/seq8.c`)** — ONE new capability: **non-destructive render-to-buffer**. Reuses the
  existing pfx pipeline from `bake_clip`/`bake_drum_lane` (the compute *before* the write-back) but
  emits notes via `get_param` instead of mutating the clip. Cheap, in-memory, audio-thread-safe.
- **Packager (binary, off-RT-thread)** — copies binary samples + builds the store-mode zip. **This
  is the architecture decision** (see Phase 0 / Phase 5): default = small **Python helper**
  (move-over pattern). JS writes the request; packager produces `<set>-YYYYMMDD.ablbundle`.

**Why split this way:** host file APIs are string-only (`host_read_file`/`host_write_file`, no
copy, no binary) → JS can't touch binary; binary packaging can't run on the audio thread → can't
be plain DSP either. JS owns JSON (its strength), a binary-capable off-thread packager owns bytes.

### Hard constraints (user 2026-05-23)
- **Fully offline / local** — no network, cloud, or desktop dependency at export time; all reads
  (Move set, samples), bake, and packaging happen on-device. If a Python helper is used it is a
  **local file packager (no network service)** — NOT move-over's Flask pattern.
- **Transport must be STOPPED** — export is a **no-op + OLED notification** ("Stop transport to
  export" or similar) if the sequencer is running. JS gates on its transport-playing state before
  doing anything.

### Finalized decisions (from the spec doc — do not re-litigate)
Output `/data/UserData/schwung/davebox-exports/<set>-YYYYMMDD.ablbundle` (+`-2/-3` dupes) · all 8
tracks always (empty→Dummy Drift) · portable samples · names: Move preset / `SCH-[chain]` /
`Ext ch [n]` / `dB [tr]` · auto bake w/ loop-brace-reveals-extra (delay 2-cycle, random 4-cycle,
both layered, drums same w/ L=LCM cycle) · grid clip N→scene N, clips land stopped.

### Resolved technical specifics
- `BAKE_BUF = MAX_NOTES_PER_CLIP`; existing bake already sizes `bake_out[BAKE_BUF*4]` / `out_cap =
  BAKE_BUF*loops` for up to 4 loops → 4-cycle render fits existing buffers. Drum pool `DRUM_BAKE_POOL=2048`.
- Note tick→beat: 1 bar = 384 DSP ticks, 4 beats/bar → **beats = ticks / 96**; gate(ticks)→duration
  beats same ÷96; velocity 1–127 → float.
- Empty clip slot JSON = `{"hasStop":true,"clip":null}`. clip `region` =
  `{start,end,loop:{start,end,isEnabled}}`; set `region.end` = content extent (N·L beats),
  `region.loop.end` = L (default brace = first cycle). **VERIFY** loop-brace < content opens cleanly
  in Live (standard, but untested in our generated file).
- Sample URI→file: `ableton:/packs/abl-core-library/X`→`/data/CoreLibrary/X`;
  `ableton:/user-library/X`→`/data/UserData/UserLibrary/X`; URL-decode `%20` etc. Leave non-sample
  `ableton:` URIs (presetUri/spriteUri) untouched.
- Dummy instrument = captured Drift `instrumentRack` subtree, saved in repo at
  `notes/ableton-export-drift-dummy.json` (6.4 KB, 0 samples). Clone, set `name`, neutralize macros.

### Open specifics to nail during build (need device / populated data)
- **Channel→instrument map**: how `S.trackRoute[t]` / `S.trackChannel[t]` / `S.trackSchwungSlot[t]`
  resolve to Move `midiInputMode` and Schwung `slot_channels`[4-7] vs `patches`[1-4] offset. Confirm
  against a set with a populated Schwung chain (current slots empty).
- **Trigger from JS→DSP**: new global `set_param` keys are silently dropped (CLAUDE.md) — the render
  trigger must be a per-track `tN_*` key or piggybacked.
- **Drum noteNumber alignment** with target drumRack cells (should hold by construction; verify).

---

## Phase 0 — De-risk: host binary byte-safety (decides architecture)
**Why first:** if host FS is byte-preserving, the whole packager collapses to JS and Phases 5/6 shrink.
- [ ] Add a temporary DSP/JS probe: `host_write_file` a known binary blob (bytes 0x00–0xFF), read it
  back, compare. Deploy, run, check `seq8.log`.
- [ ] **If byte-safe** → packager = JS (store-mode zip + sample bytes in JS); skip the helper. Revise
  Phases 5–6 accordingly.
- [ ] **If not** (expected) → proceed with the Python-helper packager (Phase 5). Remove the probe.

### Phase 0 RESULT — 2026-05-23 (resolved by source + device tooling probe, no byte-blob deploy needed)
**host FS is NOT byte-safe** (settled from `~/schwung/src/shadow/shadow_ui.c` source — authoritative):
- `host_write_file` (shadow_ui.c:1969): `len = strlen(JS_ToCString(content))` + `fwrite`. JS string →
  UTF-8: embedded `0x00` truncates the write; bytes `0x80–0xFF` get UTF-8-expanded. Binary write unsafe.
- `host_read_file` (shadow_ui.c:1923): `fread` then `JS_NewString` (NUL-terminated UTF-8) → truncates
  at first `0x00`, mangles invalid UTF-8. Binary read unsafe.

**BUT a third, better architecture exists — neither "JS-only zip" nor "Python-helper daemon":**
- `host_system_cmd(cmd)` (shadow_ui.c:1779, **stock Schwung** — upstream `fb44ccbf`, not in our patch):
  prefix-allowlisted (`tar/cp/mv/mkdir/rm/ls/test/chmod/`**`sh`**); `sh ` prefix ⇒ effectively
  arbitrary commands via `sh -c '...'`. fork+execl `/bin/sh` at SCHED_OTHER. **Returns exit code only**
  (no stdout → redirect to a file + `host_read_file` to capture output).
- `host_read_file_base64` (shadow_ui.c:3080, **stock** — upstream PR #61): byte-safe READ fallback if
  ever needed (we won't — samples go through the OS, not JS).
- **Device tooling (ssh probe):** NO `zip` binary (busybox has only `unzip`/`gzip`/`tar`); **`python3`
  3.10.18 at `/usr/bin/python3` WITH `zipfile`** ✅. Verified end-to-end on device: python3 `zipfile`
  (`ZIP_STORED`) produced a `.ablbundle` with `Song.abl` at root + `Samples/test.wav` (2048 binary
  bytes intact), `unzip -l` confirms structure.

**DECIDED architecture (supersedes the JS-zip-vs-Python-helper fork above):**
- **JS** (`ui_export.mjs`): orchestration + build `Song.abl` JSON (text → `host_write_file`, safe since
  JSON is UTF-8 text) + emit a text **manifest** (sample `src_abs → Samples/<dest>`).
- **DSP**: non-destructive render-to-buffer for baked MIDI (`get_param` text). Unchanged.
- **Packager** = a `pack.py` (shipped in the module dir) invoked **once** via
  `host_system_cmd("sh -c '/usr/bin/python3 <pack.py> <staging> <out.ablbundle>'")` — copies binary
  samples into staging `Samples/` (OS-level, never through JS) + builds the `ZIP_STORED` bundle.
  Fully on-device, offline, **no daemon, no network, no JS byte-writer**. Ships from `main` to stock
  Schwung (host_system_cmd + python3 both stock) → **no capability gate needed**.
- Byte-safety of `host_write_file` is now **irrelevant** to the design (binary never touches JS).

**One thing still to confirm on first real build (Phase 1):** that `host_system_cmd` actually executes
from inside the shadow_ui process context (allowlist + fork/exec + PATH) — ssh login shell ≠ shadow_ui
child env; use absolute `/usr/bin/python3` to be PATH-independent. Verify during Phase 1 deploy.

## Phase 1 — Skeleton: menu + empty 8×16 bundle (no instruments/samples/MIDI yet)
Proves the pipeline produces a Live-openable bundle from dAVEBOx.
- [ ] `ui/ui_export.mjs`: `exportSession()` stub; add **"Export to Ableton"** to
  `buildGlobalMenuItems()` (`ui/ui.js:153`).
- [ ] **Transport guard:** `exportSession()` first checks JS transport-playing state — if running,
  `showActionPopup('STOP','TRANSPORT TO EXPORT')` (or similar) and return (no-op). All later phases
  assume stopped transport.
- [ ] Build a minimal `Song.abl`: 8 tracks, 16 empty scenes, each track carries the **Dummy Drift**
  (from the captured template), names = `dB 1..8`, global tempo/key/scale from dAVEBOx.
- [ ] Write `Song.abl` to staging; package via chosen packager into
  `davebox-exports/<set>-YYYYMMDD.ablbundle` (dup-suffix logic).
- [ ] **Verify:** bundle into Live → opens, 8 tracks × 16 scenes, all named, Drift on each.

### Phase 1 RESULT — 2026-05-23 (device + desktop-Live verified ✅; on branch `ableton-export`, UNCOMMITTED)
Done as designed, with these specifics:
- `ui/ui_export.mjs` (new): `requestExport()` (menu action) → confirm dialog → `confirmExportStart()`
  → `pollPendingExport()` (tick drain — get_param('bpm') needs tick context). Menu action runs in
  on_midi where get_param is null, so all work is deferred to tick (codebase idiom).
- **Confirm/cancel dialog** added (user request) — modeled on Clear Session: `S.confirmExport` /
  `S.confirmExportSel` (0=Yes,1=No default); `drawExportConfirm()` in `ui_dialogs.mjs`; jog toggles,
  jog-click commits, Back cancels; wired into the 2 commit/jog/cancel handler blocks + pad guard.
- **Transport guard = stop-transport notice** (`showStopTransportNotice()`), held 2× normal popup
  duration (`ACTION_POPUP_TICKS*2`, user request). Checked at both menu-select and Yes-commit.
- `Song.abl` built from scratch in JS (8 `kind:midi` tracks, each a cloned Drift dummy named `dB N`,
  16 empty clipSlots `{hasStop:true,clip:null}`, real captured master subtree, `$schema` 1.8.2).
  Carries **tempo + rootNote(key)**; **scale hard-coded "Major"** (Phase 3 maps it); no notes.
- **Packager shipped as module files**: `export/pack.py` + `export/ableton-master.json` +
  `notes/ableton-export-drift-dummy.json` → copied to `dist/davebox/` by `build.sh`; read at runtime
  from the module dir. JS-only deploys ship them too (install.sh scp's all of dist/davebox).
- `pack.py` invoked via `host_system_cmd("sh -c '/usr/bin/python3 .../pack.py .../pack-args.json'")`;
  args (incl. space-containing set name + out path) passed via `pack-args.json`, status read back from
  `pack-status.json`. Output `/data/UserData/schwung/davebox-exports/<set>-YYYYMMDD[-N].ablbundle`.
- **Confirmed on device:** host_system_cmd fires python3 from shadow_ui; dup-suffix `-2` works; bundle
  opens in desktop Live with 8 named tracks × 16 empty scenes + Drift on each, correct tempo.
- Bundler `ORDER` + `S.pendingExport`/`S.confirmExport*` state added.

## Phase 2 — Instruments + names (route-aware mapping)
- [ ] Read loaded Move `Song.abl`; build channel→Move-track map from `midiInputMode`.
- [ ] Per dAVEBOx track: ROUTE_MOVE → copy matched Move track's `devices` subtree + name=preset;
  ROUTE_SCHWUNG → Dummy Drift + name=`SCH-[chain]` (from `shadow_chain_config.json`); EXTERNAL →
  Dummy + `Ext ch [n]`; none → Dummy + `dB [tr]`. Track colors from mapped Move track / dB defaults.
- [ ] **Verify:** instruments load in Live; names correct; re-channel a Move track → still maps right.

### Phase 2 RESULT — 2026-05-24 (device + desktop-Live verified ✅; on branch `ableton-export`)
Mapping pinned + empirically confirmed against the live set (4 Move + 4 Schwung tracks):
- **Routes** (`fmtRoute`): 0=Schwung, 1=Move, 2=Ext. `S.trackChannel` is **1-based** (sends on
  `trackChannel-1`); `S.trackRoute` per track. Both read live in tick (pollPendingExport).
- **Loaded Move Song.abl** located at `Sets/<currentSetUuid>/<currentSetName>/Song.abl` (inner folder
  name == active_set.txt line 2 == `S.currentSetName`, verified). Read via `host_read_file` (largest
  real Song.abl ~217KB ≪ 4MB cap). `loadMoveSong()` + `buildMoveChannelMap()` (key = `midiInputMode[0]`,
  the 0-based listen channel; defensive `Array.isArray && typeof===number`).
- **ROUTE_MOVE**: match Move track `midiInputMode[0] === trackChannel-1` → clone its `devices` subtree
  (carries fx + drumRack/instrumentRack) + name=preset (`devices[0].name`) + color + mixer (sends
  cleared). Fallback Dummy `dB N`.
- **ROUTE_SCHWUNG**: `shadow_chain_config.json` `patches[i].channel === trackChannel` → name
  `SCH-<patches[i].name>`; Dummy Drift instrument. Missing config → `dB N`.
- **ROUTE_EXT**: name `Ext ch <trackChannel>`; Dummy. All sources degrade gracefully to Dummy `dB N`.
- **Verified table** (set "Set 1 Copy 7"): dB1=Cheetah Kit(drumRack,c1), dB2=BA Analog Bass 3(c17),
  dB3=BA Biggest One(c7), dB4=PL Hawkins(c10), dB5=SCH-NUS, dB6/7=SCH-Untitled, dB8=SCH-NS + JC + DFH.
  Matched exactly in the exported bundle; opens + plays in Live. Samples still by-reference (`ableton:`
  URIs; portability = Phase 5).
- Name collision fix: renamed export `SETS_BASE_DIR` → `EXPORT_SETS_BASE_DIR` (ui_persistence already
  declares `SETS_BASE_DIR`; bundler flattens all modules into one scope).

## Phase 3 — Baked MIDI (melodic)
- [ ] DSP: add non-destructive render-to-buffer (melodic) — copy `bake_clip` compute (`seq8.c:6077–6159`),
  emit notes via a `tN_cC_*` `get_param` as `tick:gate:pitch:vel;`. Trigger via per-track key.
- [ ] JS: for each non-empty melodic clip, render, read notes, convert ticks→beats, fill `notes[]`;
  set `region`/`region.loop` per loop-brace design (Phase 4b adds the multi-cycle framing).
- [ ] **Verify:** a melodic clip plays in Live identical to dAVEBOx (incl. pfx, since baked).

### Phase 3 RESULT — 2026-05-24 (device + desktop-Live verified ✅; on branch `ableton-export`)
- **DSP** `render_melodic_clip()` (seq8.c, before bake_clip): a **parallel** (NOT shared) mirror of
  the bake_clip compute — runs the same pfx pipeline (NOTE FX / HARMZ / SEQ ARP / MIDI DLY) and
  writes "what you hear" notes to a caller buffer, NO clip mutation / undo / state_dirty. Tagged
  "MIRROR of bake_clip compute — keep in sync". (Deliberately did NOT refactor bake_clip — shipped
  code, subtle behavior; revisit sharing after Phase 4.)
- **DSP get_param** `tN_cC_export`: returns `"<total_ticks> <note_count>\n<tick>:<pitch>:<vel>:<gate>;..."`.
  Phase 3 hardcodes loops=1, wrap=0 (single cycle). Host get_param buffer is **16KB** (`schwung_host.c`
  `js_host_module_get_param` buf[16384]) → a single cycle (≤512 notes ≈11KB) fits; `note_count` header
  lets JS detect truncation. **Phase 4b ≥4 loops can exceed 16KB → needs a different transfer (file or
  chunking).** Note order is `tick:pitch:vel:gate` (DSP-native), NOT the plan's `tick:gate:pitch:vel`.
- **JS** `buildClip(t,c)` (ui_export.mjs): renders every melodic clip via the get_param (DSP
  authoritative — empty clips return count 0 → empty slot; drum tracks skipped, `trackPadMode`).
  ticks→beats ÷96. Clip fields match the Live-verified Set38 shape exactly
  (`{isPlaying,name,color,isEnabled,timeSignature,region,grooveId,stepEditorScrollPosition,notes,envelopes}`,
  notes `{noteNumber,startTime,duration,velocity,offVelocity}`). Defaults: grooveId null, color null,
  offVelocity 0, timeSignature 4/4, region single-cycle [0,L].
- **CRITICAL FIX — same-pitch overlap legalization** (`legalizeNotes`): Ableton **rejects a clip with
  two same-pitch notes overlapping** ("Document invariant violation" — hit by a harmony/long-gate clip).
  JS clamps each note to end just before the next same-pitch onset + dedupes same-start. Baked pfx
  (arp/delay/harmony/long gates) routinely produces these; they're fine as live MIDI but illegal in a
  clip. Verified: BA Biggest One 2 overlaps → 0, no notes lost, opens + plays in Live.
- Verified: simple clip (Test A) + pfx clip (Test B, SEQ ARP/HARMONY) both open + play in Live.

### Transfer upgrade — 2026-05-24 (file-based DSP→JS note transfer; lifts the 16KB cap)
Done before Phase 4 because drum LCM merges and multi-cycle (4b) bakes exceed the 16KB get_param
buffer. `tN_cC_export` now writes the notes to `EXPORT_RENDER_PATH`
(`/data/UserData/schwung/seq8-export-render.txt`, fixed path, defined in BOTH seq8.c and
ui_export.mjs) and returns only the `<total_ticks> <note_count>` header; JS `buildClip` reads the
file (`host_read_file`, 4MB cap — a single clip ≪ that). Per-clip file, overwritten each call. n=-1
header signals a file-write failure. Verified: byte-identical clip output vs the old get_param path
(Test B 16/6/8 notes, 0 overlaps). Internal plumbing — no user-visible change, no MANUAL/CHANGELOG.

## Phase 4 — Drums (flatten + LCM)
- [ ] DSP: non-destructive render-to-buffer (drum) from `bake_drum_lane` compute; per-lane notes at
  `dl->midi_note`.
- [ ] JS: compute LCM of active lanes' lengths (in ticks); tile each lane across LCM; merge to one
  `notes[]`; clip length = LCM (cap policy: clamp to N bars / max length, snap to clean loop).
- [ ] **Verify:** a polymetric drum clip (lanes of differing lengths) loops correctly in Live.

### Phase 4 RESULT — 2026-05-24 (device + desktop-Live verified ✅; on branch `ableton-export`)
- **DEVIATION (intentional):** LCM/tile/merge done **in the DSP**, not JS as the plan said — the
  file transfer made shuttling per-lane data to JS pointless; DSP has the lane data and writes the
  finished merged clip to `EXPORT_RENDER_PATH`, JS reads it exactly like a melodic clip.
- **DSP** `render_drum_lane_nd()` (mirror of bake_drum_lane compute, non-destructive, one cycle, emits
  at `dl->midi_note`) + get_param `tN_cC_export_drum`: gathers active lanes, computes span =
  LCM(lane loop-lengths in TICKS, `u32_gcd`), tile-copies each lane to fill span, merges into one pool
  (each note at its lane's midi_note), writes to the shared render file. Header `"<span> <count>"`.
- **Tile-copy** (not fresh-render-per-repeat) — a randomized lane's variation repeats within the span;
  fresh-per-tile is a Phase 4b decision. **Caps:** pool `DRUM_BAKE_POOL` (2048); span
  `EXPORT_DRUM_MAX_TICKS` (24576 = 64 bars), snapped to a clean multiple of the longest lane on
  coprime blow-up (rare degenerate case). Edge cases handled: 0 active lanes → "0 0"; lane_ticks 0
  skipped; single lane → span = its length.
- **JS** `buildClip(t,c,isDrum)` now picks `_export` vs `_export_drum`; `buildTrack` routes drum tracks
  (`trackPadMode!==0`) to the drum path. `legalizeNotes` (JS) handles same-lane same-pitch overlaps —
  no second legalization in DSP.
- Verified on device + Live: basic same-length drum clip (0 overlaps, correct lane pitches) AND a true
  **polymeter clip** — span 12 beats = LCM of a 4-beat × 1.5-beat(6-step) lane; all lanes tile cleanly
  with no drift, 0 overlaps, loops seamlessly in Live.

## Phase 4b — Bake options (loops/wrap + loop-brace layout)
- [ ] Auto-detect per clip/lane from pfx: randomization → 4 cycles; delay → wrap (2-cycle layout);
  both → layered (cycle 1 clean, 2–4 random+wrapped); else 1 cycle.
- [ ] Set `region.end` = N·L (content), `region.loop` = first cycle. Drums: L = LCM cycle.
- [ ] **Verify:** randomized clip → expanding the loop brace in Live reveals variety; delayed clip →
  moving brace toggles unwrapped/wrapped.

### Phase 4b RESULT — 2026-05-24 (device + desktop-Live verified ✅; on branch `ableton-export`)
**Model SIMPLIFIED from the original loop-brace-reveal spec (user 2026-05-24):** the brace-on-cycle-1
reveal was dropped. New rule, applied per melodic clip:
- **randomness → 8 cycles** (clip is 8 cycles long, each a distinct random variation); **delay → wrap
  every cycle** (echoes fold to steady-state); **loop brace = the whole clip** (for a normal 1-cycle
  clip that = the original length). plain=1, delay=1 wrapped, random=8, random+delay=8 wrapped.
- "Randomness" = NOTE FX `note_random`, arp Rnd/RnO, **or** DELAY-bank `fb_note_random` when delay is
  on (the latter added after the user flagged track-3's delay-feedback random wasn't triggering it).
- DSP: `render_melodic_clip(loops, wrap_from, ...)` — per-cycle wrap (cycles ≥ wrap_from fold mod L),
  RNG persists across cycles for distinct passes, `note_random_walk` resets per cycle. Buffer
  `BAKE_BUF*8`. get_param `tN_cC_export` returns `"<span> <count> <span>"` (brace = whole). JS
  `buildClip` sets region.end = span, region.loop.end = span. Drums unchanged (1 LCM cycle, deferred).

### Bake-fidelity fixes — 2026-05-24 (found while testing 4b; SHARED with in-app Capture/bake)
Audited every pfx param vs the bake; fixed the gaps (all in the shared bake stages, so in-app bake
improved too):
- **`delay_retrig`** (was ignored; default ON): `bake_stage_midi_dly` now truncates each note's echo
  train at the next note onset (wraps to first+clip_ticks for steady-state cycles).
- **Echo gate** (the clip-A "sustained vs staccato" bug): echoes with `fb_gate_time=0` baked at the
  SOURCE note gate (e.g. 96t) but live uses `pfx_gate_smp` = `GATE_TICKS(12) * gate_time%`. Now baked
  at the live default. (Masked for non-random delay because same-pitch `legalizeNotes` clamped them;
  exposed by random-pitch delay where pitches spread and escape clamping.)
- **Arp Steps**: `bake_stage_arp_out` now copies `step_int` + `step_loop_len` (was hardcoded `&7u`),
  uses loop-len for step_pos, applies the per-step interval offset (needs `inst` → +1 param, 5 calls).
- **Drum `delay_retrig`**: copied into `fx` in the 3 drum bake paths (drum lanes have no `fb_note_random`).
- NOT fixed: `unison` (parked for removal), arp `retrigger` (bake forces on), arp `sync` (N/A offline).

## Phase 5 — Samples (portable) + packager
- [ ] JS: while copying instrument subtrees, collect every `sampleUri`; resolve URI→abs file; rewrite
  ref to relative `Samples/<basename>` (dedupe basenames); emit manifest.
- [ ] Packager (Python helper unless Phase 0 said JS): copy binary samples → `Samples/`; build
  store-mode `.ablbundle` zip (Song.abl@root + Samples/). Deploy + auto-start helper if daemon.
- [ ] JS: poll for output bundle; show progress/done in OLED.
- [ ] **Verify:** export on a machine *without* the packs → still opens with all sounds.

### Phase 5 RESULT — 2026-05-24 (device + desktop-Live verified ✅; on branch `ableton-export`)
- **JS** (`ui_export.mjs`): `collectSamples()` walks each cloned **Move** instrument subtree (ROUTE_MOVE
  only — Dummy Drift has no samples), resolves each `sampleUri` via `resolveSampleUri`
  (`ableton:/packs/abl-core-library/X`→`/data/CoreLibrary/X`, `ableton:/user-library/X`→
  `/data/UserData/UserLibrary/X`, URL-decoded), rewrites the ref to `Samples/<encodeURIComponent(base)>`,
  and records `{src,dest}` in a deduped manifest (`ctx.samples`/`sampleBySrc`/`usedDest`). Manifest →
  `pack-args.json` → `pack.py` copies into staging `Samples/` (pack.py UNCHANGED from Phase 1).
- **GOTCHA (cost a cycle):** do NOT `host_file_exists()` the resolved path to gate inclusion — the host
  `validate_path` (schwung_host.c:1954) sandboxes ALL JS file APIs to `BASE_DIR`, so `/data/CoreLibrary`
  + `/data/UserData/UserLibrary` always read as "missing" from JS. `pack.py` (unsandboxed python via
  host_system_cmd) is authoritative — it copies what exists and reports the rest in `status.missing`
  (JS shows "N SMP MISSING"). First attempt gated on host_file_exists → 0 samples bundled.
- **Encoding contract (verified vs real Note bundle):** zip entry = DECODED basename (`Samples/Snare VB.wav`);
  `sampleUri` ref = URL-ENCODED (`Samples/Snare%20VB.wav`); Live URL-decodes the ref to find the entry.
- Verified: 16 refs → 15 files (one deduped), `copied=15 missing=0`, 0 leftover `ableton:` refs, every
  ref matches a zip entry, `Snare VB.wav` 78284 bytes byte-identical source↔bundle. Opens + plays in Live.
- **Known minor edge (Phase 6):** a genuinely-missing sample → ref rewritten to a dangling `Samples/X`
  (pack.py can't copy it) rather than left as `ableton:`. Rare (a loaded set's samples are in CoreLibrary
  by construction). Phase 6 could revert missing refs in pack.py.

## Phase 6 — Polish
- [ ] **Track colors should match the dAVEBOx track color for ALL tracks** (user note 2026-05-24).
  Currently Move-routed tracks use the matched Move track color (happens to match dB) but
  Schwung/Ext/fallback tracks use an arbitrary `DB_TRACK_COLORS` palette → mismatch. Fix: source the
  actual dAVEBOx per-track color for every exported track's `color`.
- [ ] Progress/most-recent-export feedback; error handling (missing sample, oversized clip, no clips).
- [ ] MANUAL.md + CHANGELOG entries; capability-gate if any patched-Schwung dependency.
- [ ] **Verify:** full 8×16 session with drums, melodic, Schwung + external tracks, randomized +
  delayed clips → opens in Live, sounds like dAVEBOx, names/colors correct.

## Risks
- Phase 0 outcome flips the packager design. · Helper trigger/auto-start mechanism (daemon vs
  DSP-spawn) — confirm on-device. · LCM cap for pathological coprime drum lanes. · region/loop-brace
  rendering in Live (verify early, Phase 1/3). · Live 12.1+ for Drum Sampler; export is one-way.

# SEQ8 — Design Spec
**Read alongside CLAUDE.md. This covers design intent and behavior. CLAUDE.md covers implementation.**

---

## 1. Hardware

### CC / Note Map
| Control | CC / Note | Function |
|---------|-----------|----------|
| Pads 1–32 | Notes 68–99 | Live note input / clip launch / step edit |
| Step buttons 1–16 | Notes 16–31 | Step toggle / scene launch (Session View) / clip length |
| Track buttons 1–4 | CCs 43–40 (reversed) | Clip select (Track View) / scene row launch (Session View) |
| Knobs 1–8 | CCs 71–78 | Parameter control. Relative: CW=1–63, CCW=64–127 |
| Knob touches 1–8 | Notes 0–7 | Touch on=127, off=0–63 |
| Volume encoder | CC 79 | Do not consume — BROKEN |
| Jog rotate | CC 14 | Track View: banks (clamped) / tracks (Shift, clamped). Session View: scroll row. Global menu: navigate. |
| Jog click | CC 3 (0xB0) | Menu confirm. NOT a note-on. |
| Jog touch | Note 9 | Swallowed — no behavior. |
| Shift | CC 49 | Modifier |
| Play | CC 85 | Transport. LED green when playing. |
| Record | CC 86 | Record arm/disarm. LED red when armed. |
| Mute | CC 88 | [NOT BUILT] |
| Delete | CC 119 | Held modifier |
| Undo | CC 56 | [NOT BUILT] |
| Copy | CC 60 | [NOT BUILT] |
| Sample | CC 118 | Print/bake [NOT BUILT] |
| Back | CC 51 | Exit / return |
| CC 50 | Note/Session toggle | Tap=switch views, Hold=Session Overview, Shift+tap=Global Menu |
| Up/Down | CC 55/54 | Scene group scroll (Session) / octave shift (Track) |
| Left/Right | CC 62/63 | Previous/next step page |
| Loop | CC 58 | Hold + step = set clip length |

### Pad rows (bottom to top): 68–75 · 76–83 · 84–91 · 92–99

### Combos
| Combo | Function | Status |
|-------|----------|--------|
| Shift + Play (playing) | Deactivate all clips — stop at next main clock bar boundary, cancel queued | ✅ |
| Shift + Play (stopped) | Panic — atomic clear all clip state, does not touch step data | ✅ |
| Delete + Play | Panic | ✅ |
| Shift + Back | Hide SEQ8 (background run) — saves state before hiding | ✅ |
| Shift + CC 50 | Global Menu (any view) | ✅ |
| Shift + bottom pads (68–75) | Track select 1–8 | ✅ |
| Shift + top pads (92–99) | Parameter bank select | ✅ |
| Shift + clip pad (Session View) | Activate clip (if not playing) + switch to Track View + focus track/clip | ✅ |
| Hold CC 50 | Session Overview | ✅ |
| Loop + step | Set clip length | ✅ |
| Delete + step (Track View) | Clear step | ✅ |
| Delete + track button (Track View) | Clear clip at scene position | ✅ |
| Delete + clip pad (Session View) | Clear clip | ✅ |
| Step button (Session View) | Launch scene | ✅ |
| Shift + step (Session View) | No-op | ✅ |
| Jog, Track View | Cycle banks 0–6, clamped | ✅ |
| Shift + jog, Track View | Cycle tracks 0–7, clamped | ✅ |
| Jog, Session View | Scroll one row, clamped | ✅ |
| Shift + jog, Session View | No-op | ✅ |
| Mute + Undo | Clear all mutes/solos | NOT BUILT |

---

## 2. Data Model

**Project:** BPM (SEQ8-owned, 40–250), Key, Scale, Launch quantization (Now/1/16/1/8/1/4/1/2/1-bar), Swing [NOT BUILT]. 8 tracks × 16 scenes × 256 steps/clip.

**Track:** Mode (drum / melodic_chromatic / melodic_scale), MIDI channel (1–16), route (SCHWUNG/EXTERNAL), octave (−4..+4), mute/solo [NOT BUILT]. Play effects chain per track.

**Clip:** All clips are pre-existing containers (default 16 steps). "Empty" = no step data. Empty clips are fully launchable — they sequence normally, produce no MIDI until steps are added.

**Clip states (5):**
1. Empty/inactive — no data, not playing, not queued
2. Inactive with data — has data, not playing, not set to relaunch
3. Will relaunch — was playing when transport stopped; relaunches from step 0 on next transport play. Persisted.
4. Queued — waiting for quantization boundary to start, or waiting to stop at end of current main clock bar
5. Playing — actively sequencing

**Clip launch rules:**
- Now mode: clip with playing clip on track → immediate legato (current_step % new_clip_length); clip with no playing clip → immediate from global_tick % 16 (main clock position). Scene: each track independently.
- Quantized modes (1/16–1-bar): wait for global_tick % N == 0, start from step 0. No legato. Scene: all tracks wait for same boundary.
- Pressing a playing clip → queued to stop at end of current main clock bar (global_tick % 16 == 0)
- Multiple queued on same track: last pressed wins
- Empty clips follow all launch rules but show no LED change until data exists

**Transport:**
- Stop: playing clips → will_relaunch. Queued clips → cancelled.
- Play: will_relaunch clips → launch immediately (global_tick=0 is always a boundary)
- Shift+Play (playing): deactivate_all — graceful stop at main clock bar boundary
- Shift+Play (stopped): panic — atomic, clears all clip state, does not touch step data
- Delete+Play: panic

**State file:** v=3. Per-set path: `/data/UserData/schwung/set_state/<UUID>/seq8-state.json`. UUID from `active_set.txt`. Persists: steps, active clips, step notes (sparse), t%d_ch, t%d_rt, t%d_wr. Does NOT persist: step_vel, step_gate, clip lengths, stretch_exp.

**Step:** Up to 4 notes. Invariant: steps[s]==1 iff step_note_count[s]>=1.

---

## 3. Views

### Track View
- Default on fresh launch. On reconnect after background, preserves previous view.
- Step buttons: tap = toggle step. Hold ~200ms = step edit mode.
- Side buttons (CC 43–40): select/launch/stop clips on current track. Focused clip always visible even if empty.
- effectiveClip(t): JS source of truth for which clip Track View displays and writes to. Returns queued clip if stopped+queued, else active clip. Use this everywhere in Track View — never read trackActiveClip[t] directly.
- Pad grid: isomorphic 4ths diatonic. Root = bright track color, scale pads = dim track color, sounding notes = bright white.
- Step edit mode: hold step → tap pads to toggle notes. Up/Down shifts octave. Release to exit.
- Banks: Shift + top pad row (92–99). Active bank is global UI state — switching tracks stays on same bank. Parameter values are per-track.

### Session View
- Default on fresh launch (Track View on reconnect).
- 4×8 pad grid = clips for visible 4-row scene group.
- Clip pad: press = launch/stop (launch quantization rules). Shift+press = activate (if not playing) + switch to Track View.
- Scene buttons (CC 40–43): always full scene launch — stops playing clips at main clock bar boundary, queues all clips in row for next boundary (or immediate in Now mode). Brief white flash on press (~200ms) as tactile feedback.
- Step buttons: press = launch scene. Shift+step = no-op. Jog wheel navigation unchanged.
- Jog: scroll one row, clamped. Up/Down: jump by group (4 rows).

### LED States

**Clip pads (Session View) and Track View side buttons:**
- Empty (any state): Unlit
- Inactive with data: Very dim track color (TRACK_DIM_COLORS)
- Will relaunch: Solid bright track color
- Queued for activation: 1/16 flash, dim↔bright track color
- Queued for deactivation: 1/16 flash, dim track color↔off
- Playing: 1/8 flash, dim↔bright track color

All playing clips flash in unison (flash_eighth from state_snapshot). All queued clips flash in unison (flash_sixteenth).

**Track View side buttons only — focused clip override:**
- Focused clip, empty or inactive, not playing: Solid bright track color (always visible)
- Focused clip, playing: 1/8 flash dim↔bright track color

**Step buttons (Session View):**
- In-view + any playing: Pulse red (1/8)
- In-view, none playing: Solid red
- Out-of-view + any playing: Pulse white (1/8)
- Out-of-view, none playing, any non-empty: Solid white
- Out-of-view, all empty: Off

**Scene buttons (CC 40–43):** Brief white flash on press (~200ms). Otherwise unlit.

### Session Overview (hold CC 50)
8×16 graphical grid. Empty=unlit, has content=center bar, playing=solid fill+flash. Input swallowed. Release exits.

### Global Menu (Shift + CC 50, any view)
Jog = navigate, CC 3 = confirm/edit, Back = exit. Captures only jog inputs — all other inputs pass through.
Items: BPM (40–250), Key, Scale, Launch (Now/1/16/1/8/1/4/1/2/1-bar), Swing [stub], Vel override [stub], Input quantize [stub], Save+Unload [NOT BUILT].

---

## 4. Sequencer Engine

- 96 PPQN. MIDI scheduling in DSP render_block().
- Main clock bar boundary = global_tick % 16 == 0 at tick_in_step==0. global_tick resets to 0 on transport play.
- Stop boundary: global_tick % 16 == 0 (main clock bar) in all quantization modes.
- Panic: midi_send_internal only — never midi_send_external from render path.
- Critical: tN_deactivate is async-one-at-a-time. Use panic for atomic bulk track state clear.

### Recording
- Record while stopped → 1-bar count-in → transport + recording start. Step buttons flash white at 1/4 note.
- Record while playing → arm immediately.
- Additive overdub via tN_cC_step_S_add. Never removes notes.
- Pre-roll: pads in last 1/16th of count-in → step 0.
- Queued clip + armed record: recording begins at quantization boundary when clip starts, not on pad press.
- Disarm: Record again, or stop/panic.
- Record arm global — track switching during recording [NOT YET BUILT].
- Actual note length capture [NOT YET BUILT].

---

## 5. Play Effects Chain

```
Step Data → [Beat Stretch ✅] → [Clock Shift ✅] → [Note FX ✅] → [Harmonize ✅] → [Seq Arp ✗] → [MIDI Delay ✅] → [Swing ✗] → MIDI Out
```

Live pad input bypasses DSP chain entirely — design decision pending, do not fix without being asked.

- **Beat Stretch:** Destructive ×2/÷2. Compress blocked on collision.
- **Clock Shift:** Destructive rotation, wraps.
- **Note FX:** Oct (−4..+4), Offset (−24..+24 st), Gate (0–400%), Velocity (−127..+127).
- **Harmonize:** Unison (off/×2/×3), Octaver (−4..+4), Hrm1/Hrm2 (−24..+24 st).
- **MIDI Delay:** Time, Level, Repeats (0–64), Vel/Pitch/Gate/Clock fb, Pitch random.
- **Seq Arp / Live Arp / Swing:** [NOT BUILT]

---

## 6. MIDI Routing

- Internal: midi_send_internal → active Schwung chain. Channel does NOT route to different chains.
- External: deferred JS ext_queue pattern. DSP writes to ring buffer (64 slots), JS tick drains via move_midi_external_send. Never call midi_send_external from render path.
- Live pads: liveSendNote(t, type, pitch, vel) honors Ch/Rte per track.

---

## 7. Not Yet Built

Do not implement without being asked:
- Active bank follows track switch (global UI bank, per-track values)
- Global menu: Save + Unload
- Live recording track switching
- Mute/Solo
- Scale definitions + scale-awareness toggles (K8 per relevant bank)
- Drum mode / Chromatic mode
- Arpeggiator (Seq + Live)
- Swing
- Step edit param overlay
- Post-recording quantize
- Undo/Redo
- Print/Bake
- Clip copy/delete
- MIDI Clock sync (cable 2)
- Actual recorded note length
- Multiple simultaneous clip pad presses
- Session View display: row range indicator (e.g. "A-D")
- Track number highlight (white box, black letters)
- Rename to "Dave is a Sequencer" / Dave

---

## 8. Critical Pitfalls

- **GLIBC max 2.35** — use my_atoi()/my_atof(). Verify: `nm -D dist/seq8/dsp.so | grep GLIBC`
- **seq8_save_state in tick()** — blocks silently. Always trigger from onMidiMessageInternal.
- **midi_send_external in render path** — blocks SPI, can deadlock. Use ext_queue.
- **raw_midi/raw_ui: true** — shim crash on boot. Do not set.
- **Jog click = CC 3 (0xB0)** — not a note-on.
- **Jog touch (Note 9)** — swallowed, no behavior.
- **Do not load SEQ8 from within SEQ8** — LED corruption. Shift+Back first.
- **BPM:** get_bpm() once at init only. No polling.
- **get_clock_status() is NULL in v0.9.7** — do not use.
- **Step invariant** — steps[s]==1 iff step_note_count[s]>=1. Update atomically.
- **State file v=3** — bump v on any format change; old files auto-delete.
- **tN_deactivate is async-one-at-a-time** — never use for bulk clearing. Use panic.
- **effectiveClip(t)** — always use in Track View for display and input. Never read trackActiveClip[t] directly in Track View logic.
- **Schwung set_param coalescing** — only the LAST set_param per JS tick is delivered to DSP. Never send state_load then another param in the same tick.
- **No MIDI panic before state_load** — floods MIDI buffer, drops subsequent set_params.
- **Reboot required after every deploy** — Shift+Back does NOT reload JS from disk.
- **Deploy** — JS only: `cp ui.js dist/seq8/ui.js && ./scripts/install.sh` then reboot. DSP: `./scripts/build.sh && ./scripts/install.sh` then reboot.

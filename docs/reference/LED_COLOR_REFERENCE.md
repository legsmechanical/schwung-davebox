# LED Color Assignment Reference

> Maps every LED color assignment in dAVEBOx, organized by feature/mode. Verified against source: `ui_leds.mjs`, `ui_scene.mjs`, `ui.js`, `ui_constants.mjs`.

---

## Color Palette Reference

### Named platform colors (from `shared/constants.mjs`)
| Name | Character |
|------|-----------|
| `White` | Bright white |
| `LightGrey` | Dim white |
| `DarkGrey` | Very dim white |
| `Red` | Bright red |
| `DeepRed` | Dim red |
| `Blue` | Bright blue |
| `DarkBlue` | Dim blue |
| `DeepBlue` | Very dim blue |
| `Green` | Bright green |
| `DeepGreen` | Dim green |
| `VividYellow` | Bright yellow |
| `Mustard` | Dim yellow |
| `HotMagenta` | Bright magenta |
| `DeepMagenta` | Dim magenta |
| `Cyan` | Bright cyan |
| `PurpleBlue` | Dim cyan/purple |
| `Bright` | Bright white/neutral |
| `BurntOrange` | Dim orange |
| `SkyBlue` | Bright sky blue |

### Track colors (per-track, indices 0–7)
| Track | Bright (`TRACK_COLORS`) | Dim (`TRACK_DIM_COLORS`) |
|-------|------------------------|--------------------------|
| 0 | Red (127) | 66 `VeryDarkRed` (#1A0404) |
| 1 | Blue (125) | DarkBlue (95) |
| 2 | BrightGreen (8) | DarkOlive (78) |
| 3 | Green (126) | 86 *(unnamed — dark forest dim)* |
| 4 | BrightPink (25) | DeepWine (114) |
| 5 | RoyalBlue (16) | 96 *(unnamed — dark navy dim)* |
| 6 | Mustard (29) | 70 *(unnamed — dark olive-tan dim)* |
| 7 | DeepGreen (32) | 86 *(unnamed — same as track 3 dim)* |

Raw indices 68, 70, 86, 96 have no named export in `shared/constants.mjs`; identified via the palette viewer tool. Used as literals in `TRACK_DIM_COLORS`.

### Special / scratch palette entries (via `setPaletteEntryRGB`)
| Constant | Index | RGB | Appearance |
|----------|-------|-----|------------|
| `CC_SCRATCH_PALETTE_BASE` + k | 51–58 | (val, 0, 0) armed / (0, val, 0) playing | Red/green at CC value intensity |

Indices 49 (`BEAT_MARKER_PALETTE`) and 50 (`OOB_SCRATCH_PALETTE`) are **no longer custom-written at init** — step LEDs now use native palette colors instead (see sections 1a–1d). The constants are removed from the codebase.

### Other special values
| Name | Value | Use |
|------|-------|-----|
| `LED_OFF` | 0 | Off |
| `LED_STEP_CURSOR` | 127 | Full-white (scene map active scene) |
| Raw `124` | — | Mute button lit (platform dim white?) |
| Raw `16` | — | Mute button normal (platform very dim?) |

---

## 1. Step Buttons (Notes 16–31)

### 1a. Normal step view — melodic track (`updateStepLEDs`, `ui_leds.mjs:L155`)
| Condition | Color |
|-----------|-------|
| Step is out-of-bounds (≥ clip length) | `DarkGrey` (124) |
| Playing and step == current playhead | `TRACK_COLORS[t]` (track bright) |
| Step has note (value `1`) | `White` (120) |
| Step is a tied note (value `2`) | raw `119` (DarkGrey dup — same visual as 124) |
| Beat marker step (i%4==0, beat marks on) | `TRACK_DIM_COLORS[t]` (track dim) |
| Empty step | `LED_OFF` |

### 1b. Normal step view — drum track (`updateStepLEDs`, `ui_leds.mjs:L106`)
| Condition | Color |
|-----------|-------|
| Step out-of-bounds | `DarkGrey` (124) |
| Playing and step == current playhead | `TRACK_COLORS[t]` (track bright) |
| Step has hit (value `'1'`) | `White` (120) |
| Beat marker step (beat marks on) | `TRACK_DIM_COLORS[t]` (track dim) |
| Empty step | `LED_OFF` |

### 1c. Step edit gate-span overlay (melodic, held step) (`ui_leds.mjs:L176`)
Overlays after normal step rendering. Covers steps within the held step's gate duration.
| Condition | Color |
|-----------|-------|
| Step is within gate span | raw `56` *(unnamed native palette color; identified via palette viewer)* |

### 1d. Step edit gate-span overlay (drum, held step) (`ui_leds.mjs:L124`)
| Condition | Color |
|-----------|-------|
| Step is within gate span | raw `56` *(unnamed native palette color; identified via palette viewer)* |

### 1e. Gate duration overlay — melodic K3 (Dur knob) touched (`ui_leds.mjs:L189`)
Overlays after span overlay when `knobTouched === 2`.
| Condition | Color |
|-----------|-------|
| Step is fully within gate | `White` |
| Step is the partial final step | `DarkGrey` |

### 1f. Gate duration overlay — drum K1 (Dur knob) touched (`ui_leds.mjs:L136`)
Overlays after span overlay when `knobTouched === 0`.
| Condition | Color |
|-----------|-------|
| Step fully within gate | `White` |
| Partial final step | `DarkGrey` |

### 1g. Loop-held pages view (`updateStepLEDs`, `ui_leds.mjs:L58`)
Active when `S.loopHeld && !S.loopJogActive`. Each step button = one 16-step page.
| Condition | Color |
|-----------|-------|
| Page is out-of-bounds (≥ total pages) | `LED_OFF` |
| Page has notes (playing) | `TRACK_COLORS[t]` pulsing ↔ `LED_OFF` at sixteenth rate |
| Page has notes (stopped) | `TRACK_COLORS[t]` pulsing ↔ `LED_OFF` at 24-tick rate |
| Page is empty but within clip | `TRACK_COLORS[t]` (solid) |

### 1h. Copy-source blink — step copy pending (`ui_leds.mjs:L206`)
| Condition | Color |
|-----------|-------|
| Source step on current page | Blinks `White` ↔ `LED_OFF` at 24-tick rate |

### 1i. Count-in flash (`ui.js:L3481`)
Overrides step LEDs during count-in recording.
| Condition | Color |
|-----------|-------|
| Flash on (1/8 of quarter-note period) | `White` |
| Flash off | `LED_OFF` |

### 1j. Hold-save double-blink (`updateTrackLEDs`, `ui_leds.mjs:L453`)
Overrides all step LEDs after saving a preset slot.
| Condition | Color |
|-----------|-------|
| Blink on phase (10-tick intervals) | `White` |
| Blink off phase | (no override — underlying color shows) |

---

## 2. Scene Map (Notes 16–31 in Session View)

(`updateSceneMapLEDs`, `ui_scene.mjs:L39`)

### 2a. Mute-held snapshot view
| Condition | Color |
|-----------|-------|
| Snapshot slot has data | `VividYellow` |
| Snapshot slot empty | `DarkGrey` |

### 2b. Normal scene map
| Condition | Color |
|-----------|-------|
| Scene in view window AND any clip playing | `LED_STEP_CURSOR` ↔ `LED_OFF` at eighth rate |
| Scene in view window, nothing playing | `LED_STEP_CURSOR` (solid full-white) |
| Scene out of view, any clip playing | `White` ↔ `LED_OFF` at eighth rate |
| Scene out of view, has content, not playing | `White` (solid) |
| Scene empty | `LED_OFF` |

---

## 3. Track Pad Grid (Notes 68–99)

### 3a. Melodic track — note grid (`updateTrackLEDs`, `ui_leds.mjs:L401`)
| Condition | Color |
|-----------|-------|
| Note is sounding (live or seq) or held in step edit | `White` |
| Chromatic layout and note is not in scale | `LED_OFF` |
| Root note (matches key) | `TRACK_COLORS[t]` (track bright) |
| In-scale note, chromatic layout | `DarkGrey` |
| In-scale note, isomorphic layout | `DarkGrey` |

### 3b. Drum track — lane selectors (left 4 columns) (`ui_leds.mjs:L354`)
| Condition | Color |
|-----------|-------|
| Lane note is sounding | `White` |
| Lane hit-flash active, lane muted | `DarkGrey` |
| Lane hit-flash active, not muted | `TRACK_COLORS[t]` (track bright) |
| Lane is muted (no flash) | `LED_OFF` |
| Lane is active selection (no flash) | `White` |
| Lane has hits, playing | `TRACK_DIM_COLORS[t]` (track dim) |
| Lane has hits, stopped | `TRACK_COLORS[t]` (track bright) |
| Lane empty | `TRACK_DIM_COLORS[t]` (track dim) |
| Lane is Rpt2 active/latched (override) | `Cyan` |
| Lane is copy source (blink) | `White` ↔ `LED_OFF` at 24-tick rate |

### 3c. Drum track — velocity zones (right 4 columns, normal mode) (`ui_leds.mjs:L398`)
| Condition | Color |
|-----------|-------|
| Zone is currently selected | `White` |
| Zone not selected | `DarkGrey` |

### 3d. Drum track — Rpt1 mode (right 4 columns) (`ui_leds.mjs:L388`)
| Condition | Color |
|-----------|-------|
| Rate pad (rows 0–1), currently held | `White` |
| Rate pad, not held | `LightGrey` |
| Gate mask pad (rows 2–3), gate bit on | `TRACK_COLORS[t]` (track bright) |
| Gate mask pad, gate bit off | `LED_OFF` |

### 3e. Drum track — Rpt2 mode (right 4 columns) (`ui_leds.mjs:L393`)
| Condition | Color |
|-----------|-------|
| Rate pad (rows 0–1), selected rate | `Cyan` |
| Rate pad, not selected | `PurpleBlue` |
| Gate mask pad (rows 2–3), gate bit on | `TRACK_COLORS[t]` (track bright) |
| Gate mask pad, gate bit off | `LED_OFF` |

### 3f. Session view — clip grid (4×8) (`updateSessionLEDs`, `ui_leds.mjs:L225`)
| Condition | Color |
|-----------|-------|
| No content, this is the active clip row | `LightGrey` |
| No content, not active row | `LED_OFF` |
| Has content but no active notes | `DarkGrey` |
| Playing + pending stop (stop-at-end) | `TRACK_DIM_COLORS[t]` ↔ `LED_OFF` at sixteenth rate |
| Playing, no pending stop | `TRACK_COLORS[t]` ↔ `TRACK_DIM_COLORS[t]` at eighth rate |
| Queued | `TRACK_COLORS[t]` ↔ `TRACK_DIM_COLORS[t]` at sixteenth rate |
| Will relaunch (was playing, transport stopped) | `TRACK_COLORS[t]` (solid) |
| Has content, idle | `TRACK_DIM_COLORS[t]` (solid dim) |
| Copy source (blink) | `White` ↔ `LED_OFF` at 24-tick rate |
| Tap tempo active (override) | `Blue` (flash) or `LightGrey` |

### 3g. SEQ ARP / TRACK ARP step velocity editor (`ui_leds.mjs:L313`, `L334`)
Active when bank 4 (SEQ ARP) K5 touched, or bank 5 (TRACK ARP) K6 touched, with Steps Mode ≠ Off.
8-column × 4-row velocity bar display per step.
| Condition | Color |
|-----------|-------|
| Top row of a non-zero level bar | `TRACK_COLORS[t]` (track bright) |
| Lower rows of a non-zero level bar | `TRACK_DIM_COLORS[t]` (track dim) |
| Empty / zero level | `LED_OFF` |

### 3h. Perf mode — step buttons: preset slots (`updatePerfModeLEDs`, `ui.js:L2007`)
| Condition | Color |
|-----------|-------|
| Currently recalled slot | `White` |
| Preset slot has saved data | `PurpleBlue` |
| Empty slot | `LightGrey` |

### 3i. Perf mode — Row 0 (notes 68–75): looper controls (`ui.js:L2014`)
| Pad | Condition | Color |
|-----|-----------|-------|
| 68–72 (rate pads) | Flash on at pad's rate | `White` |
| 68–72 (rate pads) | Flash off | `LightGrey` |
| 73 (hold pad) | Currently held | `White` |
| 73 (hold pad) | Not held | `Red` |
| 74 (sync) | Sync on (blink) | `Green` ↔ `DeepGreen` at 1/4-note rate |
| 74 (sync) | Sync off | `Green` (solid) |
| 75 (latch) | Latch mode on | `VividYellow` |
| 75 (latch) | Latch mode off | `PurpleBlue` |

### 3j. Perf mode — Row 1 (notes 76–83): pitch mods (`ui.js:L2024`)
| Condition | Color |
|-----------|-------|
| Mod active | `White` |
| Mod inactive | `DeepMagenta` |

### 3k. Perf mode — Row 2 (notes 84–91): velocity/gate mods (`ui.js:L2034`)
| Condition | Color |
|-----------|-------|
| Mod active | `White` |
| Mod inactive | `Mustard` |

### 3l. Perf mode — Row 3 (notes 92–99): wild mods (`ui.js:L2044`)
| Condition | Color |
|-----------|-------|
| Mod active | `White` |
| Mod inactive | `DarkBlue` |

### 3m. Palette viewer (dev tool) (`updateTrackLEDs`, `ui_leds.mjs:L294`)
| Condition | Color |
|-----------|-------|
| Pad i | Raw palette index `base + i` (page × 32 offset) |
| Step buttons (notes 16–31) | `paletteViewHovered` index or `LED_OFF` |

---

## 4. Scene Launch Buttons (CC 40–43)

(`updateTrackLEDs`, `ui_leds.mjs:L412`)

### Session view
| Condition | Color |
|-----------|-------|
| Recently pressed (flash) | `White` (for `SCENE_BTN_FLASH_TICKS` = 40 ticks) |
| Otherwise | `LED_OFF` |

### Track view
| Condition | Color |
|-----------|-------|
| Focused clip + playing | `TRACK_COLORS[t]` ↔ `TRACK_DIM_COLORS[t]` at eighth rate |
| Focused clip + will relaunch | `TRACK_COLORS[t]` ↔ `TRACK_DIM_COLORS[t]` at ~500ms slow pulse |
| Focused clip, idle | `TRACK_COLORS[t]` (solid) |
| Non-focused, melodic or drum, no active notes | `DarkGrey` |
| Non-focused, has content | `TRACK_DIM_COLORS[t]` |
| No content | `LED_OFF` |
| Copy source (blink) | `White` ↔ `LED_OFF` at 24-tick rate |

---

## 5. Transport Buttons

### 5a. Play (MovePlay = CC 3) (`ui.js:L3443`)
| Condition | Color |
|-----------|-------|
| Transport playing | `Green` |
| Stopped | `LED_OFF` |

### 5b. Rec (MoveRec = CC 86) (`ui.js:L3444`)
| Condition | Color |
|-----------|-------|
| Scheduled stop (ending record) | `Red` ↔ `LED_OFF` at 8-tick rate |
| Record armed | `Red` |
| Disarmed | `LED_OFF` |

### 5c. Sample / Merge (MoveSample = CC 118) (`ui.js:L3449`)
| Condition | Color |
|-----------|-------|
| Merge capturing or stopping (state ≥ 2) | `Green` |
| Merge armed (state = 1) | `Red` |
| Idle | `LED_OFF` |

### 5d. Loop (MoveLoop = CC 58) (`ui.js:L3452`)
| Condition | Color |
|-----------|-------|
| Session view + perf mode locked | `White` ↔ `LED_OFF` at 48-tick rate |
| Drum repeat latched | `White` ↔ `LED_OFF` at 48-tick rate |
| Session view + latch mode on | `VividYellow` |
| Session view + loop button held | `DarkGrey` |
| Otherwise | `LED_OFF` |

### 5e. Mute/Capture (MoveMute = CC 52) (`ui.js:L3471`)
| Condition | Color |
|-----------|-------|
| Track is muted | Raw `124` |
| Track is soloed (blink on) | Raw `124` |
| Track is soloed (blink off) | Raw `0` (off) |
| Normal (neither muted nor soloed) | Raw `16` |

---

## 6. Step Icon LEDs / Shortcut Hints (CC 16–31)

(`updateTrackLEDs`, `ui_leds.mjs:L270`)

Sent every `POLL_INTERVAL` (4 ticks) with `force=true` to override native Move state.
All off when Shift is not held.

| CC offset (i) | Shortcut | Condition for `White` |
|---------------|----------|-----------------------|
| 1 | Undo/Redo | Shift held (all modes) |
| 4–6 | Step ops | Shift held (all modes) |
| 7 | Step edit | Shift held + track view |
| 8 | (shared) | Shift held (all modes) |
| 9 | Drum-specific | Shift held + drum track + track view |
| 10 | Melodic-specific | Shift held + melodic track + track view |
| 14–15 | Param nav | Shift held + track view |
| All others | — | `LED_OFF` |

---

## 7. Knob LEDs (CC 71–78)

(`updateTrackLEDs`, `ui_leds.mjs:L433`)

| Context | Condition | Color |
|---------|-----------|-------|
| Session view | Knob index = active track | `White` |
| Session view | Other knobs | `LED_OFF` |
| Drum + Bank 5 (RPT GROOVE) | Step k has non-default vel scale or nudge | `White` |
| Drum + Bank 5 (RPT GROOVE) | Step k is default | `LED_OFF` |
| Bank 6 (CC PARAM) + record armed | Any assigned knob | `CC_SCRATCH_PALETTE_BASE + k` (red intensity = CC value) |
| Bank 6 (CC PARAM) + playing, live CC ≥ 0 | Knob k | `CC_SCRATCH_PALETTE_BASE + k` (green intensity = CC value) |
| Bank 6 (CC PARAM) + has automation | Knob k | `VividYellow` |
| Bank 6 (CC PARAM) + assigned, no auto | Knob k | `White` |
| Bank 6 (CC PARAM) + unassigned | Knob k | `LED_OFF` |
| Banks 1–5 (`PARAM_LED_BANKS`) | Param value ≠ default | `White` |
| Banks 1–5 (`PARAM_LED_BANKS`) | Param value = default | `LED_OFF` |

---

## 8. Dynamic Palette — CC PARAM Bank (Bank 6)

(`ui.js:L3090`, gated on `tickCount % POLL_INTERVAL === 0`)

Per-knob palette entries 51–58 update only when value changes (`ccPaletteCache` diff):

| State | Palette entry color |
|-------|---------------------|
| Record armed | `(ccVal/127*255, 0, 0)` — red, intensity = current CC value |
| Playing, live CC value present | `(0, liveVal/127*255, 0)` — green, intensity = live CC value |
| No live value / disarmed | Entry not updated (stays at last value) |

After any palette change: `reapplyPalette()` → then force-resend Play, Rec, Sample button LEDs to bypass `input_filter.mjs` buttonCache.

---

## Files to modify for LED color changes

| File | What it controls |
|------|-----------------|
| `src/ui/ui_leds.mjs` | Step LEDs, session grid, track pads, scene launch, knob LEDs, shortcut hints |
| `src/ui/ui_scene.mjs` | Scene map LEDs (notes 16–31 in session view) |
| `src/ui/ui.js` | Transport buttons, perf mode, count-in flash, CC palette, hold-save blink |
| `src/ui/ui_constants.mjs` | `TRACK_COLORS`, `TRACK_DIM_COLORS`, scratch palette constants |

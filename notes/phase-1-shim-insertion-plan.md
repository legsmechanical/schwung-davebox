# Phase 1 Shim Insertion Plan: Deliver Internal Pad Presses to Overtake DSP

## Goal
Route internal pad-press MIDI notes (notes 10–127, status 0x80/0x90 on MIDI cable 0) to the overtake DSP's `on_midi` hook with source `MOVE_MIDI_SOURCE_INTERNAL`, while maintaining existing chain-slot dispatch via `shadow_filter_move_input`.

---

## A. Mirror-Pattern Reference: Cable-2 Musical Delivery (Line 1245–1251)

**Location:** `src/schwung_shim.c`, lines 1245–1251 (external USB MIDI musical routing)

```c
/* Also route to overtake DSP if loaded */
if (overtake_dsp_gen && overtake_dsp_gen_inst && overtake_dsp_gen->on_midi) {
    uint8_t msg[3] = { p1, p2, p3 };
    overtake_dsp_gen->on_midi(overtake_dsp_gen_inst, msg, 3, MOVE_MIDI_SOURCE_EXTERNAL);
} else if (overtake_dsp_fx && overtake_dsp_fx_inst && overtake_dsp_fx->on_midi) {
    uint8_t msg[3] = { p1, p2, p3 };
    overtake_dsp_fx->on_midi(overtake_dsp_fx_inst, msg, 3, MOVE_MIDI_SOURCE_EXTERNAL);
}
```

**Pattern:** Check `overtake_dsp_gen` first (prefer generator), fall back to `overtake_dsp_fx` (effect). Build 3-byte MIDI message. Use `MOVE_MIDI_SOURCE_EXTERNAL` for external, **`MOVE_MIDI_SOURCE_INTERNAL`** for internal.

---

## B. Proposed Insertion Point

**File:** `src/schwung_shim.c`  
**Function:** `shim_post_transfer()` (starts at line 5356)  
**Insertion location:** **Within the pad-note handling block in the `shadow_display_mode` MIDI filtering loop** (around lines 6706–6741)  

**Exact location:** After line 6740 (`shadow_master_fx_forward_midi(...)` call) and before the `continue` at line 6741.

### Why This Spot
1. **Context:** This is where internal pad presses (d1 >= 10) are already being routed to:
   - Capture rules (focused slot)
   - All active slots via `FX_BROADCAST`
   - Master FX

2. **Clean coexistence:** The new delivery sits alongside existing shadow-chain dispatch; both are safe to run without conflict. Overtake receiving a copy of the same note doesn't interfere with chain-slot processing.

3. **Not in override zones:** Lines 5519 (sh_midi filter) and 6515 (shadow_ui_midi override) do NOT filter pad notes, so our insertion won't be affected.

4. **Timing:** Post-ioctl, after shadow-mode filtering, ensures pad notes reach overtake only when in proper state.

---

## C. Proposed Code (Draft, 8 lines)

**Insert after line 6740:**

```c
                /* dAVEBOx Phase 1: deliver internal pad-press notes to overtake on_midi */
                if (overtake_dsp_gen && overtake_dsp_gen_inst && overtake_dsp_gen->on_midi) {
                    uint8_t msg[3] = { status, d1, d2 };
                    overtake_dsp_gen->on_midi(overtake_dsp_gen_inst, msg, 3, MOVE_MIDI_SOURCE_INTERNAL);
                } else if (overtake_dsp_fx && overtake_dsp_fx_inst && overtake_dsp_fx->on_midi) {
                    uint8_t msg[3] = { status, d1, d2 };
                    overtake_dsp_fx->on_midi(overtake_dsp_fx_inst, msg, 3, MOVE_MIDI_SOURCE_INTERNAL);
                }
```

**Adaptation notes:**
- Uses `status`, `d1`, `d2` (already extracted on line 6705–6707)
- Mirrors cable-2 pattern exactly, only changing source to `MOVE_MIDI_SOURCE_INTERNAL`
- Runs for all notes >= 10 (knob touches are < 10)

---

## D. Conflict Check with Existing Patches

### Line 5519 (`sh_midi` filter override)
**Context:** Shift+Menu shortcut detection, blocks Menu CC from Move.

**Code at 5728–5757:**
```c
if (d1 == CC_MENU && shadow_shift_held) {
    /* ... */
    sh_midi[j] = 0;  /* Block Menu from reaching Move */
}
```

**Verdict:** ✓ **Safe.** Only filters Menu CC (d1 = CC_MENU, a control change). Does NOT filter note events or pad notes. Our insertion handles notes in a separate code path (lines 6687–6741) and is unreachable from this block.

### Line 6515 (`shadow_ui_midi_shm` forward filter override)
**Context:** Native knob overlay mode, tracks knob touch state.

**Code at 6509–6538:**
```c
if ((cin == 0x09 || cin == 0x08) && (type == 0x90 || type == 0x80) && d1 <= 7) {
    /* Handle knob touches 0–7, let pass through to Move */
    continue;
}
```

**Verdict:** ✓ **Safe.** Only handles knob touches (d1 <= 7, notes 0–9). Explicitly does NOT block pads (d1 >= 68). Our insertion handles notes >= 10, so no overlap.

### Line 5674–5677 (shadow_display_mode pad-block filter)
**Context:** When pad_block is set, prevents pad notes from reaching Move.

**Code:**
```c
if (shadow_control->pad_block && d1 >= 68 && d1 <= 99) {
    filter = 1;  /* Zero the event in shadow */
}
```

**Verdict:** ✓ **Safe.** This filters at the shadow buffer level (prevents Move from seeing the note). Our insertion still runs and delivers to overtake even when pad_block is active, which is correct behavior — overtake should receive pads regardless of Move-UI filtering.

---

## E. Open Questions / Risks

1. **Overtake DSP instantiation check:**
   - Current code checks both `overtake_dsp_gen` pointer AND `overtake_dsp_gen_inst` before calling `on_midi`.
   - Risk: If either pointer is null, the call is safely skipped. No crash risk.
   - **Action:** Verify in device-probe that both pointers are consistently set/cleared during load/unload.

2. **Cable-0 MIDI velocity during overtake:**
   - When overtake mode is active, cable-0 internal MIDI is normally filtered from Move (line 5634–5638).
   - Our insertion runs in the `shim_post_transfer` loop, which processes cable-0 events regardless of overtake mode.
   - Risk: If overtake is active, pads may reach overtake AND be filtered from Move (expected), but confirm overtake's MIDI processing doesn't depend on Move state.
   - **Action:** Probe query: Does overtake DSP `on_midi` assume Move firmware is consuming the same message?

3. **Message timing / race windows:**
   - Pads are dispatched to both chain slots (shadow_plugin_v2 calls at 6731) AND now overtake (new code).
   - Risk: If chain-slot plugin modifies MIDI_IN buffer, our source bytes (status, d1, d2) could be corrupted.
   - **Mitigation:** Our code builds a local stack buffer `msg[3]` before calling `on_midi`, so no risk of buffer corruption.
   - **Action:** Confirm that no shadow-plugin call in the loop (lines 6708–6740) modifies the incoming hw_midi or sh_midi buffers.

4. **Capture-rule guard:**
   - Line 6710 checks `capture_has_note(capture, d1)` before dispatching to focused slot.
   - Our overtake delivery runs for ALL notes >= 10, regardless of capture rules.
   - Risk: Intentional (overtake is a separate instrument), but confirm audio DSP doesn't expect filtered input.
   - **Action:** Verify overtake `on_midi` hook is designed to handle all notes, or add a local capture-rule check if needed.

5. **FX_BROADCAST vs. MOVE_MIDI_SOURCE_INTERNAL source constant:**
   - Lines 6731–6732 dispatch with `MOVE_MIDI_SOURCE_FX_BROADCAST` to audio FX.
   - Our code uses `MOVE_MIDI_SOURCE_INTERNAL` (per spec).
   - Risk: Overtake DSP may interpret source constant differently; confirm in hook definition.
   - **Action:** Cross-check overtake module's `on_midi` signature and source-constant enum definitions.

---

## Summary

- **Insertion:** 8 lines after line 6740 in `shim_post_transfer`
- **Pattern:** Mirrors cable-2 external musical delivery, adapts source to INTERNAL
- **Safety:** No conflicts with existing filter overrides; pad notes are correctly routed to overtake independently
- **Next step:** Device-probe to confirm overtake DSP load/unload state transitions and message timing

/* ui_corun.mjs
 * Co-run / Schwung-slot lifecycle: resolving which Schwung slot a track's
 * MIDI channel maps to, entering/exiting Schwung chain-edit co-run and
 * Move-native co-run, and re-asserting overtake sysex suppression on
 * return from co-run. S stays shared via ui_state.mjs.
 * Extracted from ui.js (Phase 5 of the modularity refactor, module 3).
 */

import { S } from './ui_state.mjs';
import { invalidateLEDCache, reapplyPalette, forceRedraw } from './ui_leds.mjs';
import { computePadNoteMap } from './ui_drummodel.mjs';
import { showActionPopup } from './ui_persistence.mjs';

/* Co-run target enum + keep-mask flags — mirrors corun_target_t and the
 * CORUN_GRP_* / CORUN_KEEP_* bits in Schwung's shadow_constants.h. The shim
 * registers these as globals on shadow_ui's JS context; redeclaring them
 * here makes the dAVEBOx tool context self-contained on platforms that scope
 * globals differently. Keep in sync with docs/CORUN.md. */
const CORUN_TARGET_NONE        = 0;
export const CORUN_TARGET_CHAIN_EDIT  = 1;
export const CORUN_TARGET_MOVE_NATIVE = 2;
const CORUN_GRP_PADS           = 1 << 1;
const CORUN_GRP_STEPS          = 1 << 2;
const CORUN_GRP_TRANSPORT      = 1 << 3;
const CORUN_GRP_MENU           = 1 << 10;
/* Default split: tool keeps pads / steps / transport / Menu, cedes the rest. */
const DAVEBOX_CORUN_KEEP_DEFAULT = CORUN_GRP_PADS | CORUN_GRP_STEPS | CORUN_GRP_TRANSPORT | CORUN_GRP_MENU;
/* Opt out of framework Back-as-exit. dAVEBOx uses Menu as the canonical exit
 * (existing muscle memory) and lets Back cede to the peer for sub-view nav
 * (chain editor pop-up, Move firmware preset/synth navigation). */
const CORUN_KEEP_BACK_BIT      = 1 << 15;
const DAVEBOX_CORUN_KEEP_MASK  = DAVEBOX_CORUN_KEEP_DEFAULT | CORUN_KEEP_BACK_BIT;
/* Control-group bits matching Schwung's shadow_constants.h (OLED=0, PADS=1,
 * STEPS=2, TRANSPORT=3, JOG=4, TRACK=5, KNOBS=6, MASTER=7, SHIFT=8, BACK=9,
 * MENU=10, TOUCH=11). */
const CORUN_GRP_JOG   = 1 << 4;
const CORUN_GRP_TRACK  = 1 << 5;  /* CC 40-43 — the side clip buttons */
const CORUN_GRP_KNOBS = 1 << 6;
const CORUN_GRP_SHIFT = 1 << 8;
const CORUN_GRP_BACK  = 1 << 9;
const CORUN_GRP_TOUCH = 1 << 11;
const CORUN_GRP_MUTE  = 1 << 12;  /* CC 88 — the Mute button */
/* LED-keep mask (lights/input split): dAVEBOx paints the side clip buttons
 * (CC 40-43, paintCoRunSideButtons) as a paired-track indicator, but must let
 * Move/Schwung handle the *presses* (switching the active Move track / Schwung
 * slot). So we own the TRACK group for LEDs only — input keep_mask is unchanged,
 * so the presses still cede to the peer. Without this, Move's playback repaints
 * fight our indicator. */
const DAVEBOX_CORUN_LED_KEEP_MASK = DAVEBOX_CORUN_KEEP_MASK | CORUN_GRP_TRACK;
/* Mute (CC 88) split for co-run (schwung-davebox #8): during MOVE_NATIVE co-run
 * dAVEBOx CEDES Mute to Move so the user can mute Move's instruments and drum pads
 * — the base masks above already omit CORUN_GRP_MUTE, so the move-native begin
 * (which uses them) cedes Mute automatically. The FX picker ALSO cedes Mute to Move
 * (its mask omits CORUN_GRP_MUTE), so the user can mute Move while the picker overlay
 * is up. Only chain-edit KEEPS Mute (dAVEBOx's own track mute/solo + Delete+Mute
 * clear), matching pre-#8 behavior where Mute always stayed with the tool. Requires a
 * host that classifies CC 88 as CORUN_GRP_MUTE (schwung feat/corun-mute-cede-group);
 * on an older host CC 88 is unclassified and stays with the tool in every mode, so
 * this is a no-op there (graceful). */
const DAVEBOX_CHAIN_KEEP_MASK     = DAVEBOX_CORUN_KEEP_MASK | CORUN_GRP_MUTE;
const DAVEBOX_CHAIN_LED_KEEP_MASK = DAVEBOX_CORUN_LED_KEEP_MASK | CORUN_GRP_MUTE;

/* Mask while the FX-picker overlay is open: the normal Move-co-run mask PLUS the
 * UI elements the overlay should own — jog (turn/click), the Back *routing* group,
 * the param knobs (turn → FX value), knob touch (param pop-up), and Shift (CC 49).
 * Keeping a group routes it to shadow_ui's intercept instead of ceding it to Move
 * firmware; shadow_ui's uniform coRunWants() rule then handles exactly what we keep.
 * Shift specifically: the overlay/chain editor's Shift-modified nav (FX-bus zoom,
 * fx_picker entry) is gated on coRunWants(CORUN_GRP_SHIFT) in shadow_ui — so unless
 * we KEEP Shift here, CC 49 cedes to Move firmware and isShiftHeld() never updates,
 * making Shift dead in every fx-picker-accessed chain. NOTE: the normal mask keeps
 * only CORUN_KEEP_BACK (1<<15, the framework-exit opt-out), NOT CORUN_GRP_BACK (the
 * routing group) — so the Back/jog/knob/shift groups must be added explicitly here
 * or those elements never reach shadow_ui. */
export const DAVEBOX_PICKER_KEEP_MASK =
    DAVEBOX_CORUN_KEEP_MASK | CORUN_GRP_JOG | CORUN_GRP_BACK | CORUN_GRP_KNOBS | CORUN_GRP_TOUCH | CORUN_GRP_SHIFT;

/* Resolve the Schwung chain slot index for a dAVEBOx track's MIDI channel.
 * shadow_get_slots() returns {channel, name} per slot where channel is 1-16
 * (matching trackChannel) or 0 for "All". Returns -1 if no match. */
/* First (lowest-index) Schwung slot that receives a track's MIDI channel, or -1.
 * Thin wrapper over schSlotsForTrack so the match logic lives in one place. */
export function schSlotForTrack(t) {
    const m = schSlotsForTrack(t);
    if (m === 0) return -1;
    let i = 0;
    while (!(m & (1 << i))) i++;
    return i;
}

/* Bitmask (bits 0-3) of ALL Schwung slots that receive a track's MIDI channel —
 * i.e. every slot whose receive channel matches trackChannel[t] or is "All" (0).
 * Multiple slots on the same channel are layered (all play the track), so all of
 * them get a bit. 0 = no slot receives this track. Lowest set bit = the slot the
 * co-run editor opens to; the whole mask is blinked on the side buttons. */
export function schSlotsForTrack(t) {
    if (typeof shadow_get_slots !== 'function') return 0;
    const ch = S.trackChannel[t];
    const slots = shadow_get_slots();
    if (!slots) return 0;
    let mask = 0;
    for (let i = 0; i < slots.length && i < 4; i++) {
        if (slots[i].channel === ch || slots[i].channel === 0) mask |= (1 << i);
    }
    return mask;
}

/* Open the Schwung-slot picker (first use) or enter co-run directly if the
 * track already has a slot assigned. Co-run keeps dAVEBOx loaded; the chain
 * editor for the picked slot takes over OLED + jog + track buttons, while
 * pads / step buttons / knobs / transport stay with dAVEBOx. */
export function openSchwungSlotEditor(t) {
    if (S.trackRoute[t] !== 0) {  /* 0 = ROUTE_SCHWUNG; fmtRoute('Swng') */
        showActionPopup('NOT', 'SCHWUNG-ROUTED');
        return;
    }
    /* Close the global menu so Menu (exit co-run) doesn't land back on a
     * half-open menu. */
    S.globalMenuOpen = false;
    S.lastSentMenuEditValue = null;
    /* Auto-open the slot the track plays through (channel-matched) — no picker.
     * Resolution is deferred to tick() so shadow_get_slots runs in a safe
     * context; see the pendingSchwungCoRunTrack handler. */
    S.pendingSchwungCoRunTrack = t;
    S.screenDirty = true;
}

/* Enter co-run for slot N on track t. Persists the track's slot choice,
 * suppresses dAVEBOx's OLED drawing + track-button LEDs (handled where each
 * is written), and tells Schwung's shadow_ui to also tick the chain editor. */
export function enterSchwungCoRun(t, slot) {
    S.schwungCoRunSlot = slot;
    if (typeof shadow_corun_begin === 'function')
        shadow_corun_begin(CORUN_TARGET_CHAIN_EDIT, slot, DAVEBOX_CHAIN_KEEP_MASK);
    /* Own the side-clip-button LEDs (CC 40-43) without grabbing their input.
     * Chain-edit keeps Mute (input + LED) — see the #8 note by the mask defs. */
    if (typeof shadow_corun_set_led_keep_mask === 'function')
        shadow_corun_set_led_keep_mask(DAVEBOX_CHAIN_LED_KEEP_MASK);
    S.screenDirty = true;
}

/* Exit co-run. Called on programmatic dAVEBOx state changes (track switch,
 * global-menu open, etc.) or by the pollDSP reconcile when the shim's
 * framework Back-handler has ended the session. Calling shadow_corun_end()
 * after the shim already ended is a no-op. */
export function exitSchwungCoRun() {
    if (S.schwungCoRunSlot < 0) return;
    S.schwungCoRunSlot = -1;
    S._coRunChanSlots = 0;
    if (typeof shadow_corun_end === 'function')
        shadow_corun_end();
    /* Modifier-key release CCs the user pressed inside the co-run may have
     * been routed to Schwung and never reached us — clear defensively so a
     * stuck Shift/Mute/etc. can't silence pad dispatch on return. Mirrors
     * the resume-from-suspend clear. */
    S.shiftHeld = false; S.deleteHeld = false; S.muteHeld = false;
    S.copyHeld  = false; S.loopHeld  = false; S.loopJogActive = false;
    S.captureHeld = false; S.shiftTrackLEDActive = false;
    /* Returning to full overtake: re-assert sysex suppression (the host cleared
     * it when we ceded to co-run) so Move's clip/grid LEDs don't leak back. */
    assertOvertakeSysexSuppress();
    /* Schwung's chain editor may have rewritten palette scratch entries while
     * we were ceded. Reapply our palette before invalidating the LED cache
     * so forceRedraw below repaints with the right colors. */
    reapplyPalette();
    invalidateLEDCache();
    /* Knob-ring LEDs (CC 71-78) need a forced re-emit: the chain editor drove
     * them, and post-reapplyPalette the buttonCache is stale, so non-forced
     * writes are dropped and they'd keep the editor's colors until a knob
     * moves. Matches exitMoveNativeCoRun + CC-bank resume (audit js-display-1). */
    S._forceKnobReemit = true;
    forceRedraw();
}

/* Enter Move-native co-run for dAVEBOx track t. Asks the shim to (a) yield
 * the OLED to Move firmware and (b) flip its sh_midi filter / shadow_ui
 * forward so the nav-CC + touch-note set routes to Move firmware instead
 * of dAVEBOx. Fires one cable-0 track-button tap so Move firmware lands
 * on the preset browser for the relevant track without the user touching
 * the front panel. Move's track-button CC mapping is REVERSED
 * (CC 43 = Track 1 ... CC 40 = Track 4), and dAVEBOx tracks 5-8 with
 * ROUTE_MOVE rely on the user's trackChannel to address one of Move's
 * 4 tracks — if trackChannel is outside 1-4 we just enter co-run without
 * an auto-tap and let the user pick the Move track manually. */
export function enterMoveNativeCoRun(t) {
    if (typeof shadow_corun_begin !== 'function') return;
    if (typeof move_midi_inject_to_move !== 'function') return;
    S.moveCoRunTrack = t;
    /* Re-push the padmap so the left-column lane pads become 0xFF (DSP on_midi
     * skips sounding them; Move handles sound+select via the injected pad).
     * Also queue a tick recompute in case this set_param push coalesces away. */
    computePadNoteMap();
    S.pendingPadNoteMapRecompute = true;
    shadow_corun_begin(CORUN_TARGET_MOVE_NATIVE, t, DAVEBOX_CORUN_KEEP_MASK);
    /* Own the side-clip-button LEDs (CC 40-43) without grabbing their input — so
     * Move's playback repaints stop fighting our paired-track indicator while
     * track-button presses still switch Move's track. */
    if (typeof shadow_corun_set_led_keep_mask === 'function')
        shadow_corun_set_led_keep_mask(DAVEBOX_CORUN_LED_KEEP_MASK);
    /* Let Move firmware's own LED writes (track buttons, knob rings, transport)
     * reach hardware while it drives the device-edit UI. skip_led_clear makes the
     * shim's overtake LED-strip loop early-return, so Move's LEDs pass through live.
     * Toggled back off in exitMoveNativeCoRun(). This is a mid-overtake toggle — it
     * does NOT hit the entry/exit snapshot path, so the suspend/exit native LED
     * restore is unaffected. */
    if (typeof shadow_set_skip_led_clear === 'function') shadow_set_skip_led_clear(1);
    /* Defer the track-button "press" that lands Move on the device-edit page and
     * makes it repaint its track + knob LEDs. Injecting it immediately fails: Move's
     * repaint lands before the shim's co-run LED passthrough + OLED bypass go live
     * (corun_move_native_track hasn't propagated to the shim yet), so the repaint is
     * stripped and the LEDs don't show until a manual press. Fire it from tick() a
     * few ticks later, once co-run is fully active. */
    S.pendingMoveCoRunInject = 12;
    S.globalMenuOpen = false;
    S.lastSentMenuEditValue = null;
    S.screenDirty = true;
}

/* Exit Move-native co-run. The shim drops its input split + display
 * bypass the next time it reads corun_move_native_track from SHM, so
 * Move firmware's framebuffer stops reaching the OLED and the nav CCs
 * start flowing to dAVEBOx again. We force a full redraw so any LEDs
 * Move firmware was driving (knob rings, track buttons, Shift, Back)
 * get repainted from dAVEBOx state right away. */
export function exitMoveNativeCoRun() {
    if (S.moveCoRunTrack < 0) return;
    S.moveCoRunTrack = -1;
    S.pendingMoveCoRunInject = 0;  /* cancel any pending entry inject */
    S.moveCoRunPressQueue = null;  /* cancel any in-flight track-row press sequence */
    /* Restore the real drum padmap (left-column lane pads sound via DSP again);
     * also queue a tick recompute in case this set_param push coalesces away. */
    computePadNoteMap();
    S.pendingPadNoteMapRecompute = true;
    if (typeof shadow_corun_end === 'function')
        shadow_corun_end();
    /* Resume the shim's overtake LED-strip loop so dAVEBOx owns the LEDs again
     * (mirror of the skip_led_clear(1) in enterMoveNativeCoRun). */
    if (typeof shadow_set_skip_led_clear === 'function') shadow_set_skip_led_clear(0);
    /* If any drum pad hold injects were in flight, send a note-off for EACH
     * before the co-run session ends so Move doesn't get a stuck note — a
     * scalar here used to leak a note-off for every held pad but the first
     * (js-input-1); a Set lets us drain them all. */
    if (S.moveCoRunDrumHeld.size > 0 && typeof move_midi_inject_to_move === 'function') {
        for (const _heldPad of S.moveCoRunDrumHeld)
            move_midi_inject_to_move([0x08, 0x80, _heldPad, 0]);  /* plain pad off (no Shift was sent) */
    }
    S.moveCoRunDrumHeld.clear();
    /* Modifier-key release CCs the user pressed inside Move firmware never
     * reach us during co-run — clear defensively so a stuck Shift/Mute/etc.
     * can't silence pad dispatch on return. Mirrors resume-from-suspend. */
    S.shiftHeld = false; S.deleteHeld = false; S.muteHeld = false;
    S.copyHeld  = false; S.loopHeld  = false; S.loopJogActive = false;
    S.captureHeld = false; S.shiftTrackLEDActive = false;
    /* Returning to full overtake: re-assert sysex suppression (the host cleared
     * it when we ceded to co-run) so Move's clip/grid LEDs don't leak back. */
    assertOvertakeSysexSuppress();
    /* Move firmware may have rewritten palette scratch entries (knob rings,
     * Shift/Back, etc.) while we were ceded. Reapply our palette before
     * invalidating the LED cache so forceRedraw below repaints with the
     * right colors, not stale ones left by Move firmware. */
    reapplyPalette();
    invalidateLEDCache();
    /* Force the knob-ring LEDs (CC 71-78) to repaint over Move's native colors on
     * the next draw. invalidateLEDCache clears the JS LED cache, but reapplyPalette
     * leaves the hardware buttonCache stale so the normal (non-forced)
     * cachedSetButtonLED knob writes get dropped — Move's knob colors then persist
     * until the user happens to change a knob value. One-shot force in updateTrackLEDs
     * (mirrors the force=true the track-button reclaim already uses). */
    S._forceKnobReemit = true;
    forceRedraw();
}

/* Own all LEDs in our full-overtake views. Clock Follow keeps Move's sequencer
 * running underneath, whose RGB pad/clip/grid LEDs ride cable-0 sysex that the
 * shim otherwise passes through — they'd fight our LEDs. Opt into sysex
 * suppression (patched Schwung only; no-op on older hosts). The host CLEARS this
 * flag whenever our module is parked (suspendOvertakeMode → suspend/resume, and
 * on overtake exit / co-run), so init() alone isn't enough — we must re-assert it
 * every time we return to full overtake (resume, co-run end), or Move's clip-side
 * LEDs leak back. Idempotent + typeof-guarded, so it's safe to call repeatedly. */
export function assertOvertakeSysexSuppress() {
    if (typeof shadow_set_overtake_suppress_sysex === 'function')
        shadow_set_overtake_suppress_sysex(1);
}

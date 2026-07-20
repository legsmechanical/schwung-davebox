/* ui_tick.mjs
 * The tick() payload: _tickImpl (the ~1,300-line per-frame drain/LED/draw loop)
 * plus its tick-only satellite helpers (track-type/Conduct conversion, cable-2
 * MIDI remap, scene-playing cache, metronome click no-op). ui.js's globalThis.tick
 * wrapper stays resident and calls the imported _tickImpl; applyExtMidiRemap is
 * also called directly from ui.js's init() (exported for that).
 * Extracted from ui.js (Phase 6b, the FINAL extraction of the modularity refactor —
 * see docs/superpowers/plans/2026-07-10-refactor-phase6b-map.md).
 */

import {
    MoveShift, MovePlay, MoveLeft, MoveRight, MoveUp, MoveDown, MoveMute, MoveDelete
} from '/data/UserData/schwung/shared/constants.mjs';
import {
    Red, VividYellow, Green, DarkGrey, White
} from '/data/UserData/schwung/shared/constants.mjs';
import { setLED, setButtonLED } from '/data/UserData/schwung/shared/input_filter.mjs';

import {
    MoveNoteSession, MoveUndo, MoveLoop, MoveCopy, MoveRec, MoveCapture, MoveSample,
    LED_OFF, NUM_TRACKS, NUM_CLIPS, DRUM_LANES, NUM_STEPS, TPS_VALUES,
    ACTION_POPUP_TICKS, PAD_MODE_DRUM, PAD_MODE_MELODIC_SCALE, PAD_MODE_CONDUCT,
    POLL_INTERVAL, NO_NOTE_FLASH_TICKS,
    CC_GRADIENT_BASE, CC_GRADIENT_LEVELS, CC_GRADIENT_SCALARS
} from './ui_constants.mjs';

import { S } from './ui_state.mjs';
import { clipHasContent, stepEntryVelocity } from './ui_pure.mjs';
import { saveState, showActionPopup, uuidToStatePath, readActiveSet, loadNameIndex, saveNameIndex,
    commitSnapshot, updateNameIndex, maybeShowInheritPicker } from './ui_persistence.mjs';
import { showMenuInfo } from './ui_dialogs.mjs';
import { sceneAllQueued, updateSceneMapLEDs } from './ui_scene.mjs';
import { _padDispatchMutedNow, computePadNoteMap, syncDrumLaneSteps, syncDrumLanesMeta,
    syncDrumClipContent } from './ui_drummodel.mjs';
import { effectiveClip, updateStepLEDs, updateSessionLEDs, updateTrackLEDs, flashAtRate,
    invalidateLEDCache, trackColor, setPaletteEntryRGB, reapplyPalette, forceRedraw,
    updatePerfModeLEDs, altIndicatorActive, clearAllLEDs, installFlagsWrap, removeFlagsWrap,
    buildLedInitQueue, drainLedInit } from './ui_leds.mjs';
import { schSlotForTrack, schSlotsForTrack, enterSchwungCoRun,
    assertOvertakeSysexSuppress } from './ui_corun.mjs';
import { pollPendingExport } from './ui_export.mjs';
import { drawUI } from './ui_render.mjs';
import { pollDSP,
    refreshPerClipBankParams, refreshDrumLaneBankParams, refreshSeqNotesIfCurrent,
    syncClipsFromDsp, syncClipsTargeted, syncMuteSoloFromDsp, restoreUiSidecar,
    liveSendNote, _drainLiveNotes,
    pendingDrumNoteOffs, _drumRecNoteOns, _drumRecNoteOffs } from './ui_dsp_bridge.mjs';
import { disarmRecord, _recordingNoteTrack, flushHeldMoveExtNotes } from './ui_record.mjs';
import { xposeCancelPreview } from './ui_xpose.mjs';

const BANK_DISPLAY_TICKS = 94;  /* ~1000ms at 94Hz device tick rate (was 392 = ~4.2s; constant was miscalibrated for 196Hz) */
const KNOB_TURN_HIGHLIGHT_TICKS = 56;             /* ~600ms at 94Hz — highlight after turn without touch (was 120 @196Hz) */
const STEP_HOLD_TICKS      = 19;   /* ~200ms at ~94Hz (device actual): below = tap, at/above = hold */
const STEP_SAVE_HOLD_TICKS = 70;   /* ~750ms at 94Hz */
const STEP_SAVE_FLASH_TICKS = 40;  /* ~200ms double-blink on step button LEDs after save */

function playMetronomeClick() {
    /* DSP handles click audio via render_block; nothing to do here */
}

/* Convert a track between melodic and drum, translating note content so the
 * music follows the track. The DSP handler (tN_convert_to_drum/_to_melodic)
 * does the data move AND flips pad_mode atomically in a single set_param, so
 * there is no coalescing drop. We then resync JS from DSP — syncClipsFromDsp()'s
 * get_param round-trips double as the audio-thread sync barrier. */
function trackHasAnyData(t) {
    for (let c = 0; c < NUM_CLIPS; c++)
        if (S.clipNonEmpty[t][c] || S.drumClipNonEmpty[t][c]) return true;
    return false;
}

function convertTrackType(t, toDrum) {
    if (typeof host_module_set_param !== 'function') return;
    host_module_set_param('t' + t + (toDrum ? '_convert_to_drum' : '_convert_to_melodic'), '1');
    S.trackPadMode[t] = toDrum ? PAD_MODE_DRUM : PAD_MODE_MELODIC_SCALE;
    /* Resync inline (this runs in tick(), so get_param works): the first get
     * in syncClipsFromDsp flushes the queued convert, then reads post-convert
     * state — it also runs the drum-side syncs when the result is a drum track.
     * Empty tracks skip the heavy all-track resync but still need a get_param
     * barrier so the convert set_param drains before computePadNoteMap pushes
     * tN_padmap (without the barrier, same-buffer coalescing drops the convert). */
    if (trackHasAnyData(t)) syncClipsFromDsp();
    else host_module_get_param('t' + t + '_pad_mode');
    if (toDrum) {
        if (t === S.activeTrack && (S.activeBank === 2 || S.activeBank === 4)) S.activeBank = 0;
    } else {
        if (t === S.activeTrack && S.activeBank === 7) S.activeBank = 0;
        /* DSP zeroed active_drum_lane/drum_perform_mode inside the convert
         * handler; only JS-side mirror state needs clearing here. */
        S.drumVelZoneArmed[t] = false;
        S.drumLastVelZone[t]  = 0;
    }
    computePadNoteMap();   /* get_param-free — rebuild pad LEDs immediately */
    invalidateLEDCache();
    forceRedraw();
}

/* Route a track to Conductor. The DSP enforces one-Conductor: if another track
 * already holds the role, the convert handler returns without changing anything.
 * We optimistically flip the local mode, then verify the role next tick via
 * pendingConductReadback to detect (and revert) a refusal. */
function convertTrackToConduct(t) {
    if (typeof host_module_set_param !== 'function') return;
    const prevMode = S.trackPadMode[t];
    host_module_set_param('t' + t + '_convert_to_conduct', '1');
    S.trackPadMode[t] = PAD_MODE_CONDUCT;
    S.pendingConductReadback = { t: t, prevMode: prevMode };
    /* Mirror convertTrackType's drain barrier: the convert set_param must drain
     * before computePadNoteMap pushes tN_padmap, or same-buffer tN_* coalescing
     * drops the convert (DSP never sets the role → false refusal). The first
     * get_param in syncClipsFromDsp flushes the queued convert; empty tracks use
     * a bare get_param barrier. The refusal readback runs in tick() (get_param
     * valid there). */
    if (trackHasAnyData(t)) syncClipsFromDsp();
    else host_module_get_param('t' + t + '_pad_mode');
    computePadNoteMap();
    invalidateLEDCache();
    forceRedraw();
}

/* Rewrite the cable-2 channel remap table for the active track.
 * When the active track is ROUTE_MOVE, incoming external MIDI is remapped to the
 * track's channel so Move's firmware routes it to the correct track instrument.
 * Called from tick() on any change to activeTrack/route/channel/midiInChannel,
 * and directly from init() on first load / resume after full exit. */
export function applyExtMidiRemap() {
    const t = S.activeTrack;
    const isMove = S.trackRoute[t] === 1;
    const hasRemap = typeof host_ext_midi_remap_enable === 'function';
    if (!hasRemap) return;
    if (!isMove) {
        host_ext_midi_remap_clear();
        for (var _i = 0; _i < 16; _i++) {
            host_ext_midi_remap_set(_i, 254);  /* EXT_MIDI_REMAP_BLOCK */
        }
        host_ext_midi_remap_enable(1);
        S.extMidiRemapActive = false;
        return;
    }
    const outCh = S.trackChannel[t] - 1;  /* 0-indexed */
    host_ext_midi_remap_clear();
    if (S.midiInChannel === 0) {
        for (var _i = 0; _i < 16; _i++) {
            if (_i !== outCh) host_ext_midi_remap_set(_i, outCh);
        }
    } else {
        const inCh = S.midiInChannel - 1;  /* 0-indexed */
        if (inCh !== outCh) host_ext_midi_remap_set(inCh, outCh);
    }
    host_ext_midi_remap_enable(1);
    S.extMidiRemapActive = true;
}

function sceneAllPlaying(sceneIdx) {
    let hasAny = false;
    if (S.playing) {
        for (let t = 0; t < NUM_TRACKS; t++) {
            if (!S.trackClipPlaying[t]) continue;
            if (S.trackActiveClip[t] !== sceneIdx) return false;
            hasAny = true;
        }
    } else {
        for (let t = 0; t < NUM_TRACKS; t++) {
            if (!S.trackWillRelaunch[t] && S.trackQueuedClip[t] < 0) continue;
            if (effectiveClip(t) !== sceneIdx) return false;
            hasAny = true;
        }
    }
    return hasAny;
}

function sceneAnyPlaying(sceneIdx) {
    for (let t = 0; t < NUM_TRACKS; t++) {
        if (S.trackClipPlaying[t] && S.trackActiveClip[t] === sceneIdx) return true;
    }
    return false;
}

var _lastSessionView = false;

/* ------------------------------------------------------------------ */
/* _tickImpl drain-order constraints (phase 6b.5)                       */
/* ------------------------------------------------------------------ */
/* _tickImpl is a ~44-block flat sequence of independently-triggered
 * drains (each gated on its own S.pending* flag/countdown), but a handful
 * of pairs are load-bearing on RELATIVE ORDER within the function body —
 * reordering these blocks breaks behavior even though each block looks
 * self-contained. This banner is the "make the drain order explicit"
 * deliverable for phase 6b (map §3): NO dynamic drainPending registry —
 * every writer lives in a module and every drain here is statically
 * ordered, so the order belongs in comments, not indirection. Each
 * constraint below is anchored to its block by a searchable string.
 *
 * - CHORD TWO-TICK PHASE ORDER: the `S.pendingChordPhase2` check (anchor:
 *   "if (S.pendingChordPhase2 !== null)") MUST run BEFORE the
 *   `S.pendingChordToStep` check (anchor: "if (S.pendingChordToStep !==
 *   null && S.activeBank !== 6)") in the same tick. Phase-1 (_toggle) arms
 *   pendingChordPhase2 for the NEXT tick; _set_notes is a DSP no-op on an
 *   empty step, so _toggle must land a tick before _set_notes. Inverting
 *   this pair breaks chord entry.
 *
 * - DEFAULT-DRAIN BEFORE dspSync COUNTDOWN: the pendingDefaultSetParams
 *   drain (anchor: "else if (S.pendingDefaultSetParams.length > 0 &&
 *   !S.pendingSetLoad && S.pendingDspSync === 0") MUST run BEFORE the
 *   pendingDspSync countdown (anchor: "if (S.pendingDspSync > 0) {").
 *   On the tick pendingDspSync hits 1, the default-drain's `=== 0` guard
 *   correctly skips; the FOLLOWING tick's countdown-to-0 fires
 *   restoreUiSidecar(true), which *pushes* new defaults. Swapping the
 *   order would drain a half-populated queue.
 *
 * - pendingSetLoad GATES BOTH pendingDefaultSetParams (`!S.pendingSetLoad`
 *   guard) AND pendingPruneOrphans (anchor: "if (S.pendingPruneOrphans &&
 *   !S.pendingSetLoad && S.pendingDspSync === 0"), and pendingSetLoad's own
 *   drain (anchor: "if (S.pendingSetLoad && !S.pendingInheritPicker...")
 *   arms `S.pendingDspSync = 5`. Load is checked/drained first in program
 *   order; defaults/prune wait on `pendingDspSync === 0` by construction.
 *
 * - pollDSP() BEFORE THE LED/SCENE/DRAW BLOCK: the POLL_INTERVAL-gated
 *   pollDSP() call (anchor: "if ((S.tickCount % POLL_INTERVAL) === 0) {
 *   pollDSP();") writes S.playing/trackCurrentStep/trackClipPlaying/merge
 *   state/drum playhead — all read by the scene-cache refresh and the LED
 *   painters that follow later in the same tick. Must stay drain-before-draw.
 *
 * - SUSPEND-SAVE FIRES LAST: the pendingSuspendSave drain (anchor:
 *   "if (S.pendingSuspendSave && typeof host_module_set_param ===
 *   'function')") is placed deliberately near the end of the function so
 *   no subsequent set_param in the same tick can overwrite the save (see
 *   the block's own inline comment). Its else-if siblings
 *   (pendingExitAfterSave/pendingHideAfterSave/pendingSnapshotCopy) each
 *   run a tick AFTER the save set_param reached DSP — do not hoist any of
 *   this earlier in the function.
 *
 * - isSuspended: EARLY COMPUTE, LATE CONSUME. `const isSuspended` (anchor:
 *   "const isSuspended = S._origClearScreen && (clear_screen !==
 *   S._origClearScreen);") is computed near the top of the function and
 *   consumed exactly once, at the final draw gate (anchor: "if
 *   (S.screenDirty && !isSuspended) { S.screenDirty = false; drawUI(); }").
 *   This is the one fn-local (not S-field) cross-block coupling in
 *   _tickImpl — it is why the suspend-detect block and the draw-gate block
 *   are not independently carve-safe.
 *
 * - 2-TICK COUNTDOWNS: pendingDrumResync (anchor: "if (S.pendingDrumResync
 *   > 0) {") and pendingStepsReread (anchor: "if (S.pendingStepsReread >
 *   0) {") both arm to 2, decrement once per tick, and act at 0 — the DSP
 *   move they're waiting on must settle a full tick before the JS mirror
 *   re-reads it. pendingScheduledDisarm (anchor: "if
 *   (S.pendingScheduledDisarm) {") is its own 2-tick pair: lock length on
 *   tick 1, disarm on tick 2.
 *
 * - STANDING WARNING: do NOT silently restore a "stepOpTick" /
 *   collision-aware deferred-drain block. An earlier revision of this file
 *   had one (removed in Phase 6, long before this extraction) — its ordering
 *   hazard was real but the block itself is gone from current behavior.
 *   (The write-only S.stepOpTick field + its two ui_input_pads.mjs writers
 *   that lingered after the Phase-6 removal were deleted in the post-refactor
 *   cleanup, 2026-07-11.) If a future change reintroduces a similar deferred
 *   step-op drain, treat its ordering against the blocks above as a fresh
 *   design question, not a copy-paste restore.
 */
export function _tickImpl() {
    S.tickCount++;
    if (S.bootSplashTicks > 0) S.bootSplashTicks--;

    /* Lifecycle edge: at suspend/teardown (and transient co-run slot switches)
     * the host can momentarily unbind its param API while an already-queued tick
     * still fires. Every meaningful tick action reads or writes DSP, so there is
     * nothing useful to do without the API — bail rather than throw
     * 'host_module_get_param is not defined' into seq8-jserr.log. */
    if (typeof host_module_get_param !== 'function' ||
        typeof host_module_set_param !== 'function') return;

    /* Ableton .ablbundle export runs here (tick context) so get_param('bpm')
     * resolves — it returns null on the on_midi path where the menu action
     * fires. host_system_cmd blocks for the python packager; transport is
     * stopped (guarded in exportSession) so the brief tick stall is benign. */
    pollPendingExport();

    /* Deferred padmap recompute for leaving-DRUM (see applyTrackConfig
     * else branch). Fire ONLY when the pendingDefaultSetParams queue is
     * empty — otherwise the tN_padmap push would land in the same tick
     * as a queue-drained tN_* push for the same track, and the empirically-
     * observed same-track set_param interference drops the padmap push.
     * (See the val=1 case: it works because syncDrum* get_params between
     * the pad_mode and padmap pushes flush the buffer.) */
    /* Track-type conversion runs here (tick context) so the get_param
     * round-trips inside convertTrackType -> syncClipsFromDsp work — they
     * return null on the on_midi path where the triggers fire. */
    if (S.pendingTrackConvert) {
        const _pc = S.pendingTrackConvert;
        S.pendingTrackConvert = null;
        convertTrackType(_pc.t, _pc.toDrum);
    }

    if (S.pendingConductConvert !== null) {
        const _cct = S.pendingConductConvert;
        S.pendingConductConvert = null;
        convertTrackToConduct(_cct);
    }

    /* Verify the Conductor role landed (or detect a one-Conductor refusal).
     * Runs in tick() so get_param is valid. */
    if (S.pendingConductReadback !== null && typeof host_module_get_param === 'function') {
        const _rb  = S.pendingConductReadback;
        S.pendingConductReadback = null;
        const _raw = host_module_get_param('conductor_track');
        const _ct  = parseInt(_raw, 10);
        const _val = isNaN(_ct) ? -1 : _ct;
        if (_val === _rb.t) {
            /* SUCCESS — the role landed on the requested track. */
            S.conductorTrack = _val;
        } else if (_val >= 0) {
            /* Refused — a different track already holds the role. Revert. */
            S.conductorTrack = _val;
            S.trackPadMode[_rb.t] = _rb.prevMode;
            computePadNoteMap();
            invalidateLEDCache();
            forceRedraw();
            /* Action popups are invisible while the global menu is open (drawUI
             * early-returns into drawGlobalMenu). Use the menu-visible info
             * dialog instead. */
            showMenuInfo('Conductor exists', 'on T' + (_val + 1) + '.', 'Route it back first.');
            S.screenDirty = true;
        } else {
            /* Unexpected — DSP reports no conductor right after convert.
             * Revert the optimistic mode but do NOT show the misleading
             * "exists" popup. */
            S.conductorTrack = _val;
            S.trackPadMode[_rb.t] = _rb.prevMode;
            computePadNoteMap();
            invalidateLEDCache();
            forceRedraw();
        }
    }

    if (S.pendingPadNoteMapRecompute && S.pendingDefaultSetParams.length === 0
            && S.clearDrainHold === 0) {
        S.pendingPadNoteMapRecompute = false;
        computePadNoteMap();
    }

    /* PHASE-1: edge-detect modal pad-dispatch mute changes that aren't
     * caught by explicit hooks (dialogs, ARP-step-edit, knob-touch state).
     * Cheap check — boolean compare. Tick is ~10.6 ms, more than fast
     * enough for non-button-CC modal transitions (dialog open / knob touch). */
    if (S.dspInboundEnabled) {
        const _muted = _padDispatchMutedNow();
        if (_muted !== S.lastPushedMuted) computePadNoteMap();
        /* Self-heal: every 5 ticks (~50ms), read back DSP's pad_dispatch_muted
         * via get_param and re-push the padmap if it diverged from JS truth.
         * Necessary because tN_padmap pushes can be dropped when set_param
         * loses to shadow_send_midi_to_dsp in the same audio buffer (see
         * feedback_set_param_coalescing). Without this, an un-mute push lost
         * to MIDI contention leaves DSP stuck with pad_dispatch_muted=1 and
         * all pads silent until the user happens to gesture a modifier
         * (which retriggers computePadNoteMap). Worst-case stuck pad
         * duration is now ~50ms instead of indefinite. */
        if ((S.tickCount % 5) === 0 && typeof host_module_get_param === 'function') {
            const _dspM = host_module_get_param('pad_dispatch_muted');
            if (_dspM !== null && _dspM !== undefined) {
                const _dspMi = parseInt(_dspM, 10);
                const _jsM = _muted ? 1 : 0;
                if (_dspMi !== _jsM) computePadNoteMap();
            }
            const _dspMap0 = host_module_get_param('pad_note_map_0');
            if (_dspMap0 !== null && _dspMap0 !== undefined) {
                const _dspMap0i = parseInt(_dspMap0, 10);
                const _jsMap0 = _muted && S.sessionView ? 0xFF
                    : Math.max(0, Math.min(127, (S.padNoteMap[0] | 0) +
                        (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM ? 0 : (S.trackOctave[S.activeTrack] | 0) * 12)));
                const _expect = S.padNoteMap[0] === 0xFF ? 255 : _jsMap0;
                if (_dspMap0i !== _expect) computePadNoteMap();
            }
        }
    }

    /* Drain live-note events queued by onMidiMessage handlers since the last
     * tick. One set_param per track per tick — survives same-buffer
     * coalescing of multiple pad presses in one audio buffer. */
    _drainLiveNotes();

    /* Reapply cable-2 channel remap if anything affecting it changed. */
    {
        const _rt = S.activeTrack;
        const _rr = S.trackRoute[_rt];
        const _rc = S.trackChannel[_rt];
        const _rm = S.midiInChannel;
        if (_rt !== S.lastRemapTrack || _rr !== S.lastRemapRoute ||
                _rc !== S.lastRemapChannel || _rm !== S.lastRemapMidiIn) {
            /* TARP latch is per-track musical intent — preserved across track/
             * route/channel/MIDI-in changes. Only Stop transport and Delete+Play
             * clear it deliberately. */
            /* BEFORE repointing the remap: release any ext notes still held on
             * a Move-routed track. Once the table is rewritten their physical
             * note-off can no longer reach Move on the old channel — stranded
             * firmware voice (finding 1; see flushHeldMoveExtNotes). */
            flushHeldMoveExtNotes();
            applyExtMidiRemap();
            S.lastRemapTrack = _rt; S.lastRemapRoute = _rr;
            S.lastRemapChannel = _rc; S.lastRemapMidiIn = _rm;
        }
    }

    /* Reset TARP latch when entering session view */
    if (S.sessionView && !_lastSessionView) {
        const _t = S.activeTrack;
        if (S.bankParams[_t][5][7] | 0) {
            S.bankParams[_t][5][7] = 0;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + _t + '_tarp_latch', '0');
        }
    }
    /* PHASE-1: session-view edge re-pushes padmap so DSP on_midi gates pad
     * dispatch (session pads launch clips, not notes). Remove with the rest
     * of the PHASE-1 gates when patches upstreamed. */
    if (S.sessionView !== _lastSessionView) {
        computePadNoteMap();
    }
    _lastSessionView = S.sessionView;

    /* Suspend detection: host swaps clear_screen to a no-op while we're parked.
     * Save state on the transition edge; let tick run normally (display is no-oped by host). */
    const isSuspended = S._origClearScreen && (clear_screen !== S._origClearScreen);
    if (isSuspended && !S._wasSuspended) {
        /* saveState() writes the sidecar synchronously and sets
         * pendingSuspendSave — drained at end of this tick (block below).
         * Keeps schema unified with the explicit save paths. */
        saveState();
        removeFlagsWrap();
        if (typeof host_ext_midi_remap_enable === 'function') host_ext_midi_remap_enable(0);
    }
    if (!isSuspended && S._wasSuspended) {
        installFlagsWrap();
        applyExtMidiRemap();
        /* Clear any held-modifier state that may have got stuck on suspend
         * (key-up events fire after overtake exits, so onMidiMessage never sees them). */
        S.shiftHeld = false; S.deleteHeld = false; S.muteHeld = false;
        S.copyHeld  = false; S.loopHeld  = false; S.loopJogActive = false;
        S.captureHeld = false; S.shiftTrackLEDActive = false;
        S.heldStep  = -1;    S.heldStepBtn = -1; S.heldStepNotes = [];
        S.stepWasEmpty = false; S.stepWasHeld = false;
        /* Resuming to full overtake: re-assert sysex suppression (the host clears
         * it in suspendOvertakeMode while we're parked) so Move's clip/grid LEDs
         * don't leak back over ours. */
        assertOvertakeSysexSuppress();
        /* Check if the active set changed while we were parked. */
        const _as = readActiveSet();
        const _dspUuid = (typeof host_module_get_param === 'function')
            ? (host_module_get_param('state_uuid') || '') : '';
        if (_as.uuid && _dspUuid !== _as.uuid) {
            S.currentSetUuid = _as.uuid;
            S.currentSetName = _as.name;
            /* If multiple family candidates, picker opens and state_load is
             * deferred. Otherwise pendingSetLoad is fine to set immediately
             * since the auto-inherit branch (or blank branch) is already done. */
            const _r = maybeShowInheritPicker(_as.uuid, _as.name);
            if (_r !== 'picker') S.pendingSetLoad = true;
        }
        S.ledInitComplete = false;
        invalidateLEDCache();
        S.ledInitQueue = buildLedInitQueue();
        S.ledInitIndex = 0;
        forceRedraw();
    }
    S._wasSuspended = isSuspended;

    /* Metro note-off */
    if (S.metroNoteOffTick >= 0 && S.tickCount >= S.metroNoteOffTick) {
        S.metroNoteOffTick = -1;
        if (typeof move_midi_inject_to_move === 'function')
            move_midi_inject_to_move([0x09, 0x80, 108, 0]);
    }

    /* Drain deferred drum tap note-offs */
    for (let _t = 0; _t < NUM_TRACKS; _t++) {
        if (pendingDrumNoteOffs[_t].length === 0) continue;
        const offs = pendingDrumNoteOffs[_t].splice(0);
        for (const pitch of offs) liveSendNote(_t, 0x80, pitch, 0);
    }

    /* Clear CC step-edit active flag once the step is released */
    if (S.ccStepEditActive && S.heldStep < 0)
        S.ccStepEditActive = false;

    /* Deferred CC auto-bits/rest re-read (set from MIDI handlers where get_param
     * is null, e.g. Delete+step whole-step clear). */
    if (S.pendingCCBitsRefresh >= 0 && typeof host_module_get_param === 'function') {
        const _rt = S.activeTrack, _rc = S.pendingCCBitsRefresh;
        S.pendingCCBitsRefresh = -1;
        const _bits = host_module_get_param('t' + _rt + '_c' + _rc + '_cc_auto_bits');
        if (_bits !== null) S.trackCCAutoBits[_rt][_rc] = parseInt(_bits, 10) || 0;
        const _rest = host_module_get_param('t' + _rt + '_c' + _rc + '_cc_rest');
        if (_rest) {
            const _rp = _rest.split(' ');
            for (let _k = 0; _k < 8; _k++) {
                const _rv = parseInt(_rp[_k], 10);
                S.clipCCVal[_rt][_rc][_k] = (_rv >= 0 && _rv <= 127) ? _rv : -1;
            }
        }
        invalidateLEDCache();
    }

    /* Poll the defined output value at the playhead per knob (255 = "—") for the
     * realtime display + knob-LED feedback while the CC bank is visible & playing. */
    if (S.activeBank === 6 && S.playing && !S.sessionView && !S.ccStepEditActive) {
        const _lv = host_module_get_param('t' + S.activeTrack + '_cc_cur_vals');
        if (_lv) {
            const _lp = _lv.split(' ');
            for (let _k = 0; _k < 8 && _k < _lp.length; _k++) {
                const _v = parseInt(_lp[_k], 10);
                S.trackCCLiveVal[S.activeTrack][_k] = (_v >= 0 && _v <= 127) ? _v : -1;
            }
        }
    }

    /* Sch (chain knob) automation routing: poll cc_auto_cur_val for every
     * playing track that has Sch lanes, and push values to chain slots via
     * shadow_set_param. Runs regardless of active bank. */
    /* Sch label fetch: one shadow_get_param per tick to avoid blocking.
     * Triggered on bank-6 entry; fetches param name for each Sch lane. */
    if (S.schLabelFetchLane >= 0 && S.schLabelFetchLane < 8 &&
            typeof shadow_get_param === 'function') {
        const _ft = S.activeTrack;
        const _fk = S.schLabelFetchLane;
        S.schLabelFetchLane++;
        if (S.trackCCType[_ft][_fk] === 2) {
            const _slot = schSlotForTrack(_ft);
            if (_slot >= 0) {
                const _name = shadow_get_param(_slot, 'knob_' + S.trackCCAssign[_ft][_fk] + '_param');
                S.schLabel[_ft][_fk] = _name || null;
            }
        }
        if (S.schLabelFetchLane >= 8) S.schLabelFetchLane = -1;
        S.screenDirty = true;
    }

    /* CC-bank step-LED gradient palette: 6 white brightness levels (the playhead
     * uses the track color instead). Written on bank-6 entry / track switch
     * (not per frame); the step LEDs themselves are driven in updateStepLEDs. */
    if (S.activeBank === 6 && !S.sessionView &&
            S.ccGradPaletteTrack !== S.activeTrack) {
        S.ccGradPaletteTrack = S.activeTrack;
        for (let _l = 0; _l < CC_GRADIENT_LEVELS; _l++) {
            const _w = Math.round(255 * CC_GRADIENT_SCALARS[_l]);
            setPaletteEntryRGB(CC_GRADIENT_BASE + _l, _w, _w, _w);
        }
        reapplyPalette();
        setButtonLED(MovePlay,   S.playing ? Green : LED_OFF, true);
        /* Rec carries Live Merge state (Shift+Rec): red armed, green capturing.
         * CAPTURED (4 — capture stopped, awaiting placement) reverts to OFF so
         * both Play and Rec go dark when the merge ends. */
        setButtonLED(MoveRec,    (S.recordArmed || S.recordScheduledStop) ? Red
                                 : (S.dspMergeState === 2 || S.dspMergeState === 3) ? Green
                                 : S.dspMergeState === 1 ? Red : LED_OFF, true);
        setButtonLED(MoveSample, DarkGrey, true);
        /* reapplyPalette reset the buttonCache — force-resend the 8 knob LEDs
         * next render (their stopped-state named colors would otherwise be
         * silently dropped) and the step LEDs. */
        S._forceKnobReemit = true;
        invalidateLEDCache();
    }

    /* Phase 1 / Bundle 2C-Rpt1: pendingRepeatLane queue removed. Lane swap
     * while holding a rate pad is now fired immediately on press from the
     * lane-pad branch in _onPadPress (different set_param key from the
     * other lane-pad pushes — no coalescing). */


    /* Set change detected in init(): send UUID so DSP constructs path and loads.
     * Suppressed while the inherit picker is open — state_load fires only
     * after the user picks a source (or "Start blank"). */
    if (S.pendingSetLoad && !S.pendingInheritPicker && typeof host_module_set_param === 'function') {
        S.pendingSetLoad = false;
        S.stateLoading = true;
        disarmRecord();
        S.heldStep = -1; S.heldStepBtn = -1; S.heldStepNotes = []; S.stepWasEmpty = false; S.stepWasHeld = false;
        S.seqActiveNotes.clear(); S.seqLastStep = -1; S.seqLastClip = -1;
        S.pendingDspSync = 5;
        host_module_set_param('state_load', S.currentSetUuid || '');
    }

    /* Drain first-run default set_params one per tick, after state is fully settled.
     * clearDrainHold defers the drain past the on_midi-context buffer where
     * a clearClip caller fired synchronous set_params (see clearClip comment). */
    if (S.clearDrainHold > 0) S.clearDrainHold--;
    else if (S.pendingDefaultSetParams.length > 0 && !S.pendingSetLoad && S.pendingDspSync === 0
            && typeof host_module_set_param === 'function') {
        const _dp = S.pendingDefaultSetParams.shift();
        host_module_set_param(_dp.key, _dp.val);
        /* Device-originated clip edit (copy/cut/clear/row): the DSP will bump
         * rui_rev on the next audio buffer. Arm a short window so pollDSP treats
         * that bump as OURS — adopt the rev + cheap automation-only re-read of
         * S.localEditTouched — instead of the FULL syncClipsFromDsp() self-resync
         * (~1,540 get_params ≈ 4.3s). 12 ticks (~128ms) covers buffer-apply
         * latency + one POLL_INTERVAL. See ui_state.mjs localRevSuppressUntil. */
        if (_dp._local) S.localRevSuppressUntil = S.tickCount + 12;
    }

    /* Poll every 100 ticks (~0.5s): detect DSP hot-reload via instance nonce. */
    if ((S.tickCount % 100) === 0 && typeof host_module_get_param === 'function' &&
            typeof host_module_set_param === 'function') {
        const newInstanceId = host_module_get_param('instance_id');
        if (newInstanceId && S.lastDspInstanceId !== '' && newInstanceId !== S.lastDspInstanceId) {
            pollDSP();
            for (let _t = 0; _t < NUM_TRACKS; _t++)
                S.trackCurrentPage[_t] = Math.max(0, Math.floor(S.trackCurrentStep[_t] / 16));
            syncClipsFromDsp();
            syncMuteSoloFromDsp();
            computePadNoteMap();
            invalidateLEDCache();
            forceRedraw();
        }
        if (newInstanceId) S.lastDspInstanceId = newInstanceId;
    }

    /* Deferred resync after set change: wait ~5 ticks for state_load to land on audio thread. */
    if (S.pendingDspSync > 0) {
        S.pendingDspSync--;
        if (S.pendingDspSync === 0) {
            pollDSP();
            for (let _t = 0; _t < NUM_TRACKS; _t++)
                S.trackCurrentPage[_t] = Math.max(0, Math.floor(S.trackCurrentStep[_t] / 16));
            syncClipsFromDsp();
            syncMuteSoloFromDsp();
            /* Restore the Conductor role from DSP. syncClipsFromDsp ->
             * readTrackConfig already reads t<idx>_pad_mode (PAD_MODE_CONDUCT=2
             * preserved, not clamped), but S.conductorTrack is not derived from
             * any per-track read — pull it from the conductor_track get_param so
             * a reloaded set isn't desynced (white color, inert Channel/Route).
             * Runs here (tick context) where get_param is valid. */
            if (typeof host_module_get_param === 'function') {
                const _ct = parseInt(host_module_get_param('conductor_track'), 10);
                if (!isNaN(_ct) && _ct >= 0 && _ct < NUM_TRACKS) {
                    S.conductorTrack = _ct;
                    S.trackPadMode[_ct] = PAD_MODE_CONDUCT;
                    /* Pull the Conductor's per-clip bank values back from DSP.
                     * get_param is valid here (tick/sync context) but NOT in
                     * onMidiMessage. Read all 16 clips once on load/resume so the
                     * full per-clip mirror (condResp/condWhen/condOct) is hot —
                     * later clip switches just re-point S.condActiveClip and need
                     * no DSP reads at all. Mirror the active clip into
                     * S.condActiveClip (the clip whose values the OLED grid
                     * renders). GET shapes (Task 2.1): _cond_resp / _cond_when =
                     * 8-char '0'/'1' strings; _cond_oct = 8 space-separated
                     * signed ints. */
                    S.condActiveClip = S.trackActiveClip[_ct] | 0;
                    for (let _c = 0; _c < NUM_CLIPS; _c++) {
                        const _resp = host_module_get_param('t' + _ct + '_c' + _c + '_cond_resp');
                        const _when = host_module_get_param('t' + _ct + '_c' + _c + '_cond_when');
                        const _oct  = host_module_get_param('t' + _ct + '_c' + _c + '_cond_oct');
                        if (typeof _resp === 'string' && _resp.length >= NUM_TRACKS) {
                            for (let _k = 0; _k < NUM_TRACKS; _k++)
                                S.condResp[_c][_k] = (_resp.charAt(_k) === '1') ? 1 : 0;
                        }
                        if (typeof _when === 'string' && _when.length >= NUM_TRACKS) {
                            for (let _k = 0; _k < NUM_TRACKS; _k++)
                                S.condWhen[_c][_k] = (_when.charAt(_k) === '1') ? 1 : 0;
                        }
                        if (typeof _oct === 'string' && _oct.length > 0) {
                            const _op = _oct.split(' ');
                            for (let _k = 0; _k < NUM_TRACKS && _k < _op.length; _k++) {
                                const _ov = parseInt(_op[_k], 10);
                                if (!isNaN(_ov)) S.condOct[_c][_k] = _ov;
                            }
                        }
                        /* CdLk: single 0/1 per clip. */
                        const _clk = host_module_get_param('t' + _ct + '_c' + _c + '_cond_lock');
                        S.condLock[_c] = (_clk === '1' || _clk === 1) ? 1 : 0;
                    }
                } else {
                    S.conductorTrack = -1;
                }
            }
            restoreUiSidecar(true);
            computePadNoteMap();
            S.stateLoading = false;
            invalidateLEDCache();
            forceRedraw();
        }
    }

    /* Deferred Move co-run entry inject — see enterMoveNativeCoRun(). Fire the
     * track-button press now that the shim's co-run path is active, so Move's
     * track + knob LED repaint passes through to hardware instead of being stripped. */
    if (S.pendingMoveCoRunInject > 0) {
        S.pendingMoveCoRunInject--;
        if (S.pendingMoveCoRunInject === 0 && S.moveCoRunTrack >= 0) {
            const ch = S.trackChannel[S.moveCoRunTrack] | 0;
            if (ch >= 1 && ch <= 4) {
                const coCC = 44 - ch;  /* ch 1 -> CC 43 (Track 1) ... ch 4 -> CC 40 (Track 4) */
                /* Reliable landing: alternate a neighbor track-button with the
                 * co-run track, ending on the co-run track (twice), so Move
                 * definitively selects + shows the routed track. Each neighbor->co-run
                 * transition forces a fresh selection; the doubled co-run tail covers
                 * a missed/coalesced final press. Well-spaced (gap below) so Move
                 * processes each as a distinct press. */
                const nb = (coCC === 43) ? 42 : 43;  /* any track button != co-run */
                S.moveCoRunPressQueue = [nb, coCC, nb, coCC];
                S.moveCoRunPressGap = 0;
            }
        }
    }
    /* Drain the co-run track-button press sequence (Option B full-row repaint):
     * one injected press every few ticks until the queue empties. Prefix each
     * press with a defensive Shift-off (CC 49=0) — Move firmware's internal
     * Shift state can be ambiguous when a tool entered co-run via Shift+Step
     * (the physical Shift release was zeroed shim-side in non-co-run mode, so
     * Move never saw it), and a plain track-button press with Shift "held"
     * lands on Move's track-routing menu instead of the preset editor. */
    if (S.moveCoRunPressQueue && S.moveCoRunPressQueue.length > 0 &&
            typeof move_midi_inject_to_move === 'function') {
        if (S.moveCoRunPressGap > 0) {
            S.moveCoRunPressGap--;
        } else {
            const cc = S.moveCoRunPressQueue.shift();
            move_midi_inject_to_move([0x0B, 0xB0, 49, 0]);    /* Shift off (defensive) */
            move_midi_inject_to_move([0x0B, 0xB0, cc, 127]);
            move_midi_inject_to_move([0x0B, 0xB0, cc, 0]);
            S.moveCoRunPressGap = 5;
        }
    }

    /* Deferred targeted re-sync after undo/redo: re-read only the affected clip(s). */
    if (S.pendingUndoSync > 0) {
        S.pendingUndoSync--;
        if (S.pendingUndoSync === 0) {
            const _info = host_module_get_param('last_restore');
            syncClipsTargeted(_info);
            /* apply_clip_restore clears tr->recording on the DSP side; re-establish it.
             * Also flush stale JS note buffers since DSP called finalize_pending_notes. */
            if (S.recordArmed && !S.recordCountingIn && S.recordArmedTrack >= 0) {
                _recordingNoteTrack.clear();
                S._recNoteOns.length   = 0;
                S._recNoteOffs.length  = 0;
                _drumRecNoteOns.length  = 0;
                _drumRecNoteOffs.length = 0;
                host_module_set_param('t' + S.recordArmedTrack + '_recording', '1');
            }
            invalidateLEDCache();
            forceRedraw();
        }
    }

    /* Deferred _steps re-read after _reassign: confirm DSP move in JS mirror */
    if (S.pendingAllLanesStretchCheck >= 0) {
        const _sat = S.pendingAllLanesStretchCheck;
        S.pendingAllLanesStretchCheck = -1;
        const _res = host_module_get_param('t' + _sat + '_all_lanes_stretch_result');
        if (_res !== null && parseInt(_res, 10) === -1) {
            showActionPopup('NO ROOM');
            S.bankParams[_sat][7][1] -= (S.knobLastDir[1] || 1);
        }
    }
    if (S.allLanesQntResetTick >= 0 && S.tickCount >= S.allLanesQntResetTick) {
        S.bankParams[S.allLanesQntResetTrack][7][3] = -1;
        S.allLanesQntResetTick  = -1;
        S.allLanesQntResetTrack = -1;
        S.screenDirty = true;
    }
    if (S.allLanesResResetTick >= 0 && S.tickCount >= S.allLanesResResetTick) {
        S.bankParams[S.allLanesResResetTrack][7][0] = -1;
        S.allLanesResResetTick  = -1;
        S.allLanesResResetTrack = -1;
        S.screenDirty = true;
    }
    if (S.allLanesDirResetTick >= 0 && S.tickCount >= S.allLanesDirResetTick) {
        S.bankParams[S.allLanesDirResetTrack][7][6] = -1;
        S.allLanesDirResetTick  = -1;
        S.allLanesDirResetTrack = -1;
        S.screenDirty = true;
    }
    if (S.pendingDrumResync > 0) {
        S.pendingDrumResync--;
        if (S.pendingDrumResync === 0) {
            syncDrumClipContent(S.pendingDrumResyncTrack);
            syncDrumLanesMeta(S.pendingDrumResyncTrack);
            syncDrumLaneSteps(S.pendingDrumResyncTrack, S.activeDrumLane[S.pendingDrumResyncTrack]);
            forceRedraw();
        }
    }
    /* Drain the record-off resend (see disarmRecord): re-asserts recording=0 for
     * a few ticks so a disarm coalesced in one audio buffer can't strand
     * recording=1 (which floods the automation lane). Idempotent DSP-side. The
     * re-arm guard stops the resend if recording is armed again in the window. */
    if (S.recOffTicks > 0 && S.recOffTrack >= 0) {
        if (S.recordArmed) {
            S.recOffTicks = 0; S.recOffTrack = -1;
        } else {
            S.recOffTicks--;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + S.recOffTrack + '_recording', '0');
            if (S.recOffTicks <= 0) S.recOffTrack = -1;
        }
    }
    if (S.pendingDrumLaneResync > 0) {
        S.pendingDrumLaneResync--;
        if (S.pendingDrumLaneResync === 0) {
            const _drT = S.pendingDrumLaneResyncTrack;
            const _drL = S.pendingDrumLaneResyncLane;
            syncDrumLaneSteps(_drT, _drL);
            /* Also refresh per-lane bank params (NOTE FX, DELAY, Repeat Groove)
             * so post-reset and post-mutation pfx values reflect DSP. Without
             * this, Lane Reset would leave NOTE FX/DELAY mirrors showing the
             * pre-reset values until the next track switch. */
            refreshDrumLaneBankParams(_drT, _drL);
            forceRedraw();
        }
    }
    if (S.pendingStepsReread > 0) {
        S.pendingStepsReread--;
        if (S.pendingStepsReread === 0) {
            const prt  = S.pendingStepsRereadTrack;
            const prac = S.pendingStepsRereadClip;
            const bulk = host_module_get_param('t' + prt + '_c' + prac + '_steps');
            if (bulk && bulk.length >= NUM_STEPS) {
                for (let rs = 0; rs < NUM_STEPS; rs++)
                    S.clipSteps[prt][prac][rs] = bulk[rs] === '1' ? 1 : (bulk[rs] === '2' ? 2 : 0);
                S.clipNonEmpty[prt][prac] = clipHasContent(prt, prac);
            }
            const _plen = host_module_get_param('t' + prt + '_c' + prac + '_length');
            if (_plen !== null && _plen !== undefined) S.clipLength[prt][prac] = parseInt(_plen, 10) || 16;
            const _ptps = host_module_get_param('t' + prt + '_c' + prac + '_tps');
            if (_ptps !== null && _ptps !== undefined) {
                const _tv = parseInt(_ptps, 10);
                S.clipTPS[prt][prac] = TPS_VALUES.indexOf(_tv) >= 0 ? _tv : 24;
            }
            if (prac === S.trackActiveClip[prt]) refreshPerClipBankParams(prt);
            forceRedraw();
        }
    }
    if (S.pendingSceneBakeResync > 0) {
        S.pendingSceneBakeResync--;
        if (S.pendingSceneBakeResync === 0) {
            const sc = S.pendingSceneBakeClip;
            for (let _t = 0; _t < NUM_TRACKS; _t++) {
                if (S.trackPadMode[_t] === PAD_MODE_DRUM) {
                    if (S.trackActiveClip[_t] === sc) {
                        syncDrumClipContent(_t);
                        syncDrumLanesMeta(_t);
                        syncDrumLaneSteps(_t, S.activeDrumLane[_t]);
                    }
                } else {
                    const bulk = host_module_get_param('t' + _t + '_c' + sc + '_steps');
                    if (bulk && bulk.length >= NUM_STEPS) {
                        for (let rs = 0; rs < NUM_STEPS; rs++)
                            S.clipSteps[_t][sc][rs] = bulk[rs] === '1' ? 1 : (bulk[rs] === '2' ? 2 : 0);
                        S.clipNonEmpty[_t][sc] = clipHasContent(_t, sc);
                    }
                    const _plen = host_module_get_param('t' + _t + '_c' + sc + '_length');
                    if (_plen !== null && _plen !== undefined) S.clipLength[_t][sc] = parseInt(_plen, 10) || 16;
                    const _ptps = host_module_get_param('t' + _t + '_c' + sc + '_tps');
                    if (_ptps !== null && _ptps !== undefined) {
                        const _tv = parseInt(_ptps, 10);
                        S.clipTPS[_t][sc] = TPS_VALUES.indexOf(_tv) >= 0 ? _tv : 24;
                    }
                    if (sc === S.trackActiveClip[_t]) refreshPerClipBankParams(_t);
                }
            }
            forceRedraw();
        }
    }

    /* pendingClearLength drain removed (Group B): Clip Clear now preserves
     * length and loop window so the deferred length=16 reset is no longer
     * needed. The pendingClearLengthTrack/Clip fields are kept in ui_state
     * defaults (-1) but no setter remains. */

    /* Refresh step LEDs while drum repeat is recording into the active lane */
    if (S.recordArmed && S.playing && !S.sessionView &&
            S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM &&
            (S.drumRepeatHeldPad[S.activeTrack] >= 0 || S.drumRepeat2HeldLanes[S.activeTrack].size > 0 || S.drumRepeat2LatchedLanes[S.activeTrack].size > 0)) {
        syncDrumLaneSteps(S.activeTrack, S.activeDrumLane[S.activeTrack]);
        forceRedraw();
    }

    /* Real-time preview while editing any global menu parameter.
     * Only send set_param when the edit value actually changes — avoids flooding
     * the DSP param queue (which would starve tN_launch_clip / transport commands). */
    if (S.globalMenuOpen && S.globalMenuState && S.globalMenuItems) {
        const item = S.globalMenuItems[S.globalMenuState.selectedIndex];
        if (item && S.globalMenuState.editing && S.globalMenuState.editValue !== null) {
            if (item.set && S.globalMenuState.editValue !== S.lastSentMenuEditValue) {
                item.set(S.globalMenuState.editValue);
                S.lastSentMenuEditValue = S.globalMenuState.editValue;
                S.screenDirty = true;
            }
            S.bpmWasEditing = true;
        } else if (S.bpmWasEditing && !S.globalMenuState.editing) {
            if (item && item.set && item.get) item.set(item.get());
            S.bpmWasEditing = false;
            S.lastSentMenuEditValue = null;
        }
    }

    /* Transpose preview self-heal: cancel a stranded preview/dialog if we've left
     * the Key/Scale edit by any path the edit-exit hook above doesn't cover (whole
     * menu closed, navigated away). */
    if (S.xposePrevKey !== null || S.confirmXpose) {
        const _it = (S.globalMenuOpen && S.globalMenuState && S.globalMenuItems)
                    ? S.globalMenuItems[S.globalMenuState.selectedIndex] : null;
        const _onKeyScale = !!(_it && S.globalMenuState.editing &&
                               (_it.label === 'Key' || _it.label === 'Scale'));
        if (S.confirmXpose) {
            /* dialog stranded by Back / menu close (Back isn't a jog-click) → cancel */
            if (!_onKeyScale) { S.confirmXpose = false; xposeCancelPreview(); }
        } else if (!_onKeyScale) {
            xposeCancelPreview();
        }
    }


    if (!S.ledInitComplete) {
        drainLedInit();
    } else {
        /* Bank select display timeout: State 3 → State 4 after ~2000ms */
        if (S.bankSelectTick >= 0 && (S.tickCount - S.bankSelectTick) >= BANK_DISPLAY_TICKS) {
            S.bankSelectTick = -1;
            S.screenDirty = true;
        }
        /* Overlay expiry: clear timer here so drawUI() can gate on flag alone */
        if (S.stretchBlockedEndTick >= 0 && S.tickCount >= S.stretchBlockedEndTick) {
            S.stretchBlockedEndTick = -1;
            S.screenDirty = true;
        }
        if (S.actionPopupEndTick >= 0 && S.tickCount >= S.actionPopupEndTick) {
            S.actionPopupEndTick = -1;
            S.screenDirty = true;
        }
        if (S.knobTouched >= 0 && S.knobTurnedTick[S.knobTouched] >= 0 &&
                (S.tickCount - S.knobTurnedTick[S.knobTouched]) >= KNOB_TURN_HIGHLIGHT_TICKS) {
            S.knobTouched = -1;
            S.screenDirty = true;
        }
        if (S.noNoteFlashEndTick >= 0 && S.tickCount >= S.noNoteFlashEndTick) {
            S.noNoteFlashEndTick = -1;
            S.screenDirty = true;
        }
        if (S.stepSaveFlashEndTick >= 0 && S.tickCount >= S.stepSaveFlashEndTick) {
            S.stepSaveFlashEndTick   = -1;
            S.stepSaveFlashStartTick = -1;
        }
        /* Session view hold-to-save: fire exactly when threshold reached, not on release */
        if (S.sessionStepHeld >= 0) {
            const _ssh = S.sessionStepHeld;
            if (S.tickCount - S.stepBtnPressedTick[_ssh] >= STEP_SAVE_HOLD_TICKS) {
                const _ctx = S.sessionStepHeldCtx;
                S.sessionStepHeld    = -1;
                S.sessionStepHeldCtx = 0;
                S.stepBtnPressedTick[_ssh] = -1;
                if (_ctx === 1) {
                    S.perfSnapshots[_ssh] = S.perfModsToggled | S.perfModsHeld;
                    showActionPopup('PERF PRESET', 'SAVED');
                } else {
                    const drumEffMutes = [];
                    for (let _t = 0; _t < NUM_TRACKS; _t++) {
                        const mMask = S.drumLaneMute[_t];
                        const sMask = S.drumLaneSolo[_t];
                        let effMask = mMask;
                        if (sMask) {
                            let notSoloed = 0;
                            for (let _l = 0; _l < DRUM_LANES; _l++) {
                                if (!(sMask & (1 << _l))) notSoloed |= (1 << _l);
                            }
                            effMask = (mMask | notSoloed) >>> 0;
                        }
                        drumEffMutes.push(effMask >>> 0);
                    }
                    S.snapshots[_ssh] = { mute: S.trackMuted.slice(), solo: S.trackSoloed.slice(), drumEffMute: drumEffMutes };
                    const mStr = S.trackMuted.map(function(m) { return m ? '1' : '0'; }).join(' ');
                    const sStr = S.trackSoloed.map(function(s) { return s ? '1' : '0'; }).join(' ');
                    const dStr = drumEffMutes.join(' ');
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('snap_save', _ssh + ' ' + mStr + ' ' + sStr + ' ' + dStr);
                    showActionPopup('MUTE STATE', 'SAVED');
                }
                S.stepSaveFlashStartTick = S.tickCount;
                S.stepSaveFlashEndTick   = S.tickCount + STEP_SAVE_FLASH_TICKS;
                forceRedraw();
            }
        }

        if ((S.tickCount % POLL_INTERVAL) === 0) { pollDSP(); S.screenDirty = true; }

        /* Schwung co-run: refresh the channel-matched slot bitmask for the
         * side-button blink (shadow_get_slots is a cheap shared-memory read;
         * gate to the poll cadence to match the LED force cadence). */
        if (S.schwungCoRunSlot >= 0 && (S.tickCount % POLL_INTERVAL) === 0) {
            S._coRunChanSlots = schSlotsForTrack(S.activeTrack);
        }

        /* Deferred Schwung co-run entry (queued by openSchwungSlotEditor). Resolve
         * the slot(s) the track plays through and open the first (lowest-index)
         * match. No match → show a "NO SLOT" popup, wait ~1s so it's readable
         * before the chain editor takes the OLED, then fall back to slot 1. */
        if (S.pendingSchwungCoRunTrack >= 0) {
            const _t = S.pendingSchwungCoRunTrack;
            if (S.schwungCoRunSlot >= 0 || _t !== S.activeTrack) {
                /* Already in co-run, or the user navigated to another track while a
                 * no-match entry was waiting out its popup — drop the queued entry
                 * rather than hijacking the OLED for a track they left. (Both entry
                 * paths queue S.activeTrack, so _t != activeTrack means a switch.) */
                S.pendingSchwungCoRunTrack = -1;
                S.pendingSchwungCoRunDelay = 0;
            } else if (S.pendingSchwungCoRunDelay > 0) {
                if (--S.pendingSchwungCoRunDelay === 0) {
                    S.pendingSchwungCoRunTrack = -1;
                    enterSchwungCoRun(_t, 0);  /* slot 1 fallback after the NO SLOT popup */
                }
            } else {
                const _msk = schSlotsForTrack(_t);
                if (_msk === 0) {
                    showActionPopup('NO SLOT', 'CH ' + (S.trackChannel[_t] | 0));
                    /* Enter right as the popup expires so there's no gap where the
                     * normal UI flashes before the editor takes the OLED. */
                    S.pendingSchwungCoRunDelay = ACTION_POPUP_TICKS;
                } else {
                    S.pendingSchwungCoRunTrack = -1;
                    S._coRunChanSlots = _msk;  /* seed the blink mask so it's right on frame 1 */
                    let _slot = 0;
                    while (_slot < 4 && !(_msk & (1 << _slot))) _slot++;
                    enterSchwungCoRun(_t, _slot);
                }
            }
        }

        /* Metro beat detection: checked every tick via dedicated get_param for minimal jitter */
        if (S.metronomeOn > 0) {
            const _mbcRaw = host_module_get_param('metro_beat_count');
            if (_mbcRaw !== null && _mbcRaw !== undefined) {
                const _mbc = parseInt(_mbcRaw, 10) | 0;
                if (_mbc !== S.metroPrevBeat) {
                    S.metroPrevBeat = _mbc;
                    playMetronomeClick();
                    if (S.recordCountingIn) S.countInBeatStartTick = S.tickCount;
                }
            }
        }

        /* Step hold threshold: once elapsed, close the tap window so release won't toggle.
         * Also auto-assign empty step now so knobs work immediately in step edit. */
        if (S.heldStep >= 0 && S.heldStepBtn >= 0 && S.stepBtnPressedTick[S.heldStepBtn] >= 0 &&
                (S.tickCount - S.stepBtnPressedTick[S.heldStepBtn]) >= STEP_HOLD_TICKS) {
            S.stepBtnPressedTick[S.heldStepBtn] = -1;
            S.stepWasHeld = true;
            if (S.activeBank === 6) {
                /* CC step-edit: seed from the recorded point at this step (or "—"),
                 * plus the computed output value the lane produces there. The first
                 * knob-turn writes from the recorded point if set; otherwise it starts
                 * from the step's interpolated value (what the lane already outputs
                 * there), so inserting a new breakpoint continues the existing curve
                 * instead of jumping to 0. Falls back to clip resting value, else 0. */
                const _t6 = S.activeTrack, _c6 = effectiveClip(_t6);
                const _info = (typeof host_module_get_param === 'function')
                    ? host_module_get_param('t' + _t6 + '_c' + _c6 + '_ccstepinfo_' + S.heldStep) : null;
                const _ip = _info ? _info.split(' ') : [];
                for (let _ck = 0; _ck < 8; _ck++) {
                    const _pv = _ip.length > _ck     ? parseInt(_ip[_ck], 10)     : -1;
                    const _cv = _ip.length > _ck + 8 ? parseInt(_ip[_ck + 8], 10) : -1;
                    S.ccStepEditSet[_ck]      = _pv >= 0;
                    S.ccStepEditComputed[_ck] = (_cv >= 0 && _cv <= 127) ? _cv : -1;
                    const _rest = S.clipCCVal[_t6][_c6][_ck];
                    S.ccStepEditVal[_ck] = _pv >= 0 ? _pv
                        : (_cv >= 0 && _cv <= 127 ? _cv
                           : (_rest >= 0 ? _rest : 0));
                }
                S.screenDirty = true;
            } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
                /* Drum: auto-assign empty step so knobs work immediately */
                if (S.stepWasEmpty && S.heldStepNotes.length === 0 && typeof host_module_set_param === 'function') {
                    const t    = S.activeTrack;
                    const lane = S.activeDrumLane[t];
                    host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_toggle', String(S.stepEditVel));
                    S.drumLaneSteps[t][lane][S.heldStep] = '1';
                    S.drumLaneHasNotes[t][lane] = true;
                    S.heldStepNotes = [S.drumLaneNote[t][lane]];
                    if (typeof host_module_get_param === 'function') {
                        const rv = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_vel');
                        const rg = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_gate');
                        const rn = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_nudge');
                        const ri = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_iter');
                        const rr = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_rand');
                        const rx = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_ratch');
                        S.stepEditVel   = rv !== null ? parseInt(rv, 10) : S.stepEditVel;
                        S.stepEditGate  = rg !== null ? parseInt(rg, 10) : (S.drumLaneTPS[t] || 24);
                        S.stepEditNudge = rn !== null ? parseInt(rn, 10) : 0;
                        S.stepEditIter  = ri !== null ? parseInt(ri, 10) : 0;
                        S.stepEditRand  = rr !== null ? parseInt(rr, 10) : 0;
                        S.stepEditRatch = rx !== null ? parseInt(rx, 10) : 0;
                    }
                } else if (S.drumHeldReadPending && typeof host_module_get_param === 'function') {
                    /* Occupied drum step: the press handler couldn't read the
                     * step's real vel/gate/nudge/iter/rand/ratch (get_param
                     * null in MIDI context) — read them now from tick context
                     * so inspect-only holds don't clobber velocity with the
                     * placeholder 100 at release (audit js-input-2). */
                    const t    = S.activeTrack;
                    const lane = S.activeDrumLane[t];
                    const rv = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_vel');
                    const rg = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_gate');
                    const rn = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_nudge');
                    const ri = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_iter');
                    const rr = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_rand');
                    const rx = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_ratch');
                    S.stepEditVel   = rv !== null ? parseInt(rv, 10) : S.stepEditVel;
                    S.stepEditGate  = rg !== null ? parseInt(rg, 10) : S.stepEditGate;
                    S.stepEditNudge = rn !== null ? parseInt(rn, 10) : S.stepEditNudge;
                    S.stepEditIter  = ri !== null ? parseInt(ri, 10) : S.stepEditIter;
                    S.stepEditRand  = rr !== null ? parseInt(rr, 10) : S.stepEditRand;
                    S.stepEditRatch = rx !== null ? parseInt(rx, 10) : S.stepEditRatch;
                    S.drumHeldReadPending = false;
                }
                S.screenDirty = true;
            } else if (!S.stepWasEmpty && S.heldStepNotes.length === 0) {
                /* Non-empty step — notes not yet read (get_param null at press time).
                 * Read now from tick context where get_param works. */
                const ac_h2 = effectiveClip(S.activeTrack);
                const raw_h2 = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + S.activeTrack + '_c' + ac_h2 + '_step_' + S.heldStep + '_notes') : null;
                S.heldStepNotes = (raw_h2 && raw_h2.trim().length > 0)
                    ? raw_h2.trim().split(' ').map(Number).filter(function(n) { return n >= 0 && n <= 127; })
                    : [];
                const rv2 = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + S.activeTrack + '_c' + ac_h2 + '_step_' + S.heldStep + '_vel') : null;
                const rg2 = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + S.activeTrack + '_c' + ac_h2 + '_step_' + S.heldStep + '_gate') : null;
                const rn2 = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + S.activeTrack + '_c' + ac_h2 + '_step_' + S.heldStep + '_nudge') : null;
                const ri2 = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + S.activeTrack + '_c' + ac_h2 + '_step_' + S.heldStep + '_iter') : null;
                const rr2 = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + S.activeTrack + '_c' + ac_h2 + '_step_' + S.heldStep + '_rand') : null;
                const rx2 = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + S.activeTrack + '_c' + ac_h2 + '_step_' + S.heldStep + '_ratch') : null;
                S.stepEditVel   = rv2 !== null ? parseInt(rv2, 10) : 100;
                S.stepEditGate  = rg2 !== null ? parseInt(rg2, 10) : 12;
                S.stepEditNudge = rn2 !== null ? parseInt(rn2, 10) : 0;
                S.stepEditIter  = ri2 !== null ? parseInt(ri2, 10) : 0;
                S.stepEditRand  = rr2 !== null ? parseInt(rr2, 10) : 0;
                S.stepEditRatch = rx2 !== null ? parseInt(rx2, 10) : 0;
                S.screenDirty = true;
            } else if (S.stepWasEmpty && S.heldStepNotes.length === 0) {
                /* Empty melodic step held past threshold: auto-activate with
                 * lastPlayedNote so step edit knobs work in one gesture (mirrors
                 * the drum-mode auto-assign above and the tap-empty path at
                 * ~L8589). If no lastPlayedNote, fall back to no-note flash. */
                if (S.activeBank === 6) {
                    /* CC bank: no note auto-assign */
                } else if (S.lastPlayedNote >= 0 && typeof host_module_set_param === 'function') {
                    const ac_he       = effectiveClip(S.activeTrack);
                    const assignNote  = S.lastPlayedNote;
                    const assignVel   = stepEntryVelocity(S.activeTrack, -1, false);
                    host_module_set_param('t' + S.activeTrack + '_c' + ac_he + '_step_' + S.heldStep + '_toggle',
                                          assignNote + ' ' + assignVel);
                    S.clipSteps[S.activeTrack][ac_he][S.heldStep] = 1;
                    S.clipNonEmpty[S.activeTrack][ac_he] = true;
                    S.heldStepNotes = [assignNote];
                    S.stepEditVel   = assignVel;
                    S.stepWasEmpty  = false;
                    refreshSeqNotesIfCurrent(S.activeTrack, ac_he, S.heldStep);
                } else {
                    S.noNoteFlashEndTick = S.tickCount + NO_NOTE_FLASH_TICKS;
                }
                S.screenDirty = true;
            }
        }

        /* Chord-first phase 2: replace notes with full chord — fires the tick AFTER phase 1.
         * Must come before phase 1 so both can't fire in the same tick and coalesce. */
        if (S.pendingChordPhase2 !== null) {
            const _cp2 = S.pendingChordPhase2;
            if (_cp2.pitches.length > 1 && typeof host_module_set_param === 'function') {
                host_module_set_param('t' + _cp2.t + '_c' + _cp2.ac + '_step_' + _cp2.step + '_set_notes',
                    _cp2.pitches.join(' '));
            }
            S.heldStepNotes = _cp2.pitches.slice();
            refreshSeqNotesIfCurrent(_cp2.t, _cp2.ac, _cp2.step);
            S.screenDirty = true;
            S.pendingChordPhase2 = null;
        }

        /* Chord-first phase 1: activate empty step with first chord pitch so _set_notes works next tick.
         * _set_notes is a no-op on empty steps, so _toggle must fire first to activate.
         * Context is self-contained — does not depend on heldStep (may fire after quick release).
         * Sets pendingChordPhase2 for the NEXT tick; phase 2 check above ensures they never coalesce. */
        if (S.pendingChordToStep !== null && S.activeBank !== 6) {
            const _cp1 = S.pendingChordToStep;
            if (_cp1.wasEmpty) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + _cp1.t + '_c' + _cp1.ac + '_step_' + _cp1.step + '_toggle',
                        _cp1.pitches[0] + ' ' + _cp1.vel);
                S.clipSteps[_cp1.t][_cp1.ac][_cp1.step] = 1;
                S.clipNonEmpty[_cp1.t][_cp1.ac] = true;
            }
            S.pendingChordPhase2 = _cp1;
            S.pendingChordToStep = null;
        }

        /* Refresh scene state cache for O(1) lookups in LED update functions */
        for (let _i = 0; _i < 16; _i++) {
            S.cachedSceneAllPlaying[_i] = sceneAllPlaying(_i);
            S.cachedSceneAllQueued[_i]  = sceneAllQueued(_i);
            S.cachedSceneAnyPlaying[_i] = sceneAnyPlaying(_i);
        }

        /* Transport LEDs */
        setButtonLED(MovePlay, S.playing ? Green : LED_OFF);
        if (S.schwungCoRunSlot >= 0 || S.moveCoRunTrack >= 0) {
            /* Co-run: keep Rec dark — you can't record while a co-run target owns
             * input, and in Move co-run Move firmware lights its own Record button
             * (passes through under skip_led_clear). Force OFF every POLL_INTERVAL
             * so our blanking re-asserts over that layer instead of being eaten. */
            setButtonLED(MoveRec, LED_OFF, (S.tickCount % POLL_INTERVAL) === 0);
        } else if (S.recordScheduledStop || S.recordPendingPage) {
            /* recordScheduledStop = waiting for end-of-page to stop; recordPendingPage =
             * waiting for next page boundary for DSP to flip recording=1. Both blink. */
            setButtonLED(MoveRec, Math.floor(S.tickCount / 8) % 2 === 0 ? Red : LED_OFF);
        } else if (S.dspMergeState === 2 || S.dspMergeState === 3) {
            /* Live Merge capturing (Shift+Rec): green. */
            setButtonLED(MoveRec, Green);
        } else if (S.dspMergeState === 1) {
            /* Live Merge armed, waiting for the bar boundary: red. */
            setButtonLED(MoveRec, Red);
        } else {
            /* Idle or CAPTURED (capture ended → LED off with Play). */
            setButtonLED(MoveRec, S.recordArmed ? Red : LED_OFF);
        }
        /* Sample = bake, always available: dim ambient (same as Capture idle). */
        setButtonLED(MoveSample, DarkGrey);
        /* Loop LED: flash White at 1/8 rate while Perf Mode view is locked (Session
         * View only) or drum repeat latched; VividYellow for latch mode; dim available
         * indicator (16) otherwise (always functional in both views). */
        {
            let loopColor = LED_OFF;
            const _lt = S.activeTrack;
            const _rptLatched = S.drumRepeatLatched[_lt] || S.drumRepeat2LatchedLanes[_lt].size > 0;
            /* TARP-latched indicator: when the active track has ARP IN on +
             * latched with notes in the buffer, blink the Loop button at the
             * arp's step-fire rate in the track color. fire_count is a DSP
             * monotonic counter — parity drives a 50% duty cycle synced to
             * each fired note. Gated to melodic tracks (TARP doesn't run on
             * drum) and yields to perfViewLocked / drum-rpt latch above. */
            let _tarpBlinkActive = false;
            let _tarpBlinkOn = false;
            if (!(S.sessionView && S.perfViewLocked) && !_rptLatched) {
                const _tarpOn = parseInt(host_module_get_param('t' + _lt + '_tarp_on'), 10) === 1;
                const _tarpLatch = parseInt(host_module_get_param('t' + _lt + '_tarp_latch'), 10) === 1;
                if (_tarpOn && _tarpLatch) {
                    const _fc = parseInt(host_module_get_param('t' + _lt + '_tarp_fc'), 10) || 0;
                    _tarpBlinkActive = true;
                    _tarpBlinkOn = (_fc % 2) === 0;
                }
            }
            if (S.sessionView && S.perfViewLocked) {
                loopColor = flashAtRate(48) ? White : LED_OFF;
            } else if (_rptLatched) {
                loopColor = flashAtRate(48) ? White : LED_OFF;
            } else if (_tarpBlinkActive) {
                loopColor = _tarpBlinkOn ? trackColor(_lt) : LED_OFF;
            } else if (S.sessionView && S.perfLatchMode) {
                loopColor = VividYellow;
            } else {
                /* Loop's LED renders palette colors brighter than Delete/Copy;
                 * scratch index 60 is a custom-RGB dim grey set in drainLedInit
                 * so Loop's ambient visually matches Delete/Copy at idx 16. */
                loopColor = 60;
            }
            setButtonLED(MoveLoop, loopColor);
        }
        /* Capture: blink White only when a tap would actually commit buffered
         * input (S.captureArmed — playing, or stopped in an empty session), dim
         * ambient otherwise. Blinking on stopped+non-empty (a no-op) misled. */
        setButtonLED(MoveCapture,
            S.captureArmed
                ? ((Math.floor(S.tickCount / 24) % 2) ? White : LED_OFF)
                : DarkGrey);
        {
            const _muted      = S.trackMuted[S.activeTrack];
            const _soloed     = S.trackSoloed[S.activeTrack];
            const _muteBlink  = Math.floor(S.tickCount / 24) % 2;
            setButtonLED(MoveMute, _muted ? 124 : (_soloed ? (_muteBlink ? 124 : 0) : 16));
        }
        /* Contextual button LEDs: dim available indicator (16) on actionable buttons. */
        setButtonLED(MoveShift,       16);
        setButtonLED(MoveNoteSession, 16);
        /* Session/Track view button. In Schwung co-run the CC 50 press AND its
         * LED are owned by the Schwung chain editor (Menu opens master/send FX,
         * editor paints it white via its LED queue) — NOT a dAVEBOx exit. We
         * can't win that LED (the editor's queue flush lands after us each
         * frame), so just paint White to agree rather than fight. In Move co-run
         * the button is disabled + dark; force OFF to override Move firmware.
         * Global Menu / Tap Tempo keep the blink (no competing LED layer). */
        if (S.schwungCoRunSlot >= 0) {
            setButtonLED(MoveNoteSession, White, (S.tickCount % POLL_INTERVAL) === 0);
        } else if (S.moveCoRunTrack >= 0) {
            /* Move co-run: the Menu button is disabled (Step 3 / Back are the
             * exits), so keep its LED dark. Force OFF every POLL_INTERVAL to
             * override Move firmware's pass-through writes. */
            setButtonLED(MoveNoteSession, LED_OFF, (S.tickCount % POLL_INTERVAL) === 0);
        } else if (S.globalMenuOpen || S.tapTempoOpen) {
            const _exitBlink = (Math.floor(S.tickCount / 24) % 2) ? 16 : LED_OFF;
            setButtonLED(MoveNoteSession, _exitBlink);
        }
        setButtonLED(MoveUndo,        16);
        setButtonLED(MoveDelete,      16);
        setButtonLED(MoveCopy,        16);
        setButtonLED(MoveUp,          16);
        setButtonLED(MoveDown,        16);
        setButtonLED(MoveLeft,  S.sessionView ? LED_OFF : 16);
        setButtonLED(MoveRight, S.sessionView ? LED_OFF : 16);
        /* Shift-flash: buttons with a Shift-modified function blink 16/OFF while Shift is held.
         * Sample uses DarkGrey/OFF since index 16 (RoyalBlue) shows wrong on that button. */
        if (S.shiftHeld) {
            const _sf  = (Math.floor(S.tickCount / 24) % 2) ? 16 : LED_OFF;
            setButtonLED(MoveNoteSession, _sf);
            /* Shift+Rec = Live Merge; blink Rec only while merge is idle (an
             * active merge already owns the LED with its red/green state). */
            if (S.dspMergeState === 0 && !S.recordArmed)
                setButtonLED(MoveRec, (Math.floor(S.tickCount / 24) % 2) ? Red : LED_OFF);
            setButtonLED(MoveUndo,        _sf);
            setButtonLED(MoveCopy,        _sf);
            if (S.sessionView)  setButtonLED(MoveLoop, _sf);
            if (!S.sessionView) setButtonLED(MoveMute, _sf);
        }

        if (S.sessionView) {
            updateSessionLEDs();
            if (S.loopHeld || S.perfViewLocked) updatePerfModeLEDs();
            else updateSceneMapLEDs();
        } else {
            updateStepLEDs();
            /* Count-in flash: blink all step buttons white at quarter-note rate */
            if (S.recordArmed && S.recordCountingIn && S.countInQuarterTicks > 0) {
                const elapsed  = S.tickCount - S.countInBeatStartTick;
                const flashOn  = (elapsed % S.countInQuarterTicks) < (S.countInQuarterTicks >> 3);
                const flashClr = flashOn ? White : LED_OFF;
                for (let _i = 0; _i < 16; _i++) setLED(16 + _i, flashClr);
            }
        }
        updateTrackLEDs();

        /* Session overview blink: mark dirty when animation state toggles */
        if (S.sessionOverlayHeld) {
            const blinkOn = S.flashEighth;
            if (blinkOn !== S.lastBlinkOn) { S.lastBlinkOn = blinkOn; S.screenDirty = true; }
        } else {
            S.lastBlinkOn = null;
        }

        /* Solo blink: mark dirty when blink toggles and any track is soloed */
        if (S.trackSoloed.some(function(s) { return s; })) {
            const _sb = Math.floor(S.tickCount / 24) % 2;
            if (_sb !== S.lastSoloBlink) { S.lastSoloBlink = _sb; S.screenDirty = true; }
        } else {
            S.lastSoloBlink = null;
        }

        /* Loop jog OOB view: revert to pages view after ~500ms of inactivity */
        if (S.loopJogActive && S.loopHeld && S.loopJogLastTick !== undefined) {
            if ((S.tickCount - S.loopJogLastTick) > 70) {
                S.loopJogActive = false;
                S.screenDirty = true;
            }
        }

        /* ALL LANES blink: mark dirty when "ALL" blink toggles (bank header + loop-held overlay) */
        if (S.activeBank === 7 && S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            const _ab = Math.floor(S.tickCount / 24) % 2;
            if (_ab !== S.lastAllLanesBlink) { S.lastAllLanesBlink = _ab; S.screenDirty = true; }
        } else {
            S.lastAllLanesBlink = null;
        }
    }
    /* Flush buffered recording events — one batched set_param per tick to survive coalescing.
     * Note-ons take priority; note-offs wait until the next tick if both are pending.
     * Ext-origin entries (external cable-2 MIDI) carry a PER-NOTE 'e' marker in the
     * payload ("e64 100"): the DSP handlers use slot-if-active-else-fallback for
     * ext notes (non-Move ext never reaches on_midi, so no press slot exists) while
     * plain pad notes keep the slot requirement. A batch can mix pad + ext. */
    if (S.recordArmed && !S.recordCountingIn && typeof host_module_set_param === 'function') {
        if (S._recNoteOns.length > 0) {
            const rt   = S._recNoteOns[0].rt;
            const pairs = S._recNoteOns.map(function(n) { return (n.ext ? 'e' : '') + n.pitch + ' ' + n.vel; }).join(' ');
            host_module_set_param('t' + rt + '_record_note_on', pairs);
            S._recNoteOns.length = 0;
        } else if (_drumRecNoteOns.length > 0) {
            /* Batch all queued drum note-ons (same recordArmedTrack) into one
             * payload so a chord-press lands in DSP in a single audio buffer
             * rather than trickling out one-per-tick. */
            const rt = _drumRecNoteOns[0].track;
            const pairs = _drumRecNoteOns.map(function(n) { return (n.ext ? 'e' : '') + n.laneNote + ' ' + n.vel; }).join(' ');
            host_module_set_param('t' + rt + '_drum_record_note_on', pairs);
            _drumRecNoteOns.length = 0;
        } else if (S._recNoteOffs.length > 0) {
            const rt     = S._recNoteOffs[0].rt;
            const pitches = S._recNoteOffs.map(function(n) { return (n.ext ? 'e' : '') + n.pitch; }).join(' ');
            host_module_set_param('t' + rt + '_record_note_off', pitches);
            S._recNoteOffs.length = 0;
        } else if (_drumRecNoteOffs.length > 0) {
            const rt = _drumRecNoteOffs[0].track;
            const pitches = _drumRecNoteOffs.map(function(n) { return (n.ext ? 'e' : '') + n.laneNote; }).join(' ');
            host_module_set_param('t' + rt + '_drum_record_note_off', pitches);
            _drumRecNoteOffs.length = 0;
        } else if (S.pendingPrerollGate !== null) {
            const pg = S.pendingPrerollGate;
            S.pendingPrerollGate = null;
            /* Write to the first step of the loop window — playback starts at loop_start,
             * not at absolute step 0. */
            if (pg.isDrum) {
                const _ls = S.drumLaneLoopStart[pg.track] | 0;
                host_module_set_param('t' + pg.track + '_l' + pg.lane + '_step_' + _ls + '_gate', String(pg.gate));
            } else {
                const _ls = S.clipLoopStart[pg.track][pg.clip] | 0;
                host_module_set_param('t' + pg.track + '_c' + pg.clip + '_step_' + _ls + '_gate', String(pg.gate));
            }
        } else if (S.pendingPrerollToggleQueue.length > 0) {
            const _ptq = S.pendingPrerollToggleQueue.shift();
            const _ls = S.clipLoopStart[_ptq.track][_ptq.clip] | 0;
            host_module_set_param('t' + _ptq.track + '_c' + _ptq.clip + '_step_' + _ls + '_toggle', _ptq.pitch + ' ' + _ptq.vel);
            if (_ptq.last)
                S.pendingPrerollGate = { isDrum: false, track: _ptq.track, clip: _ptq.clip, gate: _ptq.gate };
        } else if (S.pendingPrerollNote !== null && S.playing) {
            const pr = S.pendingPrerollNote;
            const _prLive = S.liveActiveNotes.has(pr.laneNote);
            if (pr.isDrum) {
                const tps = S.drumLaneTPS[pr.track] || 24;
                const elapsed = S.tickCount - S.transportStartTick;
                /* Wait for note released AND one step elapsed (skip first loop pass to avoid double-trigger) */
                if (!_prLive && elapsed >= tps) {
                    S.pendingPrerollNote = null;
                    const _ls = S.drumLaneLoopStart[pr.track] | 0;
                    if (S.drumLaneSteps[pr.track][pr.lane][_ls] === '0') {
                        const countInDur = S.transportStartTick - pr.countInStart;
                        const dspPerJs = countInDur > 0 ? 384 / countInDur : 4;
                        const pressedDur = (pr.releasedAtTick || S.tickCount) - pr.pressedAtTick;
                        const gate = Math.max(1, Math.min(tps * 16, Math.round(pressedDur * dspPerJs)));
                        host_module_set_param('t' + pr.track + '_l' + pr.lane + '_step_' + _ls + '_toggle', String(pr.vel));
                        S.pendingPrerollGate = { isDrum: true, track: pr.track, lane: pr.lane, gate };
                        S.drumLaneSteps[pr.track][pr.lane][_ls] = '1';
                        S.drumLaneHasNotes[pr.track][pr.lane] = true;
                        invalidateLEDCache();
                        forceRedraw();
                    }
                }
            }
        } else if (S.pendingPrerollNotes.length > 0 && S.playing) {
            const pns = S.pendingPrerollNotes;
            const pr  = pns[0];
            /* TARP-on: DSP tarp_fire_step records arp output to clip directly. Skip
             * JS preroll capture so a held chord becomes an arpeggiated sequence
             * across steps instead of a chord stamped on step 0. */
            const _tarpOn = parseInt(host_module_get_param('t' + pr.track + '_tarp_on'), 10) === 1;
            if (_tarpOn) {
                S.pendingPrerollNotes       = [];
                S.pendingPrerollToggleQueue = [];
                S.pendingPrerollGate        = null;
            } else {
            const _prLive = pns.some(function(n) { return S.liveActiveNotes.has(n.pitch); });
            const tps = (S.clipTPS[pr.track] && S.clipTPS[pr.track][pr.clip]) || 24;
            const elapsed = S.tickCount - S.transportStartTick;
            /* Wait for all chord notes released AND one step elapsed */
            if (!_prLive && elapsed >= tps) {
                S.pendingPrerollNotes = [];
                const _ls = S.clipLoopStart[pr.track][pr.clip] | 0;
                if (S.clipSteps[pr.track][pr.clip][_ls] === 0) {
                    const countInDur = S.transportStartTick - pr.countInStart;
                    const dspPerJs   = countInDur > 0 ? 384 / countInDur : 4;
                    const lastRel    = pns.reduce(function(m, n) { return Math.max(m, n.releasedAtTick || S.tickCount); }, 0);
                    const pressedDur = lastRel - pr.pressedAtTick;
                    const gate       = Math.max(1, Math.min(tps * 16, Math.round(pressedDur * dspPerJs)));
                    host_module_set_param('t' + pr.track + '_c' + pr.clip + '_step_' + _ls + '_toggle', pr.pitch + ' ' + pr.vel);
                    if (pns.length === 1) {
                        S.pendingPrerollGate = { isDrum: false, track: pr.track, clip: pr.clip, gate };
                    } else {
                        for (let _qi = 1; _qi < pns.length; _qi++) {
                            S.pendingPrerollToggleQueue.push({
                                track: pns[_qi].track, clip: pns[_qi].clip,
                                pitch: pns[_qi].pitch,  vel: pns[_qi].vel,
                                gate, last: _qi === pns.length - 1
                            });
                        }
                    }
                    S.clipSteps[pr.track][pr.clip][_ls] = 1;
                    S.clipNonEmpty[pr.track][pr.clip] = true;
                    invalidateLEDCache();
                    forceRedraw();
                }
            }
            }
        } else {
            /* No note event this tick — safe to send a length set_param without coalescing. */
            const _art = S.recordArmedTrack >= 0 ? S.recordArmedTrack : S.activeTrack;
            const _arac = S.trackActiveClip[_art];
            const _arDrum = S.trackPadMode[_art] === PAD_MODE_DRUM;
            if (S.pendingScheduledDisarm) {
                /* Tick 2: send tN_recording=0 alone (length was locked last tick) */
                S.pendingScheduledDisarm = false;
                disarmRecord();
            } else if (S.recordScheduledStop) {
                /* Tick 1: lock clip length at page boundary; disarm deferred to next tick */
                const _sStp = _arDrum ? S.drumCurrentStep[_art] : S.trackCurrentStep[_art];
                if (_sStp >= 0 && _sStp >= S.recordScheduledStopTarget - 1) {
                    const _lockLen = S.recordScheduledStopTarget;
                    if (_arDrum) {
                        S.drumLaneLength[_art] = _lockLen;
                        host_module_set_param('t' + _art + '_all_lanes_length', String(_lockLen));
                    } else {
                        S.clipLength[_art][_arac] = _lockLen;
                        host_module_set_param('t' + _art + '_c' + _arac + '_length', String(_lockLen));
                    }
                    S.clipAdaptiveMode[_art][_arac] = false;
                    S.recordScheduledStop           = false;
                    S.recordScheduledStopTarget     = -1;
                    S.pendingScheduledDisarm        = true;
                }
            } else if (S.clipAdaptiveMode[_art][_arac]) {
                /* Adaptive extend: grow clip by one page when approaching boundary */
                if (_arDrum) {
                    const _adCur = S.drumLaneLength[_art];
                    const _adStp = S.drumCurrentStep[_art];
                    if (_adStp >= 0 && _adCur > 0 && _adCur < 256 && _adStp >= _adCur - 4) {
                        const _adNew = _adCur + 16;
                        S.drumLaneLength[_art] = _adNew;
                        host_module_set_param('t' + _art + '_all_lanes_length', String(_adNew));
                    }
                } else {
                    const _adCur = S.clipLength[_art][_arac];
                    const _adStp = S.trackCurrentStep[_art];
                    if (_adStp >= 0 && _adCur > 0 && _adCur < 256 && _adStp >= _adCur - 4) {
                        const _adNew = _adCur + 16;
                        S.clipLength[_art][_arac] = _adNew;
                        host_module_set_param('t' + _art + '_c' + _arac + '_length', String(_adNew));
                    }
                }
            }
        }
    }

    /* Suspend save: fires last so no subsequent set_param can overwrite it.
     * Quit/Shift+Back use the else-if branches below so the exit/hide call
     * only runs on a tick AFTER the save set_param has reached DSP — same-tick
     * exit would tear the module down before the buffer processes the save. */
    if (S.pendingSuspendSave && typeof host_module_set_param === 'function') {
        S.pendingSuspendSave = false;
        updateNameIndex();
        host_module_set_param('save', '1');
    } else if (S.pendingExitAfterSave) {
        S.pendingExitAfterSave = false;
        removeFlagsWrap();
        S.ledInitComplete = false;
        invalidateLEDCache();
        clearAllLEDs();
        for (let _i = 0; _i < 4; _i++) setButtonLED(40 + _i, LED_OFF);
        if (typeof host_exit_module === 'function') host_exit_module();
    } else if (S.pendingHideAfterSave) {
        S.pendingHideAfterSave = false;
        removeFlagsWrap();
        S.ledInitComplete = false;
        invalidateLEDCache();
        clearAllLEDs();
        for (let _i = 0; _i < 4; _i++) setButtonLED(40 + _i, LED_OFF);
        if (typeof host_hide_module === 'function') host_hide_module();
    } else if (S.pendingSnapshotCopy) {
        /* One tick after the 'save' above flushed live state to disk
         * synchronously — copy it into the snapshot + update manifest. */
        const _sc = S.pendingSnapshotCopy;
        S.pendingSnapshotCopy = null;
        commitSnapshot(S.currentSetUuid, _sc.id, _sc.label);
    }

    /* Orphan prune: clean up set_state/<uuid>/seq8-*.json for sets that no
     * longer exist on disk. Defer until any state_load + initial sync settles
     * so the prune set_param doesn't collide with state_load coalescing. */
    if (S.pendingPruneOrphans && !S.pendingSetLoad && S.pendingDspSync === 0 &&
            typeof host_module_set_param === 'function') {
        S.pendingPruneOrphans = false;
        host_module_set_param('prune_orphan_states', '1');
        /* Drop stale entries from the in-memory index so subsequent inheritance
         * lookups don't find UUIDs whose state file is about to be removed. */
        if (!S.nameIndexCache) S.nameIndexCache = loadNameIndex();
        let _dropped = false;
        for (const _nm in S.nameIndexCache) {
            const _u = S.nameIndexCache[_nm];
            if (_u && typeof host_file_exists === 'function'
                    && !host_file_exists(uuidToStatePath(_u))) {
                delete S.nameIndexCache[_nm];
                _dropped = true;
            }
        }
        if (_dropped) saveNameIndex(S.nameIndexCache);
    }

    /* Drive the alt-mode arrow flash: repaint on each blink-phase edge so the
     * down-arrow animates even when the UI is otherwise idle. Covers both altMode
     * (most alt banks) and stepIntervalMode (Arp Steps overlay on melodic 4/5). */
    if (altIndicatorActive(S.activeTrack, S.activeBank) ||
            (!S.sessionView && S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT)) {
        const _ph = Math.floor(S.tickCount / 24) % 2;
        if (_ph !== S._altBlinkPhase) { S._altBlinkPhase = _ph; S.screenDirty = true; }
    }
    if (S.screenDirty && !isSuspended) { S.screenDirty = false; drawUI(); }

};

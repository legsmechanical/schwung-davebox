import { S } from './ui_state.mjs';
import {
    NUM_STEPS, NUM_TRACKS, LED_OFF, LEDS_PER_FRAME,
    TRACK_COLORS, TRACK_DIM_COLORS, TRACK_PAD_BASE, SCENE_BTN_FLASH_TICKS,
    PAD_MODE_DRUM, BANKS,
    POLL_INTERVAL, TAP_TEMPO_FLASH_TICKS, PARAM_LED_BANKS,
    SEQ8_NAV_FLAGS
} from './ui_constants.mjs';
import { trackClipHasContent, updateSceneMapLEDs } from './ui_scene.mjs';
import { arpVelLevel } from './ui_pure.mjs';
import {
    White, Red, Green, Blue, DarkBlue, LightGrey, DarkGrey, Cyan, PurpleBlue, VividYellow,
    DeepRed, DeepGreen, DeepMagenta, Mustard
} from '/data/UserData/schwung/shared/constants.mjs';
import { setLED, setButtonLED } from '/data/UserData/schwung/shared/input_filter.mjs';

const lastSentNoteLED   = new Array(128).fill(-1);
const lastSentButtonLED = new Array(128).fill(-1);

function clipHasActiveNotes(t, c) {
    const s = S.clipSteps[t][c];
    for (let i = 0; i < NUM_STEPS; i++) if (s[i] === 1) return true;
    return false;
}

/* When stopped with a clip queued, Track View should operate on the queued clip. */
export function effectiveClip(t) {
    const qc = S.trackQueuedClip[t];
    return (!S.playing && qc >= 0) ? qc : S.trackActiveClip[t];
}

function effectiveDrumMute(t, l) {
    const bit = 1 << l;
    if (S.drumLaneMute[t] & bit) return true;
    if (S.drumLaneSolo[t] && !(S.drumLaneSolo[t] & bit)) return true;
    return false;
}

function cachedSetLED(note, color) {
    if (lastSentNoteLED[note] === color) return;
    lastSentNoteLED[note] = color;
    setLED(note, color);
}

function cachedSetButtonLED(cc, color) {
    if (lastSentButtonLED[cc] === color) return;
    lastSentButtonLED[cc] = color;
    setButtonLED(cc, color);
}

export function invalidateLEDCache() {
    lastSentNoteLED.fill(-1);
    lastSentButtonLED.fill(-1);
}

/* Track color. (Conductor tracks formerly forced white — dropped as confusing;
 * the Conductor now keeps its pre-assigned per-index track color.) Helpers kept
 * as the single color-lookup seam in case per-track color overrides return. */
export function trackColor(t)    { return TRACK_COLORS[t]; }
export function trackDimColor(t) { return TRACK_DIM_COLORS[t]; }

/* Co-run side clip buttons (CC 40-43): blink the buttons whose bit is set in
 * `litMask` (bit 0 = TOP = CC 43 .. bit 3 = bottom = CC 40) between dark-grey and
 * light-grey; the rest stay dark grey. Shared by Schwung co-run (mask = slots
 * receiving the track's channel) and Move co-run (single paired track) so the
 * blink rate, colors, and force cadence stay in one place. */
export function paintCoRunSideButtons(litMask, force) {
    const blinkOn = (Math.floor(Date.now() / 250) % 2) === 1;
    for (let i = 0; i < 4; i++) {
        const lit = (litMask >> i) & 1;
        setButtonLED(43 - i, lit ? (blinkOn ? LightGrey : DarkGrey) : DarkGrey, force);
    }
}

export function updateStepLEDs() {
    if (!S.ledInitComplete) return;

    /* Co-run (Schwung chain-edit or Move-native): the co-run target owns the
     * surface, so blank the step button main LEDs — except Step 3 (index 2),
     * which blinks dark-grey/bright-white at a steady rate as the "Edit Slot/Synth"
     * affordance. Return early so the normal step grid neither paints nor burns
     * LED budget (see SCHWUNG_DAVEBOX_LIMITATIONS.md §14). */
    if (S.schwungCoRunSlot >= 0 || S.moveCoRunTrack >= 0) {
        /* Blink off wall-clock, NOT tickCount: dAVEBOx's tick() runs at a slower
         * wall-clock rate in Schwung co-run (the host also services Schwung's
         * chain editor) than in Move co-run, so a tickCount-based blink looks
         * slower in Schwung. ~250ms half-period ≈ the Move-co-run feel of the
         * old tickCount/24 at ~94Hz. Date.now() works on-device (see ui.js). */
        const _blinkOn = (Math.floor(Date.now() / 250) % 2) === 1;
        /* Force-resend every POLL_INTERVAL so the blanking re-asserts over the
         * other layer's writes — Move firmware paints these step buttons (its
         * own LED writes pass through under skip_led_clear, e.g. red on track 1)
         * in Move co-run, and the shim's overtake LED loop eats the blink's lit
         * phase in Schwung co-run (making it look slower). Mirrors the step-icon
         * force below. Without it our LED_OFF lands once then loses to that layer. */
        const _force = (S.tickCount % POLL_INTERVAL) === 0;
        for (let i = 0; i < 16; i++) {
            setLED(16 + i, i === 2 ? (_blinkOn ? White : DarkGrey) : LED_OFF, _force);
        }
        return;
    }

    const ac = effectiveClip(S.activeTrack);

    /* Loop-held pages view (no jog active): 16 step buttons = 16 possible 16-step pages.
     * Pages with notes within the window → pulse; empty in-window pages → solid track color;
     * out-of-window pages → off. Held start page during the range gesture lights bright
     * white as a "waiting for end tap" affordance. */
    if (S.loopHeld && !S.loopJogActive &&
            !(S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7 && !S.allLanesConfirmed)) {
        const t = S.activeTrack;
        const tCol = trackColor(t);
        const pulsOn = S.playing ? S.flashSixteenth : (Math.floor(S.tickCount / 24) % 2);
        const gestureHeldPage = (S.loopGestureStart >= 0 && S.loopGestureTrack === t) ? S.loopGestureStart : -1;
        if (S.trackPadMode[t] === PAD_MODE_DRUM && S.activeBank !== 6) {
            const lane = S.activeDrumLane[t];
            const len  = S.drumLaneLength[t];
            const lsBase = S.drumLaneLoopStart[t] | 0;
            const ls   = S.drumLaneSteps[t][lane];
            const startPage = lsBase >> 4;
            const endPage   = startPage + Math.ceil(len / 16) - 1;
            for (let p = 0; p < 16; p++) {
                let color;
                if (p === gestureHeldPage) {
                    color = White;
                } else if (p < startPage || p > endPage) {
                    color = LED_OFF;
                } else {
                    const base = p * 16;
                    const end  = Math.min(base + 16, lsBase + len);
                    let hasNotes = false;
                    for (let s = base; s < end; s++) {
                        if (ls[s] !== '0') { hasNotes = true; break; }
                    }
                    color = hasNotes ? (pulsOn ? tCol : LED_OFF) : tCol;
                }
                setLED(16 + p, color);
            }
        } else {
            var _ccLen = 0, _ccLs = 0;
            if (S.activeBank === 6) {
                var _ccL = S.ccActiveLane[t];
                _ccLen = S.ccLaneLength[t][ac][_ccL];
                _ccLs  = S.ccLaneLoopStart[t][ac][_ccL] | 0;
            }
            const len    = _ccLen > 0 ? _ccLen : S.clipLength[t][ac];
            const lsBase = _ccLen > 0 ? _ccLs : (S.clipLoopStart[t][ac] | 0);
            const steps  = S.clipSteps[t][ac];
            const startPage = lsBase >> 4;
            const endPage   = startPage + Math.ceil(len / 16) - 1;
            for (let p = 0; p < 16; p++) {
                let color;
                if (p === gestureHeldPage) {
                    color = White;
                } else if (p < startPage || p > endPage) {
                    color = LED_OFF;
                } else {
                    const base = p * 16;
                    const end  = Math.min(base + 16, lsBase + len);
                    let hasNotes = false;
                    for (let s = base; s < end; s++) {
                        if (steps[s] !== 0) { hasNotes = true; break; }
                    }
                    color = hasNotes ? (pulsOn ? tCol : LED_OFF) : tCol;
                }
                setLED(16 + p, color);
            }
        }
        return;
    }

    /* Shift overlay: suppress step state; blink shortcut hints and return early to keep
     * MIDI traffic low (avoids queue overflow that breaks hardware button LED blinking).
     * Exception: while Shift is held and the Shft/Res knob is being touched on a bank
     * where the shift modifier applies (CLIP bank 0 = Shft+Res; ALL LANES bank 7 = Shft
     * only, no Res), fall through to normal step LEDs so the grid is visible.
     * Exception: when another modifier is also held (Shift+Mute/Delete/Copy/Loop forms
     * a different compound gesture), the step row no longer carries the shift-shortcut
     * semantic — drop the hint overlay so the step grid stays visible. */
    const _compoundHeld = S.muteHeld || S.deleteHeld || S.copyHeld || S.loopHeld;
    if (S.shiftHeld && !_compoundHeld) {
        const _kt = S.knobTouched;
        const _knobShiftMode =
            (S.activeBank === 0 && (_kt === 1 || _kt === 2)) ||
            (S.activeBank === 7 && _kt === 1);
        if (!_knobShiftMode) {
            const isDrum = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM;
            const _allLanesLocked = isDrum && S.activeBank === 7 && !S.allLanesConfirmed;
            for (let i = 0; i < 16; i++) {
                let on = i === 1 || i === 2 || (i >= 4 && i <= 6) || i === 8;
                if (i === 7 || i === 9 || (i === 10 && !isDrum) || i === 14
                    || (i === 15 && S.activeBank !== 6)) on = true;
                /* ALL LANES unconfirmed: gated double-fill (15) / quantize (16)
                 * shortcuts stay dark — don't advertise a blocked action. */
                if (_allLanesLocked && (i === 14 || i === 15)) on = false;
                setLED(16 + i, on ? LightGrey : LED_OFF);
            }
            return;
        }
    }

    /* Drum mode: step buttons show active lane's steps — identical visualization to melodic.
     * On the AUTO bank (6) drum falls through to the CC-automation gradient block below,
     * so drum AUTO shows the CC gradient/playhead, not drum-lane state (parity w/ melodic). */
    if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank !== 6) {
        const t    = S.activeTrack;
        const lane = S.activeDrumLane[t];
        const ls   = S.drumLaneSteps[t][lane];
        const cs   = S.drumCurrentStep[t];
        const page = S.drumStepPage[t];
        const base = page * 16;
        const len    = S.drumLaneLength[t];
        const lsBase = S.drumLaneLoopStart[t] | 0;
        const winEnd = lsBase + len;

        for (let i = 0; i < 16; i++) {
            const absStep = base + i;
            let color;
            if (absStep < lsBase || absStep >= winEnd) color = DarkGrey;
            else if (S.playing && absStep === cs)      color = White;
            else if (ls[absStep] === '1')              color = trackColor(t);
            else                                       color = (S.beatMarkersEnabled && i % 4 === 0) ? trackDimColor(t) : LED_OFF;
            setLED(16 + i, color);
        }
        /* Gate span overlay: fixed index 56 across the steps the held note sounds
         * on = ceil(gate/tps) (gate of exactly N steps covers 0..N-1, not N). */
        if (S.heldStep >= 0 && S.heldStepNotes.length > 0) {
            const _sTps  = S.drumLaneTPS[t] || 24;
            const _sSpan = Math.ceil(S.stepEditGate / _sTps);
            for (let i = 0; i < 16; i++) {
                const absStep = base + i;
                if (absStep < lsBase || absStep >= winEnd) continue;
                const offset = (absStep - S.heldStep + len) % len;
                if (offset < _sSpan) setLED(16 + i, 56);
            }
        }
        /* Gate overlay: K1 (Dur) touched in drum step edit — White=full, DarkGrey=partial */
        if (S.heldStep >= 0 && S.knobTouched === 0 && S.heldStepNotes.length > 0) {
            const _dTps      = S.drumLaneTPS[t] || 24;
            const _fullSteps = Math.floor(S.stepEditGate / _dTps);
            const _partTicks = S.stepEditGate % _dTps;
            for (let i = 0; i < 16; i++) {
                const absStep = base + i;
                if (absStep < lsBase || absStep >= winEnd) continue;
                const offset = (absStep - S.heldStep + len) % len;
                if (offset < _fullSteps) {
                    setLED(16 + i, White);
                } else if (offset === _fullSteps && _partTicks > 0) {
                    setLED(16 + i, DarkGrey);
                }
            }
        }
        /* Copy-source blink: step-to-step copy waiting for destination (drum lane) */
        if (S.copyHeld && S.copySrc && (S.copySrc.kind === 'step' || S.copySrc.kind === 'cut_step') && Math.floor(S.copySrc.absStep / 16) === page) {
            const btnIdx = S.copySrc.absStep % 16;
            setLED(16 + btnIdx, (Math.floor(S.tickCount / 24) % 2) ? White : LED_OFF);
        }
        return;
    }

    /* CC bank: step LEDs show the active lane's automation as a warm gradient
     * (7 levels: val=0 → dim, rising through yellow/orange/red to full white).
     * "—"=off; playhead = track color; out-of-window = DarkGrey. */
    if (S.activeBank === 6) {
        const CC_GRAD = [76, 29, 29, 3, 4, 67, 127];
        const t    = S.activeTrack;
        const c    = ac;
        const lane = S.ccActiveLane[t] | 0;
        /* trackCurrentPage drives the displayed page on the AUTO bank for both
         * melodic AND drum (page-nav + step-press route through the CC path on
         * bank 6 so the per-CC-lane loop window works identically to melodic). */
        const pg   = S.trackCurrentPage[t];
        const csCC = S.trackCurrentStep[t];
        var _ccLenCC = S.ccLaneLength[t][c][lane];
        var _ccLsCC  = _ccLenCC > 0 ? (S.ccLaneLoopStart[t][c][lane] | 0)
                                     : (S.clipLoopStart[t][c] | 0);
        var _ccWinEnd = _ccLsCC + (_ccLenCC > 0 ? _ccLenCC : S.clipLength[t][c]);
        var _ccPlayStep = -1;
        if (S.playing) {
            var _dispTps = S.ccLaneTps[t][c][lane] || (S.clipTPS[t][c] || 24);
            var _speedTps = S.ccLaneResTps[t][c][lane] || _dispTps;
            var _effLen = _ccLenCC > 0 ? _ccLenCC : S.clipLength[t][c];
            var _lLenTicks = _effLen * _speedTps;
            var _lTickPos = S.masterPos % _lLenTicks;
            var _progress = _lTickPos / _lLenTicks;
            _ccPlayStep = _ccLsCC + Math.floor(_progress * _effLen);
        }
        const key = t + '_' + c + '_' + lane + '_' + pg;
        if (key !== S.ccGradKey || (S.tickCount % POLL_INTERVAL) === 0) {
            var raw = (typeof host_module_get_param === 'function')
                ? host_module_get_param('t' + t + '_c' + c + '_ccsv_' + lane + '_' + pg) : null;
            if (raw) {
                var parts = raw.split(' ');
                for (let s = 0; s < 16; s++) {
                    var v = s < parts.length ? parseInt(parts[s], 10) : 255;
                    S.ccGradVals[s] = (v >= 0 && v <= 127) ? v : 255;
                }
            }
            var bpRaw = (typeof host_module_get_param === 'function')
                ? host_module_get_param('t' + t + '_c' + c + '_ccbp_' + lane + '_' + pg) : null;
            if (bpRaw) {
                var bpParts = bpRaw.split(' ');
                for (let s = 0; s < 16; s++)
                    S.ccGradHasBP[s] = s < bpParts.length ? (bpParts[s] === '1') : false;
            } else {
                for (let s = 0; s < 16; s++) S.ccGradHasBP[s] = false;
            }
            S.ccGradKey = key;
        }
        const _blip = (S.tickCount % 47) < 4;
        const baseCC = pg * 16;
        for (let i = 0; i < 16; i++) {
            const absStep = baseCC + i;
            let color;
            if (absStep < _ccLsCC || absStep >= _ccWinEnd) {
                color = DarkGrey;
            } else if (absStep === _ccPlayStep) {
                color = White;
            } else {
                const v = S.ccGradVals[i];
                if (v >= 0 && v <= 127) {
                    if (_blip && S.ccGradHasBP[i]) { color = LED_OFF; }
                    else {
                    const level = v === 0 ? 0 : Math.min(6, 1 + Math.floor((v - 1) * 6 / 127));
                    color = CC_GRAD[level]; }
                } else {
                    color = LED_OFF;
                }
            }
            setLED(16 + i, color);
        }
        return;
    }

    const steps  = S.clipSteps[S.activeTrack][ac];
    const cs     = S.trackCurrentStep[S.activeTrack];
    const page   = S.trackCurrentPage[S.activeTrack];
    const base   = page * 16;
    const len    = S.clipLength[S.activeTrack][ac];
    const lsBase = S.clipLoopStart[S.activeTrack][ac] | 0;
    const winEnd = lsBase + len;
    for (let i = 0; i < 16; i++) {
        const absStep = base + i;
        let color;
        if (absStep < lsBase || absStep >= winEnd) {
            color = DarkGrey;
        } else if (S.playing && absStep === cs) {
            color = White;
        } else if (steps[absStep] === 1) {
            color = trackColor(S.activeTrack);
        } else {
            color = (S.beatMarkersEnabled && i % 4 === 0) ? trackDimColor(S.activeTrack) : LED_OFF;
        }
        setLED(16 + i, color);
    }

    /* Gate span overlay: fixed index 56 across all steps the held note actually
     * sounds on = ceil(gate/tps) steps (a gate of exactly N steps ends at the
     * start of step N, so it covers steps 0..N-1 — NOT N). */
    if (S.heldStep >= 0 && S.heldStepNotes.length > 0) {
        const _spanTps  = S.clipTPS[S.activeTrack][effectiveClip(S.activeTrack)] || 24;
        const spanSteps = Math.ceil(S.stepEditGate / _spanTps);
        for (let i = 0; i < 16; i++) {
            const absStep = base + i;
            if (absStep < lsBase || absStep >= winEnd) continue;
            const offset = (absStep - S.heldStep + len) % len;
            if (offset < spanSteps) setLED(16 + i, 56);
        }
    }

    /* Gate overlay: K3 (Dur) touched while in step edit — visualize gate length on step buttons. */
    if (S.heldStep >= 0 && S.knobTouched === 2 && S.heldStepNotes.length > 0) {
        const _acTps = S.clipTPS[S.activeTrack][effectiveClip(S.activeTrack)] || 24;
        const fullSteps    = Math.floor(S.stepEditGate / _acTps);
        const partialTicks = S.stepEditGate % _acTps;
        for (let i = 0; i < 16; i++) {
            const absStep = base + i;
            if (absStep < lsBase || absStep >= winEnd) continue;
            const offset = (absStep - S.heldStep + len) % len;
            if (offset < fullSteps) {
                setLED(16 + i, White);
            } else if (offset === fullSteps && partialTicks > 0) {
                setLED(16 + i, DarkGrey);
            }
        }
    }

    /* Copy-source blink: step-to-step copy waiting for destination */
    if (S.copyHeld && S.copySrc && (S.copySrc.kind === 'step' || S.copySrc.kind === 'cut_step') && Math.floor(S.copySrc.absStep / 16) === page) {
        const btnIdx = S.copySrc.absStep % 16;
        setLED(16 + btnIdx, (Math.floor(S.tickCount / 24) % 2) ? White : LED_OFF);
    }

}

export function updateSessionLEDs() {
    if (!S.ledInitComplete) return;
    if (S.tapTempoOpen) {
        for (let i = 0; i < 32; i++) {
            const note  = TRACK_PAD_BASE + i;
            const flash = S.tapTempoFlashTick >= 0 &&
                          S.tickCount - S.tapTempoFlashTick < TAP_TEMPO_FLASH_TICKS;
            cachedSetLED(note, flash ? DarkBlue : DarkGrey);
        }
        return;
    }
    for (let row = 0; row < 4; row++) {
        const sceneIdx = S.sceneRow + row;
        for (let t = 0; t < 8; t++) {
            const note = 92 - row * 8 + t;
            if (t >= NUM_TRACKS) { setLED(note, LED_OFF); continue; }
            const isActiveClip  = S.trackActiveClip[t] === sceneIdx;
            const isPlaying     = S.trackClipPlaying[t] && isActiveClip;
            const isPendingStop = S.trackPendingPageStop[t] && isActiveClip;
            const isQueued      = S.trackQueuedClip[t] === sceneIdx;
            const isWillRelaunch = S.trackWillRelaunch[t] && isActiveClip;
            const isDrumTrack = S.trackPadMode[t] === PAD_MODE_DRUM;
            const hasContent  = isDrumTrack ? S.drumClipNonEmpty[t][sceneIdx] : S.clipNonEmpty[t][sceneIdx];
            const hasActive   = hasContent;
            let color;
            if (!hasContent) {
                color = isActiveClip ? DarkGrey : LED_OFF;
            } else if (!hasActive) {
                color = DarkGrey;
            } else if (isPlaying && isPendingStop) {
                color = (!S.playing || S.flashSixteenth) ? trackDimColor(t) : LED_OFF;
            } else if (isPlaying) {
                color = S.flashEighth ? trackColor(t) : trackDimColor(t);
            } else if (isQueued) {
                color = (!S.playing || S.flashSixteenth) ? trackColor(t) : trackDimColor(t);
            } else if (isWillRelaunch) {
                color = trackColor(t);
            } else {
                color = trackDimColor(t);
            }
            /* Copy source blink: JS-side timer (transport-independent) */
            if (S.copySrc) {
                const isSrcClip     = (S.copySrc.kind === 'clip'      || S.copySrc.kind === 'cut_clip')      && S.copySrc.track === t && S.copySrc.clip === sceneIdx;
                const isSrcRow      = (S.copySrc.kind === 'row'       || S.copySrc.kind === 'cut_row')       && S.copySrc.row === sceneIdx;
                const isSrcDrumClip = (S.copySrc.kind === 'drum_clip' || S.copySrc.kind === 'cut_drum_clip') && S.copySrc.track === t && S.copySrc.clip === sceneIdx;
                if (isSrcClip || isSrcRow || isSrcDrumClip) color = (Math.floor(S.tickCount / 24) % 2) ? White : LED_OFF;
            }
            /* Single-clip merge / capture placement: blink the track's EMPTY
             * clips (the viable destinations); leave every other clip at its
             * normal color so the user keeps the session as a reference. */
            const _placeTrack = S.mergeSoloPlacement >= 0 ? S.mergeSoloPlacement
                              : S.capturePlaceTrack >= 0  ? S.capturePlaceTrack : -1;
            if (_placeTrack >= 0 && t === _placeTrack && !hasContent)
                color = (Math.floor(S.tickCount / 24) % 2) ? LightGrey : LED_OFF;
            cachedSetLED(note, color);
        }
    }
}

export function updateTrackLEDs() {
    if (!S.ledInitComplete) return;

    /* Side clip buttons in Schwung co-run: all dark grey, with EVERY slot that
     * receives the active track's channel (_coRunChanSlots bitmask; layered slots
     * all blink) blinking dark-grey/light-grey. Slot order is TOP-to-bottom:
     * slot 1 (bit 0) = top button = CC 43, slot 4 (bit 3) = bottom = CC 40.
     * Blink runs off wall-clock so the rate matches Move co-run; force every
     * POLL_INTERVAL so it re-asserts over the Schwung shim's overtake LED loop.
     * On exit, restore to OFF exactly once. */
    {
        const inCoRun = S.schwungCoRunSlot >= 0;
        if (inCoRun) {
            /* _coRunChanSlots bit i = slot (i+1), already top-to-bottom (bit 0 = top). */
            paintCoRunSideButtons(S._coRunChanSlots, S.tickCount % POLL_INTERVAL === 0);
            S._coRunTrackLedsLit = true;
        } else if (S._coRunTrackLedsLit) {
            for (let _i = 0; _i < 4; _i++) setButtonLED(40 + _i, LED_OFF, true);
            S._coRunTrackLedsLit = false;
        }
    }

    /* Move-native co-run: drawUI() returns early in co-run and handles the
     * track-button blink directly there (setButtonLED in the early-return block).
     * This path only fires on co-run EXIT to reclaim the four CCs from Move
     * firmware so its colors don't persist into dAVEBOx track view. */
    {
        const inMoveCoRun = (S.moveCoRunTrack | 0) >= 0;
        if (inMoveCoRun) {
            S._moveCoRunTrackLedsActive = true;
        } else if (S._moveCoRunTrackLedsActive) {
            for (let _i = 0; _i < 4; _i++) setButtonLED(40 + _i, LED_OFF, true);
            S._moveCoRunTrackLedsActive = false;
        }
    }

    /* Step icon LEDs (CCs 16-31): light shortcut hints while Shift held in Track View.
     * Force-send every POLL_INTERVAL to override any native Move state that bypasses caches.
     * Suppress icons too while Shift+Shft/Res knob is being touched (matches the step
     * button main-LED fall-through to the normal step view). */
    {
        const isDrum    = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM;
        const force     = S.tickCount % POLL_INTERVAL === 0;
        const _kt = S.knobTouched;
        const _knobShiftMode =
            (S.activeBank === 0 && (_kt === 1 || _kt === 2)) ||
            (S.activeBank === 7 && _kt === 1);
        const _compoundHeld = S.muteHeld || S.deleteHeld || S.copyHeld || S.loopHeld;
        const _inCoRun = S.schwungCoRunSlot >= 0 || S.moveCoRunTrack >= 0;
        for (let i = 0; i < 16; i++) {
            let color;
            if (_inCoRun) {
                /* Co-run: only the Step 3 icon stays lit (solid White) as the
                 * Edit Slot/Synth affordance; all other step icons go dark. */
                color = (i === 2) ? White : LED_OFF;
            } else {
                let on = false;
                if (S.shiftHeld && !_knobShiftMode && !_compoundHeld) {
                    if (i === 1 || (i >= 4 && i <= 6) || i === 8) on = true; /* shared shortcuts */
                    if (!S.sessionView) {
                        if (i === 2)                            on = true; /* Step3 = Edit Slot/Synth — Track View only */
                        else if (i === 7)                       on = true;
                        else if (i === 9)                       on = true;
                        else if (i === 10 && !isDrum)           on = true;
                        else if (i === 14 || i === 15)          on = true;
                    }
                }
                /* ALL LANES unconfirmed: gated double-fill/quantize shortcuts dark */
                if (isDrum && S.activeBank === 7 && !S.allLanesConfirmed && (i === 14 || i === 15)) on = false;
                color = on ? LightGrey : LED_OFF;
            }
            if (force) {
                lastSentButtonLED[16 + i] = color;
                setButtonLED(16 + i, color, true);
            } else {
                cachedSetButtonLED(16 + i, color);
            }
        }
    }

    /* Step button main LEDs (notes 16-31): shift overlay in session view only.
     * Track view is handled by updateStepLEDs (early return keeps MIDI traffic low).
     * Suppressed when a compound modifier is held (Shift+Mute/Delete/Copy/Loop). */
    if (S.sessionView && S.shiftHeld &&
        !(S.muteHeld || S.deleteHeld || S.copyHeld || S.loopHeld)) {
        for (let i = 0; i < 16; i++) {
            const on = i === 1 || (i >= 4 && i <= 6) || i === 8; /* shared shortcuts only — Step3 (Edit Slot/Synth) is Track View only */
            setLED(16 + i, on ? LightGrey : LED_OFF);
        }
    }

    if (S.tapTempoOpen) {
        for (let i = 0; i < 32; i++) {
            const note  = TRACK_PAD_BASE + i;
            const flash = S.tapTempoFlashTick >= 0 &&
                          S.tickCount - S.tapTempoFlashTick < TAP_TEMPO_FLASH_TICKS;
            cachedSetLED(note, flash ? DarkBlue : DarkGrey);
        }
        return;
    }

    /* Arp Steps interval-mode overlay: persistent vel-level pad editor on SEQ ARP (4)
     * and TARP (5). Replaces the prior K5-touch transient gesture — now toggled via
     * jog click on the bank. Renders even when Steps Mode = Off so the user can edit
     * step intervals + levels in one dedicated mode. */
    if (!S.sessionView && S.stepIntervalMode && S.activeBank === 4) {
        const t  = S.activeTrack;
        const ac = effectiveClip(t);
        const sv = S.seqArpStepVel[t][ac];
        const tc = trackColor(t);
        const td = trackDimColor(t);
        const ll = S.seqArpStepLoopLen[t][ac] | 0;
        const loopLen = (ll >= 1 && ll <= 8) ? ll : 8;
        for (let i = 0; i < 32; i++) {
            const col = i % 8;
            const row = Math.floor(i / 8);
            let color = LED_OFF;
            if (col < loopLen) {
                const lvl = arpVelLevel(sv[col]);
                if (lvl > 0 && row < lvl) {
                    color = (row === lvl - 1) ? tc : td;
                }
            }
            cachedSetLED(TRACK_PAD_BASE + i, color);
        }
        return;
    }
    if (!S.sessionView && S.stepIntervalMode && S.activeBank === 5) {
        const t  = S.activeTrack;
        const sv = S.tarpStepVel[t];
        const tc = trackColor(t);
        const td = trackDimColor(t);
        const ll = S.tarpStepLoopLen[t] | 0;
        const loopLen = (ll >= 1 && ll <= 8) ? ll : 8;
        for (let i = 0; i < 32; i++) {
            const col = i % 8;
            const row = Math.floor(i / 8);
            let color = LED_OFF;
            if (col < loopLen) {
                const lvl = arpVelLevel(sv[col]);
                if (lvl > 0 && row < lvl) {
                    color = (row === lvl - 1) ? tc : td;
                }
            }
            cachedSetLED(TRACK_PAD_BASE + i, color);
        }
        return;
    }

    if (!S.sessionView) {
        const _inCoRunPad = S.schwungCoRunSlot >= 0 || S.moveCoRunTrack >= 0;
        const isDrum = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM;
        if (isDrum) {
            /* Left 4 cols (col 0-3): lane selectors; Right 4 cols (col 4-7): velocity zones */
            const t        = S.activeTrack;
            const selLane  = S.activeDrumLane[t];
            const velZone  = S.drumLastVelZone[t];
            const tc       = _inCoRunPad ? White     : trackColor(t);
            const td       = _inCoRunPad ? LightGrey : trackDimColor(t);
            /* True track colors for the co-run lane inversion: in co-run the
             * SELECTED lane takes the track color (bright = has data, dim =
             * empty) while every other lane goes white — the inverse of the
             * regular scheme (selected lane White, data lanes track-colored).
             * tc/td stay White/LightGrey so the right-col gate mask is unchanged. */
            const tcReal   = trackColor(t);
            const tdReal   = trackDimColor(t);
            const flashDur = 2 * POLL_INTERVAL;
            for (let i = 0; i < 32; i++) {
                const col = i % 8;
                const row = Math.floor(i / 8);
                if (S.activeBank === 6) {
                    /* AUTO bank: the drum pads still PLAY their drum sounds (handled
                     * in _onPadPressTrackView) but are not lane-selectors here. Left
                     * 4x4 (lane/sound pads): the active lane = bright track color, any
                     * lane actually sounding = dim track color, the rest = gray (light
                     * if the lane has hits, dark if empty). Right 4x4 (perf/vel area):
                     * LEDs off. */
                    let g6;
                    if (col < 4) {
                        const lane6 = S.drumLanePage[t] * 16 + row * 4 + col;
                        const note6 = S.drumLaneNote[t][lane6];
                        if (lane6 === selLane) {
                            g6 = trackColor(t);
                        } else if (S.liveActiveNotes.has(note6) || S.seqActiveNotes.has(note6)) {
                            g6 = trackDimColor(t);
                        } else {
                            g6 = S.drumLaneHasNotes[t][lane6] ? 118 : 124;
                        }
                    } else {
                        g6 = LED_OFF;
                    }
                    cachedSetLED(TRACK_PAD_BASE + i, g6);
                    continue;
                }
                let color;
                if (col < 4) {
                    const lane = S.drumLanePage[t] * 16 + row * 4 + col;
                    const isActive = (lane === selLane);
                    const hasHits  = S.drumLaneHasNotes[t][lane];
                    const laneNote = S.drumLaneNote[t][lane];
                    const sounding = S.liveActiveNotes.has(laneNote);
                    const flashing = (S.tickCount - S.drumLaneFlashTick[t][lane]) < flashDur;
                    const isMuted  = effectiveDrumMute(t, lane);
                    if (sounding) {
                        color = White;
                    } else if (flashing) {
                        color = isMuted ? DarkGrey : tc;
                    } else if (isMuted) {
                        color = LED_OFF;
                    } else if (isActive) {
                        /* Selected lane: co-run shows it in track color (the
                         * inversion); regular shows White. */
                        color = _inCoRunPad ? (hasHits ? tcReal : tdReal)
                                            : (hasHits ? White  : DarkGrey);
                    } else if (hasHits) {
                        /* Non-selected lane with data: bright white in co-run;
                         * track color (dimmed while playing) in regular. */
                        color = _inCoRunPad ? White : (S.playing ? td : tc);
                    } else {
                        /* Non-selected empty lane: dim white (LightGrey) in
                         * co-run via td; dim track color in regular. */
                        color = td;
                    }
                    /* Copy source blink */
                    if (S.copySrc && (S.copySrc.kind === 'drum_lane' || S.copySrc.kind === 'cut_drum_lane') &&
                            S.copySrc.track === t && S.copySrc.lane === lane) {
                        color = (Math.floor(S.tickCount / 24) % 2) ? White : LED_OFF;
                    }
                    /* Persistent latch highlight: Rpt1 + Rpt2 latched lanes
                     * stay Cyan regardless of current drumPerformMode (mirrors
                     * TARP latched-chord visual). Held-but-not-latched Rpt2
                     * lanes also Cyan, but only while in Rpt2 mode (transient
                     * gesture feedback). */
                    const _rpt1Lit = S.drumRepeatLatched[t] && lane === S.activeDrumLane[t];
                    const _rpt2Lit = S.drumRepeat2LatchedLanes[t].has(lane) ||
                        (S.drumPerformMode[t] === 2 && S.drumRepeat2HeldLanes[t].has(lane));
                    if (_rpt1Lit || _rpt2Lit) {
                        color = Cyan;
                    }
                } else if (S.drumPerformMode[t] === 1) {
                    /* Repeat mode: right 4×4 — rows 0-1 = rate pads, rows 2-3 = gate mask */
                    if (row < 2) {
                        const isHeld = S.drumRepeatHeldPad[t] === i;
                        color = isHeld ? White : DarkGrey;
                    } else {
                        const maskStep = (row - 2) * 4 + (col - 4);
                        const gLen = S.drumRepeatGateLen[t][selLane];
                        if (maskStep >= gLen) {
                            color = DarkGrey;
                        } else {
                            const isOn = !!(S.drumRepeatGate[t][selLane] & (1 << maskStep));
                            color = isOn ? tc : LED_OFF;
                        }
                    }
                } else if (S.drumPerformMode[t] === 2) {
                    /* Rpt2 mode: right 4×4 — Cyan theme for visual distinction */
                    if (row < 2) {
                        const rateIdx = row * 4 + (col - 4);
                        color = (rateIdx === S.drumRepeat2RatePerLane[t][selLane]) ? Cyan : PurpleBlue;
                    } else {
                        const maskStep = (row - 2) * 4 + (col - 4);
                        const gLen = S.drumRepeatGateLen[t][selLane];
                        if (maskStep >= gLen) {
                            color = DarkGrey;
                        } else {
                            const isOn = !!(S.drumRepeatGate[t][selLane] & (1 << maskStep));
                            color = isOn ? tc : LED_OFF;
                        }
                    }
                } else {
                    const zone = row * 4 + (col - 4);
                    color = (zone === velZone) ? White : DarkGrey;
                }
                cachedSetLED(TRACK_PAD_BASE + i, color);
            }
        } else {
        const _autoGrey    = S.activeBank === 6;
        const rootColor    = _autoGrey ? 118 : (_inCoRunPad ? DarkGrey : trackColor(S.activeTrack));
        const nonRootColor = _autoGrey ? 124 : (_inCoRunPad ? trackDimColor(S.activeTrack) : DarkGrey);
        const _tarpActive = (S.bankParams[S.activeTrack][5][7] | 0) !== 0 &&
                            (S.bankParams[S.activeTrack][5][0] | 0) !== 0;
        const _tarpHeld = _tarpActive ? S.tarpHeldNotes[S.activeTrack] : null;
        for (let i = 0; i < 32; i++) {
            let color;
            /* OOB pads — either (a) sentinel from computePadNoteMap (base pitch
             * before track-octave was out of range), or (b) base + trackOctave
             * shift pushes the pitch out of [0,127]. Both must blank the LED so
             * pads sharing the same clamped MIDI note don't all light when one
             * is pressed (clamping multiple pads to note 0 was the bottom-row
             * ghost-light bug). */
            if (S.padNoteMap[i] === 0xFF) {
                cachedSetLED(TRACK_PAD_BASE + i, LED_OFF);
                continue;
            }
            const pitchRaw = S.padNoteMap[i] + S.trackOctave[S.activeTrack] * 12;
            if (pitchRaw < 0 || pitchRaw > 127) {
                cachedSetLED(TRACK_PAD_BASE + i, LED_OFF);
                continue;
            }
            const pitch    = pitchRaw;
            const sounding = S.liveActiveNotes.has(pitch) || S.seqActiveNotes.has(pitch);
            const inHeld   = S.heldStep >= 0 && S.heldStepNotes.indexOf(pitch) >= 0;
            const inLatch  = _tarpHeld && _tarpHeld.has(pitch);
            /* During a transpose preview the pad map is laid out for the candidate
             * key, so colour scale-membership/root against it too (padScaleSet is
             * already candidate-based) — otherwise non-overlapping scales read as
             * all-out-of-key and the pads go dark. */
            const _effKey = S.xposePrevKey !== null ? S.xposePrevKey : S.padKey;
            const semitone = ((S.padNoteMap[i] % 12) - _effKey + 12) % 12;
            const inScale  = S.padScaleSet.has(semitone);
            const chromatic = S.padLayoutChromatic[S.activeTrack];
            color = (sounding || inHeld || inLatch) ? (_autoGrey ? 120 : White)
                  : (chromatic && !inScale) ? LED_OFF
                  : (S.padNoteMap[i] % 12 === _effKey ? rootColor : nonRootColor);
            cachedSetLED(TRACK_PAD_BASE + i, color);
        }
        }
    }

    /* Co-run: track buttons are owned by the co-run UI — skip the scene/clip-color
     * writes so they don't fight the co-run indicator. Schwung chain-edit co-run
     * shows the bright-White indicator written at the top of this function;
     * Move-native co-run blinks them dark-grey from drawUI. Either way, the
     * per-frame clip-playback paint here must stand down. Knob LEDs below still
     * update normally so dAVEBOx's sequencer-side controls stay legible. */
  if (S.schwungCoRunSlot < 0 && (S.moveCoRunTrack | 0) < 0) {
    for (let idx = 0; idx < 4; idx++) {
        const row      = 3 - idx;
        const sceneIdx = S.sceneRow + row;
        let color;
        if (S.sessionView) {
            const sincePress = S.sceneBtnFlashTick[idx] >= 0 ? (S.tickCount - S.sceneBtnFlashTick[idx]) : 999;
            color = sincePress < SCENE_BTN_FLASH_TICKS ? White : LED_OFF;
        } else {
            const t         = S.activeTrack;
            const focused   = effectiveClip(t);
            const isFocused = sceneIdx === focused;
            const isPlaying = S.trackClipPlaying[t] && S.trackActiveClip[t] === sceneIdx;
            const slowPulse = Math.floor(S.tickCount / 98) % 2;
            const isWillRelaunch = S.trackWillRelaunch[t] && S.trackActiveClip[t] === sceneIdx;
            if (isPlaying) {
                color = S.flashEighth ? trackColor(t) : trackDimColor(t);
            } else if (isFocused && isWillRelaunch && S.playing) {
                color = slowPulse ? trackColor(t) : trackDimColor(t);
            } else if (isFocused) {
                color = trackColor(t);
            } else if (!trackClipHasContent(t, sceneIdx)) {
                color = DarkGrey;
            } else {
                color = trackDimColor(t);
            }
        }
        /* Copy source blink: JS-side timer (transport-independent) */
        if (S.copySrc) {
            const isSrcRow      = (S.copySrc.kind === 'row'       || S.copySrc.kind === 'cut_row')       && S.copySrc.row === sceneIdx;
            const isSrcClip     = (S.copySrc.kind === 'clip'      || S.copySrc.kind === 'cut_clip')      && S.copySrc.track === S.activeTrack && S.copySrc.clip === sceneIdx;
            const isSrcDrumClip = (S.copySrc.kind === 'drum_clip' || S.copySrc.kind === 'cut_drum_clip') && S.copySrc.track === S.activeTrack && S.copySrc.clip === sceneIdx;
            if (isSrcRow || isSrcClip || isSrcDrumClip) color = (Math.floor(S.tickCount / 24) % 2) ? White : LED_OFF;
        }
        cachedSetButtonLED(40 + idx, color);
    }
  }

    /* Knob LEDs (CC 71-78) */
    for (let k = 0; k < NUM_TRACKS; k++) {
        let ledVal = LED_OFF;
        if (S.perfViewLocked) {
            ledVal = S.trackLooper[k] !== 0 ? trackColor(k) : LED_OFF;
        } else if (S.sessionView) {
            ledVal = (k === S.activeTrack) ? White : LED_OFF;
        } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 5) {
            /* Repeat Groove: lit when step k has non-default vel scale or nudge */
            const lane = S.activeDrumLane[S.activeTrack];
            const isDirty = (S.drumRepeatVelScale[S.activeTrack][lane][k] !== 100) ||
                            (S.drumRepeatNudge[S.activeTrack][lane][k] !== 0);
            ledVal = isDirty ? White : LED_OFF;
        } else if (S.activeBank === 6) {
            /* Solid colors: red = recording, green = automation playing back,
             * yellow = automation exists, white = resting value set, off = empty. */
            const _t6 = S.activeTrack, _c6 = effectiveClip(_t6);
            const _autoHas = (S.trackCCAutoBits[_t6][_c6] >> k) & 1;
            if (S.recordArmed) {
                ledVal = Red;
            } else if (S.playing && _autoHas) {
                ledVal = Green;
            } else if (_autoHas) {
                ledVal = VividYellow;
            } else {
                ledVal = S.clipCCVal[_t6][_c6][k] >= 0 ? White : LED_OFF;
            }
        } else if (PARAM_LED_BANKS.indexOf(S.activeBank) >= 0) {
            const pm = BANKS[S.activeBank].knobs[k];
            if (pm && pm.abbrev && pm.scope !== 'stub') {
                ledVal = (S.bankParams[S.activeTrack][S.activeBank][k] !== pm.def) ? White : LED_OFF;
            }
        }
        if (S._forceKnobReemit) setButtonLED(71 + k, ledVal, true);
        else cachedSetButtonLED(71 + k, ledVal);
    }
    if (S._forceKnobReemit) S._forceKnobReemit = false;  /* one-shot: consumed on the post-co-run-exit repaint */
    /* (Removed: a Shift-held knob-flash that advertised Shift-modified knob
     * functions. Those moved to jog-click alt-mode — _onCC_knobs no longer reads
     * S.shiftHeld at all — so the flash promised a gesture that does nothing. The
     * down-arrow header indicator already signals alt-param availability.) */

    /* Shift overlay: bottom row shows track-switch color hints (all track types).
     * The active track's pad is solid bright track color; every other pad blinks
     * dim grey (DarkGrey, dimmest available) ↔ dim track color (~2 Hz, 24-tick
     * rate) so the current track stands out from the switch targets. */
    if (!S.sessionView && S.shiftHeld && S.shiftTrackLEDActive) {
        const _ttPhase = (Math.floor(S.tickCount / 24) % 2) === 1;
        for (let i = 0; i < NUM_TRACKS; i++) {
            const color = (i === S.activeTrack)
                ? trackColor(i)
                : (_ttPhase ? DarkGrey : trackDimColor(i));
            cachedSetLED(TRACK_PAD_BASE + i, color);
        }
    }

    /* Hold-save double-blink: override step button LEDs in any view */
    if (S.stepSaveFlashEndTick >= 0 && S.tickCount < S.stepSaveFlashEndTick &&
            S.stepSaveFlashStartTick >= 0) {
        const elapsed = S.tickCount - S.stepSaveFlashStartTick;
        if (Math.floor(elapsed / 10) % 2 === 0) {
            for (let i = 0; i < 16; i++) setLED(16 + i, White);
        }
    }
}

/* Music-synced flash at an arbitrary master-tick rate. */
export function flashAtRate(rateTicks) {
    if (rateTicks <= 0) return false;
    return (Math.floor(S.masterPos / rateTicks) & 1) === 1;
}

export function drawPositionBar(t) {
    const ac     = effectiveClip(t);
    const lsBase = S.clipLoopStart[t][ac] | 0;
    const len    = S.clipLength[t][ac];
    const startPage = lsBase >> 4;
    const winPages  = Math.max(1, Math.ceil(len / 16));
    /* View/play pages are translated into window-relative space so the bar
     * always anchors at the window's first page on the left edge. */
    const viewPage = Math.max(0, Math.min(S.trackCurrentPage[t] - startPage, winPages - 1));
    const cs = S.trackCurrentStep[t];
    const playPage = (S.playing && S.trackClipPlaying[t] && cs >= lsBase && cs < lsBase + len)
                   ? Math.floor((cs - lsBase) / 16) : -1;
    const barY = 57, barH = 5, segGap = 1;
    const segW   = Math.max(2, Math.floor((120 - (winPages - 1) * segGap) / winPages));
    const startX = 4;
    for (let pg = 0; pg < winPages; pg++) {
        const x = startX + pg * (segW + segGap);
        if (pg === viewPage) {
            fill_rect(x, barY, segW, barH, 1);
        } else if (pg === playPage) {
            fill_rect(x, barY, segW, 1, 1);
            fill_rect(x, barY + barH - 1, segW, 1, 1);
            fill_rect(x, barY, 1, barH, 1);
            fill_rect(x + segW - 1, barY, 1, barH, 1);
        } else {
            fill_rect(x, barY + barH - 1, segW, 1, 1);
        }
    }
    /* Playhead dot mapped across the window's pixel span (not full 128px). */
    if (S.playing && S.trackClipPlaying[t] && cs >= lsBase && cs < lsBase + len) {
        const winPxW = winPages * (segW + segGap) - segGap;
        const dotX = startX + Math.floor((cs - lsBase) * winPxW / Math.max(1, len));
        const viewSegStart = startX + viewPage * (segW + segGap);
        const onSolid = dotX >= viewSegStart && dotX < viewSegStart + segW;
        fill_rect(dotX, barY, 1, barH, onSolid ? 0 : 1);
    }
    /* Extent markers: small vertical ticks just outside the bar edges to
     * hint that clip content exists before / after the visible window. */
    const steps = S.clipSteps[t][ac];
    let hasLeft = false, hasRight = false;
    for (let s = 0; s < lsBase; s++) if (steps[s] !== 0) { hasLeft = true; break; }
    for (let s = lsBase + len; s < NUM_STEPS; s++) if (steps[s] !== 0) { hasRight = true; break; }
    if (hasLeft)  fill_rect(startX - 2, barY + 1, 1, barH - 2, 1);
    if (hasRight) {
        const xRight = startX + winPages * (segW + segGap) - segGap + 1;
        fill_rect(xRight, barY + 1, 1, barH - 2, 1);
    }
}

/* Pack a SysEx byte array into 4-byte USB-MIDI SysEx packets for move_midi_internal_send. */
function _sysexPkts(bytes) {
    const out = [];
    for (let i = 0; i < bytes.length; i += 3) {
        const rem = bytes.length - i;
        const cin = rem >= 3 ? (rem === 3 ? 0x07 : 0x04) : (rem === 2 ? 0x06 : 0x05);
        out.push(cin, bytes[i], rem > 1 ? bytes[i + 1] : 0, rem > 2 ? bytes[i + 2] : 0);
    }
    return out;
}

/* Pre-packed reapply SysEx: [F0 00 21 1D 01 01 05 F7] */
const _CC_REAPPLY_PKT = _sysexPkts([0xF0, 0x00, 0x21, 0x1D, 0x01, 0x01, 0x05, 0xF7]);

/* Set palette entry idx to RGB (0-255 each), then call reapplyPalette to push to LEDs. */
export function setPaletteEntryRGB(idx, r, g, b) {
    move_midi_internal_send(_sysexPkts([
        0xF0, 0x00, 0x21, 0x1D, 0x01, 0x01, 0x03,
        idx & 0x7F,
        r & 0x7F, r >> 7,
        g & 0x7F, g >> 7,
        b & 0x7F, b >> 7,
        0, 0,   /* white channel = 0 */
        0xF7
    ]));
}

export function reapplyPalette() { move_midi_internal_send(_CC_REAPPLY_PKT); }

export function buildLedInitQueue() {
    const q = [];
    for (let n = 68; n <= 99; n++) q.push({ kind: 'note', id: n });
    for (let n = 16; n <= 31; n++) q.push({ kind: 'note', id: n });
    for (let c = 16; c <= 31; c++) q.push({ kind: 'cc', id: c });
    for (let c = 40; c <= 43; c++) q.push({ kind: 'cc', id: c });
    for (const c of [49, 50, 51, 52, 54, 55, 56, 58, 60, 62, 63])
        q.push({ kind: 'cc', id: c });
    for (let c = 71; c <= 78; c++) q.push({ kind: 'cc', id: c });
    for (const c of [85, 86, 88, 118, 119]) q.push({ kind: 'cc', id: c });
    return q;
}

export function drainLedInit() {
    const end = Math.min(S.ledInitIndex + LEDS_PER_FRAME, S.ledInitQueue.length);
    for (let i = S.ledInitIndex; i < end; i++) {
        const led = S.ledInitQueue[i];
        if (led.kind === 'cc') setButtonLED(led.id, LED_OFF);
        else setLED(led.id, LED_OFF);
    }
    S.ledInitIndex = end;
    if (S.ledInitIndex >= S.ledInitQueue.length) {
        S.ledInitComplete = true;
        /* Custom scratch palette entry for the Loop button's ambient LED —
         * Loop's LED renders palette colors brighter than peers (Delete/Copy
         * idx 16 = dim grey; same idx 16 is invisible on Loop, and 124/DarkGrey
         * on Loop reads as fully bright). Push a low-RGB entry before
         * reapplyPalette so the LED hardware picks up index 60 on the refresh. */
        setPaletteEntryRGB(60, 32, 32, 32);
        reapplyPalette();
    }
}

/* Pad → modifier bit index. R1=bits 0-7 (pitch), R2=bits 8-15 (vel/gate), R3=bits 16-23 (wild). */
export const PERF_MOD_PAD_MAP = Object.freeze({
    76: 0,  /* Oct↑    */ 77: 1,  /* Oct↓    */ 78: 2,  /* Sc↑     */ 79: 3,  /* Sc↓     */
    80: 4,  /* 5th     */ 81: 5,  /* Triton  */ 82: 6,  /* Drift   */ 83: 7,  /* Storm   */
    84: 8,  /* Soft    */ 85: 9,  /* Hard    */ 86: 10, /* Cresc   */ 87: 11, /* Pulse   */
    88: 12, /* Sdchn   */ 89: 13, /* Stac    */ 90: 14, /* Lgto    */ 91: 15, /* RmpG    */
    92: 16, /* ½time   */ 93: 17, /* 3Skip   */ 94: 18, /* Phnm    */ 95: 19, /* Sprs    */
    96: 20, /* Gltch   */ 97: 21, /* Stggr   */ 98: 22, /* Shfl    */ 99: 23, /* Back    */
});

/* Draw the full 4-row pad grid for Performance Mode.
 * R0 (68-75): rate pads 1-6 (pulse at capture rate), triplet toggle, latch.
 * R1 (76-83): PITCH modifier pads (HotMagenta family).
 * R2 (84-91): VEL/GATE modifier pads (VividYellow family).
 * R3 (92-99): WILD modifier pads (Cyan family).
 * Also clears step buttons (16-31) — not used in Perf Mode. */
export function updatePerfModeLEDs() {
    if (!S.ledInitComplete) return;
    const activeMods = S.perfModsToggled | S.perfModsHeld;
    /* Step buttons: preset slots. */
    for (let i = 0; i < 16; i++) {
        if (i === S.perfRecalledSlot)         setLED(16 + i, White);
        else if (S.perfSnapshots[i] !== 0)    setLED(16 + i, PurpleBlue);
        else                                setLED(16 + i, LightGrey);
    }

    /* R0 (68-75): rate pads 0-4 (1/32..1/2), hold (5), sync (6), latch (7).
     * Static colors only — no flashing. */
    for (let i = 0; i < 5; i++) {
        const rateActive = S.perfStickyLengths.has(i) ||
                           S.perfStack.some(function(e) { return e.idx === i; });
        setLED(68 + i, rateActive ? White : DarkGrey);
    }
    /* Hold pad (73): bright Red when engaged, dim Red when off. */
    setLED(73, S.perfHoldPadHeld ? Red : DeepRed);
    /* Sync (pad 74): bright Green when on, dim Green when off. */
    setLED(74, S.perfSync ? Green : DeepGreen);
    /* Latch (pad 75): track-3 bright/dim pair (BrightGreen / DarkOlive). */
    setLED(75, S.perfLatchMode ? TRACK_COLORS[2] : TRACK_DIM_COLORS[2]);

    /* R1 (76-83): PITCH mods — active = White, inactive = dim Magenta */
    for (let i = 0; i < 8; i++) {
        const note = 76 + i;
        const modIdx = PERF_MOD_PAD_MAP[note];
        if (modIdx !== undefined)
            setLED(note, (activeMods >> modIdx) & 1 ? White : DeepMagenta);
        else
            setLED(note, LED_OFF);
    }

    /* R2 (84-91): VEL/GATE mods — active = White, inactive = dim Yellow */
    for (let i = 0; i < 8; i++) {
        const note = 84 + i;
        const modIdx = PERF_MOD_PAD_MAP[note];
        if (modIdx !== undefined)
            setLED(note, (activeMods >> modIdx) & 1 ? White : Mustard);
        else
            setLED(note, LED_OFF);
    }

    /* R3 (92-99): WILD mods — active = White, inactive = dim Blue */
    for (let i = 0; i < 8; i++) {
        const note = 92 + i;
        const modIdx = PERF_MOD_PAD_MAP[note];
        if (modIdx !== undefined)
            setLED(note, (activeMods >> modIdx) & 1 ? White : DarkBlue);
        else
            setLED(note, LED_OFF);
    }
}

export function forceRedraw() {
    S.screenDirty = true;
    if (!S.ledInitComplete) return;
    if (S.sessionView) {
        updateSessionLEDs();
        if (S.loopHeld || S.perfViewLocked) updatePerfModeLEDs();
        else { updateSceneMapLEDs(); for (let i = 0; i < 16; i++) setLED(16 + i, LED_OFF); }
    } else {
        updateStepLEDs();
    }
    updateTrackLEDs();
}

export function bankHasAltParams(t, bank) {
    if (S.trackPadMode[t] === PAD_MODE_DRUM) return bank === 0 || bank === 5 || bank === 6 || bank === 7;
    /* Melodic CLIP(0), NOTE FX(1), DELAY(3), SEQ ARP(4), ARP IN(5), AUTO/CC(6).
     * Banks 4/5 use stepIntervalMode (Arp Steps overlay) rather than altMode —
     * the arrow still shows their toggle-availability, and altIndicatorActive()
     * reflects which underlying flag is on. */
    return bank === 0 || bank === 1 || bank === 3 || bank === 4 || bank === 5 || bank === 6;
}

/* Returns true when the current bank's alt indicator should flash. For melodic
 * SEQ ARP / ARP IN this is the Arp Steps overlay flag; for every other alt-param
 * bank it is altMode. */
export function altIndicatorActive(t, bank) {
    if (S.trackPadMode[t] !== PAD_MODE_DRUM && (bank === 4 || bank === 5)) {
        return S.stepIntervalMode;
    }
    return S.altMode;
}

/* Synchronously zero every LED that SEQ8 owns — call before host_hide_module(). */
export function clearAllLEDs() {
    let n, c;
    for (n = 68; n <= 99; n++) setLED(n, LED_OFF);
    for (n = 16; n <= 31; n++) setLED(n, LED_OFF);
    for (c = 16; c <= 31; c++) setButtonLED(c, LED_OFF);
    for (c = 40; c <= 43; c++) setButtonLED(c, LED_OFF);
    for (const cc of [49, 50, 51, 52, 54, 55, 56, 58, 60, 62, 63])
        setButtonLED(cc, LED_OFF);
    for (c = 71; c <= 78; c++) setButtonLED(c, LED_OFF);
    for (const cc of [85, 86, 88, 118, 119]) setButtonLED(cc, LED_OFF);
}

export function installFlagsWrap() {
    if (typeof shadow_get_ui_flags !== 'function') return;
    if (globalThis.shadow_get_ui_flags._seq8) {
        globalThis.shadow_get_ui_flags._active = true;
        return;
    }
    const orig = globalThis.shadow_get_ui_flags;
    const wrap = function () {
        const f = orig();
        const hit = f & SEQ8_NAV_FLAGS;
        if (hit && wrap._active) {
            S.ledInitComplete = false;
            invalidateLEDCache();
            clearAllLEDs();
            if (typeof shadow_clear_ui_flags === 'function') shadow_clear_ui_flags(hit);
            return f & ~SEQ8_NAV_FLAGS;
        }
        return f;
    };
    wrap._seq8   = true;
    wrap._orig   = orig;
    wrap._active = true;
    globalThis.shadow_get_ui_flags = wrap;
}

export function removeFlagsWrap() {
    const cur = globalThis.shadow_get_ui_flags;
    if (typeof cur === 'function' && cur._seq8) {
        cur._active = false;
        globalThis.shadow_get_ui_flags = cur._orig;
    }
}

/* Send current combined modifier bitmask to DSP. */
export function sendPerfMods() {
    if (typeof host_module_set_param === 'function')
        host_module_set_param('perf_mods', String(S.perfModsToggled | S.perfModsHeld));
}

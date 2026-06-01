import { S } from '/data/UserData/schwung/modules/tools/davebox/ui_state.mjs';
import {
    NUM_STEPS, NUM_TRACKS, LED_OFF,
    TRACK_COLORS, TRACK_DIM_COLORS, TRACK_PAD_BASE, SCENE_BTN_FLASH_TICKS,
    PAD_MODE_DRUM, BANKS,
    POLL_INTERVAL, TAP_TEMPO_FLASH_TICKS, PARAM_LED_BANKS,
    CC_GRADIENT_BASE, CC_GRADIENT_LEVELS
} from '/data/UserData/schwung/modules/tools/davebox/ui_constants.mjs';
import { trackClipHasContent } from '/data/UserData/schwung/modules/tools/davebox/ui_scene.mjs';
import {
    White, Red, Green, Blue, DarkBlue, LightGrey, DarkGrey, Cyan, PurpleBlue, VividYellow
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

export function updateStepLEDs() {
    if (!S.ledInitComplete) return;
    const ac = effectiveClip(S.activeTrack);

    /* Loop-held pages view (no jog active): 16 step buttons = 16 possible 16-step pages.
     * Pages with notes within the window → pulse; empty in-window pages → solid track color;
     * out-of-window pages → off. Held start page during the range gesture lights bright
     * white as a "waiting for end tap" affordance. */
    if (S.loopHeld && !S.loopJogActive) {
        const t = S.activeTrack;
        const trackColor = TRACK_COLORS[t];
        const pulsOn = S.playing ? S.flashSixteenth : (Math.floor(S.tickCount / 24) % 2);
        const gestureHeldPage = (S.loopGestureStart >= 0 && S.loopGestureTrack === t) ? S.loopGestureStart : -1;
        if (S.trackPadMode[t] === PAD_MODE_DRUM) {
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
                    color = hasNotes ? (pulsOn ? trackColor : LED_OFF) : trackColor;
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
                    color = hasNotes ? (pulsOn ? trackColor : LED_OFF) : trackColor;
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
            for (let i = 0; i < 16; i++) {
                let on = i === 1 || i === 2 || (i >= 4 && i <= 6) || i === 8;
                if (i === 7 || i === 9 || (i === 10 && !isDrum) || i === 14 || i === 15) on = true;
                setLED(16 + i, on ? LightGrey : LED_OFF);
            }
            return;
        }
    }

    /* Drum mode: step buttons show active lane's steps — identical visualization to melodic */
    if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
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
            else if (ls[absStep] === '1')              color = TRACK_COLORS[t];
            else                                       color = (S.beatMarkersEnabled && i % 4 === 0) ? TRACK_DIM_COLORS[t] : LED_OFF;
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
        if (S.copyHeld && S.copySrc && S.copySrc.kind === 'step' && Math.floor(S.copySrc.absStep / 16) === page) {
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
        const pg   = S.trackCurrentPage[t];
        const csCC = S.trackCurrentStep[t];
        var _ccLenCC = S.ccLaneLength[t][c][lane];
        var _ccLsCC  = _ccLenCC > 0 ? (S.ccLaneLoopStart[t][c][lane] | 0)
                                     : (S.clipLoopStart[t][c] | 0);
        var _ccWinEnd = _ccLsCC + (_ccLenCC > 0 ? _ccLenCC : S.clipLength[t][c]);
        var _ccPlayStep = -1;
        if (S.playing) {
            var _lTps = S.ccLaneTps[t][c][lane] || (S.clipTPS[t][c] || 24);
            var _effLen = _ccLenCC > 0 ? _ccLenCC : S.clipLength[t][c];
            var _lLenTicks = _effLen * _lTps;
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
            color = TRACK_COLORS[S.activeTrack];
        } else {
            color = (S.beatMarkersEnabled && i % 4 === 0) ? TRACK_DIM_COLORS[S.activeTrack] : LED_OFF;
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
    if (S.copyHeld && S.copySrc && S.copySrc.kind === 'step' && Math.floor(S.copySrc.absStep / 16) === page) {
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
                color = (!S.playing || S.flashSixteenth) ? TRACK_DIM_COLORS[t] : LED_OFF;
            } else if (isPlaying) {
                color = S.flashEighth ? TRACK_COLORS[t] : TRACK_DIM_COLORS[t];
            } else if (isQueued) {
                color = (!S.playing || S.flashSixteenth) ? TRACK_COLORS[t] : TRACK_DIM_COLORS[t];
            } else if (isWillRelaunch) {
                color = TRACK_COLORS[t];
            } else {
                color = TRACK_DIM_COLORS[t];
            }
            /* Copy source blink: JS-side timer (transport-independent) */
            if (S.copySrc) {
                const isSrcClip     = (S.copySrc.kind === 'clip'      || S.copySrc.kind === 'cut_clip')      && S.copySrc.track === t && S.copySrc.clip === sceneIdx;
                const isSrcRow      = (S.copySrc.kind === 'row'       || S.copySrc.kind === 'cut_row')       && S.copySrc.row === sceneIdx;
                const isSrcDrumClip = (S.copySrc.kind === 'drum_clip' || S.copySrc.kind === 'cut_drum_clip') && S.copySrc.track === t && S.copySrc.clip === sceneIdx;
                if (isSrcClip || isSrcRow || isSrcDrumClip) color = (Math.floor(S.tickCount / 24) % 2) ? White : LED_OFF;
            }
            cachedSetLED(note, color);
        }
    }
}

export function updateTrackLEDs() {
    if (!S.ledInitComplete) return;

    /* Track buttons (CCs 40-43) — bright White while co-run is active so the
     * user sees they're disconnected from dAVEBOx and owned by Schwung's
     * chain editor. On exit, restore to OFF (dAVEBOx doesn't otherwise drive
     * these LEDs). The transition latch fires the OFF writes exactly once
     * when co-run clears. */
    {
        const inCoRun = S.schwungCoRunSlot >= 0;
        if (inCoRun) {
            const force = S.tickCount % POLL_INTERVAL === 0;
            for (let _i = 0; _i < 4; _i++) {
                if (force) setButtonLED(40 + _i, White, true);
                else cachedSetButtonLED(40 + _i, White);
            }
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
        for (let i = 0; i < 16; i++) {
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
            const color = on ? LightGrey : LED_OFF;
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
        const tc = TRACK_COLORS[t];
        const td = TRACK_DIM_COLORS[t];
        const ll = S.seqArpStepLoopLen[t][ac] | 0;
        const loopLen = (ll >= 1 && ll <= 8) ? ll : 8;
        for (let i = 0; i < 32; i++) {
            const col = i % 8;
            const row = Math.floor(i / 8);
            let color = LED_OFF;
            if (col < loopLen) {
                const lvl = sv[col] | 0;
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
        const tc = TRACK_COLORS[t];
        const td = TRACK_DIM_COLORS[t];
        const ll = S.tarpStepLoopLen[t] | 0;
        const loopLen = (ll >= 1 && ll <= 8) ? ll : 8;
        for (let i = 0; i < 32; i++) {
            const col = i % 8;
            const row = Math.floor(i / 8);
            let color = LED_OFF;
            if (col < loopLen) {
                const lvl = sv[col] | 0;
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
            const tc       = _inCoRunPad ? White     : TRACK_COLORS[t];
            const td       = _inCoRunPad ? LightGrey : TRACK_DIM_COLORS[t];
            /* True track colors for the co-run lane inversion: in co-run the
             * SELECTED lane takes the track color (bright = has data, dim =
             * empty) while every other lane goes white — the inverse of the
             * regular scheme (selected lane White, data lanes track-colored).
             * tc/td stay White/LightGrey so the right-col gate mask is unchanged. */
            const tcReal   = TRACK_COLORS[t];
            const tdReal   = TRACK_DIM_COLORS[t];
            const flashDur = 2 * POLL_INTERVAL;
            for (let i = 0; i < 32; i++) {
                const col = i % 8;
                const row = Math.floor(i / 8);
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
        const rootColor    = _autoGrey ? 118 : (_inCoRunPad ? DarkGrey : TRACK_COLORS[S.activeTrack]);
        const nonRootColor = _autoGrey ? 124 : (_inCoRunPad ? TRACK_COLORS[S.activeTrack] : DarkGrey);
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
            const semitone = ((S.padNoteMap[i] % 12) - S.padKey + 12) % 12;
            const inScale  = S.padScaleSet.has(semitone);
            const chromatic = S.padLayoutChromatic[S.activeTrack];
            color = (sounding || inHeld || inLatch) ? (_autoGrey ? 120 : White)
                  : (chromatic && !inScale) ? LED_OFF
                  : (S.padNoteMap[i] % 12 === S.padKey ? rootColor : nonRootColor);
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
                color = S.flashEighth ? TRACK_COLORS[t] : TRACK_DIM_COLORS[t];
            } else if (isFocused && isWillRelaunch && S.playing) {
                color = slowPulse ? TRACK_COLORS[t] : TRACK_DIM_COLORS[t];
            } else if (isFocused) {
                color = TRACK_COLORS[t];
            } else if (!trackClipHasContent(t, sceneIdx)) {
                color = DarkGrey;
            } else {
                color = TRACK_DIM_COLORS[t];
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
            ledVal = S.trackLooper[k] !== 0 ? TRACK_COLORS[k] : LED_OFF;
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
    /* Shift-flash: knobs with a Shift-modified function blink DarkGrey/OFF while Shift is held. */
    if (S.shiftHeld && !S.sessionView && !S.perfViewLocked) {
        const _sf = (Math.floor(S.tickCount / 24) % 2) ? 16 : LED_OFF;
        const _isDrum = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM;
        for (let k = 0; k < 8; k++) {
            let hasShift = false;
            if      (S.activeBank === 0 && (k === 1 || k === 2)) hasShift = true; // K2 Nudg, K3 Zoom
            else if (S.activeBank === 7 && k === 1)              hasShift = true; // ALL LANES K2 Nudg
            else if (S.activeBank === 1 && k === 7 && !_isDrum)  hasShift = true; // K8 Rnd algo
            else if (S.activeBank === 3 && k === 7 && !_isDrum)  hasShift = true; // K8 Rnd algo
            else if (S.activeBank === 5 && _isDrum)              hasShift = true; // K1-8 nudge
            else if (S.activeBank === 6)                         hasShift = true; // K1-8 CC assign
            if (hasShift) cachedSetButtonLED(71 + k, _sf);
        }
    }

    /* Shift overlay: bottom row shows track-switch color hints (all track types).
     * The active track's pad is solid bright track color; every other pad blinks
     * dim grey (DarkGrey, dimmest available) ↔ dim track color (~2 Hz, 24-tick
     * rate) so the current track stands out from the switch targets. */
    if (!S.sessionView && S.shiftHeld && S.shiftTrackLEDActive) {
        const _ttPhase = (Math.floor(S.tickCount / 24) % 2) === 1;
        for (let i = 0; i < NUM_TRACKS; i++) {
            const color = (i === S.activeTrack)
                ? TRACK_COLORS[i]
                : (_ttPhase ? DarkGrey : TRACK_DIM_COLORS[i]);
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

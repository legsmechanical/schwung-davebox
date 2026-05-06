import { S } from '/data/UserData/schwung/modules/tools/seq8/ui_state.mjs';
import {
    NUM_STEPS, NUM_TRACKS, LED_OFF,
    TRACK_COLORS, TRACK_DIM_COLORS, TRACK_PAD_BASE, SCENE_BTN_FLASH_TICKS,
    PAD_MODE_DRUM, BANKS,
    POLL_INTERVAL, CC_SCRATCH_PALETTE_BASE, TAP_TEMPO_FLASH_TICKS, PARAM_LED_BANKS
} from '/data/UserData/schwung/modules/tools/seq8/ui_constants.mjs';
import { trackClipHasContent } from '/data/UserData/schwung/modules/tools/seq8/ui_scene.mjs';
import {
    White, Blue, LightGrey, DarkGrey, Cyan, PurpleBlue, VividYellow
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
     * Pages with notes → pulse; empty pages within clip → solid track color; OOB → White. */
    if (S.loopHeld && !S.loopJogActive) {
        const t = S.activeTrack;
        const trackColor = TRACK_COLORS[t];
        const pulsOn = S.playing ? S.flashSixteenth : (Math.floor(S.tickCount / 24) % 2);
        if (S.trackPadMode[t] === PAD_MODE_DRUM) {
            const lane = S.activeDrumLane[t];
            const len  = S.drumLaneLength[t];
            const ls   = S.drumLaneSteps[t][lane];
            const totalPages = Math.ceil(len / 16);
            for (let p = 0; p < 16; p++) {
                let color;
                if (p >= totalPages) {
                    color = White;
                } else {
                    const base = p * 16;
                    const end  = Math.min(base + 16, len);
                    let hasNotes = false;
                    for (let s = base; s < end; s++) {
                        if (ls[s] !== '0') { hasNotes = true; break; }
                    }
                    color = hasNotes ? (pulsOn ? trackColor : LED_OFF) : trackColor;
                }
                setLED(16 + p, color);
            }
        } else {
            const len   = S.clipLength[t][ac];
            const steps = S.clipSteps[t][ac];
            const totalPages = Math.ceil(len / 16);
            for (let p = 0; p < 16; p++) {
                let color;
                if (p >= totalPages) {
                    color = White;
                } else {
                    const base = p * 16;
                    const end  = Math.min(base + 16, len);
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

    /* Drum mode: step buttons show active lane's steps — identical visualization to melodic */
    if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
        const t    = S.activeTrack;
        const lane = S.activeDrumLane[t];
        const ls   = S.drumLaneSteps[t][lane];
        const cs   = S.drumCurrentStep[t];
        const page = S.drumStepPage[t];
        const base = page * 16;
        const len  = S.drumLaneLength[t];

        for (let i = 0; i < 16; i++) {
            const absStep = base + i;
            let color;
            if (absStep >= len)                    color = White;
            else if (S.playing && absStep === cs)    color = White;
            else if (ls[absStep] === '1')          color = TRACK_COLORS[t];
            else                                   color = (S.beatMarkersEnabled && i % 4 === 0) ? LightGrey : LED_OFF;
            setLED(16 + i, color);
        }
        /* Gate span overlay: dim track color across steps covered by held step's gate */
        if (S.heldStep >= 0 && S.heldStepNotes.length > 0) {
            const _sTps  = S.drumLaneTPS[t] || 24;
            const _sSpan = Math.floor(S.stepEditGate / _sTps);
            const _sDim  = TRACK_DIM_COLORS[t];
            for (let i = 0; i < 16; i++) {
                const absStep = base + i;
                if (absStep >= len) continue;
                const offset = (absStep - S.heldStep + len) % len;
                if (offset <= _sSpan) setLED(16 + i, _sDim);
            }
        }
        /* Gate overlay: K1 (Dur) touched in drum step edit — White=full, DarkGrey=partial */
        if (S.heldStep >= 0 && S.knobTouched === 0 && S.heldStepNotes.length > 0) {
            const _dTps      = S.drumLaneTPS[t] || 24;
            const _fullSteps = Math.floor(S.stepEditGate / _dTps);
            const _partTicks = S.stepEditGate % _dTps;
            for (let i = 0; i < 16; i++) {
                const absStep = base + i;
                if (absStep >= len) continue;
                const offset = (absStep - S.heldStep + len) % len;
                if (offset < _fullSteps) {
                    setLED(16 + i, White);
                } else if (offset === _fullSteps && _partTicks > 0) {
                    setLED(16 + i, DarkGrey);
                }
            }
        }
        return;
    }

    const steps  = S.clipSteps[S.activeTrack][ac];
    const cs     = S.trackCurrentStep[S.activeTrack];
    const page   = S.trackCurrentPage[S.activeTrack];
    const base   = page * 16;
    const len    = S.clipLength[S.activeTrack][ac];
    for (let i = 0; i < 16; i++) {
        const absStep = base + i;
        let color;
        if (absStep >= len) {
            color = White;
        } else if (S.playing && absStep === cs) {
            color = White;
        } else if (steps[absStep] === 1) {
            color = TRACK_COLORS[S.activeTrack];
        } else if (steps[absStep] === 2) {
            color = DarkGrey;
        } else {
            color = (S.beatMarkersEnabled && i % 4 === 0) ? LightGrey : LED_OFF;
        }
        setLED(16 + i, color);
    }

    /* Gate span overlay: dim track color across all steps covered by the held step's gate. */
    if (S.heldStep >= 0 && S.heldStepNotes.length > 0) {
        const _spanTps  = S.clipTPS[S.activeTrack][effectiveClip(S.activeTrack)] || 24;
        const spanFull  = Math.floor(S.stepEditGate / _spanTps);
        const dimClr    = TRACK_DIM_COLORS[S.activeTrack];
        for (let i = 0; i < 16; i++) {
            const absStep = base + i;
            if (absStep >= len) continue;
            const offset = (absStep - S.heldStep + len) % len;
            if (offset <= spanFull) setLED(16 + i, dimClr);
        }
    }

    /* Gate overlay: K3 (Dur) touched while in step edit — visualize gate length on step buttons. */
    if (S.heldStep >= 0 && S.knobTouched === 2 && S.heldStepNotes.length > 0) {
        const _acTps = S.clipTPS[S.activeTrack][effectiveClip(S.activeTrack)] || 24;
        const fullSteps    = Math.floor(S.stepEditGate / _acTps);
        const partialTicks = S.stepEditGate % _acTps;
        for (let i = 0; i < 16; i++) {
            const absStep = base + i;
            if (absStep >= len) continue;
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
            cachedSetLED(note, flash ? Blue : LightGrey);
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
            const hasActive   = isDrumTrack
                ? S.drumClipNonEmpty[t][sceneIdx]
                : clipHasActiveNotes(t, sceneIdx);
            let color;
            if (!hasContent) {
                color = isActiveClip ? LightGrey : LED_OFF;
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

    /* Step icon LEDs (CCs 16-31): light shortcut hints while Shift held in Track View.
     * Force-send every POLL_INTERVAL to override any native Move state that bypasses caches. */
    {
        const isDrum    = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM;
        const force     = S.tickCount % POLL_INTERVAL === 0;
        for (let i = 0; i < 16; i++) {
            let on = false;
            if (S.shiftHeld) {
                if (i === 1 || (i >= 4 && i <= 6) || i === 8) on = true; /* shared shortcuts */
                if (!S.sessionView) {
                    if (i === 7)                            on = true;
                    else if (i === 9 && isDrum)             on = true;
                    else if (i === 10 && !isDrum)           on = true;
                    else if (i === 14 || i === 15)          on = true;
                }
            }
            const color = on ? White : LED_OFF;
            if (force) {
                lastSentButtonLED[16 + i] = color;
                setButtonLED(16 + i, color, true);
            } else {
                cachedSetButtonLED(16 + i, color);
            }
        }
    }

    if (S.tapTempoOpen) {
        for (let i = 0; i < 32; i++) {
            const note  = TRACK_PAD_BASE + i;
            const flash = S.tapTempoFlashTick >= 0 &&
                          S.tickCount - S.tapTempoFlashTick < TAP_TEMPO_FLASH_TICKS;
            cachedSetLED(note, flash ? Blue : LightGrey);
        }
        return;
    }

    /* SEQ ARP K5 (Steps Mode) touched + Steps Mode != Off: pad grid becomes vel-level editor */
    if (!S.sessionView && S.activeBank === 4 && S.knobTouched === 4 &&
            (S.bankParams[S.activeTrack][4][4] | 0) !== 0) {
        const t  = S.activeTrack;
        const ac = effectiveClip(t);
        const sv = S.seqArpStepVel[t][ac];
        const tc = TRACK_COLORS[t];
        const td = TRACK_DIM_COLORS[t];
        for (let i = 0; i < 32; i++) {
            const col = i % 8;
            const row = Math.floor(i / 8);
            const lvl = sv[col] | 0;
            let color = LED_OFF;
            if (lvl > 0 && row < lvl) {
                color = (row === lvl - 1) ? tc : td;
            }
            cachedSetLED(TRACK_PAD_BASE + i, color);
        }
        return;
    }

    /* TRACK ARP K6 (Steps Mode) touched + Steps Mode != Off: same vel-level editor */
    if (!S.sessionView && S.activeBank === 5 && S.knobTouched === 5 &&
            (S.bankParams[S.activeTrack][5][5] | 0) !== 0) {
        const t  = S.activeTrack;
        const sv = S.tarpStepVel[t];
        const tc = TRACK_COLORS[t];
        const td = TRACK_DIM_COLORS[t];
        for (let i = 0; i < 32; i++) {
            const col = i % 8;
            const row = Math.floor(i / 8);
            const lvl = sv[col] | 0;
            let color = LED_OFF;
            if (lvl > 0 && row < lvl) {
                color = (row === lvl - 1) ? tc : td;
            }
            cachedSetLED(TRACK_PAD_BASE + i, color);
        }
        return;
    }

    if (!S.sessionView) {
        const isDrum = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM;
        if (isDrum) {
            /* Left 4 cols (col 0-3): lane selectors; Right 4 cols (col 4-7): velocity zones */
            const t        = S.activeTrack;
            const selLane  = S.activeDrumLane[t];
            const velZone  = S.drumLastVelZone[t];
            const tc       = TRACK_COLORS[t];
            const td       = TRACK_DIM_COLORS[t];
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
                        color = White;
                    } else if (hasHits) {
                        color = S.playing ? td : tc;
                    } else {
                        color = td;
                    }
                    /* Copy source blink */
                    if (S.copySrc && (S.copySrc.kind === 'drum_lane' || S.copySrc.kind === 'cut_drum_lane') &&
                            S.copySrc.track === t && S.copySrc.lane === lane) {
                        color = (Math.floor(S.tickCount / 24) % 2) ? White : LED_OFF;
                    }
                    /* Rpt2: highlight active (held or latched) lanes in Cyan */
                    if (S.drumPerformMode[t] === 2 &&
                            (S.drumRepeat2HeldLanes[t].has(lane) || S.drumRepeat2LatchedLanes[t].has(lane))) {
                        color = Cyan;
                    }
                } else if (S.drumPerformMode[t] === 1) {
                    /* Repeat mode: right 4×4 — rows 0-1 = rate pads, rows 2-3 = gate mask */
                    if (row < 2) {
                        const isHeld = S.drumRepeatHeldPad[t] === i;
                        color = isHeld ? White : LightGrey;
                    } else {
                        const maskStep = (row - 2) * 4 + (col - 4);
                        const isOn = !!(S.drumRepeatGate[t][selLane] & (1 << maskStep));
                        color = isOn ? tc : LED_OFF;
                    }
                } else if (S.drumPerformMode[t] === 2) {
                    /* Rpt2 mode: right 4×4 — Cyan theme for visual distinction */
                    if (row < 2) {
                        const rateIdx = row * 4 + (col - 4);
                        color = (rateIdx === S.drumRepeat2RatePerLane[t][selLane]) ? Cyan : PurpleBlue;
                    } else {
                        const maskStep = (row - 2) * 4 + (col - 4);
                        const isOn = !!(S.drumRepeatGate[t][selLane] & (1 << maskStep));
                        color = isOn ? tc : LED_OFF;
                    }
                } else {
                    const zone = row * 4 + (col - 4);
                    color = (zone === velZone) ? White : DarkGrey;
                }
                cachedSetLED(TRACK_PAD_BASE + i, color);
            }
        } else {
        const rootColor = TRACK_COLORS[S.activeTrack];
        for (let i = 0; i < 32; i++) {
            let color;
            const pitch    = Math.max(0, Math.min(127, S.padNoteMap[i] + S.trackOctave[S.activeTrack] * 12));
            const sounding = S.liveActiveNotes.has(pitch) || S.seqActiveNotes.has(pitch);
            const inHeld   = S.heldStep >= 0 && S.heldStepNotes.indexOf(pitch) >= 0;
            const semitone = ((S.padNoteMap[i] % 12) - S.padKey + 12) % 12;
            const inScale  = S.padScaleSet.has(semitone);
            const chromatic = S.padLayoutChromatic[S.activeTrack];
            color = (sounding || inHeld) ? White
                  : (chromatic && !inScale) ? LED_OFF
                  : (S.padNoteMap[i] % 12 === S.padKey ? rootColor : (chromatic ? LightGrey : DarkGrey));
            cachedSetLED(TRACK_PAD_BASE + i, color);
        }
        }
    }

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
            if (isFocused && isPlaying) {
                color = S.flashEighth ? TRACK_COLORS[t] : TRACK_DIM_COLORS[t];
            } else if (isFocused && isWillRelaunch) {
                color = slowPulse ? TRACK_COLORS[t] : TRACK_DIM_COLORS[t];
            } else if (isFocused) {
                color = TRACK_COLORS[t];
            } else if (!trackClipHasContent(t, sceneIdx)) {
                color = LED_OFF;
            } else if (S.trackPadMode[t] !== PAD_MODE_DRUM && !clipHasActiveNotes(t, sceneIdx)) {
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

    /* Knob LEDs (CC 71-78) */
    for (let k = 0; k < NUM_TRACKS; k++) {
        let ledVal = LED_OFF;
        if (S.sessionView) {
            ledVal = (k === S.activeTrack) ? White : LED_OFF;
        } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 5) {
            /* Repeat Groove: lit when step k has non-default vel scale or nudge */
            const lane = S.activeDrumLane[S.activeTrack];
            const isDirty = (S.drumRepeatVelScale[S.activeTrack][lane][k] !== 100) ||
                            (S.drumRepeatNudge[S.activeTrack][lane][k] !== 0);
            ledVal = isDirty ? White : LED_OFF;
        } else if (S.activeBank === 6) {
            const _t6 = S.activeTrack, _c6 = S.trackActiveClip[_t6];
            const _autoHas = (S.trackCCAutoBits[_t6][_c6] >> k) & 1;
            const _liveV = S.trackCCLiveVal[_t6][k];
            if (S.recordArmed) {
                ledVal = CC_SCRATCH_PALETTE_BASE + k;
            } else if (S.playing && _liveV >= 0) {
                ledVal = CC_SCRATCH_PALETTE_BASE + k;
            } else if (_autoHas) {
                ledVal = VividYellow;
            } else {
                ledVal = S.trackCCVal[_t6][k] !== 0 ? White : LED_OFF;
            }
        } else if (PARAM_LED_BANKS.indexOf(S.activeBank) >= 0) {
            const pm = BANKS[S.activeBank].knobs[k];
            if (pm && pm.abbrev && pm.scope !== 'stub') {
                ledVal = (S.bankParams[S.activeTrack][S.activeBank][k] !== pm.def) ? White : LED_OFF;
            }
        }
        cachedSetButtonLED(71 + k, ledVal);
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
    const ac = effectiveClip(t);
    const totalPages = Math.max(1, Math.ceil(S.clipLength[t][ac] / 16));
    const viewPage = Math.min(S.trackCurrentPage[t], totalPages - 1);
    const cs = S.trackCurrentStep[t];
    const playPage = (S.playing && S.trackClipPlaying[t] && cs >= 0)
                   ? Math.min(Math.floor(cs / 16), totalPages - 1) : -1;
    const barY = 57, barH = 5, segGap = 1;
    const segW = Math.max(2, Math.floor((120 - (totalPages - 1) * segGap) / totalPages));
    const startX = 4;
    for (let pg = 0; pg < totalPages; pg++) {
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
    /* Playhead dot: 1px wide, full bar height, mapped across 128px width */
    if (S.playing && S.trackClipPlaying[t] && cs >= 0) {
        const totalSteps = Math.max(1, S.clipLength[t][ac]);
        const dotX = Math.floor(cs * 128 / totalSteps);
        const viewSegStart = startX + viewPage * (segW + segGap);
        const onSolid = dotX >= viewSegStart && dotX < viewSegStart + segW;
        fill_rect(dotX, barY, 1, barH, onSolid ? 0 : 1);
    }
}

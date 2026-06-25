import {
    MoveShift,
    MoveBack,
    MovePlay,
    MoveLeft,
    MoveRight,
    MoveUp,
    MoveDown,
    MoveMute,
    MoveDelete
} from '/data/UserData/schwung/shared/constants.mjs';

import {
    Red,
    Blue,
    VividYellow,
    Green,
    DeepRed,
    DarkBlue,
    Mustard,
    DeepGreen,
    DarkGrey,
    LightGrey,
    HotMagenta,
    DeepMagenta,
    Cyan,
    PurpleBlue,
    Purple,
    DarkPurple,
    Bright,
    BurntOrange,
    White,
    SkyBlue,
    DeepBlue
} from '/data/UserData/schwung/shared/constants.mjs';

import {
    setLED,
    setButtonLED,
    isNoiseMessage,
    decodeDelta
} from '/data/UserData/schwung/shared/input_filter.mjs';

import {
    installConsoleOverride
} from '/data/UserData/schwung/shared/logger.mjs';

import {
    createInfo, createValue, createEnum, createToggle, createAction, createDivider, formatItemValue
} from '/data/UserData/schwung/shared/menu_items.mjs';

import {
    createMenuState, handleMenuInput
} from '/data/UserData/schwung/shared/menu_nav.mjs';

import {
    createMenuStack
} from '/data/UserData/schwung/shared/menu_stack.mjs';

import {
    drawMenuHeader, drawMenuList, menuLayoutDefaults
} from '/data/UserData/schwung/shared/menu_layout.mjs';

import {
    MoveNoteSession, MoveUndo, MoveLoop, MoveCopy, MoveMainTouch, MoveRec,
    MoveCapture, MoveSample, MoveMainButton, MoveMainKnob,
    LED_OFF, LED_STEP_ACTIVE, LED_STEP_CURSOR, SCENE_BTN_FLASH_TICKS,
    LEDS_PER_FRAME, NUM_TRACKS, NUM_CLIPS, DRUM_LANES, DRUM_BASE_NOTE,
    FLAG_JUMP_TO_OVERTAKE, FLAG_JUMP_TO_TOOLS, SEQ8_NAV_FLAGS, NUM_STEPS,
    TRACK_COLORS, TRACK_DIM_COLORS, SCENE_LETTERS, TRACK_PAD_BASE, TOP_PAD_BASE,
    TPS_VALUES, NOTE_KEYS, SCALE_NAMES, SCALE_DISPLAY, DELAY_LABELS,
    fmtSign, fmtStretch, fmtLen, fmtLgto, fmtRes, fmtPct, fmtNote, fmtPages,
    fmtDly, fmtBool, fmtRoute, fmtPlain, fmtNA, fmtGateMod,
    fmtArpStyle, fmtArpRate, fmtArpSteps, fmtArpOct, fmtVelOverride, fmtPlayDir, fmtRevStyle,
    col4, col5, parseActionRaw, MCUFONT, pixelPrint, pixelPrintC,
    BANKS, ACTION_POPUP_TICKS, PAD_MODE_DRUM, PAD_MODE_MELODIC_SCALE, PAD_MODE_CONDUCT,
    BANK_RESPONDER, BANK_OCTAVE, BANK_WHEN,
    POLL_INTERVAL, TAP_TEMPO_FLASH_TICKS, TAP_TEMPO_RESET_MS,
    PARAM_LED_BANKS, STATE_VERSION,
    CC_GRADIENT_BASE, CC_GRADIENT_LEVELS, CC_GRADIENT_SCALARS
} from './ui_constants.mjs';

import { S, CC_ASSIGN_DEFAULTS, PERF_FACTORY_PRESETS } from './ui_state.mjs';
import { saveState, writeSidecar, doClearSession, showActionPopup, uuidToStatePath, uuidToUiStatePath, readActiveSet, loadNameIndex, saveNameIndex, copyStateFiles, findInheritCandidates,
    SNAPSHOT_CAP, snapshotLabel, loadSnapshotManifest, commitSnapshot, applySnapshotToLive, dropSnapshots } from './ui_persistence.mjs';
import { drawGlobalMenu } from './ui_dialogs.mjs';
import { trackClipHasContent, sceneAllQueued, updateSceneMapLEDs } from './ui_scene.mjs';
import { effectiveClip, updateStepLEDs, updateSessionLEDs, updateTrackLEDs, flashAtRate, drawPositionBar, invalidateLEDCache, paintCoRunSideButtons, trackColor, trackDimColor } from './ui_leds.mjs';
import { SPLASH_FRAMES, SPLASH_COUNT, SPLASH_W, SPLASH_H, pickSplashIdx } from './ui_splash.mjs';
import { requestExport, confirmExportStart, pollPendingExport } from './ui_export.mjs';

/* ------------------------------------------------------------------ */
/* Parameter bank definitions                                           */
/* ------------------------------------------------------------------ */

function bankHeader(bankIdx) {
    return '[ ' + BANKS[bankIdx].name + ' ]';
}

/* Bank position in the jog-cycle order, for the header position strip. Melodic
 * banks cycle 0..6 linearly; drum banks cycle in BANK_CYCLE_DRUM order. Returns
 * {idx, count} for the active track's chain — mirrors the jog nav in _onCC_jog. */
const BANK_CYCLE_DRUM = [7, 0, 1, 3, 5, 6];
function bankCyclePos() {
    if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
        const i = BANK_CYCLE_DRUM.indexOf(S.activeBank);
        return { idx: i < 0 ? 0 : i, count: BANK_CYCLE_DRUM.length };
    }
    return { idx: Math.max(0, Math.min(6, S.activeBank)), count: 7 };
}

/* Compact "you are here in the bank chain" strip, right-aligned on the header
 * bar (replaces the old ad-hoc '>>' name hints). Each bank = a 3px tick; the
 * active bank = a tall filled block. Returns the strip's left x so the caller
 * can tuck the alt-arrow to its left. hdrBgWhite picks ink (black on white bar). */
function drawBankStrip(rightX, hdrBgWhite) {
    const fg = hdrBgWhite ? 0 : 1;
    const pos = bankCyclePos();
    const segW = 3, pitch = 4;
    const startX = rightX - (pos.count * pitch - 1);
    for (let i = 0; i < pos.count; i++) {
        const x = startX + i * pitch;
        if (i === pos.idx) fill_rect(x, 1, segW, 6, fg);   /* active: full 6px block */
        else               fill_rect(x, 5, segW, 2, fg);   /* others: 2px stub, baseline-aligned */
    }
    return startX;
}

/* Right side of the bank header: the bank-position strip on every screen —
 * resting overview AND deeper param banks — with the alt-arrow tucked to its
 * left. The strip replaces the old per-bank Tr[n] indicator. showTrack is now
 * vestigial here (kept for caller-signature stability). */
function drawBankHeaderRight(showTrack, hdrBgWhite) {
    if (S.sessionView) return;
    const sx = drawBankStrip(124, hdrBgWhite);
    if (bankHasAltParams(S.activeTrack, S.activeBank)) {
        drawAltArrow(sx - 8, hdrBgWhite, altIndicatorActive(S.activeTrack, S.activeBank));
    }
}

function drawBankHeading(name, showTrack) {
    fill_rect(0, 0, 128, 9, 1);
    /* Conductor banks: blink ONLY the "C-" prefix (phase driven in the tick loop,
     * like the alt-arrow flash); the bank name stays steady. */
    if (S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT &&
            name.charAt(0) === 'C' && name.charAt(1) === '-') {
        if (S._altBlinkPhase !== 1) print(4, 1, 'C-', 0);   /* prefix blinks */
        print(16, 1, name.slice(2), 0);                     /* bank name steady (after "C-") */
    } else {
        print(4, 1, name, 0);
    }
    drawBankHeaderRight(showTrack, true);
}

function drawBankHeadingInverted(name, showTrack) {
    fill_rect(0, 0, 128, 9, 0);
    fill_rect(0, 0, 128, 1, 1);
    fill_rect(0, 8, 128, 1, 1);
    print(4, 1, name, 1);
    drawBankHeaderRight(showTrack, false);
}

/* Conductor bank render: standard white bank header + a 2x4 (2 rows x 4 cols)
 * grid of per-track cells labeled Tr1..Tr8, value rendered under each label.
 * Column/row metrics + col4() fixed-width cells + touched-knob highlight match
 * the standard 8-knob bank overview (colX = 4 + (i%4)*30, rowY = 12 | 36, value
 * at rowY+12; cell i is filled and rendered inverted when S.knobTouched === i —
 * same idiom as the drum-lane / ALL-LANES overviews). valFn(trackIdx) -> short
 * string. The Conductor's own track cell shows inertLabel instead of a value. */
function drawConductTrackGrid(header, valFn, inertLabel) {
    drawBankHeading(header, false);
    for (let i = 0; i < 8; i++) {
        const colX = 4 + (i % 4) * 30;
        const rowY = i < 4 ? 12 : 36;
        const hi   = (S.knobTouched === i);
        if (hi) fill_rect(colX, rowY, 24, 24, 1);
        /* activeTrack is the Conductor whenever these banks render */
        const isCond = (i === S.activeTrack);
        print(colX, rowY,      col4(isCond ? '-' : 'Tr' + (i + 1)),  hi ? 0 : 1);
        print(colX, rowY + 12, col4(isCond ? inertLabel : valFn(i)), hi ? 0 : 1);
    }
}

/* Down-arrow affordance for banks that expose alt params. Always drawn in the
 * header text color (steady) when alt mode is off; flashes on/off ~2x/sec when
 * alt mode is on. `hdrBgWhite` true = header background is white (so arrow draws
 * black); false = header background is black (so arrow draws white). The blink
 * phase is set in the tick loop (S._altBlinkPhase) which also marks the screen
 * dirty so the animation runs while idle. */
function drawAltArrow(x, hdrBgWhite, on) {
    if (on && S._altBlinkPhase === 1) return;   /* off-phase of the flash */
    const fg = hdrBgWhite ? 0 : 1;
    fill_rect(x,     2, 5, 1, fg);
    fill_rect(x + 1, 3, 3, 1, fg);
    fill_rect(x + 2, 4, 1, 1, fg);
}

function drawStepEditHeader() {
    pixelPrint(37, 1, 'STEP EDIT', 1);
    fill_rect(0, 9, 128, 1, 1);
}

/* Per-step trig-condition formatters (v=34).
 *   formatStepIter(raw):  0 -> "—"; else "{idx}/{len}" with raw=(len<<4)|idx
 *   formatStepRand(raw):  0 -> "—" (100%); else "{n}%"
 *   formatStepRatch(raw): 0|1 -> "—"; else "x{n}" */
function formatStepIter(raw) {
    if (!raw) return '--';
    return (raw & 0xF) + '/' + ((raw >> 4) & 0xF);
}
function formatStepRand(raw) {
    if (!raw) return '--';
    return raw + '%';
}
function formatStepRatch(raw) {
    if (raw < 2) return '--';
    return 'x' + raw;
}
/* Iter knob list: 36 entries, raw byte at each position. Index 0 = default (1/1).
 * Sorted by cycle_len then cycle_idx: 1/1, 1/2, 2/2, 1/3, 2/3, 3/3, ..., 8/8. */
const STEP_ITER_LIST = (function() {
    const L = [0];
    for (let cl = 2; cl <= 8; cl++)
        for (let ci = 1; ci <= cl; ci++)
            L.push((cl << 4) | ci);
    return L;
})();


function drawMetroIndicator() {
    /* Match the Global Menu / Shift+Step6 popup wording exactly (one source of
     * truth): Off / Cnt-In / Play / Always. */
    const METRO_LABELS = [null, 'Cnt-In', 'Play', 'Always'];
    const label = METRO_LABELS[S.metronomeOn];
    if (label) {
        const tx = 8;
        const tw = label.length * 6;
        fill_rect(4, 22, 2, 2, 1);           /* left dot */
        pixelPrint(tx, 21, label, 1);
        fill_rect(tx + tw + 2, 22, 2, 2, 1); /* right dot */
    }
    /* Velocity / Fixed/Adaptive indicators (track view only, y=21) */
    if (!S.sessionView) {
        const t  = S.activeTrack;
        const ac = (!S.playing && S.trackQueuedClip[t] >= 0) ? S.trackQueuedClip[t] : S.trackActiveClip[t];
        const _isDrum7   = S.trackPadMode[t] === PAD_MODE_DRUM;
        const _isEmpty7  = _isDrum7 ? !S.drumClipNonEmpty[t][ac] : !S.clipNonEmpty[t][ac];
        const _manualL7  = _isDrum7 ? S.drumLaneLengthManuallySet[t] : S.clipLengthManuallySet[t][ac];
        /* Velocity input indicator (between metro and fixed/adap) */
        pixelPrint(67, 21, fmtVelOverride(S.trackVelOverride[t]), 1);
        if (_isEmpty7 && !_manualL7) {
            pixelPrint(103, 21, 'Adap', 1);
        } else {
            pixelPrint(109, 21, 'Fix', 1);
        }
    }
}

/* ------------------------------------------------------------------ */
/* Global menu items                                                    */
/* ------------------------------------------------------------------ */

/* Stub state for not-yet-wired global menu params */

/* Launch quantization: 0=Now, 1=1/16, 2=1/8, 3=1/4, 4=1/2, 5=1-bar; default 0 */

function buildGlobalMenuItems() {
    return [
        createValue('Channel', {
            get: function() { return S.trackChannel[S.activeTrack]; },
            /* Conductor has no MIDI channel — inert + shows '-'. */
            set: function(v) {
                if (S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT) return;
                applyTrackConfig(S.activeTrack, 'channel', v);
            },
            min: 1, max: 16, step: 1,
            format: function(v) {
                return S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT ? fmtNA() : String(v);
            }
        }),
        createEnum('Route', {
            get: function() { return S.trackRoute[S.activeTrack]; },
            /* Conductor routes nowhere (drives transposition) — inert + shows '-'. */
            set: function(v) {
                if (S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT) return;
                applyTrackConfig(S.activeTrack, 'route', v);
            },
            options: [0, 1, 2],
            format: function(v) {
                return S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT ? fmtNA() : fmtRoute(v);
            }
        }),
        createEnum('Mode', {
            get: function() { return S.trackPadMode[S.activeTrack]; },
            /* DEFERRED COMMIT: scrolling only previews the selected type — set()
             * is a no-op, so passing over Drums/Cond while scrolling never fires
             * a conversion or confirm. The conversion (behind its confirm) is
             * triggered by the commit CLICK, intercepted in the jog-click handler
             * (search: label === 'Mode'). Mirrors the Key/Scale commit-on-click
             * pattern. Keys/Drums/Cond = PAD_MODE_MELODIC_SCALE/DRUM/CONDUCT. */
            set: function() {},
            options: [0, 1, 2],
            format: function(v) { return v === PAD_MODE_CONDUCT ? 'Conduct' : (v ? 'Drums' : 'Keys'); }
        }),
        createEnum('Layout', {
            get: function() { return S.padLayoutChromatic[S.activeTrack] ? 1 : 0; },
            set: function(v) {
                if (S.trackPadMode[S.activeTrack] !== 0) return;
                S.padLayoutChromatic[S.activeTrack] = v !== 0;
                computePadNoteMap();
                forceRedraw();
            },
            options: [0, 1],
            format: function(v) {
                if (S.trackPadMode[S.activeTrack] !== 0) return fmtNA();
                return v ? 'Chrom' : 'Scale';
            }
        }),
        createValue('VelIn', {
            get: function() { return S.trackVelOverride[S.activeTrack]; },
            set: function(v) { applyTrackConfig(S.activeTrack, 'track_vel_override', v); },
            min: 0, max: 127, step: 1,
            format: function(v) { return fmtVelOverride(v); }
        }),
        createToggle('Looper', {
            get: function() { return S.trackLooper[S.activeTrack] !== 0; },
            set: function(v) { applyTrackConfig(S.activeTrack, 'track_looper', v ? 1 : 0); },
            onLabel: 'On', offLabel: 'Off'
        }),
        /* Pad-pressure (aftertouch) send mode — melodic tracks only. On drum
         * tracks pad pressure is owned by the repeat-velocity system, so the
         * item is hidden there. Move route supports Off/Poly only (Move
         * instruments take poly AT); Schwung/External also offer Channel.
         * Options recompute each menu open (buildGlobalMenuItems re-runs). Mode is
         * JS-side (carried per-message in tN_live_at) → persisted in the sidecar. */
        ...(S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM ? [
            createEnum('AftTch', {
                get: function() { return S.trackAtMode[S.activeTrack] | 0; },
                set: function(v) { S.trackAtMode[S.activeTrack] = v | 0; writeSidecar(); },
                options: S.trackRoute[S.activeTrack] === 1 ? [0, 1] : [0, 1, 2],
                format: function(v) { return v === 2 ? 'Chan' : v === 1 ? 'Poly' : 'Off'; }
            })
        ] : []),
        /* Co-run capability gate. The chain-editor co-run feature gates on
         * shadow_corun_begin — the co-run framework merged upstream as #94,
         * shipped in Schwung 0.9.18. On Schwung older than 0.9.18 the API is
         * undefined and the menu entry isn't built, so the feature is invisible.
         * All other co-run code is dormant unless this entry triggers it. Also
         * hidden on non-Schwung-routed tracks (symmetric with Edit Synth below). */
        ...((S.trackRoute[S.activeTrack] === 0 &&
             typeof shadow_corun_begin === 'function') ? [
            createAction('Edit Slot...', function() {
                openSchwungSlotEditor(S.activeTrack);
            })
        ] : []),
        /* Move-native co-run entry — visible only when (a) active track is
         * ROUTE_MOVE, (b) the co-run API (shadow_corun_begin, Schwung >= 0.9.18)
         * is present, and (c) the cable-0 MIDI inject API is present (Schwung
         * >= v0.7.0). On older Schwung or non-Move-routed tracks the entry isn't built. */
        ...((S.trackRoute[S.activeTrack] === 1 &&
             typeof shadow_corun_begin === 'function' &&
             typeof move_midi_inject_to_move === 'function') ? [
            createAction('Edit Synth...', function() {
                enterMoveNativeCoRun(S.activeTrack);
            })
        ] : []),
        createDivider('Global'),
        /* Clock Follow: follow Move's MIDI clock + transport. Default off =
         * unchanged internal free-run. When on, BPM is read-only (EXT) and Play
         * drives Move (single source of truth). */
        createToggle('Clock Follow', {
            get: function() { return S.clockFollowOn === true; },
            set: function(v) {
                S.clockFollowOn = v ? true : false;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('clock_follow_on', S.clockFollowOn ? '1' : '0');
            },
            onLabel: 'Move', offLabel: 'Off'
        }),
        /* Clock Out: db emits MIDI clock (start/stop + 24-PPQN) to external gear
         * over USB-A when free-running (db is master at its own tempo). Suppressed
         * while Clock Follow = Move (Move's own MIDI Clock Out owns external sync,
         * so db relaying would double the clock on the shared port). The toggle
         * stays a stored preference even while following; the value shows "—"
         * then. Uses createEnum (not createToggle) so the "—" format applies. */
        createEnum('Clock Out', {
            get: function() { return S.clockSendOn ? 1 : 0; },
            set: function(v) {
                S.clockSendOn = v ? true : false;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('clock_send_on', S.clockSendOn ? '1' : '0');
            },
            options: [0, 1],
            format: function(v) { return S.clockFollowOn ? '—' : (v ? 'On' : 'Off'); }
        }),
        createValue('BPM', {
            get: function() {
                const v = parseFloat(host_module_get_param('bpm'));
                return (v > 0 && isFinite(v)) ? Math.round(v) : 120;
            },
            /* Read-only while following — Move owns tempo (DSP also ignores writes). */
            set: function(v) {
                if (S.clockFollowOn) return;
                host_module_set_param('bpm', String(Math.round(v)));
            },
            min: 40, max: 250, step: 1,
            format: function(v) { return S.clockFollowOn ? 'Move' : String(Math.round(v)); }
        }),
        createAction('Tap Tempo', function() {
            if (S.clockFollowOn) { showActionPopup('TEMPO: MOVE'); return; }
            openTapTempo();
        }),
        /* Key/Scale: turning the knob previews a transpose of all melodic clips
         * (live, uncommitted); the click commits behind a confirm (see the
         * jog-click intercept + xpose* helpers). set() runs as the menu-edit
         * live preview AND on edit-exit (set(get()) → candidate==committed →
         * cancel), so back-out cleanly drops the preview. */
        createEnum('Key', {
            get: function() { return S.padKey; },
            set: function(v) { xposePreviewSet(v, S.padScale); },
            options: [0,1,2,3,4,5,6,7,8,9,10,11],
            format: function(v) { return NOTE_KEYS[((v | 0) % 12 + 12) % 12]; }
        }),
        createEnum('Scale', {
            get: function() { return S.padScale; },
            set: function(v) { xposePreviewSet(S.padKey, v); },
            options: [0,1,2,3,4,5,6,7,8,9,10,11,12,13],
            format: function(v) { return SCALE_NAMES[v] || 'Major'; }
        }),
        createToggle('Scale Aware', {
            get: function() { return S.scaleAware !== 0; },
            set: function(v) {
                S.scaleAware = v ? 1 : 0;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('scale_aware', S.scaleAware ? '1' : '0');
            },
            onLabel: 'On', offLabel: 'Off'
        }),
        createEnum('Launch', {
            get: function() { return S.launchQuant; },
            set: function(v) {
                S.launchQuant = v;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('launch_quant', String(v));
            },
            options: [0, 1, 2, 3, 4, 5],
            format: function(v) {
                return ['Now','1/16','1/8','1/4','1/2','1-bar'][v] || '1-bar';
            }
        }),
        createValue('Swing Amt', {
            get: function() { return S.swingAmt; },
            set: function(v) { S.swingAmt = v; host_module_set_param('swing_amt', String(v)); },
            min: 0, max: 100,
            format: function(v) { return Math.round(50 + v * 0.25) + '%'; }
        }),
        createEnum('Swing Res', {
            get: function() { return S.swingRes; },
            set: function(v) { S.swingRes = v; host_module_set_param('swing_res', String(v)); },
            options: [0, 1],
            format: function(v) { return ['1/16','1/8'][v] || '1/16'; }
        }),
        createEnum('MIDI In', {
            get: function() { return S.midiInChannel; },
            set: function(v) {
                S.midiInChannel = v;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('midi_in_channel', String(v));
            },
            options: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],
            format: function(v) { return v === 0 ? 'All' : String(v); }
        }),
        createEnum('Metro', {
            get: function() { return S.metronomeOn; },
            set: function(v) {
                S.metronomeOn = v | 0;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('metro_on', String(S.metronomeOn));
            },
            options: [0, 1, 2, 3],
            format: function(v) {
                return ['Off', 'Cnt-In', 'Play', 'Always'][v | 0];
            }
        }),
        createValue('Metro Vol', {
            get: function() { return S.metronomeVol; },
            set: function(v) {
                S.metronomeVol = v | 0;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('metro_vol', String(S.metronomeVol));
            },
            min: 0, max: 150, step: 1,
            format: function(v) { return String(v | 0) + '%'; }
        }),
        createToggle('Beat Marks', {
            get: function() { return S.beatMarkersEnabled; },
            set: function(v) { S.beatMarkersEnabled = v; forceRedraw(); },
            onLabel: 'On', offLabel: 'Off'
        }),
        createAction('Export to Ableton', function() {
            requestExport();
        }),
        createAction('Save state', function() {
            S.confirmSaveCount = loadSnapshotManifest(S.currentSetUuid).length;
            S.confirmSaveState = true;
            S.confirmSaveSel   = 1;   /* default No */
        }),
        createAction('Load state', function() {
            openLoadSnapshot();
        }),
        createAction('Clear Sess', function() {
            S.confirmClearSession = true;
            S.confirmClearSel     = 1;
            S.screenDirty         = true;
        }),
        createAction('Quit', function() {
            saveState();                       /* sets pendingSuspendSave */
            S.pendingExitAfterSave = true;     /* drained one tick after save fires */
            S.globalMenuOpen = false;
        }),
    ];
}


/* ------------------------------------------------------------------ */
/* UI state                                                             */
/* ------------------------------------------------------------------ */

/* Performance Mode state. Session View + Loop held → pad grid shows Perf Mode.
 * S.perfStack: currently-held R0 length pads (same stack semantics as old looper
 * step stack; rate captured at press time). Top = active rate.
 * S.perfModsToggled: latched modifier bitmask (Latch-toggle presses).
 * S.perfModsHeld: momentary bitmask (held mod pads, not Latch-pressed).
 * DSP receives (S.perfModsToggled | S.perfModsHeld) as perf_mods each change. */
/* Co-run target enum + keep-mask flags — mirrors corun_target_t and the
 * CORUN_GRP_* / CORUN_KEEP_* bits in Schwung's shadow_constants.h. The shim
 * registers these as globals on shadow_ui's JS context; redeclaring them
 * here makes the dAVEBOx tool context self-contained on platforms that scope
 * globals differently. Keep in sync with docs/CORUN.md. */
const CORUN_TARGET_NONE        = 0;
const CORUN_TARGET_CHAIN_EDIT  = 1;
const CORUN_TARGET_MOVE_NATIVE = 2;
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
const DAVEBOX_PICKER_KEEP_MASK =
    DAVEBOX_CORUN_KEEP_MASK | CORUN_GRP_JOG | CORUN_GRP_BACK | CORUN_GRP_KNOBS | CORUN_GRP_TOUCH | CORUN_GRP_SHIFT;

const LOOPER_RATES_STRAIGHT = [12, 24, 48, 96, 192];   /* 1/32, 1/16, 1/8, 1/4, 1/2 */
const PERF_LATCH_LONG_PRESS = 100;     /* ~510ms → clear all toggled mods + exit Latch mode */
/* Pad → modifier bit index. R1=bits 0-7 (pitch), R2=bits 8-15 (vel/gate), R3=bits 16-23 (wild). */
const PERF_MOD_PAD_MAP = Object.freeze({
    76: 0,  /* Oct↑    */ 77: 1,  /* Oct↓    */ 78: 2,  /* Sc↑     */ 79: 3,  /* Sc↓     */
    80: 4,  /* 5th     */ 81: 5,  /* Triton  */ 82: 6,  /* Drift   */ 83: 7,  /* Storm   */
    84: 8,  /* Soft    */ 85: 9,  /* Hard    */ 86: 10, /* Cresc   */ 87: 11, /* Pulse   */
    88: 12, /* Sdchn   */ 89: 13, /* Stac    */ 90: 14, /* Lgto    */ 91: 15, /* RmpG    */
    92: 16, /* ½time   */ 93: 17, /* 3Skip   */ 94: 18, /* Phnm    */ 95: 19, /* Sprs    */
    96: 20, /* Gltch   */ 97: 21, /* Stggr   */ 98: 22, /* Shfl    */ 99: 23, /* Back    */
});
const PERF_MOD_NAMES = [
    'Oct↑','Oct↓','Sc↑','Sc↓','5th','Triton','Drift','Storm',
    'Decrsc','Swell','Cresc','Pulse','Sdchn','Stac','Lgto','RmpG',
    '½time','3Skip','Phnm','Sprs','Gltch','Stggr','Shfl','Back',
];
const PERF_MOD_FULL_NAMES = [
    'Octave Up','Octave Down','Scale Up','Scale Down','Fifth','Tritone','Drift','Storm',
    'Decrescendo','Swell','Crescendo','Pulse','Sidechain','Staccato','Legato','Ramp Gate',
    'Half Time','3 Skip','Phantom','Sparse','Glitch','Stagger','Shuffle','Backwards',
];

/* Preset S.snapshots: 16 slots (step buttons 1-16).
 * S.perfRecalledSlot: which slot is active (-1 = none); preset bits are
 * copied into S.perfModsToggled on recall so mod pads can toggle them off.
 * Factory presets populate slots 0-7 (steps 1-8) at init. */
const PERF_MOD_POPUP_TICKS = 80; /* ~500ms at ~160 ticks/s */

/* View lock: double-tap Loop keeps Perf Mode alive after Loop is released.
 * Single tap while locked → unlock + stop loop. */
const LOOP_TAP_TICKS  = 40;
const LOOP_DBLTAP_GAP = 80;

/* Live pad note input — isomorphic 4ths diatonic layout. */
const SCALE_INTERVALS = [
    [0, 2, 4, 5, 7, 9, 11],        /*  0 Major           */
    [0, 2, 3, 5, 7, 8, 10],        /*  1 Minor           */
    [0, 2, 3, 5, 7, 9, 10],        /*  2 Dorian          */
    [0, 1, 3, 5, 7, 8, 10],        /*  3 Phrygian        */
    [0, 2, 4, 6, 7, 9, 11],        /*  4 Lydian          */
    [0, 2, 4, 5, 7, 9, 10],        /*  5 Mixolydian      */
    [0, 1, 3, 5, 6, 8, 10],        /*  6 Locrian         */
    [0, 2, 3, 5, 7, 8, 11],        /*  7 Harmonic Minor  */
    [0, 2, 3, 5, 7, 9, 11],        /*  8 Melodic Minor   */
    [0, 2, 4, 7, 9],               /*  9 Pentatonic Major*/
    [0, 3, 5, 7, 10],              /* 10 Pentatonic Minor*/
    [0, 3, 5, 6, 7, 10],           /* 11 Blues           */
    [0, 2, 4, 6, 8, 10],           /* 12 Whole Tone      */
    [0, 2, 3, 5, 6, 8, 9, 11],     /* 13 Diminished      */
];

/* Step-edit pitch nudge: move note up/down to next in-scale pitch.
 * When scale-aware is off, shifts by exactly 1 semitone per dir. */
function scaleNudgeNote(note, dir, key, scale) {
    if (!S.scaleAware) return Math.max(0, Math.min(127, note + dir));
    const ivls = SCALE_INTERVALS[scale];
    let candidate = note + dir;
    while (candidate >= 0 && candidate <= 127) {
        const pc = ((candidate - key) % 12 + 12) % 12;
        if (ivls.indexOf(pc) >= 0) return candidate;
        candidate += dir;
    }
    return Math.max(0, Math.min(127, note + dir));
}


/* Per-pad pitch sent at note-on — ensures matching note-off even if map changes mid-hold. */
const padPitch = new Array(32).fill(-1);
const padPressTick = new Array(32).fill(-1);  /* tick when each pad was pressed, for drum tap-vs-hold detection */
const DRUM_TAP_TICKS = 10;  /* ~30ms — taps shorter than this suppress the release note-off */

/* S.clipSteps[track][clip][step] — JS-authoritative mirror of DSP step data */
/* S.clipNonEmpty[track][clip] — cached result of clipHasContent; updated on every S.clipSteps write */

/* Drum mode state */
/* S.drumLaneSteps[t][l] — '0'/'1'/'2' per step (up to 256), cached from DSP for the active clip */
/* S.drumLaneHasNotes[t][l] — true if lane l has any programmed hits */
/* S.drumLaneNote[t][l] — current MIDI note for lane l (JS mirror of lane->midi_note) */
/* S.drumLaneFlashTick[t][l] — S.tickCount when this lane last fired a hit (for pad flash) */
/* Per-track drum lane mute/solo bitmasks (uint32 mirrors of DSP drum_lane_mute/drum_lane_solo) */
/* Drum Repeat state */
/* Rpt2 state */
/* Per-track per-lane repeat groove state mirrors */
/* SEQ ARP per-clip step_vel[8] mirror. Stored as level 0..4:
 *   0 = step off (no note)
 *   1 = bottom row (vel 10)
 *   4 = top row (vel = incoming) — default. */
/* TRACK ARP per-track step_vel[8] mirror (per-track, not per-clip). */
const DRUM_FLASH_TICKS = 8; /* ~130ms pad flash duration after a drum hit */
/* S.drumClipNonEmpty[t][c] — true if any lane in drum clip c of track t has content */
/* Per-track config (formerly TRACK bank 0 params) */

/* Per-tick scene state cache — computed once at top of tick(), O(1) lookup in LED update fns */


/* ------------------------------------------------------------------ */
/* Parameter bank state                                                 */
/* ------------------------------------------------------------------ */

/* S.activeBank: index 0-6 (pad 92-98). CLIP bank (0) is default. */

/* S.knobTouched: 0-7 (MoveKnob1Touch-8Touch note numbers), or -1 = none */

/* Per-physical-knob sensitivity accumulators.
 * S.knobAccum[k] counts raw encoder ticks; fires delta when >= pm.sens.
 * S.knobLastDir[k] tracks last direction for reversal detection.
 * S.knobLocked[k] blocks further firing until touch release (used by lock=true params). */

/* S.bankSelectTick: S.tickCount at last bank select, used for the State 3 timeout.
 * -1 = timeout not active. */
const BANK_DISPLAY_TICKS = 94;  /* ~1000ms at 94Hz device tick rate (was 392 = ~4.2s; constant was miscalibrated for 196Hz) */
const STRETCH_BLOCKED_TICKS = 294;  /* ~1500ms at 196Hz */
const NO_NOTE_FLASH_TICKS = 118;     /* ~600ms at 196Hz */
const KNOB_TURN_HIGHLIGHT_TICKS = 120;            /* ~600ms at 196Hz — highlight after turn without touch */

/* S.bankParams[track][bankIdx][knobIdx] = integer value (JS-authoritative).
 * Initialized from BANKS defaults; refreshed from DSP on bank select. */

/* CC PARAM bank (bank 6) — per-track state, JS-authoritative */

/* Scratch palette indices for CC bank live value display (51-58, all undefined in palette).
 * Updated dynamically via SysEx each tick — one entry per knob. */

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
function setPaletteEntryRGB(idx, r, g, b) {
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

function reapplyPalette() { move_midi_internal_send(_CC_REAPPLY_PKT); }

/* Resolve the Schwung chain slot index for a dAVEBOx track's MIDI channel.
 * shadow_get_slots() returns {channel, name} per slot where channel is 1-16
 * (matching trackChannel) or 0 for "All". Returns -1 if no match. */
/* First (lowest-index) Schwung slot that receives a track's MIDI channel, or -1.
 * Thin wrapper over schSlotsForTrack so the match logic lives in one place. */
function schSlotForTrack(t) {
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
function schSlotsForTrack(t) {
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

/* Format CC number as a 4-char display label: CC7→"CC7 ", CC74→"CC74", C100→"C100" */
function fmtCCLabel(cc) {
    const n = (cc | 0);
    return n >= 100 ? 'C' + n : 'CC' + n;
}

/* ------------------------------------------------------------------ */
/* Step entry state                                                     */
/* ------------------------------------------------------------------ */

/* S.heldStepBtn: physical button index 0-15 that is currently held (-1 = none).
 * Stored separately from S.heldStep so a second button press doesn't cause the
 * first button's release to exit step edit prematurely. */

const STEP_HOLD_TICKS      = 19;   /* ~200ms at ~94Hz (device actual): below = tap, at/above = hold */
const STEP_SAVE_HOLD_TICKS = 70;   /* ~750ms at 94Hz */
const STEP_SAVE_FLASH_TICKS = 40;  /* ~200ms double-blink on step button LEDs after save */

/* Metronome */

/* Undo/redo availability (mirrors DSP undo_valid/redo_valid; set on every undoable action) */

/* Per-track mute/solo state (JS mirrors DSP) */

/* Suspend detection (suspend_keeps_js) */

/* Global menu state (Phase 5q) */

/* Tap Tempo screen state */

/* Session overview overlay (hold CC 50) */
const NOTE_SESSION_HOLD_TICKS = 40;  /* ~200ms at 196Hz */

/* Real-time recording state */

const pendingLiveNotes = Array.from({length: NUM_TRACKS}, () => []);  /* buffered live notes flushed each tick */
const pendingDrumNoteOffs = Array.from({length: NUM_TRACKS}, () => []);  /* drum tap note-offs deferred 1 tick to avoid coalescing with note-on */
const _drumRecNoteOns  = [];  /* { track, laneNote, vel } — queued drum recording note-ons */
const _drumRecNoteOffs = [];  /* { track, laneNote } — queued drum recording note-offs */


/* ------------------------------------------------------------------ */
/* Utility                                                              */
/* ------------------------------------------------------------------ */

function midiNoteName(n) {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    return names[n % 12] + (Math.floor(n / 12) - 1);
}

function effectiveMute(t) {
    const anySolo = S.trackSoloed.some(function(s) { return s; });
    return S.trackMuted[t] || (anySolo && !S.trackSoloed[t]);
}

function setTrackMute(t, on) {
    S.trackMuted[t] = on;
    if (on && S.trackSoloed[t]) {
        S.trackSoloed[t] = false;
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + t + '_solo', '0');
    }
    if (typeof host_module_set_param === 'function')
        host_module_set_param('t' + t + '_mute', on ? '1' : '0');
    S.screenDirty = true;
}

function setTrackSolo(t, on) {
    /* Solo is disabled on the Conductor track — the control is inert. (It emits
     * no MIDI, and soloing it would wrongly silence every other track.) Mute
     * stays functional via setTrackMute. */
    if (S.trackPadMode[t] === PAD_MODE_CONDUCT) return;
    S.trackSoloed[t] = on;
    if (on && S.trackMuted[t]) {
        S.trackMuted[t] = false;
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + t + '_mute', '0');
    }
    if (typeof host_module_set_param === 'function')
        host_module_set_param('t' + t + '_solo', on ? '1' : '0');
    S.screenDirty = true;
}

function clearAllMuteSolo() {
    for (let _t = 0; _t < NUM_TRACKS; _t++) {
        S.trackMuted[_t]  = false;
        S.trackSoloed[_t] = false;
    }
    if (typeof host_module_set_param === 'function')
        host_module_set_param('mute_all_clear', '1');
    S.screenDirty = true;
}

/* Immediately refresh S.seqActiveNotes for the given step if it is the current
 * sequencer position on the active track — call after any step state change. */
function refreshSeqNotesIfCurrent(t, ac, absIdx) {
    if (absIdx !== S.trackCurrentStep[t] || ac !== S.trackActiveClip[t]) return;
    S.seqActiveNotes.clear();
    S.seqLastStep = -1;
    S.seqNoteOnClipTick = -1;
    if (S.clipSteps[t][ac][absIdx] && typeof host_module_get_param === 'function') {
        const r = host_module_get_param('t' + t + '_c' + ac + '_step_' + absIdx + '_notes');
        if (r && r.trim().length > 0)
            r.trim().split(' ').forEach(function(sn) {
                const p = parseInt(sn, 10);
                if (p >= 0 && p <= 127) S.seqActiveNotes.add(p);
            });
    }
}

/* Clear all notes from a step and deactivate it (atomic DSP write). */
function clearStep(t, ac, absIdx) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 't' + t + '_c' + ac + '_step_' + absIdx + '_clear', val: '1' });
    S.clipSteps[t][ac][absIdx] = 0;
    if (S.clipNonEmpty[t][ac]) S.clipNonEmpty[t][ac] = clipHasContent(t, ac);
    refreshSeqNotesIfCurrent(t, ac, absIdx);
}

function showModePopup(title, items, activeIdx) {
    S.actionPopupLines     = [title, ...items];
    S.actionPopupHighlight = activeIdx + 1;
    S.actionPopupEndTick   = S.tickCount + ACTION_POPUP_TICKS;
    S.screenDirty = true;
}

function playMetronomeClick() {
    /* DSP handles click audio via render_block; nothing to do here */
}

/* Clear all steps in a clip. clearClip runs in on_midi context and schedules
 * its tN_cC_clear via pendingDefaultSetParams. The drain at tick() bottom
 * fires on the SAME audio buffer as the synchronous set_param fan-out from
 * resetPerClipBankParamsToDefault below — and the host coalesces all of them
 * down to a single survivor, eating the queued _clear. clearDrainHold defers
 * the drain by one tick so _clear lands in a clean buffer. */
function clearClip(t, ac, keepPlaying) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    /* Clip CLEAR semantics (matches drum lane Clear, Group I): wipe step
     * note data only. Preserve length, loop window, ticks_per_step, the
     * destructive CLIP-bank params (stretch_exp / clock_shift_pos /
     * nudge_pos), and per-clip pfx (NOTE FX / HARMONY / DELAY / SEQUENCE
     * ARP). Hard Reset (Shift+Delete) is the gesture that wipes structure. */
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        const keep = (keepPlaying && S.trackClipPlaying[t] && ac === S.trackActiveClip[t]) ? '1' : '0';
        S.pendingDefaultSetParams.unshift({ key: 't' + t + '_c' + ac + '_drum_clear', val: keep });
        S.clearDrainHold = 1;
        for (let l = 0; l < DRUM_LANES; l++) {
            for (let s = 0; s < 256; s++) S.drumLaneSteps[t][l][s] = '0';
            S.drumLaneHasNotes[t][l] = false;
        }
        S.drumClipNonEmpty[t][ac] = false;
        if (ac === S.trackActiveClip[t]) {
            S.seqActiveNotes.clear();
        }
        return;
    }
    const cmd = (keepPlaying && S.trackClipPlaying[t] && ac === S.trackActiveClip[t])
        ? 't' + t + '_c' + ac + '_clear_keep'
        : 't' + t + '_c' + ac + '_clear';
    S.pendingDefaultSetParams.unshift({ key: cmd, val: '1' });
    /* Defer drain 1 tick to keep _clear out of the same audio buffer as any
     * sync set_param fan-out that might still be in flight. */
    S.clearDrainHold = 1;
    const len = S.clipLength[t][ac];
    for (let s = 0; s < len; s++) S.clipSteps[t][ac][s] = 0;
    S.clipNonEmpty[t][ac] = false;
    /* Clip clear now also wipes all automation DSP-side — mirror it so the
     * AUTOMATION-bank indicators + CC values reflect the clear immediately. */
    S.trackCCAutoBits[t][ac] = 0;
    S.clipCCVal[t][ac] = new Array(8).fill(-1);
    S.clipAtHas[t][ac] = false;
    invalidateLEDCache();
    /* Re-read steps from DSP 2 ticks later so step LEDs catch up after _clear
     * has drained. Belt-and-suspenders against any state that still reads from
     * DSP after the synchronous JS mirror wipe. */
    S.pendingStepsReread      = 2;
    S.pendingStepsRereadTrack = t;
    S.pendingStepsRereadClip  = ac;
    if (ac === S.trackActiveClip[t]) {
        S.seqActiveNotes.clear(); S.seqLastStep = -1; S.seqNoteOnClipTick = -1;
        /* Focused-clip-by-default: after clearing the focused clip, ensure it
         * stays playing so the track doesn't go silent. If trackClipPlaying
         * was true we used _clear_keep (DSP preserves playback). If it was
         * false (e.g. clip hadn't auto-launched yet), re-launch now while
         * transport is playing so the cleared clip ticks through empty steps. */
        if (S.playing && !S.trackClipPlaying[t]
                && !S.trackWillRelaunch[t]
                && S.trackQueuedClip[t] === -1) {
            S.pendingDefaultSetParams.push({ key: 't' + t + '_launch_clip', val: String(ac) });
            S.trackQueuedClip[t] = ac;
        }
    }
}

/* Full factory reset: clip_init on DSP + JS mirror cleared. Track View only. */
function hardResetClip(t, ac) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        /* Drum clip reset: clip_init all 32 lanes; midi_note preserved */
        S.pendingDefaultSetParams.unshift({ key: 't' + t + '_c' + ac + '_drum_reset', val: '1' });
        S.clearDrainHold = 1;
        for (let l = 0; l < DRUM_LANES; l++) {
            for (let s = 0; s < 256; s++) S.drumLaneSteps[t][l][s] = '0';
            S.drumLaneHasNotes[t][l] = false;
        }
        S.drumClipNonEmpty[t][ac] = false;
        S.clipLengthManuallySet[t][ac] = false;
        S.drumLaneLengthManuallySet[t]  = false;
        if (ac === S.trackActiveClip[t]) {
            S.drumLaneLength[t] = 16;
            S.drumLaneLoopStart[t] = 0;
            S.drumLaneTPS[t]    = 24;
            S.drumStepPage[t]   = 0;
            S.trackCurrentPage[t] = 0;
            S.seqActiveNotes.clear();
        }
        return;
    }
    S.pendingDefaultSetParams.unshift({ key: 't' + t + '_c' + ac + '_hard_reset', val: '1' });
    S.clearDrainHold = 1;
    const defaultLen = 16;
    for (let s = 0; s < NUM_STEPS; s++) S.clipSteps[t][ac][s] = 0;
    S.clipLength[t][ac] = defaultLen;
    S.clipLoopStart[t][ac] = 0;
    S.clipNonEmpty[t][ac] = false;
    S.clipTPS[t][ac] = 24;
    S.clipLengthManuallySet[t][ac] = false;
    for (var _k = 0; _k < 8; _k++) {
        S.ccLaneLoopStart[t][ac][_k] = 0;
        S.ccLaneLength[t][ac][_k]    = 0;
        S.ccLaneTps[t][ac][_k]       = 0;
    }
    if (ac === S.trackActiveClip[t]) {
        S.trackCurrentPage[t] = 0;
        S.seqActiveNotes.clear(); S.seqLastStep = -1; S.seqNoteOnClipTick = -1;
        resetPerClipBankParamsToDefault(t);
    }
}

/* Copy clip src→dst (single atomic DSP write, JS mirror update). */
function copyClip(srcT, srcC, dstT, dstC) {
    if (srcT === dstT && srcC === dstC) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'clip_copy', val: `${srcT} ${srcC} ${dstT} ${dstC}` });
    S.clipSteps[dstT][dstC] = S.clipSteps[srcT][srcC].slice();
    S.clipLength[dstT][dstC] = S.clipLength[srcT][srcC];
    S.clipLoopStart[dstT][dstC] = S.clipLoopStart[srcT][srcC];
    S.clipNonEmpty[dstT][dstC] = S.clipNonEmpty[srcT][srcC];
    S.clipTPS[dstT][dstC] = S.clipTPS[srcT][srcC];
    for (var _k = 0; _k < 8; _k++) {
        S.ccLaneLoopStart[dstT][dstC][_k] = S.ccLaneLoopStart[srcT][srcC][_k];
        S.ccLaneLength[dstT][dstC][_k]    = S.ccLaneLength[srcT][srcC][_k];
        S.ccLaneTps[dstT][dstC][_k]       = S.ccLaneTps[srcT][srcC][_k];
    }
    if (dstC === S.trackActiveClip[dstT]) {
        S.seqActiveNotes.clear(); S.seqLastStep = -1;
        refreshPerClipBankParams(dstT);
    }
}

/* Cut clip: copy src→dst then hard-reset src (single atomic DSP write, JS mirror update). */
function cutClip(srcT, srcC, dstT, dstC) {
    if (srcT === dstT && srcC === dstC) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'clip_cut', val: `${srcT} ${srcC} ${dstT} ${dstC}` });
    S.clipSteps[dstT][dstC] = S.clipSteps[srcT][srcC].slice();
    S.clipLength[dstT][dstC] = S.clipLength[srcT][srcC];
    S.clipLoopStart[dstT][dstC] = S.clipLoopStart[srcT][srcC];
    S.clipNonEmpty[dstT][dstC] = S.clipNonEmpty[srcT][srcC];
    S.clipTPS[dstT][dstC] = S.clipTPS[srcT][srcC];
    for (var _k = 0; _k < 8; _k++) {
        S.ccLaneLoopStart[dstT][dstC][_k] = S.ccLaneLoopStart[srcT][srcC][_k];
        S.ccLaneLength[dstT][dstC][_k]    = S.ccLaneLength[srcT][srcC][_k];
        S.ccLaneTps[dstT][dstC][_k]       = S.ccLaneTps[srcT][srcC][_k];
    }
    if (dstC === S.trackActiveClip[dstT]) {
        S.seqActiveNotes.clear(); S.seqLastStep = -1;
        refreshPerClipBankParams(dstT);
    }
    for (let s = 0; s < NUM_STEPS; s++) S.clipSteps[srcT][srcC][s] = 0;
    S.clipLength[srcT][srcC] = 16;
    S.clipLoopStart[srcT][srcC] = 0;
    S.clipNonEmpty[srcT][srcC] = false;
    S.clipTPS[srcT][srcC] = 24;
    for (var _k2 = 0; _k2 < 8; _k2++) {
        S.ccLaneLoopStart[srcT][srcC][_k2] = 0;
        S.ccLaneLength[srcT][srcC][_k2]    = 0;
        S.ccLaneTps[srcT][srcC][_k2]       = 0;
    }
    if (srcC === S.trackActiveClip[srcT]) {
        S.seqActiveNotes.clear(); S.seqLastStep = -1; S.seqNoteOnClipTick = -1;
        resetPerClipBankParamsToDefault(srcT);
    }
}

/* Copy all 8 tracks for a scene row (single atomic DSP write, JS mirror update). */
function copyRow(srcRow, dstRow) {
    if (srcRow === dstRow) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'row_copy', val: `${srcRow} ${dstRow}` });
    for (let t = 0; t < NUM_TRACKS; t++) {
        S.clipSteps[t][dstRow] = S.clipSteps[t][srcRow].slice();
        S.clipLength[t][dstRow] = S.clipLength[t][srcRow];
        S.clipLoopStart[t][dstRow] = S.clipLoopStart[t][srcRow];
        S.clipNonEmpty[t][dstRow] = S.clipNonEmpty[t][srcRow];
        S.clipTPS[t][dstRow] = S.clipTPS[t][srcRow];
        S.drumClipNonEmpty[t][dstRow] = S.drumClipNonEmpty[t][srcRow];
        for (var _k = 0; _k < 8; _k++) {
            S.ccLaneLoopStart[t][dstRow][_k] = S.ccLaneLoopStart[t][srcRow][_k];
            S.ccLaneLength[t][dstRow][_k]    = S.ccLaneLength[t][srcRow][_k];
            S.ccLaneTps[t][dstRow][_k]       = S.ccLaneTps[t][srcRow][_k];
        }
        if (dstRow === S.trackActiveClip[t]) {
            S.seqActiveNotes.clear(); S.seqLastStep = -1;
            refreshPerClipBankParams(t);
            if (S.trackPadMode[t] === PAD_MODE_DRUM) {
                S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
            }
        }
    }
}

/* Cut row: copy all tracks src→dst then hard-reset src (single atomic DSP write, JS mirror update). */
function cutRow(srcRow, dstRow) {
    if (srcRow === dstRow) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'row_cut', val: `${srcRow} ${dstRow}` });
    for (let t = 0; t < NUM_TRACKS; t++) {
        S.clipSteps[t][dstRow] = S.clipSteps[t][srcRow].slice();
        S.clipLength[t][dstRow] = S.clipLength[t][srcRow];
        S.clipLoopStart[t][dstRow] = S.clipLoopStart[t][srcRow];
        S.clipNonEmpty[t][dstRow] = S.clipNonEmpty[t][srcRow];
        S.clipTPS[t][dstRow] = S.clipTPS[t][srcRow];
        S.drumClipNonEmpty[t][dstRow] = S.drumClipNonEmpty[t][srcRow];
        for (var _k = 0; _k < 8; _k++) {
            S.ccLaneLoopStart[t][dstRow][_k] = S.ccLaneLoopStart[t][srcRow][_k];
            S.ccLaneLength[t][dstRow][_k]    = S.ccLaneLength[t][srcRow][_k];
            S.ccLaneTps[t][dstRow][_k]       = S.ccLaneTps[t][srcRow][_k];
        }
        if (dstRow === S.trackActiveClip[t]) {
            S.seqActiveNotes.clear(); S.seqLastStep = -1;
            refreshPerClipBankParams(t);
            if (S.trackPadMode[t] === PAD_MODE_DRUM) {
                S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
            }
        }
        for (let s = 0; s < NUM_STEPS; s++) S.clipSteps[t][srcRow][s] = 0;
        S.clipLength[t][srcRow] = 16;
        S.clipLoopStart[t][srcRow] = 0;
        S.clipNonEmpty[t][srcRow] = false;
        S.clipTPS[t][srcRow] = 24;
        S.drumClipNonEmpty[t][srcRow] = false;
        for (var _k2 = 0; _k2 < 8; _k2++) {
            S.ccLaneLoopStart[t][srcRow][_k2] = 0;
            S.ccLaneLength[t][srcRow][_k2]    = 0;
            S.ccLaneTps[t][srcRow][_k2]       = 0;
        }
        if (srcRow === S.trackActiveClip[t]) {
            S.seqActiveNotes.clear(); S.seqLastStep = -1; S.seqNoteOnClipTick = -1;
            resetPerClipBankParamsToDefault(t);
            if (S.trackPadMode[t] === PAD_MODE_DRUM) {
                S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
            }
        }
    }
}

/* Copy step src→dst within same clip (single atomic DSP write, JS mirror update). */
function copyStep(t, ac, srcAbs, dstAbs) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        const lane = S.activeDrumLane[t];
        S.pendingDefaultSetParams.push({ key: 't' + t + '_l' + lane + '_step_' + srcAbs + '_copy_to', val: String(dstAbs) });
        S.drumLaneSteps[t][lane][dstAbs] = S.drumLaneSteps[t][lane][srcAbs];
        if (S.drumLaneSteps[t][lane][srcAbs] !== '0') S.drumLaneHasNotes[t][lane] = true;
        S.pendingDrumLaneResync      = 2;
        S.pendingDrumLaneResyncTrack = t;
        S.pendingDrumLaneResyncLane  = lane;
    } else {
        S.pendingDefaultSetParams.push({ key: 't' + t + '_c' + ac + '_step_' + srcAbs + '_copy_to', val: String(dstAbs) });
        S.clipSteps[t][ac][dstAbs] = S.clipSteps[t][ac][srcAbs];
        if (S.clipSteps[t][ac][srcAbs] !== 0) S.clipNonEmpty[t][ac] = true;
        S.pendingStepsReread      = 2;
        S.pendingStepsRereadTrack = t;
        S.pendingStepsRereadClip  = ac;
    }
}

/* Copy active clip's lane srcLane to dstLane (same track, preserves dst midi_note). */
function copyDrumLane(t, srcLane, dstLane) {
    if (srcLane === dstLane) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 't' + t + '_l' + srcLane + '_copy_to', val: String(dstLane) });
    const steps = S.drumLaneSteps[t];
    for (let s = 0; s < 256; s++) steps[dstLane][s] = steps[srcLane][s];
    S.drumLaneHasNotes[t][dstLane] = S.drumLaneHasNotes[t][srcLane];
    if (S.drumLaneHasNotes[t][srcLane]) S.drumClipNonEmpty[t][S.trackActiveClip[t]] = true;
    /* Copy repeat groove JS state */
    S.drumRepeatGate[t][dstLane]    = S.drumRepeatGate[t][srcLane];
    S.drumRepeatGateLen[t][dstLane] = S.drumRepeatGateLen[t][srcLane];
    for (let s = 0; s < 8; s++) {
        S.drumRepeatVelScale[t][dstLane][s] = S.drumRepeatVelScale[t][srcLane][s];
        S.drumRepeatNudge[t][dstLane][s]    = S.drumRepeatNudge[t][srcLane][s];
    }
    S.pendingDrumLaneResync = 2; S.pendingDrumLaneResyncTrack = t; S.pendingDrumLaneResyncLane = dstLane;
}

/* Cut active clip's lane srcLane into dstLane (copy then clear src). */
function cutDrumLane(t, srcLane, dstLane) {
    if (srcLane === dstLane) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 't' + t + '_l' + srcLane + '_cut_to', val: String(dstLane) });
    const steps = S.drumLaneSteps[t];
    for (let s = 0; s < 256; s++) { steps[dstLane][s] = steps[srcLane][s]; steps[srcLane][s] = '0'; }
    S.drumLaneHasNotes[t][dstLane] = S.drumLaneHasNotes[t][srcLane];
    S.drumLaneHasNotes[t][srcLane] = false;
    let anyHits = false;
    for (let l = 0; l < DRUM_LANES; l++) if (S.drumLaneHasNotes[t][l]) { anyHits = true; break; }
    S.drumClipNonEmpty[t][S.trackActiveClip[t]] = anyHits;
    /* Move repeat groove JS state */
    S.drumRepeatGate[t][dstLane]    = S.drumRepeatGate[t][srcLane];
    S.drumRepeatGateLen[t][dstLane] = S.drumRepeatGateLen[t][srcLane];
    for (let s = 0; s < 8; s++) {
        S.drumRepeatVelScale[t][dstLane][s] = S.drumRepeatVelScale[t][srcLane][s];
        S.drumRepeatNudge[t][dstLane][s]    = S.drumRepeatNudge[t][srcLane][s];
    }
    S.drumRepeatGate[t][srcLane]    = 0xFF;
    S.drumRepeatGateLen[t][srcLane] = 8;
    for (let s = 0; s < 8; s++) { S.drumRepeatVelScale[t][srcLane][s] = 100; S.drumRepeatNudge[t][srcLane][s] = 0; }
    S.pendingDrumLaneResync = 2; S.pendingDrumLaneResyncTrack = t; S.pendingDrumLaneResyncLane = dstLane;
}

/* Copy all 32 lanes of drum_clips[srcC] on srcT to drum_clips[dstC] on dstT; preserve dst midi_notes. */
function copyDrumClip(srcT, srcC, dstT, dstC) {
    if (srcT === dstT && srcC === dstC) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'drum_clip_copy', val: `${srcT} ${srcC} ${dstT} ${dstC}` });
    S.drumClipNonEmpty[dstT][dstC] = S.drumClipNonEmpty[srcT][srcC];
    if (dstC === S.trackActiveClip[dstT]) { S.pendingDrumResync = 2; S.pendingDrumResyncTrack = dstT; }
}

/* Cut all 32 lanes of drum_clips[srcC] on srcT into drum_clips[dstC] on dstT; undo dst only. */
function cutDrumClip(srcT, srcC, dstT, dstC) {
    if (srcT === dstT && srcC === dstC) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'drum_clip_cut', val: `${srcT} ${srcC} ${dstT} ${dstC}` });
    S.drumClipNonEmpty[dstT][dstC] = S.drumClipNonEmpty[srcT][srcC];
    S.drumClipNonEmpty[srcT][srcC] = false;
    if (srcC === S.trackActiveClip[srcT]) {
        for (let l = 0; l < DRUM_LANES; l++) {
            for (let s = 0; s < 256; s++) S.drumLaneSteps[srcT][l][s] = '0';
            S.drumLaneHasNotes[srcT][l] = false;
        }
        S.drumLaneLength[srcT] = 16;
        S.drumLaneTPS[srcT]    = 24;
    }
    if (dstC === S.trackActiveClip[dstT]) { S.pendingDrumResync = 2; S.pendingDrumResyncTrack = dstT; }
}

/* Clear all 8 tracks for a scene row (single atomic DSP write, JS mirror update). */
function clearRow(rowIdx) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'row_clear', val: String(rowIdx) });
    for (let t = 0; t < NUM_TRACKS; t++) {
        const len = S.clipLength[t][rowIdx];
        for (let s = 0; s < len; s++) S.clipSteps[t][rowIdx][s] = 0;
        S.clipNonEmpty[t][rowIdx] = false;
        S.drumClipNonEmpty[t][rowIdx] = false;
        S.clipLoopStart[t][rowIdx] = 0;
        if (rowIdx === S.trackActiveClip[t]) {
            S.seqActiveNotes.clear(); S.seqLastStep = -1;
            S.trackCurrentPage[t] = 0;
            if (S.trackPadMode[t] === PAD_MODE_DRUM) S.drumLaneLoopStart[t] = 0;
            resetPerClipBankParamsToDefault(t);
            if (S.trackPadMode[t] === PAD_MODE_DRUM) {
                S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
            }
        }
    }
}

/* Disarm real-time recording: clear DSP flag (triggers deferred save), update LED. */
function disarmRecord() {
    if (!S.recordArmed) return;
    const t = S.recordArmedTrack;
    const _wasCountingIn   = S.recordCountingIn;
    S.recordArmed          = false;
    S.recordPendingPage    = false;
    S.recordCountingIn     = false;
    S.recordArmedTrack     = -1;
    S.countInStartTick    = -1;
    S.countInQuarterTicks = 0;
    _recordingNoteTrack.clear();
    S._recNoteOns.length   = 0;
    S._recNoteOffs.length  = 0;
    _drumRecNoteOns.length  = 0;
    _drumRecNoteOffs.length = 0;
    S.pendingPrerollNote          = null;
    S.pendingPrerollNotes         = [];
    S.pendingPrerollToggleQueue   = [];
    S.pendingPrerollGate          = null;
    if (t >= 0) {
        const _dat = S.trackActiveClip[t];
        S.clipAdaptiveMode[t][_dat] = false;
        if (S.trackPadMode[t] === PAD_MODE_DRUM) {
            S.pendingDrumResync      = 2;
            S.pendingDrumResyncTrack = t;
        }
    }
    S.recordScheduledStop       = false;
    S.recordScheduledStopTarget = -1;
    S.pendingScheduledDisarm    = false;
    if (typeof host_module_set_param === 'function') {
        if (_wasCountingIn) {
            /* Count-in active: only cancel is needed; sending _recording 0 would coalesce it away */
            host_module_set_param('record_count_in_cancel', '1');
        } else {
            if (t >= 0) {
                host_module_set_param('t' + t + '_recording', '0');
                /* Re-send the disarm across the next few ticks (drained in tick()):
                 * a single set_param can be coalesced away by another set_param
                 * sharing the same audio buffer (e.g. a knob-release on the AUTO
                 * bank), which would strand recording=1 and flood the lane. */
                S.recOffTrack = t;
                S.recOffTicks = 5;
            }
        }
    }
    setButtonLED(MoveRec, LED_OFF);
}

/* Move recording to a different track while staying armed. No-op if not actively recording. */
function handoffRecordingToTrack(newTrack) {
    if (!S.recordArmed || S.recordCountingIn || newTrack === S.recordArmedTrack) return;
    const old = S.recordArmedTrack;
    _recordingNoteTrack.clear();
    S.recordArmedTrack      = newTrack;
    if (typeof host_module_set_param === 'function') {
        if (old >= 0) host_module_set_param('t' + old + '_recording', '0');
        host_module_set_param('t' + newTrack + '_recording', '1');
    }
}

function effectiveVelocity(rawVel) { return rawVel; }

/* Step-entry velocity. Single source of truth used by every step-write site.
 *
 * Drum context (allowZone=true, used at drum step-tap sites and the drum
 * vel-pad-while-step-held site): drum vel zones ALWAYS win over VelIn.
 *   active vel-pad press now (liveVel >= 0)  →  zone velocity
 *   sticky vel-zone armed                    →  sticky zone velocity
 *   VelIn engaged                            →  VelIn value
 *   otherwise                                →  100
 *
 * Melodic context (allowZone=false): VelIn wins over pad press.
 *   VelIn engaged                            →  VelIn value
 *   live pad press now (liveVel >= 0)        →  pad press velocity
 *   otherwise                                →  100
 */
function stepEntryVelocity(t, liveVel, allowZone) {
    if (allowZone) {
        if (liveVel >= 0) return liveVel;
        if (S.drumVelZoneArmed && S.drumVelZoneArmed[t])
            return drumVelZoneToVelocity(S.drumLastVelZone[t]);
        const tvo = S.trackVelOverride[t];
        if (tvo > 0) return tvo;
        return 100;
    }
    const tvo = S.trackVelOverride[t];
    if (tvo > 0) return tvo;
    if (liveVel >= 0) return liveVel;
    return 100;
}

function flushChordBatch() {}

/* DSP-side recording: buffer note events; tick() flushes as a single batched set_param so
 * chords (multiple pads hit in the same ~5ms JS tick) are not lost to coalescing. */
const _recordingNoteTrack = new Map(); /* pitch → track index, for matching note-offs */
const extHeldNotes = new Map(); /* pitch → {track, recording} — external MIDI held notes */

function recordNoteOn(pitch, velocity, rt) {
    _recordingNoteTrack.set(pitch, rt);
    S._recNoteOns.push({pitch, vel: velocity, rt});
}

function recordNoteOff(pitch) {
    const rt = _recordingNoteTrack.get(pitch);
    if (rt === undefined) return;
    _recordingNoteTrack.delete(pitch);
    S._recNoteOffs.push({pitch, rt});
}


function openTapTempo() {
    S.tapTempoOpen      = true;
    S.tapTempoTapTimes  = [];
    S.tapTempoBpm       = Math.max(40, Math.min(250, Math.round(parseFloat(host_module_get_param('bpm')) || 120)));
    S.tapTempoFlashTick = -1;
    S.tapTempoFlashPad  = -1;
    computePadNoteMap();
    invalidateLEDCache();
    S.screenDirty = true;
}

function closeTapTempo() {
    S.tapTempoOpen = false;
    if (typeof host_module_set_param === 'function')
        host_module_set_param('bpm', String(S.tapTempoBpm));
    computePadNoteMap();
    invalidateLEDCache();
    S.screenDirty = true;
}

function registerTapTempo(padNote) {
    const nowMs  = Date.now();
    const taps   = S.tapTempoTapTimes;
    const last   = taps.length > 0 ? taps[taps.length - 1] : -1;
    const intvl  = last >= 0 ? nowMs - last : -1;

    /* Inactivity reset: gap exceeds 2s */
    if (intvl > TAP_TEMPO_RESET_MS) {
        S.tapTempoTapTimes = [nowMs];
    } else if (intvl > 0 && taps.length >= 2) {
        /* Deviation reset: new interval differs from previous by >~1.8x */
        const prevIntvl = taps[taps.length - 1] - taps[taps.length - 2];
        const ratio     = intvl / prevIntvl;
        if (ratio > 1.8 || ratio < 0.55) {
            /* Tempo change: keep last tap as anchor for new session */
            S.tapTempoTapTimes = [last, nowMs];
        } else {
            taps.push(nowMs);
            /* Sliding window: cap at last 9 taps (8 intervals) */
            if (taps.length > 9) S.tapTempoTapTimes = taps.slice(-9);
        }
    } else {
        taps.push(nowMs);
    }

    if (S.tapTempoTapTimes.length >= 2) {
        const t = S.tapTempoTapTimes;
        const n = t.length;
        const avgInterval = (t[n - 1] - t[0]) / (n - 1);
        if (avgInterval > 0) {
            S.tapTempoBpm = Math.max(40, Math.min(250, Math.round(60000 / avgInterval)));
            host_module_set_param('bpm', String(S.tapTempoBpm));
        }
    }
    S.tapTempoFlashTick = S.tickCount;
    S.tapTempoFlashPad  = padNote;
    S.screenDirty = true;
}


/* True when the track's currently-focused clip has NO note/hit data.
 * Note data only — CC-lane automation does not count (a CC-only clip is
 * "empty" here). Used to gate implicit focused-clip auto-launch so a clip the
 * user intentionally left off is not re-activated by scrolling / transport
 * start. */
function _clipIsEmpty(t, c) {
    return (S.trackPadMode[t] === PAD_MODE_DRUM)
        ? !S.drumClipNonEmpty[t][c]
        : !S.clipNonEmpty[t][c];
}
function _focusedClipIsEmpty(t) {
    return _clipIsEmpty(t, S.trackActiveClip[t]);
}

/* Save the current S.activeBank into the outgoing track's per-track slot,
 * switch to newT, then restore the new track's stored bank into S.activeBank.
 * Existing post-switch validity checks (e.g. drum-track hidden banks → 0)
 * still apply to the loaded value. Use at every site that assigns S.activeTrack. */
function _switchActiveTrack(newT) {
    S.trackActiveBank[S.activeTrack] = S.activeBank;
    S.activeTrack = newT | 0;
    S.activeBank = S.trackActiveBank[S.activeTrack] | 0;
    if (S.activeBank === 7) S.allLanesConfirmed = false;
    /* Focused-clip-by-default: ONLY while transport is running — entering a track
     * launches its focused clip so it's live. While stopped we do NOT arm (passive
     * track-scrolling must not queue clips for the next transport start); the
     * displayed clip is instead armed at transport start (see _onCC_transport).
     * Skip if already live, in Session View, or if the focused clip has note
     * data (a clip intentionally left off must not be re-launched by scroll). */
    if (S.playing && !S.sessionView
            && !S.trackClipPlaying[S.activeTrack]
            && !S.trackWillRelaunch[S.activeTrack]
            && S.trackQueuedClip[S.activeTrack] === -1
            && _focusedClipIsEmpty(S.activeTrack)) {
        const _ac = S.trackActiveClip[S.activeTrack];
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + S.activeTrack + '_launch_clip', String(_ac));
        S.trackQueuedClip[S.activeTrack] = _ac;
    }
}

/* ALL LANES safety gate. Every gesture that writes all 32 drum lanes at once
 * funnels through this: while the drum ALL LANES bank is unconfirmed it surfaces
 * the "Edits will affect all lanes" OK screen (jog-click confirms) and tells the
 * caller to abort. Returns false (proceed) on any other bank/track. */
function allLanesGate() {
    if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7 && !S.allLanesConfirmed) {
        S.screenDirty = true;
        forceRedraw();
        return true;
    }
    return false;
}

function doDoubleFill() {
    const _t = S.activeTrack;
    if (S.trackPadMode[_t] === PAD_MODE_DRUM && S.activeBank === 7) {
        if (allLanesGate()) return;
        S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
        host_module_set_param('t' + _t + '_all_lanes_double_fill', '1');
        S.pendingDrumResync = 2; S.pendingDrumResyncTrack = _t;
        showActionPopup('LOOP', 'DOUBLED');
        forceRedraw();
    } else if (S.trackPadMode[_t] === PAD_MODE_DRUM) {
        const _l   = S.activeDrumLane[_t];
        const _len = S.drumLaneLength[_t];
        if (_len * 2 > 256) {
            showActionPopup('CLIP FULL');
        } else {
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
            host_module_set_param('t' + _t + '_l' + _l + '_loop_double_fill', '1');
            S.drumLaneLength[_t] = _len * 2;
            S.pendingDrumResync      = 2;
            S.pendingDrumResyncTrack = _t;
            showActionPopup('LOOP', 'DOUBLED');
            forceRedraw();
        }
    } else {
        const _ac  = effectiveClip(_t);
        const _len = S.clipLength[_t][_ac];
        if (_len * 2 > 256) {
            showActionPopup('CLIP FULL');
        } else {
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + _t + '_loop_double_fill', '1');
            S.clipLength[_t][_ac] = _len * 2;
            S.pendingStepsReread      = 2;
            S.pendingStepsRereadTrack = _t;
            S.pendingStepsRereadClip  = _ac;
            refreshPerClipBankParams(_t);
            showActionPopup('LOOP', 'DOUBLED');
            forceRedraw();
        }
    }
}

function doLaneDoubleFill() {
    var _t = S.activeTrack, _ac = effectiveClip(_t), _l = S.ccActiveLane[_t];
    var _len = S.ccLaneLength[_t][_ac][_l] || S.clipLength[_t][_ac];
    if (_len * 2 > 256) {
        showActionPopup('LANE FULL');
        return;
    }
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.ccLaneLength[_t][_ac][_l] = _len * 2;
    var _pre = 't' + _t + '_c' + _ac + '_k' + _l;
    S.pendingDefaultSetParams.push({ key: _pre + '_cc_lane_double_fill', val: '1' });
    showActionPopup('LANE LOOP', 'DOUBLED');
    forceRedraw();
}

function openGlobalMenu() {
    /* Co-run owns the OLED — exit it before opening the menu so dAVEBOx
     * can draw again. */
    if (S.schwungCoRunSlot >= 0) exitSchwungCoRun();
    if (S.moveCoRunTrack >= 0) exitMoveNativeCoRun();
    S.globalMenuItems         = buildGlobalMenuItems();
    S.globalMenuState         = createMenuState();
    S.globalMenuStack         = createMenuStack();
    S.globalMenuOpen          = true;
    S.globalMenuBuiltForTrack = S.activeTrack;
    S.lastSentMenuEditValue   = null;
    S.screenDirty             = true;
    S.jogTouched              = false;
}

/* Rebuild the global menu items list if the active track has changed
 * since the last build. Edit Slot... and Edit Synth... visibility
 * depends on the track's Route, so a Shift+jog track switch with the
 * menu open must rebuild the list. Cursor preserved by label-match
 * when possible, otherwise clamped. */
function ensureGlobalMenuFresh() {
    if (!S.globalMenuOpen) return;
    if (S.globalMenuBuiltForTrack === S.activeTrack) return;
    let prevLabel = null;
    if (S.globalMenuItems && S.globalMenuState) {
        const _cur = S.globalMenuItems[S.globalMenuState.selectedIndex];
        if (_cur) prevLabel = _cur.label || null;
    }
    S.globalMenuItems = buildGlobalMenuItems();
    if (prevLabel && S.globalMenuState) {
        let idx = -1;
        for (let i = 0; i < S.globalMenuItems.length; i++) {
            const _it = S.globalMenuItems[i];
            if (_it && _it.label === prevLabel) { idx = i; break; }
        }
        if (idx >= 0) S.globalMenuState.selectedIndex = idx;
        else S.globalMenuState.selectedIndex = Math.min(
            S.globalMenuState.selectedIndex,
            Math.max(0, S.globalMenuItems.length - 1));
    }
    S.globalMenuBuiltForTrack = S.activeTrack;
}



/* "REC Unavailable" two-option dialog (OK | BAKE NOW). Opens when Record
 * is pressed on a clip / lane in any non-Forward direction or Audio reverse
 * style. OK dismisses; BAKE NOW opens the standard bake confirm dialog
 * pre-targeted at the active clip / drum lane. */
function drawStateWipeConfirm() {
    clear_screen();
    function _btn(x, y, w, h, sel, label, labelOff) {
        if (sel) {
            fill_rect(x, y, w, h, 1);
            print(x + labelOff, y + 3, label, 0);
        } else {
            fill_rect(x, y, w, 1, 1);
            fill_rect(x, y + h - 1, w, 1, 1);
            fill_rect(x, y, 1, h, 1);
            fill_rect(x + w - 1, y, 1, h, 1);
            print(x + labelOff, y + 3, label, 1);
        }
    }
    drawMenuHeader('Incompatible State');
    print(4, 16, 'Session incompatible', 1);
    print(4, 25, 'with current dB ver.', 1);
    print(4, 34, 'Erase and proceed?', 1);
    _btn(6,  46, 46, 13, S.confirmStateWipeSel === 0, 'Yes', 14);
    _btn(74, 46, 46, 13, S.confirmStateWipeSel === 1, 'No',  17);
}

function drawRecordBlockedDialog() {
    clear_screen();
    function _btn(x, y, w, h, sel, label, labelOff) {
        if (sel) {
            fill_rect(x, y, w, h, 1);
            print(x + labelOff, y + 3, label, 0);
        } else {
            fill_rect(x, y, w, 1, 1);
            fill_rect(x, y + h - 1, w, 1, 1);
            fill_rect(x, y, 1, h, 1);
            fill_rect(x + w - 1, y, 1, h, 1);
            print(x + labelOff, y + 3, label, 1);
        }
    }
    drawMenuHeader('REC Unavailable');
    print(4, 16, 'Set Dir to Fwd', 1);
    print(4, 25, 'or Bake', 1);
    _btn(6,  46, 46, 13, S.recordBlockedDialogSel === 0, 'OK',       19);
    _btn(58, 46, 64, 13, S.recordBlockedDialogSel === 1, 'BAKE NOW', 6);
}

/* Shown when Tap Tempo is invoked while Clock Follow = Move (tempo is Move's, so
 * there's nothing to tap). Single OK button; dismissed by jog click or Back. */
function drawBpmMoveInfo() {
    clear_screen();
    drawMenuHeader('Tempo');
    print(4, 20, 'BPM controlled', 1);
    print(4, 30, 'by Move', 1);
    /* OK button (filled, bottom center) — matches the generic INFO dialog. */
    fill_rect(49, 52, 30, 11, 1);
    print(59, 54, 'OK', 0);
}

/* Destructive Lgto confirm dialog. Right-turn of CLIP K8 / DRUM LANE K8
 * opens this. OK applies; CANCEL aborts. Undoable. */
function drawLgtoConfirm() {
    clear_screen();
    function _btn(x, y, w, h, sel, label, labelOff) {
        if (sel) {
            fill_rect(x, y, w, h, 1);
            print(x + labelOff, y + 3, label, 0);
        } else {
            fill_rect(x, y, w, 1, 1);
            fill_rect(x, y + h - 1, w, 1, 1);
            fill_rect(x, y, 1, h, 1);
            fill_rect(x + w - 1, y, 1, h, 1);
            print(x + labelOff, y + 3, label, 1);
        }
    }
    drawMenuHeader(S.confirmLgtoIsDrum ? 'Lgto (lane)' : 'Lgto (clip)');
    print(4, 16, 'Destructive', 1);
    print(4, 25, 'Proceed?', 1);
    _btn(6,  46, 46, 13, S.confirmLgtoSel === 0, 'OK',     19);
    _btn(58, 46, 64, 13, S.confirmLgtoSel === 1, 'CANCEL', 14);
}

function drawBakeConfirm() {
    clear_screen();
    function _btn(x, y, w, h, sel, label, labelOff) {
        if (sel) {
            fill_rect(x, y, w, h, 1);
            print(x + labelOff, y + 3, label, 0);
        } else {
            fill_rect(x, y, w, 1, 1);
            fill_rect(x, y + h - 1, w, 1, 1);
            fill_rect(x, y, 1, h, 1);
            fill_rect(x + w - 1, y, 1, h, 1);
            print(x + labelOff, y + 3, label, 1);
        }
    }
    if (S.confirmBakeWrapPhase) {
        drawMenuHeader('WRAP TAILS?');
        print(4, 16, 'Wrap delay echoes', 1);
        print(4, 25, 'past clip end back', 1);
        print(4, 34, 'to the beginning?', 1);
        const bW = 38, bH = 13, bY = 50;
        _btn(4,  bY, bW, bH, S.confirmBakeWrapSel === 0, 'YES',    9);
        _btn(45, bY, bW, bH, S.confirmBakeWrapSel === 1, 'NO',    14);
        _btn(86, bY, bW, bH, S.confirmBakeWrapSel === 2, 'CANCEL', 1);
    } else if (S.confirmBakeIsMultiLoop) {
        drawMenuHeader('BAKE FX?');
        print(4, 14, 'Bake N loops of FX', 1);
        print(4, 23, 'chain to clip?', 1);
        const bH = 12, bY = 38;
        _btn(2,  bY, 27, bH, S.confirmBakeSel === 1, '1x',     9);
        _btn(31, bY, 27, bH, S.confirmBakeSel === 2, '2x',     9);
        _btn(60, bY, 27, bH, S.confirmBakeSel === 3, '4x',     9);
        _btn(89, bY, 37, bH, S.confirmBakeSel === 0, 'CANCEL', 3);
    } else if (!S.confirmBakeIsDrum) {
        drawMenuHeader('BAKE FX?');
        print(4, 16, 'Apply effects chain', 1);
        print(4, 25, 'to clip notes and', 1);
        print(4, 34, 'clear the settings.', 1);
        _btn(6,  46, 46, 13, S.confirmBakeSel === 1, 'No',  17);
        _btn(74, 46, 46, 13, S.confirmBakeSel === 0, 'Yes', 14);
    } else if (S.confirmBakeDrumLoopOpen) {
        /* Step 2: loop count selection */
        const modeLabel = S.confirmBakeDrumMode === 1 ? 'LANE' : 'CLIP';
        drawMenuHeader('BAKE DRUMS?');
        print(4, 13, modeLabel + ' — loop count:', 1);
        const mH = 11;
        _btn(14, 33, 100, mH, S.confirmBakeDrumLoopSel === 0, 'CANCEL', 31);
        _btn(4,  47, 36,  mH, S.confirmBakeDrumLoopSel === 1, '1x', 12);
        _btn(46, 47, 36,  mH, S.confirmBakeDrumLoopSel === 2, '2x', 12);
        _btn(88, 47, 36,  mH, S.confirmBakeDrumLoopSel === 3, '4x', 12);
    } else {
        drawMenuHeader('BAKE DRUMS?');
        print(4, 16, 'Bake FX to clip', 1);
        print(4, 25, '(all lanes) or lane?', 1);
        /* 3 buttons: CLIP(0) | LANE(1) | CANCEL(2, default) */
        const bW = 38, bH = 13, bY = 50;
        _btn(4,  bY, bW, bH, S.confirmBakeSel === 0, 'CLIP',   7);
        _btn(45, bY, bW, bH, S.confirmBakeSel === 1, 'LANE',   7);
        _btn(86, bY, bW, bH, S.confirmBakeSel === 2, 'CANCEL', 1);
    }
}


function drawInheritPicker() {
    clear_screen();
    const p = S.pendingInheritPicker;
    if (!p) return;
    /* Header (two preamble lines + title wrapped to two lines; Move display
     * is 128px wide which only fits ~21 chars at the standard 6px/char font).
     * Tight 8-9px line stride to leave room for the list below. */
    print(2, 2,  'Copied Move set', 1);
    print(2, 10, 'detected',        1);
    fill_rect(0, 18, 128, 1, 1);
    print(2, 20, 'Inherit dAVEBOx', 1);
    print(2, 28, 'state from?',     1);
    fill_rect(0, 36, 128, 1, 1);

    /* List: candidates + 'Start blank' sentinel. Scroll window of 3 around
     * the selected index so 4+ entries still fit. Selection inverts the
     * line; arrows hint at off-screen items. */
    const total = p.candidates.length + 1;
    const visible = 3;
    const sel = p.selectedIndex;
    let top = Math.max(0, Math.min(sel - 1, total - visible));
    if (total <= visible) top = 0;
    const lineH = 9;
    const listTopY = 39;
    for (let i = 0; i < visible && (top + i) < total; i++) {
        const idx = top + i;
        const y = listTopY + i * lineH;
        const isBlank = (idx === p.candidates.length);
        const label = isBlank ? 'Start blank' : p.candidates[idx].name;
        const truncated = label.length > 20 ? label.substring(0, 19) + '…' : label;
        if (idx === sel) {
            fill_rect(2, y - 1, 124, lineH - 1, 1);
            print(5, y, truncated, 0);
        } else {
            print(5, y, truncated, 1);
        }
    }
    /* Scroll indicators */
    if (top > 0)               print(120, listTopY, '^', 1);
    if (top + visible < total) print(120, listTopY + (visible - 1) * lineH, 'v', 1);
}

function snapById(p, id) {
    for (let i = 0; i < p.snaps.length; i++) if (p.snaps[i].id === id) return p.snaps[i];
    return null;
}

/* Yes/No buttons matching the other confirm dialogs (No left, Yes right). */
function drawSnapYesNo(sel) {
    const noX = 6, yesX = 74, btnY = 46, btnW = 46, btnH = 13;
    function btn(x, on, label, off) {
        if (on) { fill_rect(x, btnY, btnW, btnH, 1); print(x + off, btnY + 3, label, 0); }
        else {
            fill_rect(x, btnY, btnW, 1, 1); fill_rect(x, btnY + btnH - 1, btnW, 1, 1);
            fill_rect(x, btnY, 1, btnH, 1); fill_rect(x + btnW - 1, btnY, 1, btnH, 1);
            print(x + off, btnY + 3, label, 1);
        }
    }
    btn(noX, sel === 1, 'No', 17);
    btn(yesX, sel === 0, 'Yes', 14);
}

function drawSnapshotPicker() {
    clear_screen();
    const p = S.snapshotPicker;
    if (!p) return;

    if (p.confirm) {
        const c = p.confirm;
        if (c.kind === 'wipe') {
            drawMenuHeader('STATES UPDATED');
            print(4, 18, 'Delete ' + c.wipeIds.length + ' snapshot(s)', 1);
            print(4, 27, 'from an older', 1);
            print(4, 36, 'version?', 1);
        } else if (c.kind === 'load') {
            const s = snapById(p, c.targetId);
            drawMenuHeader('LOAD STATE');
            print(4, 18, 'Load ' + (s ? s.label : ''), 1);
            print(4, 27, 'Unsaved changes', 1);
            print(4, 36, 'will be lost.', 1);
        } else {
            const s = snapById(p, c.targetId);
            drawMenuHeader('OVERWRITE');
            print(4, 18, 'Replace', 1);
            print(4, 27, (s ? s.label : '') + '?', 1);
        }
        drawSnapYesNo(c.sel);
        return;
    }

    drawMenuHeader(p.mode === 'overwrite' ? 'OVERWRITE WHICH?' : 'LOAD STATE');
    const total = p.snaps.length;
    const visible = 4;
    const sel = p.sel;
    let top = Math.max(0, Math.min(sel - 1, total - visible));
    if (total <= visible) top = 0;
    const lineH = 9;
    const listTopY = 20;
    for (let i = 0; i < visible && (top + i) < total; i++) {
        const idx = top + i;
        const y = listTopY + i * lineH;
        const s = p.snaps[idx];
        let label = s.label || '';
        if (p.mode === 'load' && s.sv !== STATE_VERSION) label += ' (old)';
        const truncated = label.length > 20 ? label.substring(0, 19) + '…' : label;
        if (idx === sel) {
            fill_rect(2, y - 1, 124, lineH - 1, 1);
            print(5, y, truncated, 0);
        } else {
            print(5, y, truncated, 1);
        }
    }
    if (top > 0)               print(120, listTopY, '^', 1);
    if (top + visible < total) print(120, listTopY + (visible - 1) * lineH, 'v', 1);
}

/* CLEAR AUTOMATION modal — checkable AT / PB(disabled) / CC + a CLEAR action. */
function drawClearAutoMenu() {
    clear_screen();
    const m = S.clearAutoMenu;
    if (!m) return;
    drawMenuHeader('CLEAR AUTOMATION');
    const rows = [
        { label: 'Aftertouch (AT)',     box: m.at ? '[x]' : '[ ]' },
        { label: 'Pitch bend (PB)',     box: '( )' },   /* placeholder, not selectable */
        { label: 'Control Change (CC)', box: m.cc ? '[x]' : '[ ]' },
        { label: 'CLEAR',  action: true },
        { label: 'Cancel', action: true }
    ];
    const lineH = 9, topY = 18;
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const y = topY + i * lineH;
        const seld = (m.sel === i);
        if (seld) fill_rect(2, y - 1, 124, lineH - 1, 1);
        const txt = r.action ? r.label : (r.box + ' ' + r.label);
        print(5, y, txt, seld ? 0 : 1);
    }
}

/* True when scene-baking at clipIdx should offer "Apply Conductor?":
 * a Conductor exists and its clip at clipIdx has at least one responder On for a
 * non-conductor melodic track (something there is to fold). */
/* Conductor track index derived from pad_mode — the reliable source. The
 * S.conductorTrack mirror can be stale/-1 (flaky single-tick load readback), so
 * anything that must KNOW the conductor (not just "am I viewing it") derives it
 * here, the same way the banks key off S.trackPadMode. -1 = no conductor. */
function conductorTrackIdx() {
    let t;
    for (t = 0; t < 8; t++) if (S.trackPadMode[t] === PAD_MODE_CONDUCT) return t;
    return -1;
}

function sceneBakeHasConductor(clipIdx) {
    const ct = conductorTrackIdx();
    if (ct < 0) return false;
    const mask = S.condResp[clipIdx | 0];
    if (!mask) return false;
    let t;
    for (t = 0; t < 8; t++) {
        if (t === ct) continue;
        if (S.trackPadMode[t] !== PAD_MODE_MELODIC_SCALE) continue;
        if (mask[t]) return true;
    }
    return false;
}

/* Push the scene-bake set_param and arm post-bake resync. apply=1 folds the
 * Conductor (4th token A) and the DSP auto-disables the conductor clip's
 * responder flags for the baked tracks. */
function commitSceneBake(clipIdx, loops, wrap, apply) {
    S.pendingDefaultSetParams.push({
        key: 'bake_scene',
        val: clipIdx + ' ' + loops + ' ' + (wrap ? 1 : 0) + ' ' + (apply ? 1 : 0)
    });
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    showActionPopup('SCENE', 'BAKED');
    S.pendingSceneBakeResync = 2;
    S.pendingSceneBakeClip   = clipIdx;
    /* DSP cleared the conductor clip's responder flags for the baked tracks.
     * Mirror that locally so the Responder bank UI reflects the auto-disable
     * without waiting for the next full per-clip re-read. */
    const ct = conductorTrackIdx();
    if (apply && ct >= 0) {
        const mask = S.condResp[clipIdx | 0];
        if (mask) {
            for (let t = 0; t < 8; t++) {
                if (t === ct) continue;
                if (S.trackPadMode[t] !== PAD_MODE_MELODIC_SCALE) continue;
                mask[t] = 0;
            }
        }
    }
}

function drawBakeSceneConfirm() {
    clear_screen();
    function _btn(x, y, w, h, sel, label, labelOff) {
        if (sel) {
            fill_rect(x, y, w, h, 1);
            print(x + labelOff, y + 3, label, 0);
        } else {
            fill_rect(x, y, w, 1, 1);
            fill_rect(x, y + h - 1, w, 1, 1);
            fill_rect(x, y, 1, h, 1);
            fill_rect(x + w - 1, y, 1, h, 1);
            print(x + labelOff, y + 3, label, 1);
        }
    }
    drawMenuHeader('BAKE SCENE?');
    const mH = 11;
    if (S.confirmBakeSceneCondPhase) {
        print(4, 22, 'Apply Conductor?', 1);
        const bY = 47, bW = 36;
        _btn(4,  bY, bW, mH, S.confirmBakeSceneCondSel === 0, 'YES',    9);
        _btn(45, bY, bW, mH, S.confirmBakeSceneCondSel === 1, 'NO',    14);
        _btn(86, bY, bW, mH, S.confirmBakeSceneCondSel === 2, 'CANCEL', 1);
    } else if (S.confirmBakeSceneWrapPhase) {
        print(4, 22, 'Wrap tails?', 1);
        const bY = 47, bW = 36;
        _btn(4,  bY, bW, mH, S.confirmBakeSceneWrapSel === 0, 'YES',    9);
        _btn(45, bY, bW, mH, S.confirmBakeSceneWrapSel === 1, 'NO',    14);
        _btn(86, bY, bW, mH, S.confirmBakeSceneWrapSel === 2, 'CANCEL', 1);
    } else {
        print(4, 22, 'Loop count:', 1);
        _btn(14, 33, 100, mH, S.confirmBakeSceneSel === 0, 'CANCEL', 31);
        _btn(4,  47, 36,  mH, S.confirmBakeSceneSel === 1, '1x', 12);
        _btn(46, 47, 36,  mH, S.confirmBakeSceneSel === 2, '2x', 12);
        _btn(88, 47, 36,  mH, S.confirmBakeSceneSel === 3, '4x', 12);
    }
}

function drawXposeConfirm() {
    clear_screen();
    function _btn(x, y, w, h, sel, label, labelOff) {
        if (sel) {
            fill_rect(x, y, w, h, 1);
            print(x + labelOff, y + 3, label, 0);
        } else {
            fill_rect(x, y, w, 1, 1);
            fill_rect(x, y + h - 1, w, 1, 1);
            fill_rect(x, y, 1, h, 1);
            fill_rect(x + w - 1, y, 1, h, 1);
            print(x + labelOff, y + 3, label, 1);
        }
    }
    drawMenuHeader('TRANSPOSE CLIPS?');
    const tgt = NOTE_KEYS[S.confirmXposeKey] + ' ' + (SCALE_DISPLAY[S.confirmXposeScale] || '?');
    print(4, 22, 'To ' + tgt, 1);
    print(4, 33, 'All melodic clips', 1);
    const mH = 11, bY = 50, bW = 50;
    _btn(4,  bY, bW, mH, S.confirmXposeSel === 0, 'YES', 17);
    _btn(74, bY, bW, mH, S.confirmXposeSel === 1, 'NO',  20);
}

function clipHasContent(t, c) {
    const s = S.clipSteps[t][c];
    for (let i = 0; i < NUM_STEPS; i++) if (s[i]) return true;
    return false;
}


/* PHASE-1: helper for the pad-dispatch mute condition. Modal sources:
 * - sessionView                 — pads launch clips
 * - button-helds (Shift/Delete/Copy/Mute/Capture/Loop) — pads are shortcuts
 * - tapTempoOpen                — pads are tap input
 * - ARP step-edit pad mode      — K5 held in SEQ ARP (bank 4) or TRACK ARP
 *                                  (bank 5) with steps mode != Off; pads edit
 *                                  step velocity, not play notes
 * globalMenuOpen is NOT in this list — pads should still play notes in
 * track view while the menu is open (user confirmed 2026-05-17). */
function _padDispatchMutedNow() {
    if (S.sessionView) return true;
    if (S.shiftHeld || S.deleteHeld || S.muteHeld || S.copyHeld
        || S.captureHeld || S.loopHeld || S.tapTempoOpen) return true;
    if ((S.activeBank === 4 || S.activeBank === 5)
        && S.knobTouched === 4
        && S.bankParams[S.activeTrack]
        && ((S.bankParams[S.activeTrack][S.activeBank] || [])[4] | 0) !== 0) return true;
    /* Arp Steps overlay: pads are the persistent vel-level editor, not playable. */
    if (S.stepIntervalMode && (S.activeBank === 4 || S.activeBank === 5)) return true;
    return false;
}

/* ---- Transpose all melodic clips on global Key/Scale change ----------
 * Browsing the Key/Scale menu item arms a live preview (pads relayout +
 * DSP plays clips transposed); the knob-click commits behind a confirm.
 * Committed key/scale stay in S.padKey/S.padScale until commit; the
 * candidate lives in S.xposePrev* while previewing. */

/* Any melodic (non-drum) clip on any track with notes? */
function anyMelodicClipHasContent() {
    for (let t = 0; t < NUM_TRACKS; t++) {
        if (S.trackPadMode[t] === PAD_MODE_DRUM) continue;
        for (let c = 0; c < NUM_CLIPS; c++) if (S.clipNonEmpty[t][c]) return true;
    }
    return false;
}

/* Arm/refresh preview for candidate (candK,candS). Candidate == committed
 * cancels instead (no-op change). Runs from the menu-edit tick driver. */
function xposePreviewSet(candK, candS) {
    if (candK === S.padKey && candS === S.padScale) { xposeCancelPreview(); return; }
    S.xposePrevKey = candK; S.xposePrevScale = candS;
    computePadNoteMap();   /* relayout pads to candidate (also pushes padmap) */
    if (typeof host_module_set_param === 'function')
        host_module_set_param('t0_xpose_prev',
            S.padKey + ' ' + S.padScale + ' ' + candK + ' ' + candS);
    S.screenDirty = true;
}

/* Drop the preview: DSP returns playback to true pitch; pads back to committed.
 * The apply(flag=0) is queued (drained from tick) — set_param fired directly from
 * the onMidi confirm-click path is unreliable/coalesced. */
function xposeCancelPreview() {
    if (S.xposePrevKey === null && S.xposePrevScale === null) return;
    S.xposePrevKey = null; S.xposePrevScale = null;
    S.pendingDefaultSetParams.push({ key: 't0_xpose_apply',
        val: S.padKey + ' ' + S.padScale + ' ' + S.padKey + ' ' + S.padScale + ' 0' });
    computePadNoteMap();
    S.screenDirty = true;
}

/* Commit: bake the transpose into all melodic clips, adopt the new key/scale.
 * The apply(flag=1) is queued (drained from tick — set_param from the onMidi
 * confirm path is unreliable). The DSP bake skips empty clips; on the JS side a
 * transpose changes only note PITCH — step occupancy, lengths, loops and config
 * are unchanged and the pad layout is rebuilt here — so no clip resync is needed
 * (held-step note pitches refresh on the next press). */
function xposeCommit(candK, candS) {
    S.pendingDefaultSetParams.push({ key: 't0_xpose_apply',
        val: S.padKey + ' ' + S.padScale + ' ' + candK + ' ' + candS + ' 1' });
    S.padKey = candK; S.padScale = candS;
    S.xposePrevKey = null; S.xposePrevScale = null;
    computePadNoteMap();
    forceRedraw();
    S.screenDirty = true;
}

function computePadNoteMap() {
    const t = S.activeTrack;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        /* Drum mode: left half (cols 0-3) maps to drum lanes via drumPadToLane;
         * right half (cols 4-7) is velocity zones (no note dispatch).
         * For each pad we store the corresponding lane's midi_note, or 0xFF
         * for velocity-zone slots so DSP on_midi skips dispatch (JS still
         * handles vel-zone arming as state, independent of note routing). */
        const page = S.drumLanePage[t] | 0;
        /* Move co-run: the left-column lane pads are sounded + cell-selected by the
         * plain pad-on injected to Move (in _onPadPress). Map them to 0xFF too so the
         * DSP on_midi handler skips its own sound — otherwise we'd get a double hit
         * (DSP-routed Move drum + the injected pad). Right-column vel-zone pads stay
         * 0xFF as always (JS handles them; no inject, so no double). */
        const coRunSilentLeft = (S.moveCoRunTrack >= 0);
        for (let i = 0; i < 32; i++) {
            const col = i % 8;
            if (col >= 4) { S.padNoteMap[i] = 0xFF; continue; }
            if (coRunSilentLeft) { S.padNoteMap[i] = 0xFF; continue; }
            const row = Math.floor(i / 8);
            const lane = page * 16 + row * 4 + col;
            const note = (lane >= 0 && lane < DRUM_LANES)
                ? ((S.drumLaneNote[t][lane] | 0) || (DRUM_BASE_NOTE + lane))
                : 0xFF;
            S.padNoteMap[i] = note & 0xFF;
        }
    } else {
        /* While a transpose preview is armed, lay the pads out for the CANDIDATE
         * key/scale (committed padKey/padScale stay put until commit). */
        const effKey   = S.xposePrevKey   !== null ? S.xposePrevKey   : S.padKey;
        const effScale = S.xposePrevScale !== null ? S.xposePrevScale : S.padScale;
        const root = S.padOctave[t] * 12 + effKey;
        const intervals = SCALE_INTERVALS[effScale] || SCALE_INTERVALS[0];
        S.padScaleSet.clear();
        for (let i = 0; i < intervals.length; i++) S.padScaleSet.add(intervals[i]);
        if (S.padLayoutChromatic[t]) {
            for (let i = 0; i < 32; i++) {
                const col = i % 8;
                const row = Math.floor(i / 8);
                /* OOB pads (computed pitch < 0 or > 127) get the 0xFF sentinel
                 * to match drum vel-zone slots. Previously clamped to 0/127,
                 * which made multiple OOB pads share the same MIDI note → all
                 * lit when any one was pressed (LED cache keyed on note). */
                const p = root + col + row * 8;
                S.padNoteMap[i] = (p < 0 || p > 127) ? 0xFF : p;
            }
        } else {
            const n = intervals.length;
            for (let i = 0; i < 32; i++) {
                const col = i % 8;
                const row = Math.floor(i / 8);
                const deg = col + row * 3;
                const oct = Math.floor(deg / n);
                const semitone = oct * 12 + intervals[deg % n];
                const p = root + semitone;
                S.padNoteMap[i] = (p < 0 || p > 127) ? 0xFF : p;
            }
        }
    }
    /* Phase 1: push the resolved active-track map to DSP for audio-thread
     * inbound. DSP only ever indexes pad_note_map[inst->active_track], so
     * pushing the one active track's map on every recompute is sufficient.
     * Dormant until the capability gate flips dsp_inbound_enabled in
     * piece 3. */
    /* PHASE-1: only push on patched Schwung. The DSP padmap handler doubles
     * as the capability signal — its presence sets inst->dsp_inbound_enabled,
     * gating on_midi dispatch. On stock Schwung S.dspInboundEnabled stays
     * false, the push is skipped, on_midi (which isn't called on stock anyway)
     * stays dormant, and the JS pendingLiveNotes path keeps working unchanged.
     * Remove this gate when patches upstreamed. */
    if (S.dspInboundEnabled && typeof host_module_set_param === 'function') {
        /* JS dispatch today adds S.trackOctave * 12 at the pad-press site
         * (lines ~6838, ~6909). Phase 1's on_midi reads pad_note_map as-is,
         * so we bake the runtime octave offset into the pushed payload while
         * leaving S.padNoteMap itself unshifted (the stock-Schwung fallback
         * path still adds the offset at dispatch). Drum tracks ignore the
         * offset (lane midi_notes are fixed). Session View: pads launch
         * clips — emit all-0xFF so DSP on_midi skips dispatch. Track-view
         * re-entry triggers another computePadNoteMap() in tick(). */
        /* PHASE-1: pad dispatch is muted while a modal gesture owns the pad
         * surface. DSP on_midi skips 0xFF entries, so pushing all-0xFF
         * suppresses note dispatch without changing on_midi code. State
         * sources: button-held modifiers (covered by explicit hooks in
         * _onCC_buttons for zero-latency), dialogs (covered by the
         * tick()-time muted-edge detector below). Remove the modal-flag
         * checks when patches upstreamed. See [[project-modal-pad-
         * interception-regression]]. */
        const padDispatchMuted = _padDispatchMutedNow();
        const isDrum = S.trackPadMode[t] === PAD_MODE_DRUM;
        const octShift = isDrum ? 0 : ((S.trackOctave[t] | 0) * 12);
        let payload = '';
        for (let i = 0; i < 32; i++) {
            let out;
            if (padDispatchMuted && S.sessionView) {
                out = 0xFF;
            } else if (padDispatchMuted) {
                const p = S.padNoteMap[i];
                out = (p === 0xFF) ? 0xFF : Math.max(0, Math.min(127, p + octShift));
            } else {
                const p = S.padNoteMap[i];
                out = (p === 0xFF) ? 0xFF : Math.max(0, Math.min(127, p + octShift));
            }
            payload += (i ? ' ' : '') + out;
        }
        /* The tN_padmap key encodes the active track index — DSP's
         * tN_padmap handler updates inst->active_track + dsp_inbound_enabled
         * from it. (Schwung host silently drops module-defined global keys,
         * so we piggyback signals onto the per-track padmap push.)
         *
        /* 33rd token = pad-dispatch-muted flag. While set, DSP on_midi skips
         * drum_pad_event (Rpt1/Rpt2 rate-pad + vel-zone handling) on top of
         * the existing pad_note_map=0xFF mute. Fixes Shift+bottom-row track
         * shortcut leaking into Rpt1/Rpt2 latch on the prior active track. */
        payload += ' ' + (padDispatchMuted ? 1 : 0);
        payload += ' ' + (S.deleteHeld ? 1 : 0);
        /* 35th token = corun_left_silent. When this (drum) track's left-column
         * lane pads are intentionally mapped to 0xFF for Move-native co-run
         * (so DSP on_midi skips them — Move plays the injected pad), tell DSP
         * so it excludes these benign 0xFF presses from the pad-drop
         * diagnostic. Mirrors coRunSilentLeft in computePadNoteMap. */
        payload += ' ' + ((isDrum && S.moveCoRunTrack >= 0) ? 1 : 0);
        host_module_set_param('t' + t + '_padmap', payload);
        S.lastPushedMuted = padDispatchMuted;
    }
}

/* Drum helpers --------------------------------------------------------------- */

/** Sync one drum lane's step data and length from DSP. */
function syncDrumLaneSteps(t, l) {
    if (typeof host_module_get_param !== 'function') return;
    const raw = host_module_get_param('t' + t + '_l' + l + '_steps');
    if (raw) {
        for (let s = 0; s < 256; s++) S.drumLaneSteps[t][l][s] = raw[s] || '0';
        S.drumLaneHasNotes[t][l] = raw.indexOf('1') >= 0;
    }
    if (l === S.activeDrumLane[t]) {
        const lenRaw = host_module_get_param('t' + t + '_l' + l + '_length');
        if (lenRaw !== null) S.drumLaneLength[t] = parseInt(lenRaw, 10) || 16;
        const lsRaw = host_module_get_param('t' + t + '_l' + l + '_loop_start');
        if (lsRaw !== null) S.drumLaneLoopStart[t] = parseInt(lsRaw, 10) | 0;
        const lsPage = Math.floor(S.drumLaneLoopStart[t] / 16);
        const winPages = Math.max(1, Math.ceil(S.drumLaneLength[t] / 16));
        if (S.drumStepPage[t] < lsPage) S.drumStepPage[t] = lsPage;
        else if (S.drumStepPage[t] > lsPage + winPages - 1) S.drumStepPage[t] = lsPage + winPages - 1;
        const tpsRaw = host_module_get_param('t' + t + '_l' + l + '_tps');
        if (tpsRaw !== null) S.drumLaneTPS[t] = parseInt(tpsRaw, 10) || 24;
    }
}

/** Sync lane notes and hit-presence for all lanes of track t (active clip). */
function syncDrumLanesMeta(t) {
    if (typeof host_module_get_param !== 'function') return;
    for (let l = 0; l < DRUM_LANES; l++) {
        const noteRaw = host_module_get_param('t' + t + '_l' + l + '_lane_note');
        if (noteRaw !== null) S.drumLaneNote[t][l] = parseInt(noteRaw, 10) || (DRUM_BASE_NOTE + l);
        const ncRaw  = host_module_get_param('t' + t + '_l' + l + '_note_count');
        S.drumLaneHasNotes[t][l] = ncRaw !== null ? parseInt(ncRaw, 10) > 0 : false;
    }
    const muteRaw = host_module_get_param('t' + t + '_drum_lane_mute');
    if (muteRaw !== null) S.drumLaneMute[t] = parseInt(muteRaw, 10) >>> 0;
    const soloRaw = host_module_get_param('t' + t + '_drum_lane_solo');
    if (soloRaw !== null) S.drumLaneSolo[t] = parseInt(soloRaw, 10) >>> 0;
}


/** Convert a padIdx (0-31) to drum lane index for the current lane page, or -1 if right half. */
function drumPadToLane(padIdx) {
    const col = padIdx % 8;
    if (col >= 4) return -1;
    const row = Math.floor(padIdx / 8);
    return S.drumLanePage[S.activeTrack] * 16 + row * 4 + col;
}

/* Bundle 2A: single setter for S.activeDrumLane that also pushes the
 * value to DSP via tN_active_drum_lane so on_midi.drum_pad_event can
 * fire vel-pad preview at the active lane's note. Replaces every direct
 * S.activeDrumLane[t] = X write site. PHASE-1: remove the set_param push
 * (and revert to direct writes) when patches are upstreamed and the JS
 * input path is deleted. */
function setActiveDrumLane(t, lane) {
    if (S.activeDrumLane[t] === lane) return;
    /* NB: written via array-ref alias so a future `replace_all` on the
     * pattern `S.activeDrumLane[t] = lane;` can't accidentally turn this
     * line into a recursive call to setActiveDrumLane (which is what
     * happened on the first 2A deploy — stack overflow on init). */
    const arr = S.activeDrumLane;
    arr[t] = lane;
    if (typeof host_module_set_param === 'function')
        host_module_set_param('t' + t + '_active_drum_lane', String(lane));
}

/* Bundle 2A: single setter for S.drumPerformMode that also pushes the
 * value to DSP via tN_drum_perform_mode so on_midi.drum_pad_event can
 * gate the vel-zone preview branch correctly (Rpt modes skip the
 * preview; only NORMAL fires it). Same array-ref-alias pattern as
 * setActiveDrumLane to avoid replace_all self-recursion. */
function setDrumPerformMode(t, mode) {
    if (S.drumPerformMode[t] === mode) return;
    const arrPm = S.drumPerformMode;
    arrPm[t] = mode;
    if (typeof host_module_set_param === 'function')
        host_module_set_param('t' + t + '_drum_perform_mode', String(mode));
}

/* Bundle 2C-Rpt2: single setter for S.drumLanePage that also pushes the
 * value to DSP via tN_drum_lane_page so on_midi.drum_pad_event can
 * translate left-half padIdx → absolute drum lane index (Rpt2 lane-pad
 * classification + Rpt1 lane-swap-while-holding). Same array-ref-alias
 * pattern as setActiveDrumLane to avoid replace_all self-recursion. */
function setDrumLanePage(t, page) {
    if (S.drumLanePage[t] === page) return;
    const arrLp = S.drumLanePage;
    arrLp[t] = page;
    if (typeof host_module_set_param === 'function')
        host_module_set_param('t' + t + '_drum_lane_page', String(page));
}

/** Convert a padIdx (0-31) to velocity zone 0-15, or -1 if left half. */
function drumPadToVelZone(padIdx) {
    const col = padIdx % 8;
    if (col < 4) return -1;
    const row = Math.floor(padIdx / 8);
    return row * 4 + (col - 4);
}

/** Map velocity zone 0-15 to a MIDI velocity (8…127). */
function drumVelZoneToVelocity(zone) {
    return Math.round((zone + 1) * 127 / 16);
}

/** Sync S.drumClipNonEmpty[t] for all clips — called on track switch and state load. */
function syncDrumClipContent(t) {
    if (typeof host_module_get_param !== 'function') return;
    for (let c = 0; c < NUM_CLIPS; c++) {
        const raw = host_module_get_param('t' + t + '_c' + c + '_drum_has_content');
        S.drumClipNonEmpty[t][c] = raw === '1';
    }
}

/** MIDI note number → display string e.g. "C3 / 60" */
function drumNoteLabel(midiNote) {
    const oct  = Math.floor(midiNote / 12) - 2;
    const name = NOTE_KEYS[midiNote % 12];
    return name + oct + '/' + midiNote;
}

/* --------------------------------------------------------------------------- */

/* Root note in pad layout closest to octave 4 — guaranteed in-scale and on a pad. */
function defaultStepNote() {
    const target = S.padKey + 60;  /* root pitch class in MIDI octave 4 */
    let best = -1, bestDist = 999;
    for (let i = 0; i < 32; i++) {
        if (S.padNoteMap[i] === 0xFF) continue;  /* OOB pad — no melodic note */
        const p = S.padNoteMap[i] + S.trackOctave[S.activeTrack] * 12;
        if (p < 0 || p > 127) continue;
        if (S.padNoteMap[i] % 12 !== S.padKey) continue;  /* root notes only */
        const d = Math.abs(p - target);
        if (d < bestDist) { bestDist = d; best = p; }
    }
    if (best >= 0) return best;
    /* Fallback: first valid (non-0xFF) entry; if every pad is OOB (shouldn't
     * happen at any sane octave), return middle C. */
    for (let i = 0; i < 32; i++) {
        if (S.padNoteMap[i] === 0xFF) continue;
        return Math.max(0, Math.min(127, S.padNoteMap[i] + S.trackOctave[S.activeTrack] * 12));
    }
    return 60;
}


/* Synchronously zero every LED that SEQ8 owns — call before host_hide_module(). */
function clearAllLEDs() {
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

function installFlagsWrap() {
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

function removeFlagsWrap() {
    const cur = globalThis.shadow_get_ui_flags;
    if (typeof cur === 'function' && cur._seq8) {
        cur._active = false;
        globalThis.shadow_get_ui_flags = cur._orig;
    }
}

function buildLedInitQueue() {
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

function drainLedInit() {
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

/* Per-clip banks: NOTE FX (2), HARMZ (3), SEQ ARP (4), MIDI DLY (5) */
const PER_CLIP_BANKS  = [1, 2, 3, 4];

/* Read per-clip bank params from DSP into S.bankParams for track t.
 * Reads from clip[active_clip].pfx_params directly — immune to pfx_sync timing. */
function refreshDrumLaneBankParams(t, lane) {
    if (typeof host_module_get_param !== 'function') return;
    const snap = host_module_get_param('t' + t + '_l' + lane + '_pfx_snapshot');
    if (snap) {
        const v = snap.split(' ');
        if (v.length >= 9) {
            /* NOTE FX bank (1): gate_time, vel_offset, quantize */
            S.bankParams[t][1][0] = parseInt(v[0], 10) | 0;  /* Gate */
            S.bankParams[t][1][1] = parseInt(v[1], 10) | 0;  /* Vel  */
            S.bankParams[t][1][2] = parseInt(v[2], 10) | 0;  /* Qnt  */
            S.drumLaneQnt[t]      = S.bankParams[t][1][2];
            /* MIDI DLY bank (3): delay_time_idx, delay_level, repeat_times,
               fb_velocity, fb_gate_time, fb_clock at v[3..8]; delay_retrig at v[9]
               (K6 of the drum delay bank layout). */
            for (let k = 0; k < 6; k++) S.bankParams[t][3][k] = parseInt(v[3 + k], 10) | 0;
            if (v.length >= 10) S.bankParams[t][3][6] = parseInt(v[9], 10) | 0;
            /* NOTE FX K5 Len mode (v[10]) — per-lane mirror. */
            if (v.length >= 11) S.drumLaneLenMode[t][lane] = parseInt(v[10], 10) | 0;
        }
    }
    /* DRUM LANE bank (0): Res (K1=idx0), Eucl (K5=idx4), Dir (K7=idx6),
     * SqFl (K8=idx7) per-lane meta. */
    const tpsIdx = TPS_VALUES.indexOf(S.drumLaneTPS[t]);
    S.bankParams[t][0][0] = tpsIdx >= 0 ? tpsIdx : 1;
    S.bankParams[t][0][4] = S.drumLaneEuclidN[t][lane] | 0;
    {
        const _pd = host_module_get_param('t' + t + '_l' + lane + '_playback_dir');
        const _pdv = parseInt(_pd, 10);
        const _pdvi = (isFinite(_pdv) && _pdv >= 0 && _pdv <= 3) ? _pdv : 0;
        S.drumLanePlaybackDir[t][lane] = _pdvi;
        S.bankParams[t][0][6] = _pdvi;
        const _par = host_module_get_param('t' + t + '_l' + lane + '_playback_audio_reverse');
        const _parv = parseInt(_par, 10);
        S.drumLanePlaybackAudioReverse[t][lane] = (isFinite(_parv) && _parv === 1) ? 1 : 0;
    }
    S.bankParams[t][0][7] = S.clipSeqFollow[t][S.trackActiveClip[t]] ? 1 : 0;
    /* Repeat Groove state for this lane */
    syncDrumRepeatState(t, lane);
    S.screenDirty = true;
}

function syncDrumRepeatState(t, lane) {
    if (typeof host_module_get_param !== 'function') return;
    const raw = host_module_get_param('t' + t + '_l' + lane + '_repeat_state');
    if (!raw) return;
    const v = raw.split(' ');
    if (v.length < 18) return;
    S.drumRepeatGate[t][lane] = parseInt(v[0], 10) & 0xFF;
    for (let s = 0; s < 8; s++) S.drumRepeatVelScale[t][lane][s] = parseInt(v[1 + s], 10) | 0;
    for (let s = 0; s < 8; s++) S.drumRepeatNudge[t][lane][s]    = parseInt(v[9 + s], 10) | 0;
    if (v.length >= 19) S.drumRepeatGateLen[t][lane] = parseInt(v[18], 10) || 8;
}

/* Full drum-track resync after a track switch: lane metadata (MIDI notes,
 * mute/solo), the active lane's step pattern, clip non-empty dots, and bank
 * params. The two track-switch entry points (Shift+pad, Shift+jog) must both
 * call this so a drum track that changed while inactive (e.g. a clip launched
 * from Session View) doesn't show stale steps/notes/dots. */
function resyncDrumTrack(t) {
    syncDrumLanesMeta(t);
    syncDrumLaneSteps(t, S.activeDrumLane[t]);
    syncDrumClipContent(t);
    refreshDrumLaneBankParams(t, S.activeDrumLane[t]);
}

function refreshPerClipBankParams(t) {
    if (typeof host_module_get_param !== 'function') return;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        refreshDrumLaneBankParams(t, S.activeDrumLane[t]);
        return;
    }
    const ac   = S.trackActiveClip[t];
    const snap = host_module_get_param('t' + t + '_c' + ac + '_pfx_snapshot');
    if (!snap) return;
    const v = snap.split(' ');
    if (v.length < 17) return;
    /* NOTE FX bank (1): K1=Oct K2=Ofs K3=Vel K4=Qnt K5=Len K6=Gate K7=blocked K8=Rnd
     * (DSP snapshot still emits v[] in original order oct/ofs/gate/vel/qnt + rnd at v[31].) */
    S.bankParams[t][1][0] = parseInt(v[0], 10) | 0;  /* K1 = Oct */
    S.bankParams[t][1][1] = parseInt(v[1], 10) | 0;  /* K2 = Ofs */
    S.bankParams[t][1][2] = parseInt(v[3], 10) | 0;  /* K3 = Vel */
    S.bankParams[t][1][3] = parseInt(v[4], 10) | 0;  /* K4 = Qnt */
    /* K5 = Len mode at v[43] (appended after seq_arp_step_loop_len at v[42]) */
    S.bankParams[t][1][4] = v.length >= 44 ? (parseInt(v[43], 10) | 0) : 0;
    S.bankParams[t][1][5] = parseInt(v[2], 10) | 0;  /* K6 = Gate */
    /* K7 (idx 6) = blocked — leave at 0 */
    /* NOTE FX random + modes packed at v[31..33] (right after step_vel[0..7] = v[23..30]) */
    S.bankParams[t][1][7] = v.length >= 32 ? (parseInt(v[31], 10) | 0) : 0; /* K8 = Rnd */
    S.noteFXRandomMode[t]  = v.length >= 33 ? (parseInt(v[32], 10) | 0) : 2;
    S.midiDlyRandomMode[t] = v.length >= 34 ? (parseInt(v[33], 10) | 0) : 2;
    /* HARMZ bank (2): K0=oct K1=hrm1 K2=hrm2 K3=hrm3 (Unis retired in state v=33) */
    for (let k = 0; k < 4; k++) S.bankParams[t][2][k] = parseInt(v[5 + k], 10) | 0;
    /* MIDI DLY bank (3): K0=dly K1=lvl K2=rep K3=vfb K4=pfb K5=gfb K6=retrg K7=rnd
     * (delay_clock_fb moved to Shift+K1 alt — read separately via tN_delay_clock_fb). */
    for (let k = 0; k < 8; k++) S.bankParams[t][3][k] = parseInt(v[9 + k], 10) | 0;
    /* SEQ ARP bank (4): K0=style K1=rate K2=oct K3=gate K4=steps K5=retrigger (length-aware) */
    if (v.length >= 23) {
        for (let k = 0; k < 6; k++) S.bankParams[t][4][k] = parseInt(v[17 + k], 10) | 0;
    }
    /* step_vel[0..7] when present (length-aware) */
    if (v.length >= 31) {
        for (let s = 0; s < 8; s++) S.seqArpStepVel[t][ac][s] = parseInt(v[23 + s], 10) | 0;
    }
    /* step_int[0..7] at v[34..41] (scale-degree offsets for Arp Steps interval mode) */
    if (v.length >= 42) {
        for (let s = 0; s < 8; s++) S.seqArpStepInt[t][ac][s] = parseInt(v[34 + s], 10) | 0;
    }
    /* step_loop_len at v[42] (1..8) */
    if (v.length >= 43) {
        const _ll = parseInt(v[42], 10) | 0;
        S.seqArpStepLoopLen[t][ac] = (_ll >= 1 && _ll <= 8) ? _ll : 8;
    }
    /* CLIP bank (0): Res (K1=idx0), Dir (K7=idx6), SqFl (K8=idx7) — all per-clip. */
    const tps    = S.clipTPS[t][ac] || 24;
    const tpsIdx = TPS_VALUES.indexOf(tps);
    S.bankParams[t][0][0] = tpsIdx >= 0 ? tpsIdx : 1;
    {
        const _pd = host_module_get_param('t' + t + '_clip_playback_dir');
        const _pdv = parseInt(_pd, 10);
        const _pdvi = (isFinite(_pdv) && _pdv >= 0 && _pdv <= 3) ? _pdv : 0;
        S.clipPlaybackDir[t][ac] = _pdvi;
        S.bankParams[t][0][6] = _pdvi;
        const _par = host_module_get_param('t' + t + '_clip_playback_audio_reverse');
        const _parv = parseInt(_par, 10);
        S.clipPlaybackAudioReverse[t][ac] = (isFinite(_parv) && _parv === 1) ? 1 : 0;
    }
    S.bankParams[t][0][7] = S.clipSeqFollow[t][ac] ? 1 : 0;
    S.screenDirty = true;
}

/* Read TRACK ARP step_vel[8] from DSP for track t. Called on init and track switch. */
function readTarpStepVel(t) {
    if (typeof host_module_get_param !== 'function') return;
    const raw = host_module_get_param('t' + t + '_tarp_sv');
    if (!raw) return;
    const v = raw.split(' ');
    for (let s = 0; s < 8; s++)
        S.tarpStepVel[t][s] = parseInt(v[s], 10) | 0;
    /* Also pull step_int[8] (Arp Steps interval mode). */
    const rawI = host_module_get_param('t' + t + '_tarp_si');
    if (rawI) {
        const vi = rawI.split(' ');
        for (let s = 0; s < 8; s++)
            S.tarpStepInt[t][s] = parseInt(vi[s], 10) | 0;
    }
    /* Step pattern loop length (1..8). */
    const rawL = host_module_get_param('t' + t + '_tarp_sll');
    if (rawL !== null && rawL !== undefined) {
        const _ll = parseInt(rawL, 10) | 0;
        S.tarpStepLoopLen[t] = (_ll >= 1 && _ll <= 8) ? _ll : 8;
    }
}

/* Read Rpt2 per-lane rate idx[32] from DSP for track t. Called after state
 * load so the rate-pad LED highlight matches the persisted DSP state.
 * (Rpt1's per-track last-rate lives only in DSP — JS has no mirror for it.) */
function readDrumRepeatRates(t) {
    if (typeof host_module_get_param !== 'function') return;
    const r2 = host_module_get_param('t' + t + '_drum_r2rt');
    if (r2) {
        const v = r2.split(' ');
        for (let l = 0; l < 32 && l < v.length; l++)
            S.drumRepeat2RatePerLane[t][l] = parseInt(v[l], 10) | 0;
    }
}

/* Reset per-clip S.bankParams to defaults for track t (no DSP call needed —
 * DSP already reset them; this just keeps JS mirrors in sync). */
function resetPerClipBankParamsToDefault(t) {
    for (let bi = 0; bi < PER_CLIP_BANKS.length; bi++) {
        const b = PER_CLIP_BANKS[bi];
        for (let k = 0; k < 8; k++) {
            const pm = BANKS[b].knobs[k];
            if (pm) S.bankParams[t][b][k] = pm.def;
        }
    }
    /* DSP self-resets pfx params to 0 on clip clear; defer non-zero JS defaults
     * onto the pendingDefaultSetParams queue so they land on a later tick and
     * don't coalesce with the clear set_param fired by the caller. */
    const _ac = S.trackActiveClip[t];
    S.pendingDefaultSetParams.push({
        key: 't' + t + '_c' + _ac + '_pfx_set',
        val: 'delay_level 127'
    });
    S.screenDirty = true;
}

function pollDSP() {
    /* Reconcile co-run state with SHM. The shim auto-clears co-run on user
     * Back press (framework exit gesture), so dAVEBOx may discover target=NONE
     * here without having driven the exit itself. Use the existing exit
     * helpers for cleanup — they're idempotent on the second SHM write and
     * carry the palette/LED-cache/modifier-clear work we need either way. */
    if (typeof shadow_corun_state === 'function') {
        const _st = shadow_corun_state();
        const _slot  = (_st && _st.target === CORUN_TARGET_CHAIN_EDIT)  ? _st.id : -1;
        const _track = (_st && _st.target === CORUN_TARGET_MOVE_NATIVE) ? _st.id : -1;
        if (_slot < 0 && S.schwungCoRunSlot >= 0) {
            exitSchwungCoRun();
            /* Framework exit also closes any global menu we opened to launch it. */
            S.globalMenuOpen = false;
            S.lastSentMenuEditValue = null;
        }
        if (_track < 0 && S.moveCoRunTrack >= 0) {
            exitMoveNativeCoRun();
        }
        if (S.coRunOverlayScreen === undefined) {
            /* Which Schwung screen Note/Session opens as an overlay in Move co-run.
             * Prefer this fork's FX-bus picker; fall back to an upstream-registered
             * FX screen (master_fx) so the overlay also works on STOCK Schwung that
             * has the co-run view-addressing API (shadow_corun_*) but not the fork's
             * fork-only fx_picker entry. null = no addressable screen available. */
            let _scr = null;
            if (typeof shadow_corun_entries === 'function') {
                const _ents = shadow_corun_entries();
                if (_ents.indexOf('fx_picker') >= 0) _scr = 'fx_picker';
                else if (_ents.indexOf('master_fx') >= 0) _scr = 'master_fx';
            }
            S.coRunOverlayScreen = _scr;
        }
    }
    if (typeof host_module_get_param !== 'function') return;
    /* Keep the AUTOMATION-bank AT indicator live (it appears as you record). */
    if (S.activeBank === 6) {
        const _at = S.activeTrack, _ac = effectiveClip(_at);
        const _ah = host_module_get_param('t' + _at + '_c' + _ac + '_at_has');
        if (_ah !== null) S.clipAtHas[_at][_ac] = (parseInt(_ah, 10) === 1);
    }
    /* Clock-follow: keep the UI's view of follow mode + Move's transport live so
     * BPM shows EXT and Tap Tempo is gated. Cheap single get_param per poll. */
    {
        const _cs = host_module_get_param('clock_follow_on');
        if (_cs !== null) S.clockFollowOn = (_cs === '1');
        /* Clock Out: stored preference; sync UI from DSP (reflects saved _cs on
         * state load). Emission itself is gated DSP-side on free-running. */
        const _co = host_module_get_param('clock_send_on');
        if (_co !== null) S.clockSendOn = (_co === '1');
        /* Clock-Follow start fell back to the solo clock (Move never started after
         * the Link-sync wait) — DSP raises a one-shot; warn the user briefly. */
        if (host_module_get_param('clock_follow_fallback') === '1')
            showActionPopup('CLOCK FOLLOW', "Move didn't start", 'Last-known tempo');
    }
    const snap = host_module_get_param('state_snapshot');
    if (!snap) return;
    const v = snap.split(' ');
    if (v.length < 53) return;
    S.playing = (v[0] === '1');
    for (let t = 0; t < NUM_TRACKS; t++) {
        const newStep = parseInt(v[1 + t], 10) | 0;
        S.trackCurrentStep[t] = newStep;
        if (S.playing) {
            const newClip = parseInt(v[9 + t], 10) | 0;
            S.trackActiveClip[t] = newClip;
            if (newClip !== S.lastDspActiveClip[t]) {
                S.lastDspActiveClip[t] = newClip;
                refreshPerClipBankParams(t);
                if (S.trackPadMode[t] === PAD_MODE_DRUM) {
                    syncDrumLanesMeta(t);
                    syncDrumLaneSteps(t, S.activeDrumLane[t]);
                }
            }
        }
        const _newQ = parseInt(v[17 + t], 10) | 0;
        if (_newQ !== S.trackQueuedClip[t]) S.screenDirty = true;
        S.trackQueuedClip[t]  = _newQ;
    }
    const countInDspActive = (v[25] === '1');
    for (let t = 0; t < NUM_TRACKS; t++) {
        const _newPlaying  = (v[26 + t] === '1');
        const _newWR       = (v[34 + t] === '1');
        if (_newPlaying !== S.trackClipPlaying[t] || _newWR !== S.trackWillRelaunch[t]) {
            S.screenDirty = true;
        }
        S.trackClipPlaying[t]     = _newPlaying;
        S.trackWillRelaunch[t]    = _newWR;
        S.trackPendingPageStop[t] = (v[42 + t] === '1');
    }
    S.flashEighth    = (v[50] === '1');
    S.flashSixteenth = (v[51] === '1');
    if (v.length >= 54) S.masterPos      = (parseInt(v[53], 10) | 0) >>> 0;
    if (v.length >= 55) S.dspLooperState  = parseInt(v[54], 10) | 0;
    const _prevMergeState = S.dspMergeState;
    if (v.length >= 56) S.dspMergeState   = parseInt(v[55], 10) | 0;
    /* Arm confirmation: no longer fails on "no empty slot" — placement is
     * deferred until the user picks a row, so arm always succeeds. */
    if (S.pendingMergeArm) S.pendingMergeArm = false;
    /* Capture-done transition: DSP went into CAPTURED (4) — show placement
     * dialog so the user can tap a row to commit. */
    if (_prevMergeState !== 4 && S.dspMergeState === 4) {
        S.pendingMergePlacement = true;
        S.screenDirty = true;
    }
    /* Placement complete: DSP transitioned CAPTURED→IDLE (merge_place_row
     * fired and committed clips). Re-read ALL clips from DSP — any of the 8
     * tracks may have just received fresh notes at the placement row. The
     * full re-read also rebuilds clipSteps/clipNonEmpty mirrors so the
     * Session-View overview lights the newly-populated clip pads. */
    if (_prevMergeState !== 0 && S.dspMergeState === 0) {
        setButtonLED(MoveSample, LED_OFF);
        if (_prevMergeState === 2) showActionPopup('MAX LENGTH', 'REACHED');
        syncClipsFromDsp();
        S.screenDirty = true;
    }

    /* Deferred bank refresh after bake */
    if (S.pendingBankRefresh >= 0) {
        refreshPerClipBankParams(S.pendingBankRefresh);
        S.pendingBankRefresh = -1;
        S.screenDirty = true;
    }

    /* Drum playhead: poll active lane's current step for active drum track */
    if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
        const _dl = S.activeDrumLane[S.activeTrack];
        const _dcRaw = host_module_get_param('t' + S.activeTrack + '_l' + _dl + '_current_step');
        if (_dcRaw !== null) {
            const _newDcs = parseInt(_dcRaw, 10) | 0;
            if (_newDcs !== S.drumCurrentStep[S.activeTrack]) {
                S.drumCurrentStep[S.activeTrack] = _newDcs;
                S.screenDirty = true;
            }
        }
        /* Drum SeqFollow: auto-page to follow playhead */
        if (S.playing && S.trackClipPlaying[S.activeTrack] && S.clipSeqFollow[S.activeTrack][effectiveClip(S.activeTrack)]) {
            const _dcs = S.drumCurrentStep[S.activeTrack];
            if (_dcs >= 0) {
                const _newPage = Math.floor(_dcs / 16);
                if (_newPage !== S.drumStepPage[S.activeTrack]) {
                    S.drumStepPage[S.activeTrack] = _newPage;
                    S.screenDirty = true;
                }
            }
        }
        /* M blink: keep screen dirty while any lane is muted so blink animates */
        if (S.drumLaneMute[S.activeTrack]) S.screenDirty = true;
        /* Drum pad flash + S.seqActiveNotes: poll which lanes are hitting (single bitmask call) */
        if (S.playing && S.trackClipPlaying[S.activeTrack]) {
            const _maskRaw = host_module_get_param('t' + S.activeTrack + '_drum_active_lanes');
            if (_maskRaw !== null) {
                const _mask = parseInt(_maskRaw, 10) | 0;
                S.seqActiveNotes.clear(); /* refresh per poll; stale entries block external recording */
                for (let _fl = 0; _fl < DRUM_LANES; _fl++) {
                    if (_mask & (1 << _fl)) {
                        S.drumLaneFlashTick[S.activeTrack][_fl] = S.tickCount;
                        S.seqActiveNotes.add(S.drumLaneNote[S.activeTrack][_fl]);
                        S.screenDirty = true;
                    }
                }
            }
        }
    } else {
        /* TARP held-buffer mirror: poll DSP buffer for active melodic track when
         * latch + style are both on so source pads light up. Cleared when either
         * is off (style=0 silences the engine — pad lighting follows suit). Drives
         * only pad LEDs (updateTrackLEDs reads .has() each tick) — no OLED
         * dependency so no screenDirty needed here. */
        const _tat = S.activeTrack;
        const _tLatch = (S.bankParams[_tat][5][7] | 0) !== 0 &&
                        (S.bankParams[_tat][5][0] | 0) !== 0;
        if (_tLatch) {
            const _hRaw = host_module_get_param('t' + _tat + '_tarp_held');
            const _set = S.tarpHeldNotes[_tat];
            _set.clear();
            if (_hRaw) {
                const _parts = _hRaw.split(' ');
                for (let _i = 0; _i < _parts.length; _i++) {
                    const _p = parseInt(_parts[_i], 10);
                    if (_p >= 0 && _p <= 127) _set.add(_p);
                }
            }
        } else if (S.tarpHeldNotes[_tat].size > 0) {
            S.tarpHeldNotes[_tat].clear();
        }
    }

    /* SeqFollow: auto-page S.activeTrack to follow playhead */
    if (S.playing) {
        const _sft = S.activeTrack;
        const _sfac = effectiveClip(_sft);
        if (S.clipSeqFollow[_sft][_sfac] && S.trackClipPlaying[_sft]) {
            var newPage;
            if (S.activeBank === 6) {
                var _ccLsf = S.ccActiveLane[_sft];
                var _dispTpsSf = S.ccLaneTps[_sft][_sfac][_ccLsf] || (S.clipTPS[_sft][_sfac] || 24);
                var _lTpsSf = S.ccLaneResTps[_sft][_sfac][_ccLsf] || _dispTpsSf;
                var _effLenSf = S.ccLaneLength[_sft][_sfac][_ccLsf] || S.clipLength[_sft][_sfac];
                var _lLenTicksSf = _effLenSf * _lTpsSf;
                var _progressSf = (S.masterPos % _lLenTicksSf) / _lLenTicksSf;
                var _laneStep = Math.floor(_progressSf * _effLenSf);
                newPage = Math.floor(_laneStep / 16);
            } else {
                var _cs = S.trackCurrentStep[_sft];
                if (_cs >= 0) newPage = Math.floor(_cs / 16);
            }
            if (newPage !== undefined && newPage !== S.trackCurrentPage[_sft]) {
                S.trackCurrentPage[_sft] = newPage;
                S.screenDirty = true;
            }
        }
    }

    /* Record-arm pending page boundary: DSP defers recording=1 to next bar.
     * Clear S.recordPendingPage once DSP has fired (recording_pending_page=0). */
    if (S.recordPendingPage && S.recordArmedTrack >= 0 && typeof host_module_get_param === 'function') {
        const _rpp = host_module_get_param('t' + S.recordArmedTrack + '_recording_pending_page');
        if (_rpp === '0') S.recordPendingPage = false;
    }

    /* Count-in end: DSP fired transport+recording — sync JS state */
    if (S.countInDspPrev && !countInDspActive && S.playing) {
        S.recordCountingIn    = false;
        S.countInStartTick    = -1;
        S.countInQuarterTicks = 0;
    }
    S.countInDspPrev = countInDspActive;

    /* Transport transitions */
    if (!S.playingPrev && S.playing) {
        S.transportStartTick = S.tickCount;
        /* Focused-clip-by-default on transport start: only the clip the user
         * is currently *viewing* in Track View auto-launches. Session View
         * launches whatever is already queued — explicit launch by the user.
         * The "focused" concept is single-clip: the one open for editing on
         * the active track in Track View; other tracks aren't focused and
         * shouldn't auto-launch (otherwise Session-View Delete+Play to
         * deactivate everything would be undone by the next transport start). */
        if (!S.sessionView) {
            const _at = S.activeTrack;
            if (!S.trackClipPlaying[_at]
                    && !S.trackWillRelaunch[_at]
                    && S.trackQueuedClip[_at] === -1
                    && _focusedClipIsEmpty(_at)) {
                const _tac = S.trackActiveClip[_at];
                S.pendingDefaultSetParams.push({ key: 't' + _at + '_launch_clip', val: String(_tac) });
                S.trackQueuedClip[_at] = _tac;
            }
        }
        /* Auto-launch focused clip if record is armed and clip is inactive */
        if (S.recordArmed) {
            const _rT  = S.recordArmedTrack >= 0 ? S.recordArmedTrack : S.activeTrack;
            const _rAc = S.trackActiveClip[_rT];
            if (S.clipNonEmpty[_rT][_rAc] &&
                    !S.trackClipPlaying[_rT] &&
                    !S.trackWillRelaunch[_rT] &&
                    S.trackQueuedClip[_rT] !== _rAc) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + _rT + '_launch_clip', String(_rAc));
                S.trackQueuedClip[_rT] = _rAc;
            }
            /* Adaptive mode for count-in path: enter if clip was empty with no manual length */
            if (!S.clipAdaptiveMode[_rT][_rAc]) {
                const _isDrumAdapt = S.trackPadMode[_rT] === PAD_MODE_DRUM;
                if (_isDrumAdapt ? (!S.drumClipNonEmpty[_rT][_rAc] && !S.drumLaneLengthManuallySet[_rT])
                                 : (!S.clipNonEmpty[_rT][_rAc] && !S.clipLengthManuallySet[_rT][_rAc]))
                    S.clipAdaptiveMode[_rT][_rAc] = true;
            }
        }
    }
    if (S.playingPrev  && !S.playing) {
        disarmRecord();
        /* Transport stop unlatches TARP + Rpt1 + Rpt2 on every track so
         * latched chords/lanes don't drone with transport dead. Shared
         * helper queues the per-track set_params one-per-tick via
         * pendingDefaultSetParams to avoid same-buffer coalescing. */
        unlatchAllTracks();
    }
    S.playingPrev = S.playing;

    /* Refresh step LEDs while recording or holding a step (nudge may move note across boundary) */
    if ((S.recordArmed && S.playing) || S.heldStep >= 0) {
        const rt = S.activeTrack;
        const rac = effectiveClip(rt);
        const bulk = host_module_get_param('t' + rt + '_c' + rac + '_steps');
        if (bulk && bulk.length >= NUM_STEPS) {
            for (let rs = 0; rs < NUM_STEPS; rs++)
                S.clipSteps[rt][rac][rs] = bulk[rs] === '1' ? 1 : (bulk[rs] === '2' ? 2 : 0);
            S.clipNonEmpty[rt][rac] = clipHasContent(rt, rac);
            S.screenDirty = true;
        }
    }

    /* Track sequencer notes for active track pad highlighting */
    const t  = S.activeTrack;
    const ac = S.trackActiveClip[t];
    const cs = S.trackCurrentStep[t];
    if (!S.playing) {
        S.seqActiveNotes.clear();
        S.seqLastStep = -1;
        S.seqLastClip = -1;
        S.seqNoteOnClipTick = -1;
        S.seqNoteGateTicks  = 0;
    } else if (cs !== S.seqLastStep || ac !== S.seqLastClip) {
        const newHasNote = cs >= 0 && S.clipSteps[t][ac][cs] === 1;
        /* Check whether the previous note's gate is still sounding before clearing */
        let prevStillSounding = false;
        if (!newHasNote && S.seqActiveNotes.size > 0 &&
                S.seqNoteOnClipTick >= 0 && S.seqNoteGateTicks > 0 && ac === S.seqLastClip) {
            const ctChk = host_module_get_param('t' + t + '_current_clip_tick');
            if (ctChk !== null && ctChk !== undefined) {
                const ctv      = parseInt(ctChk, 10) | 0;
                const clipTks  = S.clipLength[t][ac] * (S.clipTPS[t][ac] || 24);
                const elapsed  = ctv >= S.seqNoteOnClipTick
                    ? ctv - S.seqNoteOnClipTick
                    : clipTks - S.seqNoteOnClipTick + ctv;
                prevStillSounding = elapsed < S.seqNoteGateTicks;
            }
        }
        S.seqLastStep = cs;
        S.seqLastClip = ac;
        if (newHasNote) {
            /* New step has a note — show it, replacing any sustaining previous note */
            S.seqActiveNotes.clear();
            S.seqNoteOnClipTick = -1;
            S.seqNoteGateTicks  = 0;
            const raw = host_module_get_param('t' + t + '_c' + ac + '_step_' + cs + '_notes');
            if (raw && raw.trim().length > 0) {
                raw.trim().split(' ').forEach(function(sn) {
                    const pitch = parseInt(sn, 10);
                    if (pitch >= 0 && pitch <= 127) S.seqActiveNotes.add(pitch);
                });
            }
            const ctStr = host_module_get_param('t' + t + '_current_clip_tick');
            const gStr  = host_module_get_param('t' + t + '_c' + ac + '_step_' + cs + '_gate');
            if (ctStr !== null && ctStr !== undefined) S.seqNoteOnClipTick = parseInt(ctStr, 10) | 0;
            if (gStr  !== null && gStr  !== undefined) S.seqNoteGateTicks  = parseInt(gStr,  10) | 0;
        } else if (!prevStillSounding) {
            /* New step empty, previous note expired — clear */
            S.seqActiveNotes.clear();
            S.seqNoteOnClipTick = -1;
            S.seqNoteGateTicks  = 0;
        }
        /* else: prevStillSounding — keep old notes + gate tracking across empty step */
    } else if (S.seqActiveNotes.size > 0 && S.seqNoteOnClipTick >= 0 && S.seqNoteGateTicks > 0) {
        const ctStr = host_module_get_param('t' + t + '_current_clip_tick');
        if (ctStr !== null && ctStr !== undefined) {
            const ct = parseInt(ctStr, 10) | 0;
            const clipTicks = S.clipLength[t][ac] * (S.clipTPS[t][ac] || 24);
            const elapsed = ct >= S.seqNoteOnClipTick
                ? ct - S.seqNoteOnClipTick
                : clipTicks - S.seqNoteOnClipTick + ct;
            if (elapsed >= S.seqNoteGateTicks) {
                S.seqActiveNotes.clear();
                S.seqNoteOnClipTick = -1;
                S.seqNoteGateTicks  = 0;
            }
        }
    }

    /* Deferred DSP state save: fetch state_full (DSP serializes only when dirty) */
    if (typeof host_write_file === 'function' && S.currentSetUuid) {
        const _st = host_module_get_param('state_full');
        if (_st && _st.length > 2) {
            host_write_file(uuidToStatePath(S.currentSetUuid), _st);
            updateNameIndex();
        }
    }

}

/* Refresh name -> uuid mapping after any successful save so that future
 * duplicates of this set can inherit its state. In-memory cache; disk write
 * happens on suspend, deferred-save, and clear-session. */
function updateNameIndex() {
    if (!S.currentSetUuid || !S.currentSetName) return;
    if (!S.nameIndexCache) S.nameIndexCache = loadNameIndex();
    if (S.nameIndexCache[S.currentSetName] === S.currentSetUuid) return;
    S.nameIndexCache[S.currentSetName] = S.currentSetUuid;
    saveNameIndex(S.nameIndexCache);
}

/* Reset NOTE FX, HARMZ, and MIDI DLY banks to DSP defaults for track t.
 * The pfx_reset push itself is deferred via pendingDefaultSetParams — when
 * called from a MIDI handler (jog click), a synchronous push competes with
 * the same-buffer MIDI delivery and is silently coalesced away, leaving DSP
 * with no reset despite the OLED reporting success. The delay_level=127
 * override is queued after the reset so it lands on a later tick (DSP zeros
 * delay_level during the reset). */
function resetFxBanks(t) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        const lane = S.activeDrumLane[t];
        S.pendingDefaultSetParams.push({ key: 't' + t + '_l' + lane + '_pfx_reset', val: '1' });
        S.pendingDefaultSetParams.push({
            key: 't' + t + '_l' + lane + '_pfx_set',
            val: 'delay_level 127'
        });
    } else {
        S.pendingDefaultSetParams.push({ key: 't' + t + '_pfx_reset', val: '1' });
        const _ac = S.trackActiveClip[t];
        S.pendingDefaultSetParams.push({
            key: 't' + t + '_c' + _ac + '_pfx_set',
            val: 'delay_level 127'
        });
        /* Reset SEQ ARP step params (step vel levels, per-step intervals,
         * loop length) — DSP-side clip_pfx_params_init handles these on
         * pfx_reset; mirror in JS so the overlay reflects defaults. */
        for (let s = 0; s < 8; s++) {
            S.seqArpStepVel[t][_ac][s] = 4;
            S.seqArpStepInt[t][_ac][s] = 0;
        }
        S.seqArpStepLoopLen[t][_ac] = 8;
    }
    const targets = [1, 2, 3, 4];
    for (let bi = 0; bi < targets.length; bi++) {
        const b = targets[bi];
        for (let k = 0; k < 8; k++) {
            const pm = BANKS[b].knobs[k];
            if (!pm) continue;
            S.bankParams[t][b][k] = pm.def;
        }
    }
    S.screenDirty = true;
}

/* Reset ARP IN (TARP, bank 5) for a melodic track to DSP defaults.
 * Issues a single tN_tarp_reset which the DSP handler resolves via
 * arp_init_defaults + held-buffer clear + silence. JS mirrors are
 * zeroed in parallel so the bank overview reflects defaults immediately. */
function resetTarp(t) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false;
    S.pendingDefaultSetParams.push({ key: 't' + t + '_tarp_reset', val: '1' });
    for (let k = 0; k < 8; k++) {
        const pm = BANKS[5].knobs[k];
        if (pm) S.bankParams[t][5][k] = pm.def;
    }
    for (let s = 0; s < 8; s++) {
        S.tarpStepVel[t][s] = 4;
        S.tarpStepInt[t][s] = 0;
    }
    S.tarpStepLoopLen[t] = 8;
    S.tarpHeldNotes[t].clear();
    S.screenDirty = true;
}

function resetSingleFxBank(t, bankIdx) {
    if (typeof host_module_set_param !== 'function') return;
    const dspCmd = { 1: 'pfx_noteFx_reset', 2: 'pfx_harm_reset', 3: 'pfx_delay_reset' }[bankIdx];
    if (!dspCmd) return;
    S.undoAvailable = true; S.redoAvailable = false;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        const lane = S.activeDrumLane[t];
        /* Defer the reset push (same coalescing concern as resetFxBanks). */
        S.pendingDefaultSetParams.push({ key: 't' + t + '_l' + lane + '_pfx_set', val: dspCmd + ' 1' });
        if (bankIdx === 3) {
            S.pendingDefaultSetParams.push({
                key: 't' + t + '_l' + lane + '_pfx_set',
                val: 'delay_level 127'
            });
        }
    } else {
        S.pendingDefaultSetParams.push({ key: 't' + t + '_' + dspCmd, val: '1' });
        if (bankIdx === 3) {
            const _ac = S.trackActiveClip[t];
            S.pendingDefaultSetParams.push({
                key: 't' + t + '_c' + _ac + '_pfx_set',
                val: 'delay_level 127'
            });
        }
    }
    for (let k = 0; k < 8; k++) {
        const pm = BANKS[bankIdx].knobs[k];
        if (!pm) continue;
        S.bankParams[t][bankIdx][k] = pm.def;
    }
    S.screenDirty = true;
}

/* ------------------------------------------------------------------ */
/* Parameter bank: read from DSP and write to DSP                      */
/* ------------------------------------------------------------------ */

/* Read all wired params for bankIdx on track t from DSP into S.bankParams. */
function readBankParams(t, bankIdx) {
    if (typeof host_module_get_param !== 'function') return;
    /* Drum pfx banks (0, 1, 3): read via per-lane snapshot, not melodic keys */
    if (S.trackPadMode[t] === PAD_MODE_DRUM && (bankIdx === 0 || bankIdx === 1 || bankIdx === 3)) {
        refreshDrumLaneBankParams(t, S.activeDrumLane[t]);
        return;
    }
    /* ARP OUT bank: seq_arp_* are set-only; read via per-clip pfx_snapshot */
    if (bankIdx === 4) {
        const ac   = S.trackActiveClip[t];
        const snap = host_module_get_param('t' + t + '_c' + ac + '_pfx_snapshot');
        if (snap) {
            const v = snap.split(' ');
            if (v.length >= 24) {
                for (let k = 0; k < 7; k++) S.bankParams[t][4][k] = parseInt(v[17 + k], 10) | 0;
            }
        }
        return;
    }
    /* CC PARAM bank: read all 8 CC assignments + per-knob type from DSP */
    if (bankIdx === 6) {
        const raw = host_module_get_param('t' + t + '_cc_assigns');
        if (raw) {
            const parts = raw.split(' ');
            for (let k = 0; k < 8; k++)
                S.trackCCAssign[t][k] = parseInt(parts[k], 10) || CC_ASSIGN_DEFAULTS[k];
        }
        const typs = host_module_get_param('t' + t + '_cc_types');
        if (typs) {
            const tp = typs.split(' ');
            for (let k = 0; k < 8; k++) S.trackCCType[t][k] = parseInt(tp[k], 10) || 0;
        }
        /* Default Schwung-routed tracks to Sch1-8 when all lanes are at factory CC defaults.
         * Deferred one-per-tick via pendingDefaultSetParams to avoid coalescing. */
        if (S.trackRoute[t] === 0 && typeof shadow_set_param === 'function' &&
                S.trackCCType[t].every(function(tp) { return tp === 0; })) {
            for (let k = 0; k < 8; k++) {
                S.trackCCType[t][k] = 2;
                S.trackCCAssign[t][k] = k + 1;
                S.schLabel[t][k] = null;
                S.pendingDefaultSetParams.push({ key: 't' + t + '_cc_type_assign', val: k + ' 2 ' + (k + 1) });
            }
        }
        for (let c = 0; c < NUM_CLIPS; c++) {
            const bits = host_module_get_param('t' + t + '_c' + c + '_cc_auto_bits');
            S.trackCCAutoBits[t][c] = bits !== null ? (parseInt(bits, 10) || 0) : 0;
            /* Per-clip resting values ("—"=255 → -1). */
            const rest = host_module_get_param('t' + t + '_c' + c + '_cc_rest');
            if (rest) {
                const rp = rest.split(' ');
                for (let k = 0; k < 8; k++) {
                    const rv = parseInt(rp[k], 10);
                    S.clipCCVal[t][c][k] = (rv >= 0 && rv <= 127) ? rv : -1;
                }
            }
            /* Aftertouch automation presence (for the AUTOMATION-bank indicator). */
            const ath = host_module_get_param('t' + t + '_c' + c + '_at_has');
            S.clipAtHas[t][c] = (ath !== null && parseInt(ath, 10) === 1);
        }
        return;
    }
    const knobs = BANKS[bankIdx].knobs;
    for (let k = 0; k < 8; k++) {
        const pm = knobs[k];
        if (!pm || !pm.abbrev || pm.scope === 'stub') {
            S.bankParams[t][bankIdx][k] = pm ? pm.def : 0;
            continue;
        }
        if (pm.scope === 'seqfollow') {
            S.bankParams[t][bankIdx][k] = S.clipSeqFollow[t][S.trackActiveClip[t]] ? 1 : 0;
            continue;
        }
        if (pm.scope === 'clip') {
            const ac = S.trackActiveClip[t];
            if (pm.dspKey === 'clip_resolution') {
                const tps = S.clipTPS[t][ac] || 24;
                const idx = TPS_VALUES.indexOf(tps);
                S.bankParams[t][bankIdx][k] = idx >= 0 ? idx : 1;
            } else if (pm.dspKey === 'clip_playback_dir') {
                /* Mirror kept in sync by refreshPerClipBankParams +
                 * applyBankParam. Without this, every bank-jog onto CLIP
                 * resets the displayed Dir to Fwd until the next pollDSP. */
                S.bankParams[t][bankIdx][k] = S.clipPlaybackDir[t][ac] | 0;
            } else {
                S.bankParams[t][bankIdx][k] = pm.def;
            }
            continue;
        }
        if (pm.scope === 'action') {
            /* beat_stretch and clock_shift display per-touch labels (0 at rest) rather than absolute position */
            if (pm.dspKey === 'beat_stretch' || pm.dspKey === 'clock_shift') { S.bankParams[t][bankIdx][k] = 0; continue; }
            const stateKey = 't' + t + '_' + pm.dspKey + pm.actionSuffix;
            const raw = host_module_get_param(stateKey);
            S.bankParams[t][bankIdx][k] = parseActionRaw(raw, pm.def);
            continue;
        }
        const key = pm.scope === 'global' ? pm.dspKey : 't' + t + '_' + pm.dspKey;
        const raw = host_module_get_param(key);
        if (raw === null || raw === undefined) {
            S.bankParams[t][bankIdx][k] = pm.def;
            continue;
        }
        if (pm.dspKey === 'route') {
            S.bankParams[t][bankIdx][k] = raw === 'external' ? 2 : raw === 'move' ? 1 : 0;
        } else {
            S.bankParams[t][bankIdx][k] = parseInt(raw, 10) || 0;
        }
    }
    /* Drum NOTE/NOTEFX bank: quantize slot is managed via drumLaneQnt mirror, not get_param */
    if (bankIdx === 1 && S.trackPadMode[t] === PAD_MODE_DRUM)
        S.bankParams[t][1][2] = S.drumLaneQnt[t];
    /* DELAY bank (melodic): K7 is delay_retrig in the bank def now, so the
     * standard loop already reads it into bankParams[t][3][6]. delay_clock_fb
     * is no longer in the bank def — it lives on Shift+K1 with its own mirror
     * S.delayClockFb[t]. Read it explicitly here so the OLED value cell shows
     * the live value when Shift+K1 is touched. */
    if (bankIdx === 3 && S.trackPadMode[t] !== PAD_MODE_DRUM) {
        const _cf = host_module_get_param('t' + t + '_delay_clock_fb');
        if (_cf !== null && _cf !== undefined)
            S.delayClockFb[t] = Math.max(-100, Math.min(100, parseInt(_cf, 10) | 0));
    }
}

function readTrackConfig(t) {
    if (typeof host_module_get_param !== 'function') return;
    const ch = host_module_get_param('t' + t + '_channel');
    if (ch !== null && ch !== undefined) S.trackChannel[t] = parseInt(ch, 10) || 1;
    const rt = host_module_get_param('t' + t + '_route');
    if (rt !== null && rt !== undefined) S.trackRoute[t] = rt === 'external' ? 2 : rt === 'move' ? 1 : 0;
    const pm = host_module_get_param('t' + t + '_pad_mode');
    if (pm !== null && pm !== undefined) S.trackPadMode[t] = parseInt(pm, 10) | 0;
    const tvo = host_module_get_param('t' + t + '_track_vel_override');
    if (tvo !== null && tvo !== undefined) S.trackVelOverride[t] = parseInt(tvo, 10) | 0;
    const lpr = host_module_get_param('t' + t + '_track_looper');
    if (lpr !== null && lpr !== undefined) S.trackLooper[t] = parseInt(lpr, 10) | 0;
    const diq = host_module_get_param('t' + t + '_diq');
    if (diq !== null && diq !== undefined) {
        S.drumInpQuant[t] = Math.max(0, Math.min(8, parseInt(diq, 10) | 0));
        S.bankParams[t][7][5] = S.drumInpQuant[t];
    }
}

function applyTrackConfig(t, key, val) {
    if (typeof host_module_set_param !== 'function') return;
    let strVal;
    if (key === 'route') strVal = val === 2 ? 'external' : val === 1 ? 'move' : 'schwung';
    else strVal = String(val);
    host_module_set_param('t' + t + '_' + key, strVal);
    if (key === 'channel')              S.trackChannel[t] = val;
    else if (key === 'route') {
        S.trackRoute[t] = val;
        /* Move route offers only Off/Poly aftertouch — normalize a lingering
         * Channel selection so the AftTch menu + send stay in sync. */
        if (val === 1 && S.trackAtMode[t] === 2) { S.trackAtMode[t] = 1; writeSidecar(); }
    }
    else if (key === 'pad_mode') {
        S.trackPadMode[t] = val;
        if (val === PAD_MODE_DRUM) {
            if (t === S.activeTrack && (S.activeBank === 2 || S.activeBank === 4)) S.activeBank = 0;
            syncDrumLanesMeta(t);
            syncDrumLaneSteps(t, S.activeDrumLane[t]);
            syncDrumClipContent(t);
        } else {
            if (t === S.activeTrack && S.activeBank === 7) S.activeBank = 0;
            /* Leaving DRUM mode: clear JS drum vel-zone state and defer all
             * downstream DSP pushes. When tN_pad_mode='0' is followed
             * synchronously by another tN_* push from the same JS callback,
             * the pad_mode push is silently dropped — verified empirically.
             * The entering-DRUM branch escapes this by running sync*
             * get_params between pad_mode and the tN_padmap push (the
             * get_param round-trips act as a sync barrier on the audio
             * thread). For leaving-DRUM we defer instead: adl/dpm via
             * the queue (one per tick), and computePadNoteMap via a
             * pending flag handled at the top of next tick. */
            S.drumVelZoneArmed[t] = false;
            S.drumLastVelZone[t]  = 0;
            S.pendingDefaultSetParams.push({ key: 't' + t + '_active_drum_lane',  val: '0' });
            S.pendingDefaultSetParams.push({ key: 't' + t + '_drum_perform_mode', val: '0' });
            if (t === S.activeTrack) { S.pendingPadNoteMapRecompute = true; forceRedraw(); }
        }
        if (t === S.activeTrack && val === PAD_MODE_DRUM) { computePadNoteMap(); forceRedraw(); }
    }
    else if (key === 'track_vel_override') S.trackVelOverride[t] = val;
    else if (key === 'track_looper')    S.trackLooper[t] = val;
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

/* Open the generic menu INFO dialog with the given text lines (each argument is
 * one line, up to ~4 shown). Empty = closed. */
function showMenuInfo() {
    S.menuInfoLines = Array.prototype.slice.call(arguments);
    S.screenDirty = true;
}

/* Tear down the Keys->Drums confirm dialog and the menu's edit state so a
 * lingering enum edit doesn't replay. Call on Yes, No, and Back-cancel. */
function closeConvertConfirm() {
    S.confirmConvertToDrum = false;
    S.confirmConvertToConduct = false;
    S.menuInfoLines = [];
    if (S.globalMenuState) S.globalMenuState.editing = false;
    if (S.globalMenuState) S.globalMenuState.editValue = null;
    S.lastSentMenuEditValue = null;
    S.bpmWasEditing = false;
}

/* Rewrite the cable-2 channel remap table for the active track.
 * When the active track is ROUTE_MOVE, incoming external MIDI is remapped to the
 * track's channel so Move's firmware routes it to the correct track instrument.
 * Called from tick() on any change to activeTrack/route/channel/midiInChannel,
 * and directly from init() on first load / resume after full exit. */
function applyExtMidiRemap() {
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

/* True when (track-type, bank) exposes alt params reachable via S.altMode.
 * Melodic: CLIP(0), DELAY(3), AUTO/CC(6 — CC-assign). Drum: DRUM LANE(0),
 * REPEAT GROOVE(5), AUTO(6), ALL LANES(7). Keep in sync with the
 * shiftHeld→altMode migration sites. */
/* Bank header label. Identical to BANKS[bank].name except a Conductor track
 * relabels bank 0 (CLIP) to "CONDUCT" — the CLIP bank is reused as the Conduct
 * bank. Does NOT rename BANKS[0] globally (other track types keep "CLIP"). */
function bankHeaderName(t, bank) {
    /* Conductor banks: "C-" prefix on the bank name (bank 0/CLIP shown as CONDUCT). */
    if (S.trackPadMode[t] === PAD_MODE_CONDUCT)
        return 'C-' + (bank === 0 ? 'CONDUCT' : BANKS[bank].name);
    return BANKS[bank].name;
}

function bankHasAltParams(t, bank) {
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
function altIndicatorActive(t, bank) {
    if (S.trackPadMode[t] !== PAD_MODE_DRUM && (bank === 4 || bank === 5)) {
        return S.stepIntervalMode;
    }
    return S.altMode;
}

/* Conductor bank knob: knob k edits dAVEBOx track k's per-Conductor-clip value.
 * The Conductor's own track cell is inert. `delta` is signed knob detents.
 * RESPONDER/WHEN are single-fire toggles (any nonzero turn flips the value once);
 * OCTAVE increments/decrements by 1 per detent, clamped -4..+4. The JS mirror is
 * authoritative; we push the absolute new value per-Conductor-clip (tN_* key,
 * reaches DSP reliably; last-wins-per-buffer is correct since we push the final
 * value the mirror tracks). */
function applyConductGridKnob(bank, k, delta) {
    if (delta === 0) return;
    /* While these banks are active, S.activeTrack IS the Conductor (the bank is
     * gated on trackPadMode[activeTrack]===CONDUCT). Use it + its live active
     * clip directly, rather than the S.conductorTrack / S.condActiveClip mirrors
     * which can be stale or -1 (e.g. a flaky single-tick load readback). */
    const N = S.activeTrack, c = S.trackActiveClip[N] | 0;
    if (N < 0 || S.trackPadMode[N] !== PAD_MODE_CONDUCT) return;
    if (k === N) return;                          /* own cell inert */
    /* Drum tracks never respond to the Conductor — all three per-track banks
     * (Responder/Octave/When) are non-editable ("--") for them. */
    if (S.trackPadMode[k] === PAD_MODE_DRUM) return;
    if (bank === BANK_RESPONDER) {
        S.condResp[c][k] = S.condResp[c][k] ? 0 : 1;     /* single-fire toggle */
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + N + '_c' + c + '_cond_resp', k + ' ' + S.condResp[c][k]);
    } else if (bank === BANK_OCTAVE) {
        const nv = Math.max(-4, Math.min(4, (S.condOct[c][k] | 0) + (delta > 0 ? 1 : -1)));
        S.condOct[c][k] = nv;
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + N + '_c' + c + '_cond_oct', k + ' ' + nv);
    } else if (bank === BANK_WHEN) {
        S.condWhen[c][k] = S.condWhen[c][k] ? 0 : 1;     /* single-fire toggle */
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + N + '_c' + c + '_cond_when', k + ' ' + S.condWhen[c][k]);
    }
    S.screenDirty = true;
    forceRedraw();
}

/* Send a single param change to DSP and apply any JS-side side-effects. */
function applyBankParam(t, bankIdx, knobIdx, val) {
    const pm = BANKS[bankIdx].knobs[knobIdx];
    if (!pm || pm.scope === 'stub') return;
    if (pm.scope === 'seqfollow') {
        S.clipSeqFollow[t][S.trackActiveClip[t]] = val !== 0;
        return;
    }
    if (!pm.dspKey) return;
    if (typeof host_module_set_param !== 'function') return;

    if (pm.scope === 'global') {
        host_module_set_param(pm.dspKey, String(val));
        if (pm.dspKey === 'key') { S.padKey = val; computePadNoteMap(); }
    } else if (pm.scope === 'track') {
        let strVal;
        if      (pm.dspKey === 'route')              strVal = val === 2 ? 'external' : val === 1 ? 'move' : 'schwung';
        else                                         strVal = String(val);
        if ([1, 2, 3].indexOf(bankIdx) >= 0 && S.trackPadMode[t] === PAD_MODE_DRUM) {
            const lane = S.activeDrumLane[t];
            let dKey = pm.dspKey;
            if (bankIdx === 3) {
                /* Drum MIDI DLY: remap K5→delay_gate_fb, K6→delay_clock_fb. K7
                 * now hosts delay_retrig (was blocked) — pass through. K8
                 * (delay_pitch_random) stays blocked for drum. */
                if (knobIdx === 4) dKey = 'delay_gate_fb';
                else if (knobIdx === 5) dKey = 'delay_clock_fb';
                else if (knobIdx === 7) return;
            }
            host_module_set_param('t' + t + '_l' + lane + '_pfx_set', dKey + ' ' + strVal);
            return;
        }
        if (pm.dspKey === 'seq_arp_steps_mode' || pm.dspKey === 'tarp_steps_mode'
                || pm.dspKey === 'delay_retrig') {
            /* Defer via pendingDefaultSetParams: same-track sync tN_* set_params
             * fired in the same audio block can coalesce and silently drop the
             * first one (see set-param-per-buffer-per-key memory). delay_retrig
             * + a clip pad press (launch_clip) in quick succession was losing
             * the retrig write. One-per-tick drain guarantees it lands alone. */
            S.pendingDefaultSetParams.push({ key: 't' + t + '_' + pm.dspKey, val: strVal });
            return;
        }
        host_module_set_param('t' + t + '_' + pm.dspKey, strVal);
    } else if (pm.scope === 'clip') {
        const ac = S.trackActiveClip[t];
        if (pm.dspKey === 'clip_resolution') {
            if (S.recordArmed && !S.recordCountingIn && S.recordArmedTrack === t) return;
            const idx = Math.max(0, Math.min(5, val));
            S.clipTPS[t][ac] = TPS_VALUES[idx];
            host_module_set_param('t' + t + '_clip_resolution', String(idx));
        } else if (pm.dspKey === 'clip_playback_dir') {
            const dv = Math.max(0, Math.min(3, val | 0));
            S.clipPlaybackDir[t][ac] = dv;
            host_module_set_param('t' + t + '_clip_playback_dir', String(dv));
        }
    }
}


/* Tick-batched live-note dispatch. Multiple set_param calls within a single
 * audio buffer coalesce to the last write — regardless of key — so a 3-pad
 * chord that fires 3 separate tN_live_notes microtasks within one buffer
 * loses two of them. We previously batched via a Promise microtask which
 * runs once per JS turn, but the host dispatches each onMidiMessage as its
 * own turn — so multiple pad CCs in one buffer still produced multiple
 * coalescing set_params. Drain on tick instead: events queue synchronously
 * from any number of onMidiMessage calls; tick() drains once per audio
 * buffer into one set_param per track. Cost: up to ~10 ms (one tick) of
 * live-monitor latency. Benefit: chord-press survives intact. */
function _drainLiveNotes() {
    if (typeof host_module_set_param !== 'function') return;
    for (let _t = 0; _t < NUM_TRACKS; _t++) {
        if (pendingLiveNotes[_t].length === 0) continue;
        const evts = pendingLiveNotes[_t];
        pendingLiveNotes[_t] = [];
        const parts = [];
        for (const e of evts) {
            if (e.isOff) parts.push('off ' + e.pitch);
            else parts.push('on ' + e.pitch + ' ' + e.vel);
        }
        host_module_set_param('t' + _t + '_live_notes', parts.join(' '));
    }
}
function queueLiveNoteOn(t, pitch, vel) {
    pendingLiveNotes[t].push({ isOff: false, pitch, vel });
}
function queueLiveNoteOff(t, pitch) {
    pendingLiveNotes[t].push({ isOff: true, pitch });
}

function liveSendNote(t, type, pitch, vel, rawVel) {
    const ch    = (S.trackChannel[t] - 1) & 0x0F;
    const route = S.trackRoute[t];
    const status = type | ch;
    /* PHASE-1: dead on patched Schwung (Bundle 1 gate skips note dispatch
     * for liveSendNote; Bundle 2B applies VelIn in DSP on_midi via
     * effective_vel before live_note_on). Stock Schwung still needs this
     * — runs when dspInboundEnabled is false. Remove with the final
     * cleanup pass once shim patches land upstream. */
    if (!rawVel && type === 0x90 && vel > 0) {
        const tvo = S.trackVelOverride[t];
        if (tvo > 0) vel = tvo;
    }
    if (route === 2) {
        /* ROUTE_EXTERNAL. Note events queue through tN_live_notes so the pfx
         * chain applies (consistent with sequencer playback, which already
         * routes ROUTE_EXTERNAL through pfx_emit). DSP-side gate suppresses
         * when on_midi already handled it. CC/AT/PB pass through raw for the
         * external-MIDI-in forwarding path. */
        if (type === 0x90 || type === 0x80) {
            const isOff = (type === 0x80) || (type === 0x90 && vel === 0);
            if (isOff) {
                queueLiveNoteOff(t, pitch);
            } else {
                queueLiveNoteOn(t, pitch, vel);
            }
        } else {
            const cin = (status >> 4) & 0x0F;
            if (typeof move_midi_external_send === 'function')
                move_midi_external_send([cin, status, pitch, vel]);
        }
    } else if (route === 1) {
        /* ROUTE_MOVE. Queue note events for microtask-batched drain into one
         * tN_live_notes payload at end of the current JS turn. Recording
         * suppression: melodic record_note_on inline-monitors via DSP; drum
         * recording handled by press-handler direct-fire (also routes through
         * queueLiveNoteOn). Suppress here to avoid double-monitoring.
         *
         * Always queued regardless of dspInboundEnabled — the DSP-side
         * tN_live_notes handler gates on dsp_inbound_enabled instead, so
         * the JS path serves as a fallback when the padmap push didn't
         * reach DSP (stock Schwung v0.9.16 exposes the sentinel but
         * on_midi delivery may not produce sound). */
        if (type === 0x90 || type === 0x80) {
            const activelyRecording = S.recordArmed && !S.recordCountingIn && S.recordArmedTrack === t;
            const isOff = (type === 0x80) || (type === 0x90 && vel === 0);
            if (isOff) {
                queueLiveNoteOff(t, pitch);
            } else if (!activelyRecording) {
                queueLiveNoteOn(t, pitch, vel);
            }
        }
    } else {
        /* ROUTE_SCHWUNG: route note events through live_note_on so pfx chain
         * (TARP, NOTE FX, HARMZ, MIDI DLY) applies. No activelyRecording filter
         * — record_note_on DSP handler does not call live_note_on() inline for
         * ROUTE_SCHWUNG, so no double-monitoring risk. Non-note events (CC, AT,
         * PB) pass through raw — only note on/off go through the live-notes
         * payload parser.
         *
         * Always queued regardless of dspInboundEnabled — DSP-side gate. */
        if (type === 0x90 || type === 0x80) {
            const isOff = type === 0x80 || vel === 0;
            if (isOff) {
                queueLiveNoteOff(t, pitch);
            } else {
                queueLiveNoteOn(t, pitch, vel);
            }
        } else {
            if (typeof shadow_send_midi_to_dsp === 'function') shadow_send_midi_to_dsp([status, pitch, vel]);
        }
    }
}

function extNoteOffAll() {
    if (extHeldNotes.size === 0) return;
    for (const [pitch, info] of extHeldNotes) {
        liveSendNote(info.track, 0x80, pitch, 0);
        if (info.recording) recordNoteOff(pitch);
    }
    extHeldNotes.clear();
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






/* Send current combined modifier bitmask to DSP. */
function sendPerfMods() {
    if (typeof host_module_set_param === 'function')
        host_module_set_param('perf_mods', String(S.perfModsToggled | S.perfModsHeld));
}

/* Draw the full 4-row pad grid for Performance Mode.
 * R0 (68-75): rate pads 1-6 (pulse at capture rate), triplet toggle, latch.
 * R1 (76-83): PITCH modifier pads (HotMagenta family).
 * R2 (84-91): VEL/GATE modifier pads (VividYellow family).
 * R3 (92-99): WILD modifier pads (Cyan family).
 * Also clears step buttons (16-31) — not used in Perf Mode. */
function updatePerfModeLEDs() {
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

function forceRedraw() {
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

/* ------------------------------------------------------------------ */
/* Display                                                              */
/* ------------------------------------------------------------------ */

/* Pure graphical 8×16 grid (128×64 OLED). 8 columns = tracks, 16 rows = scenes.
 * Each cell is 16×4 px. Cell states:
 *   active clip on active track → blink (solid ↔ center bar)
 *   active clip on other track  → solid fill (16×4)
 *   has content, not active     → center bar (14×2 at x+1,y+1)
 *   empty                       → nothing */
function drawSessionOverview() {
    /* White background everywhere; current scene group band stays black. */
    fill_rect(0, 0, 128, 64, 1);
    const bandY = Math.floor(S.sceneRow / 4) * 16;
    fill_rect(0, bandY, 128, 16, 0);

    /* Horizontal grid lines: white inside band, black outside. */
    for (let s = 0; s < NUM_CLIPS; s++) {
        const ly = s * 4;
        fill_rect(0, ly, 128, 1, (ly >= bandY && ly < bandY + 16) ? 1 : 0);
    }

    /* Vertical grid lines: three segments per column — black/white/black. */
    for (let t = 0; t < NUM_TRACKS; t++) {
        const lx = t * 16;
        if (bandY > 0)        fill_rect(lx, 0,          1, bandY,             0);
                              fill_rect(lx, bandY,      1, 16,                1);
        if (bandY + 16 < 64) fill_rect(lx, bandY + 16, 1, 64 - bandY - 16,  0);
    }

    /* Cell content: white (1) inside band, black (0) outside. */
    const blinkOn = S.flashEighth;
    for (let t = 0; t < NUM_TRACKS; t++) {
        const x  = t * 16 + 1;
        const ac = S.trackActiveClip[t];
        for (let s = 0; s < NUM_CLIPS; s++) {
            const y      = s * 4 + 1;
            const color  = (s >= S.sceneRow && s < S.sceneRow + 4) ? 1 : 0;
            const hasData    = S.clipNonEmpty[t][s];
            const isActive   = (s === ac);
            const isPlaying  = (isActive && S.trackClipPlaying[t]);
            if (isPlaying && hasData) {
                if (blinkOn) fill_rect(x + 1, y + 1, 13, 1, color);
            } else if (isActive && hasData) {
                fill_rect(x + 1, y + 1, 13, 1, color);
            } else if (S.overviewCache[t][s]) {
                fill_rect(x + 6, y + 1, 2, 1, color);
            }
        }
    }
}

/* Track-number row: active track has a box (1px border + 1px pad around number).
 * Muted = inverted. Soloed = blink. */
function drawTrackRow(y) {
    const soloBlinkOn = Math.floor(S.tickCount / 24) % 2 === 0;
    for (let _t = 0; _t < NUM_TRACKS; _t++) {
        const cx = _t * 16 + 5;
        const bx = _t * 16 + 3;
        const by = y - 2;
        const bw = 10, bh = 12;
        const isActive = (_t === S.activeTrack);
        if (S.trackMuted[_t]) {
            if (soloBlinkOn) print(cx, y, String(_t + 1), 1);
            if (isActive) {
                fill_rect(bx, by,      bw, 1,  1);
                fill_rect(bx, by+bh-1, bw, 1,  1);
                fill_rect(bx, by,      1,  bh, 1);
                fill_rect(bx+bw-1, by, 1,  bh, 1);
            }
        } else if (S.trackSoloed[_t]) {
            fill_rect(bx, by, bw, bh, 1);
            print(cx, y, String(_t + 1), 0);
        } else {
            print(cx, y, String(_t + 1), 1);
            if (isActive) {
                fill_rect(bx, by,      bw, 1,  1);
                fill_rect(bx, by+bh-1, bw, 1,  1);
                fill_rect(bx, by,      1,  bh, 1);
                fill_rect(bx+bw-1, by, 1,  bh, 1);
            }
        }
    }
}

/* Convert a PERF_MOD_NAMES entry to mcufont-safe ASCII (no arrows / fractions). */
function _modAscii(name) {
    return name.replace('↑', '+').replace('↓', '-').replace('½', 'Hf');
}

/* Footer indicator chip: filled-rect when active, outline when inactive.
 * Returns the chip's width so the caller can advance x. */
function _perfChip(x, y, label, active) {
    const w = label.length * 6 + 3;
    if (active) {
        fill_rect(x, y, w, 9, 1);
        pixelPrint(x + 2, y + 2, label, 0);
    } else {
        /* hollow outline */
        fill_rect(x,         y,     w, 1, 1);
        fill_rect(x,         y + 8, w, 1, 1);
        fill_rect(x,         y,     1, 9, 1);
        fill_rect(x + w - 1, y,     1, 9, 1);
        pixelPrint(x + 2, y + 2, label, 1);
    }
    return w;
}

function drawPerfModeOled() {
    clear_screen();
    const activeMods = S.perfModsToggled | S.perfModsHeld;

    /* ── Header bar (y 0-11): preset name or "PERFORMANCE" ── */
    fill_rect(0, 0, 128, 12, 1);
    let title;
    if (S.perfRecalledSlot >= 0) {
        const fp = PERF_FACTORY_PRESETS[S.perfRecalledSlot];
        title = fp ? fp.name : ('SLOT ' + (S.perfRecalledSlot + 1));
    } else {
        title = 'PERFORMANCE';
    }
    print(4, 3, title, 0);

    /* ── Body (y 14-49): action popup → mod popup → mods list ── */
    if (S.actionPopupEndTick >= 0 && S.tickCount <= S.actionPopupEndTick && S.actionPopupLines.length > 0) {
        const _n = S.actionPopupLines.length;
        if (_n >= 4) {
            print(4, 14, S.actionPopupLines[0], 1);
            print(4, 25, S.actionPopupLines[1], 1);
            print(4, 36, S.actionPopupLines[2], 1);
            print(4, 47, S.actionPopupLines[3], 1);
        } else if (_n === 3) {
            print(4, 17, S.actionPopupLines[0], 1);
            print(4, 29, S.actionPopupLines[1], 1);
            print(4, 41, S.actionPopupLines[2], 1);
        } else if (_n === 2) {
            print(4, 20, S.actionPopupLines[0], 1);
            print(4, 32, S.actionPopupLines[1], 1);
        } else {
            print(4, 26, S.actionPopupLines[0], 1);
        }
    } else if (S.perfModPopupEndTick >= 0 && S.tickCount <= S.perfModPopupEndTick && S.perfModPopupName) {
        const px = Math.floor((128 - S.perfModPopupName.length * 6) / 2);
        print(px < 0 ? 0 : px, 26, S.perfModPopupName, 1);
    } else {
        S.perfModPopupEndTick = -1;
        const activeNames = [];
        for (let i = 0; i < PERF_MOD_NAMES.length; i++)
            if ((activeMods >> i) & 1) activeNames.push(_modAscii(PERF_MOD_NAMES[i]));
        if (activeNames.length === 0) {
            pixelPrint(4, 24, 'no mods active', 1);
            pixelPrint(4, 34, 'tap pad to engage', 1);
        } else {
            /* Wrap into up to 4 lines, ~20 chars per line at 6px each. */
            const MAX_CHARS = 20;
            const MAX_LINES = 4;
            const lines = [];
            let cur = '';
            for (let i = 0; i < activeNames.length; i++) {
                const sep  = cur ? '  ' : '';
                const next = cur + sep + activeNames[i];
                if (next.length > MAX_CHARS && cur) {
                    lines.push(cur);
                    if (lines.length >= MAX_LINES) { cur = ''; break; }
                    cur = activeNames[i];
                } else {
                    cur = next;
                }
            }
            if (cur && lines.length < MAX_LINES) lines.push(cur);
            for (let li = 0; li < lines.length; li++) {
                pixelPrint(4, 16 + li * 8, lines[li], 1);
            }
        }
    }

    /* ── Footer (y 53-61): mode chips + rate ── */
    const fy = 53;
    let fx = 2;
    fx += _perfChip(fx, fy, 'Hold',  S.perfHoldPadHeld || S.perfStickyLengths.size > 0) + 3;
    fx += _perfChip(fx, fy, 'Sync',  S.perfSync) + 3;
    fx += _perfChip(fx, fy, 'Latch', S.perfLatchMode) + 3;

    /* Rate (right-aligned, only when a loop length is active) */
    if (S.perfStack.length > 0) {
        const RATE_LABELS = ['1/32','1/16','1/8','1/4','1/2'];
        const top = S.perfStack[S.perfStack.length - 1];
        const lab = RATE_LABELS[top.idx];
        const w   = lab.length * 6 + 3;
        const rx  = 128 - w - 2;
        fill_rect(rx, fy, w, 9, 1);
        pixelPrint(rx + 2, fy + 2, lab, 0);
    }
}

function drawUI() {
    /* CO-RUN: shadow_ui's chain editor owns the OLED while this is active.
     * Skip every dAVEBOx draw path so it doesn't fight the chain editor's
     * frame. shadow_ui still calls clear_screen + redraw each tick. */
    if (S.schwungCoRunSlot >= 0) return;
    /* Move-native co-run: Move firmware owns the OLED (preset browser /
     * device-edit pages). The shim's display_mode bypass keeps Move's
     * framebuffer visible while the MIDI filter stays active; we just
     * stay out of the way. Pad/step LEDs freeze at entry-time state —
     * verified harmless in real use (nothing the user does during co-run
     * depends on live LED feedback). */
    if (S.moveCoRunTrack >= 0) {
        /* Side clip buttons: the button paired to the Move track this dAVEBOx
         * track routes to blinks; the rest stay dark grey. Move's track numbering
         * is reversed (Track 1 = CC 43 = top .. Track 4 = CC 40 = bottom), so a
         * channel ch (1-4) maps to top-to-bottom bit (ch-1). Forced every
         * POLL_INTERVAL to re-assert over Move firmware's pass-through writes. */
        const _coRunCh = (S.trackChannel[S.moveCoRunTrack] | 0);
        const _litMask = (_coRunCh >= 1 && _coRunCh <= 4) ? (1 << (_coRunCh - 1)) : 0;
        paintCoRunSideButtons(_litMask, (S.tickCount % POLL_INTERVAL) === 0);
        return;
    }
    /* Alt-param mode is transient: any bank change, track change, or entering
     * Session View drops back to primary params. Diff-guard catches every
     * S.activeBank / S.activeTrack reassignment regardless of source. */
    if (S.altMode && (S.sessionView ||              /* session view can be entered via a button after altMode was set */
            S.activeBank !== S._altPrevBank ||
            S.activeTrack !== S._altPrevTrack)) {
        S.altMode = false;
    }
    S._altPrevBank  = S.activeBank;
    S._altPrevTrack = S.activeTrack;
    if (S.sessionOverlayHeld) { drawSessionOverview(); return; }
    if (S.pendingInheritPicker) { drawInheritPicker(); return; }
    if (S.snapshotPicker) { drawSnapshotPicker(); return; }
    if (S.clearAutoMenu) { drawClearAutoMenu(); return; }
    if (S.pendingSceneBakePicker) {
        clear_screen();
        print(4, 8,  'BAKE SCENE',         1);
        print(4, 22, 'Tap row or scene step', 1);
        print(4, 34, 'to pick the scene',    1);
        print(4, 50, 'Any other btn cancels', 1);
        return;
    }
    if (S.pendingMergePlacement) {
        clear_screen();
        print(4, 8,  'PLACE MERGED CLIPS',  1);
        print(4, 22, 'Tap row or scene step', 1);
        print(4, 34, 'to pick destination',  1);
        print(4, 50, 'Capture cancels',      1);
        return;
    }
    if (S.confirmStateWipe) { drawStateWipeConfirm(); return; }
    if (S.bpmMoveInfo) { drawBpmMoveInfo(); return; }
    if (S.recordBlockedDialog) { drawRecordBlockedDialog(); return; }
    if (S.confirmLgto)         { drawLgtoConfirm();         return; }
    if (S.confirmXpose) { drawXposeConfirm(); return; }
    if (S.confirmBakeScene) { drawBakeSceneConfirm(); return; }
    if (S.confirmBake) { drawBakeConfirm(); return; }
    if (S.globalMenuOpen || S.tapTempoOpen) { ensureGlobalMenuFresh(); drawGlobalMenu(); return; }
    /* Perf Mode OLED takeover (Session View + Loop held or locked) */
    if (S.sessionView && (S.loopHeld || S.perfViewLocked)) { drawPerfModeOled(); return; }
    if (S.stateLoading || S.bootSplashTicks > 0) {
        /* Reroll the splash on entry edge — picks one of SPLASH_FRAMES at
         * random per splash session (boot, set load, etc.). Stays stable
         * across the splash duration thanks to splashWasVisible. */
        if (!S.splashWasVisible) {
            S.currentSplashIdx = pickSplashIdx();
            S.splashWasVisible = true;
        }
        clear_screen();
        /* 128x64 splash bitmap, MSB-first packed bytes (1024 bytes total).
         * Render via fill_rect runs of lit pixels per row — fewer host calls
         * than per-pixel set_pixel and the screen is only redrawn briefly. */
        const _frame  = SPLASH_FRAMES[S.currentSplashIdx % SPLASH_COUNT];
        const rowBytes = SPLASH_W >> 3;
        for (let y = 0; y < SPLASH_H; y++) {
            let runStart = -1;
            const rowOff = y * rowBytes;
            for (let x = 0; x < SPLASH_W; x++) {
                const bit = (_frame[rowOff + (x >> 3)] >> (7 - (x & 7))) & 1;
                if (bit) {
                    if (runStart < 0) runStart = x;
                } else if (runStart >= 0) {
                    fill_rect(runStart, y, x - runStart, 1, 1);
                    runStart = -1;
                }
            }
            if (runStart >= 0) fill_rect(runStart, y, SPLASH_W - runStart, 1, 1);
        }
        return;
    }
    /* Not in splash mode — clear the entry-edge flag so the next splash rerolls. */
    if (S.splashWasVisible) S.splashWasVisible = false;

    clear_screen();
    if (S.sessionView) {
        if (S.actionPopupEndTick >= 0) {
            const _n = S.actionPopupLines.length;
            if (_n >= 4) {
                print(4, 14, S.actionPopupLines[0], 1);
                print(4, 25, S.actionPopupLines[1], 1);
                print(4, 36, S.actionPopupLines[2], 1);
                print(4, 47, S.actionPopupLines[3], 1);
            } else if (_n === 3) {
                print(4, 17, S.actionPopupLines[0], 1);
                print(4, 29, S.actionPopupLines[1], 1);
                print(4, 41, S.actionPopupLines[2], 1);
            } else if (_n === 2) {
                print(4, 22, S.actionPopupLines[0], 1);
                print(4, 34, S.actionPopupLines[1], 1);
            } else {
                print(4, 28, S.actionPopupLines[0], 1);
            }
            return;
        }
        /* DAVEBOX banner — white bar, letters animated when transport running */
        fill_rect(0, 0, 128, 12, 1);
        let dA, dE, dO;
        if (S.playing) {
            dA = (Math.floor(S.masterPos /  96) % 2 === 0) ? 'A' : '@';
            dE = (Math.floor(S.masterPos /  48) % 2 === 0) ? '3' : 'E';
            dO = (Math.floor(S.masterPos / 192) % 2 === 0) ? 'O' : 'o';
        } else {
            dA = 'A'; dE = 'E'; dO = 'O';
        }
        const banner = 'd' + dA + 'V' + dE + 'B' + dO + 'x';
        print(43, 2, banner, 0);
        drawMetroIndicator();
        drawTrackRow(34);
        for (let t = 0; t < NUM_TRACKS; t++) {
            const cx = t * 16 + 5;
            const ac = S.trackActiveClip[t];
            const hasData = S.trackPadMode[t] === PAD_MODE_DRUM
                ? S.drumClipNonEmpty[t][ac]
                : S.clipNonEmpty[t][ac];
            const isActive = (S.trackClipPlaying[t] || S.trackWillRelaunch[t] || (S.trackQueuedClip[t] >= 0)) && hasData;
            if (isActive) {
                fill_rect(cx - 1, 45, 9, 7, 1);
                pixelPrint(cx, 46, SCENE_LETTERS[ac], 0);
            } else {
                pixelPrint(cx, 46, SCENE_LETTERS[ac], 1);
            }
        }
        return;
    }

    /* Track View — priority display state machine */
    const bank      = S.activeBank;
    const inTimeout = S.bankSelectTick >= 0 || S.jogTouched;

    /* Compress-limit override: highest priority for ~1500ms after a blocked compress */
    if (S.stretchBlockedEndTick >= 0) {
        print(4, 10, '[CLIP       ]', 1);
        print(4, 22, 'Beat Stretch', 1);
        print(4, 34, 'COMPRESS LIMIT', 1);
        return;
    }

    /* Action confirmation pop-up: ~500ms; defers to step edit and active-knob bank overview */
    if (S.actionPopupEndTick >= 0 && S.heldStep < 0 && S.knobTouched < 0) {
        if (S.actionPopupHighlight >= 0 && S.actionPopupLines.length >= 3) {
            const _title = S.actionPopupLines[0];
            const _tw = _title.length * 6;
            const _tx = Math.floor((128 - _tw) / 2);
            print(_tx, 4, _title, 1);
            fill_rect(_tx, 13, _tw, 1, 1);
            for (let _li = 1; _li < S.actionPopupLines.length; _li++) {
                const _ly = 12 + _li * 14;
                const _lw = S.actionPopupLines[_li].length * 6;
                const _lx = Math.floor((128 - _lw) / 2);
                if (_li === S.actionPopupHighlight) {
                    fill_rect(0, _ly - 1, 128, 13, 1);
                    print(_lx, _ly, S.actionPopupLines[_li], 0);
                } else {
                    print(_lx, _ly, S.actionPopupLines[_li], 1);
                }
            }
        } else if (S.actionPopupLines.length >= 2) {
            print(4, 22, S.actionPopupLines[0], 1);
            print(4, 34, S.actionPopupLines[1], 1);
        } else {
            print(4, 28, S.actionPopupLines[0], 1);
        }
        return;
    }

    /* No-note flash: ~600ms after pressing an empty step with no prior pad */
    if (S.noNoteFlashEndTick >= 0 && S.activeBank !== 6) {
        print(4, 22, 'NO NOTE', 1);
        print(4, 34, 'Play a pad first', 1);
        return;
    }

    /* Step edit: show assigned notes and step identity */
    if (S.heldStep >= 0) {
        if (S.activeBank === 6) {
            /* CC bank step-hold: compact graph + knob values */
            var _t6s = S.activeTrack, _ac6s = effectiveClip(_t6s);
            var _gLane6 = S.ccActiveLane[_t6s];
            var _gEffLen6 = S.ccLaneLength[_t6s][_ac6s][_gLane6] || S.clipLength[_t6s][_ac6s];
            var _gLTps6 = S.ccLaneTps[_t6s][_ac6s][_gLane6] || (S.clipTPS[_t6s][_ac6s] || 24);
            /* Compact graph (12px) just above progress bar */
            var _sgBarY = 60, _sgBarH = 3;
            var _sgH = 12, _sgY = _sgBarY - _sgH - 2;
            var _sgPages = Math.ceil(_gEffLen6 / 16);
            var _sgKey = 'sg_' + _t6s + '_' + _ac6s + '_' + _gLane6;
            if (_sgKey !== S.ccGraphOvKey || (S.tickCount % POLL_INTERVAL) === 0) {
                S.ccGraphOvData = [];
                for (var _sgp = 0; _sgp < _sgPages; _sgp++) {
                    var _sgRaw = (typeof host_module_get_param === 'function')
                        ? host_module_get_param('t' + _t6s + '_c' + _ac6s + '_ccsv_' + _gLane6 + '_' + _sgp) : null;
                    if (_sgRaw) {
                        var _sgParts = _sgRaw.split(' ');
                        for (var _sgs = 0; _sgs < 16 && _sgp * 16 + _sgs < _gEffLen6; _sgs++)
                            S.ccGraphOvData.push(_sgs < _sgParts.length ? parseInt(_sgParts[_sgs], 10) : 255);
                    }
                }
                S.ccGraphOvKey = _sgKey;
            }
            fill_rect(0, _sgY, 128, 1, 1);
            fill_rect(0, _sgY + _sgH - 1, 128, 1, 1);
            fill_rect(0, _sgY, 1, _sgH, 1);
            fill_rect(127, _sgY, 1, _sgH, 1);
            var _sgDLen = S.ccGraphOvData.length || 1;
            var _sgDrawY = _sgY + 2, _sgDrawH = _sgH - 4;
            var _sgPrevPy = -1;
            for (var _sgc = 1; _sgc < 127; _sgc++) {
                var _sgIdx = Math.floor(_sgc * _sgDLen / 128);
                var _sgv = _sgIdx < S.ccGraphOvData.length ? S.ccGraphOvData[_sgIdx] : -1;
                if (_sgv >= 0 && _sgv <= 127) {
                    var _sgpy = _sgDrawY + _sgDrawH - 1 - Math.round(_sgv * (_sgDrawH - 1) / 127);
                    if (_sgPrevPy >= 0 && _sgPrevPy !== _sgpy) {
                        var _sgyMin = Math.min(_sgPrevPy, _sgpy);
                        var _sgyMax = Math.max(_sgPrevPy, _sgpy);
                        fill_rect(_sgc, _sgyMin, 1, _sgyMax - _sgyMin + 1, 1);
                    } else {
                        fill_rect(_sgc, _sgpy, 1, 1, 1);
                    }
                    _sgPrevPy = _sgpy;
                } else {
                    _sgPrevPy = -1;
                }
            }
            /* Step position indicator on graph — white vertical line */
            var _sgSx = Math.min(126, Math.max(1, Math.floor(S.heldStep * 126 / _sgDLen) + 1));
            fill_rect(_sgSx, _sgY + 1, 1, _sgH - 2, 1);
            /* Step header: MCU font, white on black, separator line */
            pixelPrint(1, 1, 'Step ' + (S.heldStep + 1), 1);
            var _pnLbl = '';
            var _pnK = S.knobTouched >= 0 ? S.knobTouched : _gLane6;
            if (S.trackCCType[_t6s][_pnK] === 2)
                _pnLbl = S.schLabel[_t6s][_pnK] || ('Sch' + S.trackCCAssign[_t6s][_pnK]);
            if (_pnLbl) pixelPrint(128 - _pnLbl.length * 6 - 1, 1, _pnLbl, 1);
            fill_rect(0, 7, 128, 1, 1);
            /* 8 knobs in 2 rows of 4 (standard font) */
            for (var _k6 = 0; _k6 < 8; _k6++) {
                var _col6 = _k6 % 4, _row6 = Math.floor(_k6 / 4);
                var _x6 = 4 + _col6 * 31, _y6 = 11 + _row6 * 18;
                var _hi6 = (S.knobTouched === _k6) || (S.ccActiveLane[_t6s] === _k6);
                if (_hi6) fill_rect(_x6 - 1, _y6 - 1, 29, 18, 1);
                var _lbl6 = S.trackCCType[_t6s][_k6] === 2 ? ('Sch' + S.trackCCAssign[_t6s][_k6])
                          : S.trackCCType[_t6s][_k6] === 1 ? 'AT'
                          : (S.trackCCAssign[_t6s][_k6] > 0 ? 'C' + S.trackCCAssign[_t6s][_k6] : '--');
                var _vs6;
                if (S.ccStepEditSet[_k6]) {
                    _vs6 = String(S.ccStepEditVal[_k6]);
                } else {
                    var _cv6 = S.ccStepEditComputed[_k6];
                    _vs6 = (_cv6 >= 0 && _cv6 <= 127) ? '(' + _cv6 + ')' : '--';
                }
                print(_x6, _y6, col4(_lbl6), _hi6 ? 0 : 1);
                print(_x6, _y6 + 9, col5(_vs6), _hi6 ? 0 : 1);
            }
            /* Progress bar */
            var _sgWP = Math.max(1, Math.ceil(_gEffLen6 / 16));
            var _sgVP = Math.max(0, Math.min(S.trackCurrentPage[_t6s], _sgWP - 1));
            var _sgSG = 1, _sgSW = Math.max(2, Math.floor((120 - (_sgWP - 1) * _sgSG) / _sgWP));
            var _sgPP = -1;
            if (S.playing) {
                var _sgProg = (S.masterPos % (_gEffLen6 * _gLTps6)) / (_gEffLen6 * _gLTps6);
                _sgPP = Math.floor(_sgProg * _sgWP);
            }
            for (var _sgPg = 0; _sgPg < _sgWP; _sgPg++) {
                var _sgx = 4 + _sgPg * (_sgSW + _sgSG);
                if (_sgPg === _sgVP) fill_rect(_sgx, _sgBarY, _sgSW, _sgBarH, 1);
                else if (_sgPg === _sgPP) {
                    fill_rect(_sgx, _sgBarY, _sgSW, 1, 1);
                    fill_rect(_sgx, _sgBarY + _sgBarH - 1, _sgSW, 1, 1);
                    fill_rect(_sgx, _sgBarY, 1, _sgBarH, 1);
                    fill_rect(_sgx + _sgSW - 1, _sgBarY, 1, _sgBarH, 1);
                } else fill_rect(_sgx, _sgBarY + _sgBarH - 1, _sgSW, 1, 1);
            }
            if (S.playing) {
                var _sgBW = _sgWP * (_sgSW + _sgSG) - _sgSG;
                var _sgDX = 4 + Math.floor(_sgProg * _sgBW);
                var _sgVS = 4 + _sgVP * (_sgSW + _sgSG);
                fill_rect(_sgDX, _sgBarY, 1, _sgBarH, (_sgDX >= _sgVS && _sgDX < _sgVS + _sgSW) ? 0 : 1);
            }
            return;
        } else {
        drawStepEditHeader();
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            /* Drum step edit: 2-row 4-col grid matching melodic layout width.
             * Row 1: K1 Leng, K2 Vel, K3 Nudg, K4 —.
             * Row 2: K5 Iter, K6 Prob, K7 Ratch, K8 —. */
            const t    = S.activeTrack;
            const lane = S.activeDrumLane[t];
            if (S.heldStepNotes.length > 0) {
                const tps   = S.drumLaneTPS[t] || 24;
                const _gateSteps = S.stepEditGate / tps;
                const LABELS = ['Leng', 'Vel', 'Nudg', '--', 'Iter', 'Prob', 'Ratch', '--'];
                const VALS   = [
                    _gateSteps % 1 === 0 ? _gateSteps.toFixed(0) : _gateSteps.toFixed(2),
                    String(S.stepEditVel),
                    (S.stepEditNudge >= 0 ? '+' : '') + String(S.stepEditNudge),
                    '',
                    formatStepIter(S.stepEditIter),
                    formatStepRand(S.stepEditRand),
                    formatStepRatch(S.stepEditRatch),
                    ''
                ];
                const COL_X = [0, 32, 64, 96];
                const ROW_Y = [13, 35];
                const CELL_W = 31, CELL_H = 22;
                for (let i = 0; i < 8; i++) {
                    if (i === 3 || i === 7) continue;
                    const col = i % 4, row = (i / 4) | 0;
                    const x = COL_X[col], y = ROW_Y[row];
                    const hi = (S.knobTouched === i);
                    if (hi) fill_rect(x, y - 3, CELL_W, CELL_H, 1);
                    print(x + 1, y, LABELS[i], hi ? 0 : 1);
                    print(x + 1, y + 10, VALS[i], hi ? 0 : 1);
                }
            } else {
                print(4, 30, '(empty)', 1);
            }
            return;
        }
        const ac        = effectiveClip(S.activeTrack);
        if (S.heldStepNotes.length > 0) {
            /* Melodic step edit: 2-row 4-col grid. Row 1: K1 Oct, K2 Note, K3 Leng, K4 Vel.
             * Row 2: K5 Nudg, K6 Iter, K7 Prob, K8 Ratch. */
            const root = S.heldStepNotes[0];
            const noteLabel = S.heldStepNotes.length > 1
                ? midiNoteName(root) + '+' + (S.heldStepNotes.length - 1)
                : midiNoteName(root);
            const tps = S.clipTPS[S.activeTrack][ac] || 24;
            const _gateSteps = S.stepEditGate / tps;
            const LABELS = ['Oct', 'Note', 'Leng', 'Vel', 'Nudg', 'Iter', 'Prob', 'Ratch'];
            const VALS   = [
                noteLabel,
                noteLabel,
                _gateSteps % 1 === 0 ? _gateSteps.toFixed(0) : _gateSteps.toFixed(2),
                String(S.stepEditVel),
                (S.stepEditNudge >= 0 ? '+' : '') + String(S.stepEditNudge),
                formatStepIter(S.stepEditIter),
                formatStepRand(S.stepEditRand),
                formatStepRatch(S.stepEditRatch)
            ];
            const COL_X = [0, 32, 64, 96];
            const ROW_Y = [13, 35];
            const CELL_W = 31, CELL_H = 22;
            /* Oct + Pit are merged: both knobs edit the same root note, so
             * one centered note value sits under both labels with a divider line. */
            {
                const hiOP = (S.knobTouched === 0 || S.knobTouched === 1);
                const opX  = COL_X[0];
                const opW  = COL_X[1] + CELL_W - COL_X[0];
                if (hiOP) fill_rect(opX, ROW_Y[0] - 3, opW, CELL_H, 1);
                print(COL_X[0] + 1, ROW_Y[0], 'Oct',  hiOP ? 0 : 1);
                print(COL_X[1] + 1, ROW_Y[0], 'Note', hiOP ? 0 : 1);
                fill_rect(opX, ROW_Y[0] + 7, opW, 1, hiOP ? 0 : 1);
                const _nlx = opX + ((opW - noteLabel.length * 6) >> 1);
                print(_nlx, ROW_Y[0] + 10, noteLabel, hiOP ? 0 : 1);
            }
            for (let i = 2; i < 8; i++) {
                const col = i % 4, row = (i / 4) | 0;
                const x = COL_X[col], y = ROW_Y[row];
                const hi = (S.knobTouched === i);
                if (hi) fill_rect(x, y - 3, CELL_W, CELL_H, 1);
                print(x + 1, y, LABELS[i], hi ? 0 : 1);
                print(x + 1, y + 10, VALS[i], hi ? 0 : 1);
            }
            return;
        } else if (S.stepWasEmpty) {
            print(4, 30, '(empty)', 1);
            return;
        }
        /* non-empty step, notes still loading at hold threshold — fall through to bank/header */
    } /* end else (non-bank-6 step edit) */
    }

    /* Loop view: own priority state so screen is fully cleared first. Suppressed
     * on the unconfirmed drum ALL LANES bank so holding Loop surfaces the confirm
     * screen (below) instead of the clip-length view for a gated gesture. */
    if (S.loopHeld && !(S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7 && !S.allLanesConfirmed)) {
        const _loopL2 = 'STEP BTN=by page';
        const _loopL3 = 'JOG TURN=by step';
        const _loopX2 = Math.floor((128 - _loopL2.length * 6) / 2);
        const _loopX3 = Math.floor((128 - _loopL3.length * 6) / 2);
        function _drawLoopSteps(steps) {
            const _l4  = 'Steps: ' + steps + '/256';
            const _l4x = Math.floor((128 - _l4.length * 6) / 2);
            const _nvX = _l4x + 7 * 6;
            const _nvW = (_l4.length - 7) * 6;
            fill_rect(_nvX - 1, 50, _nvW + 2, 14, 1);
            print(_l4x, 52, 'Steps: ', 1);
            print(_nvX, 52, steps + '/256', 0);
        }
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            const t   = S.activeTrack;
            const len = S.drumLaneLength[t];
            if (S.activeBank === 7) {
                const _allBlink = Math.floor(S.tickCount / 24) % 2 === 0;
                const _l1 = 'Clip length-' + (_allBlink ? 'ALL' : '   ') + ' lanes';
                print(Math.floor((128 - 21 * 6) / 2), 4, _l1, 1);
            } else {
                print(Math.floor((128 - 11 * 6) / 2), 4, 'Lane length', 1);
            }
            fill_rect(0, 15, 128, 1, 1);
            print(_loopX2, 22, _loopL2, 1);
            print(_loopX3, 34, _loopL3, 1);
            _drawLoopSteps(len);
        } else if (S.activeBank === 6) {
            var _t_l = S.activeTrack;
            var _ac_l = effectiveClip(_t_l);
            var _ccL_l = S.ccActiveLane[_t_l];
            var _llen_l = S.ccLaneLength[_t_l][_ac_l][_ccL_l];
            var _ltps_l = S.ccLaneResTps[_t_l][_ac_l][_ccL_l] || S.ccLaneTps[_t_l][_ac_l][_ccL_l];
            var _lbl_l = S.trackCCType[_t_l][_ccL_l] === 2
                       ? ('Sch' + S.trackCCAssign[_t_l][_ccL_l])
                       : fmtCCLabel(S.trackCCAssign[_t_l][_ccL_l]);
            var _resN = _ltps_l === 12 ? '1/32' : _ltps_l === 48 ? '1/8'
                      : _ltps_l === 96 ? '1/4' : _ltps_l === 384 ? '1bar' : '1/16';
            var _lcHdr = 'Lane config: K' + (_ccL_l + 1) + '-' + _lbl_l;
            pixelPrint(Math.floor((128 - _lcHdr.length * 6) / 2), 4, _lcHdr, 1);
            fill_rect(0, 15, 128, 1, 1);
            pixelPrint(1, 18, 'STEP BTN=Leng by page', 1);
            pixelPrint(1, 25, 'JOG TURN=Leng by step', 1);
            var _zoomTps_l = S.ccLaneTps[_t_l][_ac_l][_ccL_l] || (S.clipTPS[_t_l][_ac_l] || 24);
            var _zoomN = _zoomTps_l === 12 ? '1/32' : _zoomTps_l === 48 ? '1/8'
                       : _zoomTps_l === 96 ? '1/4' : _zoomTps_l === 384 ? '1bar' : '1/16';
            var _resLabel = 'Resolution: <';
            var _resValX = 1 + _resLabel.length * 6;
            var _resValW = _resN.length * 6 + 2;
            pixelPrint(1, 34, _resLabel, 1);
            fill_rect(_resValX - 1, 33, _resValW, 7, 1);
            pixelPrint(_resValX, 34, _resN, 0);
            pixelPrint(_resValX + _resValW, 34, '>', 1);
            var _zoomLabel = 'Zoom: +';
            var _zoomValX = 1 + _zoomLabel.length * 6;
            var _zoomValW = _zoomN.length * 6 + 2;
            pixelPrint(1, 41, _zoomLabel, 1);
            fill_rect(_zoomValX - 1, 40, _zoomValW, 7, 1);
            pixelPrint(_zoomValX, 41, _zoomN, 0);
            pixelPrint(_zoomValX + _zoomValW, 41, '-', 1);
            _drawLoopSteps(_llen_l > 0 ? _llen_l : S.clipLength[_t_l][_ac_l]);
        } else {
            const ac_l    = effectiveClip(S.activeTrack);
            const steps_l = S.clipLength[S.activeTrack][ac_l];
            print(Math.floor((128 - 11 * 6) / 2), 4, 'Clip Length', 1);
            fill_rect(0, 15, 128, 1, 1);
            print(_loopX2, 22, _loopL2, 1);
            print(_loopX3, 34, _loopL3, 1);
            _drawLoopSteps(steps_l);
        }
        return;
    }

    /* Arp Steps interval overlay: persistent bank overview while jog-clicked into
     * step-interval mode on SEQ ARP (4) or TARP (5). K1-K8 = per-step scale-degree
     * offsets (±24); pad grid is the persistent step-vel level editor handled in
     * updateTrackLEDs. Renders REGARDLESS of knob-touch / inTimeout (persistent). */
    if (bank >= 0 && S.stepIntervalMode && !S.sessionView && (bank === 4 || bank === 5)) {
        const t      = S.activeTrack;
        const isSeq  = (bank === 4);
        const arr    = isSeq ? S.seqArpStepInt[t][effectiveClip(t)] : S.tarpStepInt[t];
        drawBankHeading(isSeq ? 'SEQ ARP Steps' : 'ARP IN Steps');
        for (let k = 0; k < 8; k++) {
            const colX = 4 + (k % 4) * 30;
            const rowY = k < 4 ? 12 : 36;
            const hi   = (S.knobTouched === k);
            if (hi) fill_rect(colX, rowY, 24, 24, 1);
            const lbl = 'S' + (k + 1);
            const v   = arr[k] | 0;
            const val = (v === 0) ? ' 0' : (v > 0 ? '+' + v : String(v));
            print(colX, rowY,      col4(lbl), hi ? 0 : 1);
            print(colX, rowY + 12, col4(val), hi ? 0 : 1);
        }
        return;
    }

    /* Auto bank idle display: lane info + automation graph + progress bar */
    if (bank === 6 && !S.loopHeld && S.knobTouched < 0 && !inTimeout) {
        var _gt = S.activeTrack;
        var _gac = effectiveClip(_gt);
        var _gLane = S.ccActiveLane[_gt];
        var _gLbl = S.trackCCType[_gt][_gLane] === 2
                  ? ('Sch' + S.trackCCAssign[_gt][_gLane])
                  : fmtCCLabel(S.trackCCAssign[_gt][_gLane]);
        var _gParam = S.trackCCType[_gt][_gLane] === 2
                    ? (S.schLabel[_gt][_gLane] || '') : '';
        var _gEffLen = S.ccLaneLength[_gt][_gac][_gLane] || S.clipLength[_gt][_gac];
        var _gDispTps = S.ccLaneTps[_gt][_gac][_gLane] || (S.clipTPS[_gt][_gac] || 24);
        var _gLTps = S.ccLaneResTps[_gt][_gac][_gLane] || _gDispTps;
        var _gResN = _gLTps === 12 ? '1/32' : _gLTps === 48 ? '1/8'
                   : _gLTps === 96 ? '1/4' : _gLTps === 384 ? '1bar' : '1/16';
        drawBankHeadingInverted(BANKS[6].name);
        {
            var _ccHas = (S.trackCCAutoBits[_gt][_gac] !== 0) ||
                         S.clipCCVal[_gt][_gac].some(function(v) { return v >= 0; });
            var _atHas = !!S.clipAtHas[_gt][_gac];
            var _schHas = S.trackCCType[_gt].some(function(tp, k) {
                return tp === 2 && (((S.trackCCAutoBits[_gt][_gac] >> k) & 1) || S.clipCCVal[_gt][_gac][k] >= 0);
            });
            var _bx = 60;
            var _badge = function(txt) {
                var w = txt.length * 6 + 3;
                fill_rect(_bx, 1, w, 7, 1);
                print(_bx + 1, 1, txt, 0);
                _bx += w + 2;
            };
            if (_schHas) _badge('Sch');
            if (_atHas) _badge('AT');
            if (_ccHas) _badge('CC');
        }
        /* Lane info rows */
        var _gVal = S.playing ? S.trackCCLiveVal[_gt][_gLane] : S.clipCCVal[_gt][_gac][_gLane];
        var _gValStr = (_gVal >= 0 && _gVal <= 127) ? String(_gVal) : '--';
        var _gLine1L = 'K' + (_gLane + 1) + ' ' + _gLbl + ':';
        print(4, 10, _gLine1L, 1);
        var _gValX = 4 + _gLine1L.length * 6;
        print(_gValX, 10, _gValStr, 1);
        fill_rect(_gValX, 19, _gValStr.length * 6, 1, 1);
        if (_gParam) {
            var _gPTrunc = _gParam.length > 12 ? _gParam.substring(0, 12) : _gParam;
            print(128 - _gPTrunc.length * 6 - 1, 10, _gPTrunc, 1);
        }
        var _gZoomTps = S.ccLaneTps[_gt][_gac][_gLane] || (S.clipTPS[_gt][_gac] || 24);
        var _gZoomN = _gZoomTps === 12 ? '1/32' : _gZoomTps === 48 ? '1/8'
                    : _gZoomTps === 96 ? '1/4' : _gZoomTps === 384 ? '1bar' : '1/16';
        var _gResStr = 'Res: ' + _gResN;
        var _gZoomStr = 'Zoom: ' + _gZoomN;
        print(4, 21, _gResStr, 1);
        print(128 - _gZoomStr.length * 6 - 4, 21, _gZoomStr, 1);
        /* Automation graph: 128px wide, just above progress bar */
        var _gBarY = 60, _gBarH = 3;
        var _gH = 24, _gY = _gBarY - _gH - 3;
        var _gPages = Math.ceil(_gEffLen / 16);
        var _gCTps = S.clipTPS[_gt][_gac] || 24;
        var _gTotalSteps = _gEffLen;
        var _gKey = 'g_' + _gt + '_' + _gac + '_' + _gLane;
        if (_gKey !== S.ccGraphOvKey || (S.tickCount % POLL_INTERVAL) === 0) {
            S.ccGraphOvData = [];
            for (var _gp = 0; _gp < _gPages; _gp++) {
                var _gRaw = (typeof host_module_get_param === 'function')
                    ? host_module_get_param('t' + _gt + '_c' + _gac + '_ccsv_' + _gLane + '_' + _gp) : null;
                if (_gRaw) {
                    var _gParts = _gRaw.split(' ');
                    for (var _gs = 0; _gs < 16 && _gp * 16 + _gs < _gTotalSteps; _gs++)
                        S.ccGraphOvData.push(_gs < _gParts.length ? parseInt(_gParts[_gs], 10) : 255);
                }
            }
            S.ccGraphOvKey = _gKey;
        }
        /* Render graph: black background, 1px white border, white line */
        fill_rect(0, _gY, 128, 1, 1);
        fill_rect(0, _gY + _gH - 1, 128, 1, 1);
        fill_rect(0, _gY, 1, _gH, 1);
        fill_rect(127, _gY, 1, _gH, 1);
        var _gDataLen = S.ccGraphOvData.length || 1;
        var _gDrawY = _gY + 2, _gDrawH = _gH - 4;
        var _gPrevPy = -1;
        for (var _gc = 1; _gc < 127; _gc++) {
            var _gIdx = Math.floor(_gc * _gDataLen / 128);
            var _gv = _gIdx < S.ccGraphOvData.length ? S.ccGraphOvData[_gIdx] : -1;
            if (_gv >= 0 && _gv <= 127) {
                var _gpy = _gDrawY + _gDrawH - 1 - Math.round(_gv * (_gDrawH - 1) / 127);
                if (_gPrevPy >= 0 && _gPrevPy !== _gpy) {
                    var _gyMin = Math.min(_gPrevPy, _gpy);
                    var _gyMax = Math.max(_gPrevPy, _gpy);
                    fill_rect(_gc, _gyMin, 1, _gyMax - _gyMin + 1, 1);
                } else {
                    fill_rect(_gc, _gpy, 1, 1, 1);
                }
                _gPrevPy = _gpy;
            } else {
                _gPrevPy = -1;
            }
        }
        /* Step-hold position indicator — black vertical line on graph */
        if (S.heldStep >= 0) {
            var _gSx = Math.floor(S.heldStep * 128 / _gDataLen);
            if (_gSx > 127) _gSx = 127;
            fill_rect(_gSx, _gY, 1, _gH, 0);
        }
        /* Progress bar — lane-aware */
        var _gWinPages = Math.max(1, Math.ceil(_gEffLen / 16));
        var _gViewPage = Math.max(0, Math.min(S.trackCurrentPage[_gt], _gWinPages - 1));
        var _gSegGap = 1;
        var _gSegW = Math.max(2, Math.floor((120 - (_gWinPages - 1) * _gSegGap) / _gWinPages));
        var _gPlayPage = -1;
        if (S.playing) {
            var _gProg2 = (S.masterPos % (_gEffLen * _gLTps)) / (_gEffLen * _gLTps);
            _gPlayPage = Math.floor(_gProg2 * _gWinPages);
        }
        for (var _gPg = 0; _gPg < _gWinPages; _gPg++) {
            var _gx = 4 + _gPg * (_gSegW + _gSegGap);
            if (_gPg === _gViewPage) {
                fill_rect(_gx, _gBarY, _gSegW, _gBarH, 1);
            } else if (_gPg === _gPlayPage) {
                fill_rect(_gx, _gBarY, _gSegW, 1, 1);
                fill_rect(_gx, _gBarY + _gBarH - 1, _gSegW, 1, 1);
                fill_rect(_gx, _gBarY, 1, _gBarH, 1);
                fill_rect(_gx + _gSegW - 1, _gBarY, 1, _gBarH, 1);
            } else {
                fill_rect(_gx, _gBarY + _gBarH - 1, _gSegW, 1, 1);
            }
        }
        /* Playhead dot on progress bar */
        if (S.playing) {
            var _gBarW = _gWinPages * (_gSegW + _gSegGap) - _gSegGap;
            var _gDotX = 4 + Math.floor(_gProg2 * _gBarW);
            var _gViewStart = 4 + _gViewPage * (_gSegW + _gSegGap);
            var _gOnSolid = _gDotX >= _gViewStart && _gDotX < _gViewStart + _gSegW;
            fill_rect(_gDotX, _gBarY, 1, _gBarH, _gOnSolid ? 0 : 1);
        }
        return;
    }

    /* Conductor banks (Responder/Octave/When): per-track 2x4 grid, shown on knob
     * touch / bank-select timeout; idle falls through to the resting overview like
     * the Conduct bank. Gated on PAD_MODE_CONDUCT so it never affects melodic/drum. */
    if (S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT &&
            (bank === BANK_RESPONDER || bank === BANK_OCTAVE || bank === BANK_WHEN) &&
            (S.knobTouched >= 0 || inTimeout)) {
        const _ch = bankHeaderName(S.activeTrack, bank);
        if (bank === BANK_RESPONDER) {
            drawConductTrackGrid(_ch, function(k){ return S.trackPadMode[k] === PAD_MODE_DRUM ? '--' : (S.condResp[S.trackActiveClip[S.activeTrack] | 0][k] ? 'ON' : 'off'); }, 'Cndct');
        } else if (bank === BANK_OCTAVE) {
            drawConductTrackGrid(_ch, function(k){ if (S.trackPadMode[k] === PAD_MODE_DRUM) return '--'; const o = S.condOct[S.trackActiveClip[S.activeTrack] | 0][k]; return o === 0 ? '--' : (o > 0 ? '+' + o : '' + o); }, 'Cndct');
        } else { /* BANK_WHEN */
            drawConductTrackGrid(_ch, function(k){ return S.trackPadMode[k] === PAD_MODE_DRUM ? '--' : (S.condWhen[S.trackActiveClip[S.activeTrack] | 0][k] ? 'Now' : 'Next'); }, 'Cndct');
        }
        return;
    }

    if (bank >= 0 && (S.knobTouched >= 0 || inTimeout ||
            (S.altMode && bankHasAltParams(S.activeTrack, bank)) ||
            (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 7 && !S.allLanesConfirmed))) {
        const isDrumLaneBank = (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 0);
        if (isDrumLaneBank) {
            /* DRUM LANE bank overview: mirrors CLIP bank at lane level */
            const t    = S.activeTrack;
            const ac   = effectiveClip(t);
            const lane = S.activeDrumLane[t];
            const len  = S.drumLaneLength[t];
            const tpsIdx = Math.max(0, TPS_VALUES.indexOf(S.drumLaneTPS[t]));
            const sqfl   = S.clipSeqFollow[t][ac] ? 1 : 0;
            const eucN = Math.min(S.drumLaneEuclidN[t][lane] | 0, len);
            const drumLaneLabels = [S.altMode ? 'Zoom' : 'Res', 'Stch', S.altMode ? 'Nudg' : 'Shft', 'Lgto', 'Eucl', '-', S.altMode ? 'Rvrs' : 'Dir', 'SqFl'];
            const drumLaneVals  = [
                fmtRes(tpsIdx),
                fmtStretch(S.bankParams[t][0][1]),
                fmtSign(S.bankParams[t][0][2]),
                '->',
                String(eucN),
                '-',
                S.altMode ? fmtRevStyle(S.drumLanePlaybackAudioReverse[t][lane] | 0)
                          : fmtPlayDir(S.drumLanePlaybackDir[t][lane] | 0),
                fmtBool(sqfl),
            ];
            drawBankHeading('DRUM LANE');
            for (let k = 0; k < 8; k++) {
                if (!drumLaneLabels[k]) continue;
                const colX = 4 + (k % 4) * 30;
                const rowY = k < 4 ? 12 : 36;
                const hi   = (S.knobTouched === k);
                if (hi) fill_rect(colX, rowY, 24, 24, 1);
                print(colX, rowY,      col4(drumLaneLabels[k]), hi ? 0 : 1);
                print(colX, rowY + 12, col4(drumLaneVals[k]),   hi ? 0 : 1);
            }
        } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 7 && !S.allLanesConfirmed) {
            /* ALL LANES confirmation screen */
            fill_rect(0, 0, 128, 9, 1);
            print(4, 1, (Math.floor(S.tickCount / 24) % 2 === 0 ? 'ALL' : '   ') + ' LANES', 0);
            drawBankStrip(124, true);
            print(10, 18, 'Edits will affect', 1);
            print(10, 28, 'all lanes. Proceed?', 1);
            fill_rect(40, 44, 48, 16, 1);
            print(52, 48, 'OK', 0);
        } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 7) {
            /* ALL LANES bank overview */
            const t = S.activeTrack;
            const rv = S.bankParams[t][7][0];
            const qv = S.bankParams[t][7][3];
            const dv = S.bankParams[t][7][6];
            const DIQ_LABELS = ['Off','1/64','1/32','1/16','1/16T','1/8','1/8T','1/4','1/4T'];
            const allLabels = ['Res', 'Stch', S.altMode ? 'Nudg' : 'Shft', 'Qnt', 'VelIn', 'InQ', S.altMode ? 'Rvrs' : 'Dir', 'SyncRpt'];
            const allVals = [
                rv < 0 ? '--' : fmtRes(rv),
                fmtStretch(S.bankParams[t][7][1]),
                fmtSign(S.bankParams[t][7][2]),
                qv <= 0 ? '--' : fmtPct(qv),
                fmtVelOverride(S.trackVelOverride[t]),
                DIQ_LABELS[S.drumInpQuant[t]] || 'Off',
                dv < 0 ? '--' : (S.altMode ? fmtRevStyle(dv) : fmtPlayDir(dv)),
                fmtBool(S.bankParams[t][7][7]),
            ];
            fill_rect(0, 0, 128, 9, 1);
            print(4, 1, (Math.floor(S.tickCount / 24) % 2 === 0 ? 'ALL' : '   ') + ' LANES', 0);
            const _alSx = drawBankStrip(124, true);
            drawAltArrow(_alSx - 8, true, altIndicatorActive(S.activeTrack, S.activeBank));
            for (let k = 0; k < 8; k++) {
                if (!allLabels[k]) continue;
                const colX = 4 + (k % 4) * 30;
                const rowY = k < 4 ? 12 : 36;
                const hi   = (S.knobTouched === k);
                if (hi) fill_rect(colX, rowY, 24, 24, 1);
                const _lbl = allLabels[k];
                print(colX, rowY,      _lbl.length > 4 ? _lbl : col4(_lbl), hi ? 0 : 1);
                print(colX, rowY + 12, col4(allVals[k]),   hi ? 0 : 1);
            }
        } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 1) {
        /* Drum NOTE/NOTEFX bank: K1=Gate K2=Vel K3=Qnt */
        /* Drum NOTE FX: K1+K2=Oct/Note (merged), K3=Vel, K4=Qnt, K5=Len(placeholder), K6=Gate */
        const t    = S.activeTrack;
        const vals = S.bankParams[t][1];
        drawBankHeading('NOTE FX');
        /* K1+K2: merged Oct/Note box (per-lane MIDI note editor) */
        {
            const lane     = S.activeDrumLane[t];
            const _dlNote  = S.drumLaneNote[t][lane];
            const _noteStr = midiNoteName(_dlNote) + ' ' + _dlNote;
            const hiLane   = (S.knobTouched === 0 || S.knobTouched === 1);
            const LX = 4, LY = 12, LW = 54, LH = 24;
            if (hiLane) {
                fill_rect(LX, LY, LW, LH, 1);
            } else {
                /* single horizontal line under the Oct/Note labels */
                fill_rect(LX, LY + 9, LW, 1, 1);
            }
            const _lc = hiLane ? 0 : 1;
            print(LX + Math.floor((LW/2 - 18) / 2),                         LY + 1,  'Oct',  _lc);
            print(LX + Math.floor(LW/2) + Math.floor((LW/2 - 24) / 2),      LY + 1,  'Note', _lc);
            print(LX + Math.floor((LW - _noteStr.length * 6) / 2), LY + 13, _noteStr, _lc);
        }
        /* K3=Vel, K4=Qnt (row 1 right half); K5=Len, K6=Gate (row 2 left half) */
        {
            const _lane = S.activeDrumLane[t];
            const nfxLabels = [null, null, 'Vel', 'Qnt', 'Len>', '>Gate', null, null];
            const nfxVals   = [null, null, fmtSign(vals[1]), fmtPct(vals[2]),
                               fmtLen(S.drumLaneLenMode[t][_lane] | 0), fmtPct(vals[0]),
                               null, null];
            for (let k = 2; k < 6; k++) {
                const colX = 4 + (k % 4) * 30;
                const rowY = k < 4 ? 12 : 36;
                const hi   = (S.knobTouched === k);
                /* K6 label ">Gate" is 5 chars (30px) — widen the cell so the label
                 * and its highlight rect aren't clipped. K7/K8 are blocked on this
                 * bank, so the extra column is free. */
                const cellW = (k === 5) ? 30 : 24;
                if (hi) fill_rect(colX, rowY, cellW, 24, 1);
                const _lbl = nfxLabels[k];
                print(colX, rowY,      _lbl.length > 4 ? _lbl : col4(_lbl), hi ? 0 : 1);
                print(colX, rowY + 12, col4(nfxVals[k]),                    hi ? 0 : 1);
            }
        }

        } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 5) {
        /* Drum RPT GROOVE bank overview — 8 steps, vel scale (unshifted) or nudge (Shift) */
        const t    = S.activeTrack;
        const lane = S.activeDrumLane[t];
        syncDrumRepeatState(t, lane);
        /* Custom header: drop Tr# to clear the right side; arrow flash + per-step
         * value format (vel% vs signed nudge%) signal the alt-mode state. */
        fill_rect(0, 0, 128, 9, 0);
        fill_rect(0, 0, 128, 1, 1);
        fill_rect(0, 8, 128, 1, 1);
        print(4, 1, 'REPEAT GROOVE', 1);
        if (!S.sessionView) {
            const _rgSx = drawBankStrip(124, false);
            if (bankHasAltParams(S.activeTrack, S.activeBank)) {
                drawAltArrow(_rgSx - 8, false, altIndicatorActive(S.activeTrack, S.activeBank));
            }
        }
        const _gLen = S.drumRepeatGateLen[t][lane];
        for (let k = 0; k < 8; k++) {
            const colX = 4 + (k % 4) * 30;
            const rowY = k < 4 ? 12 : 36;
            const hi   = (S.knobTouched === k);
            if (hi) fill_rect(colX, rowY, 24, 24, 1);
            if (k >= _gLen) continue;
            const gateOn = !!(S.drumRepeatGate[t][lane] & (1 << k));
            if (gateOn) {
                fill_rect(colX, rowY + 1, 24, 4, hi ? 0 : 1);
            } else {
                const bc = hi ? 0 : 1;
                fill_rect(colX, rowY + 1, 24, 1, bc);
                fill_rect(colX, rowY + 4, 24, 1, bc);
                fill_rect(colX, rowY + 1, 1, 4, bc);
                fill_rect(colX + 23, rowY + 1, 1, 4, bc);
            }
            const vs   = S.drumRepeatVelScale[t][lane][k];
            const ndg  = S.drumRepeatNudge[t][lane][k];
            const disp = S.altMode
                ? (ndg === 0 ? ' 0%' : (ndg > 0 ? '+' : '') + ndg + '%')
                : vs + '%';
            print(colX, rowY + 12, col4(disp), hi ? 0 : 1);
        }
        } else if (bank === 6) {
        /* CC PARAM bank overview: label = CC# or "AT" (aftertouch); value =
         * stopped → clip resting value or "—"; playing → defined value at the
         * playhead or "—". Active lane cell is always highlighted. */
        const t  = S.activeTrack;
        const ac = effectiveClip(t);
        drawBankHeadingInverted(S.altMode ? 'ASSIGN' : BANKS[6].name);
        /* Automation-type indicators: inverted badge (white bg, black text) per
         * type that has data in the focused clip; nothing if the type is empty. */
        {
            const ccHas = (S.trackCCAutoBits[t][ac] !== 0) ||
                          S.clipCCVal[t][ac].some(function(v) { return v >= 0; });
            const atHas = !!S.clipAtHas[t][ac];
            const schHas = S.trackCCType[t].some(function(tp, k) {
                return tp === 2 && (((S.trackCCAutoBits[t][ac] >> k) & 1) || S.clipCCVal[t][ac][k] >= 0);
            });
            let bx = 60;
            const _badge = function(txt) {
                const w = txt.length * 6 + 3;
                fill_rect(bx, 1, w, 7, 1);
                print(bx + 1, 1, txt, 0);
                bx += w + 2;
            };
            if (schHas) _badge('Sch');
            if (atHas) _badge('AT');
            if (ccHas) _badge('CC');
        }
        for (let k = 0; k < 8; k++) {
            const colX = 4 + (k % 4) * 30;
            const rowY = k < 4 ? 12 : 36;
            /* In ASSIGN (altMode): highlight ONLY the label half of every cell so it
             * is visually clear that turning the knob retargets the CC/AT, not the
             * value. In normal mode, the touched/active lane gets the full-cell
             * inversion as before. */
            const touchedHi = (S.knobTouched === k) || (S.ccActiveLane[t] === k);
            const lbl = S.trackCCType[t][k] === 2 ? ('Sch' + S.trackCCAssign[t][k])
                      : S.trackCCType[t][k] === 1 ? 'AT' : fmtCCLabel(S.trackCCAssign[t][k]);
            const rawV = S.playing ? S.trackCCLiveVal[t][k] : S.clipCCVal[t][ac][k];
            const val  = (rawV >= 0 && rawV <= 127) ? String(rawV) : '--';
            if (S.altMode) {
                fill_rect(colX, rowY, 24, 12, 1);                /* label row only */
                if (touchedHi) fill_rect(colX, rowY + 12, 24, 12, 1);  /* value row only if touched */
                print(colX, rowY,      col4(lbl), 0);
                print(colX, rowY + 12, col4(val), touchedHi ? 0 : 1);
            } else {
                if (touchedHi) fill_rect(colX, rowY, 24, 24, 1);
                print(colX, rowY,      col4(lbl), touchedHi ? 0 : 1);
                print(colX, rowY + 12, col4(val), touchedHi ? 0 : 1);
            }
        }
        /* Bottom line: show full param name when a Sch knob is touched. */
        if (S.knobTouched >= 0 && S.trackCCType[t][S.knobTouched] === 2) {
            const _pn = S.schLabel[t][S.knobTouched];
            if (_pn) print(0, 56, _pn, 1);
        }
        } else if (S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM && bank === 1) {
        /* Melodic NOTE FX: K1=Oct, K2=Ofs, K3=Vel, K4=Qnt, K5=Len, K6=>Gate
         * (widened cell for 5-char label), K7=blocked, K8=Rnd. */
        const t     = S.activeTrack;
        const knobs = BANKS[1].knobs;
        const vals  = S.bankParams[t][1];
        const RND_ALG_NAMES_NFX = ['Pure', 'Gaus', 'Walk'];
        /* Conductor reuses melodic NOTE FX but only Oct(K1)/Ofs(K2)/Rnd(K8) +
         * alt-K8 random-mode apply — they shape the conductor note before its
         * offset is derived. K3-K6 (Vel/Qnt/Len/Gate) are inert/greyed. */
        const _conductNfx = S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT;
        drawBankHeading(BANKS[1].name);
        drawAltArrow(98, true, altIndicatorActive(S.activeTrack, S.activeBank));
        for (let k = 0; k < 8; k++) {
            if (k === 6) continue;  /* K7 blocked, no render */
            const colX = 4 + (k % 4) * 30;
            const rowY = k < 4 ? 12 : 36;
            const hi   = (S.knobTouched === k);
            const widen = (k === 5);
            const cellW = widen ? 30 : 24;
            const _inert = _conductNfx && (k === 2 || k === 3 || k === 4 || k === 5);
            if (_inert) {
                /* greyed-out inert cell: label/value '-' (no highlight) */
                print(colX, rowY,      col4('-'), 1);
                print(colX, rowY + 12, col4('-'), 1);
                continue;
            }
            if (hi) fill_rect(colX, rowY, cellW, 24, 1);
            const _nfxAlt = S.altMode && k === 7;
            if (widen) {
                print(colX, rowY,      '>Gate',                       hi ? 0 : 1);
                print(colX, rowY + 12, col4(knobs[k].fmt(vals[k])),   hi ? 0 : 1);
            } else if (_nfxAlt) {
                print(colX, rowY,      col4('Algo'),                   hi ? 0 : 1);
                print(colX, rowY + 12, col4(RND_ALG_NAMES_NFX[S.noteFXRandomMode[t] || 0]), hi ? 0 : 1);
            } else {
                print(colX, rowY,      col4(knobs[k].abbrev),         hi ? 0 : 1);
                print(colX, rowY + 12, col4(knobs[k].fmt(vals[k])),   hi ? 0 : 1);
            }
        }

        } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 3) {
        /* Drum MIDI DLY: K1-K4 same as melodic, K5=Gate, K6=Clk, K7=Retrg, K8 empty.
         * Drum has no Pfb (no per-lane pitch) and no Rnd (no random pitch fb),
         * so K5/K6 borrow those physical slots for Gate/Clk via the per-track
         * remap in applyBankParam, and K7 hosts delay_retrig directly. */
        const t    = S.activeTrack;
        const vals = S.bankParams[t][3];
        const knobs = BANKS[3].knobs;
        const drumDlyLabels = [knobs[0].abbrev, knobs[1].abbrev, knobs[2].abbrev, knobs[3].abbrev, 'Gate', 'Clk', 'Retrg', null];
        const drumDlyFmt    = [knobs[0].fmt, knobs[1].fmt, knobs[2].fmt, knobs[3].fmt, fmtGateMod, fmtSign, fmtBool, null];
        drawBankHeading(BANKS[3].name);
        for (let k = 0; k < 8; k++) {
            if (!drumDlyLabels[k]) continue;
            const colX = 4 + (k % 4) * 30;
            const rowY = k < 4 ? 12 : 36;
            const hi   = (S.knobTouched === k);
            if (hi) fill_rect(colX, rowY, 24, 24, 1);
            print(colX, rowY,      col4(drumDlyLabels[k]), hi ? 0 : 1);
            print(colX, rowY + 12, col4(drumDlyFmt[k](vals[k])), hi ? 0 : 1);
        }

        } else {
        /* Bank overview — 5 rows; touched knob column inverted */
        const knobs = BANKS[bank].knobs;
        const vals  = S.bankParams[S.activeTrack][bank];
        const _isDrum = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM;
        (bank === 5 ? drawBankHeadingInverted : drawBankHeading)(bankHeaderName(S.activeTrack, bank));
        for (let k = 0; k < 8; k++) {
            const colX = 4 + (k % 4) * 30;
            const rowY = k < 4 ? 12 : 36;
            const hi   = (S.knobTouched === k);
            if (hi) fill_rect(colX, rowY, 24, 24, 1);
            /* Conduct bank (CLIP bank 0 on a Conductor) K6 = CdLk lock toggle.
             * Melodic/drum CLIP K6 stays the generic '-' stub (unchanged). */
            if (bank === 0 && k === 5 &&
                    S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT) {
                const _cdc = S.trackActiveClip[S.activeTrack] | 0;
                print(colX, rowY,      col4('CdLk'), hi ? 0 : 1);
                print(colX, rowY + 12, col4(S.condLock[_cdc] ? 'Lock' : 'Off'), hi ? 0 : 1);
                continue;
            }
            let _lbl = knobs[k].abbrev || '-';
            /* Shift+K1 on DELAY bank (melodic): label + value flip to
             * delay_clock_fb. Drum: K6 already holds clock_fb directly via
             * remap; no flip needed. */
            const _delayShiftClkF = S.altMode && !_isDrum && bank === 3 && k === 0;
            const _clipDirAlt    = S.altMode && !_isDrum && knobs[k].dspKey === 'clip_playback_dir';
            const _rndAltAlgo    = S.altMode && !_isDrum && (bank === 1 || bank === 3) && k === 7;
            const RND_ALG_NAMES  = ['Pure', 'Gaus', 'Walk'];
            if (S.altMode) {
                if      (knobs[k].dspKey === 'clock_shift')    _lbl = 'Nudg';
                else if (knobs[k].dspKey === 'clip_resolution') _lbl = 'Zoom';
                else if (knobs[k].dspKey === 'clip_playback_dir') _lbl = 'Rvrs';
                else if (_delayShiftClkF)                       _lbl = 'ClkF';
                else if (_rndAltAlgo)                           _lbl = 'Algo';
            }
            print(colX, rowY,      _lbl, hi ? 0 : 1);
            /* Arp Rate (Rate knob in SEQ ARP / ARP IN) uses 5-char labels for
             * triplets ('1/16t','1/32t'). Skip the 4-char padding so the 't'
             * isn't truncated — the cell has ~24px and the raw string fits. */
            const _rawVal = _rndAltAlgo   ? RND_ALG_NAMES[bank === 3 ? (S.midiDlyRandomMode[S.activeTrack] || 0) : (S.noteFXRandomMode[S.activeTrack] || 0)]
                          : _delayShiftClkF ? fmtSign(S.delayClockFb[S.activeTrack])
                          : _clipDirAlt     ? fmtRevStyle(S.clipPlaybackAudioReverse[S.activeTrack][effectiveClip(S.activeTrack)] | 0)
                          : (knobs[k].abbrev ? knobs[k].fmt(vals[k]) : null);
            const _txt    = (knobs[k].fmt === fmtArpRate && !_delayShiftClkF) ? (_rawVal || '-') : col4(_rawVal);
            print(colX, rowY + 12, _txt, hi ? 0 : 1);
        }
        }

    } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
        /* Drum Track View — idle state */
        const t         = S.activeTrack;
        const lane      = S.activeDrumLane[t];
        const pg        = S.drumLanePage[t];
        const note      = S.drumLaneNote[t][lane];
        const oct       = Math.floor(note / 12) - 2;
        const name      = NOTE_KEYS[note % 12];
        const bankGroup = pg === 0 ? 'Bank:A' : 'Bank:B';
        const bankName  = S.activeBank === 0 ? 'DRUM LANE' : S.activeBank === 1 ? 'NOTE FX' : S.activeBank === 5 ? 'REPEAT GROOVE' : S.activeBank === 6 ? BANKS[6].name : S.activeBank === 7 ? (Math.floor(S.tickCount / 24) % 2 === 0 ? 'ALL' : '   ') + ' LANES' : BANKS[S.activeBank] ? BANKS[S.activeBank].name : '?';
        (S.activeBank === 5 || S.activeBank === 6 ? drawBankHeadingInverted : drawBankHeading)(bankName, false);
        pixelPrint(4, 10, bankGroup + '  Pad:' + name + oct + ' (' + note + ')', 1);
        const laneBit = 1 << lane;
        if (S.drumLaneSolo[t] & laneBit) {
            pixelPrint(128 - 4 - 6 * 6, 21, 'SOLOED', 1);
        } else if (S.drumLaneMute[t] & laneBit) {
            if (Math.floor(S.tickCount / 50) % 2 === 0)
                pixelPrint(128 - 4 - 5 * 6, 21, 'MUTED', 1);
        }
        drawMetroIndicator();
        drawTrackRow(34);
        for (let _t = 0; _t < NUM_TRACKS; _t++) {
            const _cx = _t * 16 + 5;
            const _ac = S.trackActiveClip[_t];
            const _hasData = S.trackPadMode[_t] === PAD_MODE_DRUM
                ? S.drumClipNonEmpty[_t][_ac]
                : S.clipNonEmpty[_t][_ac];
            const _isActive = (S.trackClipPlaying[_t] || S.trackWillRelaunch[_t] || (S.trackQueuedClip[_t] >= 0)) && _hasData;
            if (_isActive) {
                fill_rect(_cx - 1, 45, 9, 7, 1);
                pixelPrint(_cx, 46, SCENE_LETTERS[_ac], 0);
            } else {
                pixelPrint(_cx, 46, SCENE_LETTERS[_ac], 1);
            }
        }
        drawDrumPositionBar(t);
    } else {
        /* State 4: normal Track View */
        const recTag  = (S.recordArmed && !S.recordCountingIn && S.recordArmedTrack === S.activeTrack)
            ? ' REC' : '';
        const oct     = S.trackOctave[S.activeTrack];
        const octStr  = 'Oct:' + (oct >= 0 ? '+' : '') + oct;
        const keyScl  = NOTE_KEYS[S.padKey] + ' ' + (SCALE_DISPLAY[S.padScale] || '?');
        const CHAR_W  = 6;
        const keySclX = 128 - 4 - keyScl.length * CHAR_W;
        (S.activeBank === 5 || S.activeBank === 6 ? drawBankHeadingInverted : drawBankHeading)(bankHeaderName(S.activeTrack, S.activeBank) + recTag, false);
        pixelPrint(4, 10, octStr, 1);
        if (S.bankParams[S.activeTrack][5][0]) {
            if (S.bankParams[S.activeTrack][5][7]) {
                /* Latch on: invert 'Arp' (black on white chip) — pixelPrint
                 * uses a 5x5 glyph with 6px step; 'Arp' spans x=52..68, y=10..14.
                 * Chip pads 1px around: x=51..69 (w=19), y=9..15 (h=7). */
                fill_rect(51, 9, 19, 7, 1);
                pixelPrint(52, 10, 'Arp', 0);
            } else {
                pixelPrint(52, 10, 'Arp', 1);
            }
        }
        pixelPrint(keySclX, 10, keyScl, 1);
        if (S.scaleAware) fill_rect(keySclX, 15, keyScl.length * CHAR_W, 1, 1);
        drawMetroIndicator();
        drawTrackRow(34);
        for (let t = 0; t < NUM_TRACKS; t++) {
            const _cx = t * 16 + 5;
            const _ac = S.trackActiveClip[t];
            const _hasData = S.trackPadMode[t] === PAD_MODE_DRUM
                ? S.drumClipNonEmpty[t][_ac]
                : S.clipNonEmpty[t][_ac];
            const _isActive = (S.trackClipPlaying[t] || S.trackWillRelaunch[t] || (S.trackQueuedClip[t] >= 0)) && _hasData;
            if (_isActive) {
                fill_rect(_cx - 1, 45, 9, 7, 1);
                pixelPrint(_cx, 46, SCENE_LETTERS[_ac], 0);
            } else {
                pixelPrint(_cx, 46, SCENE_LETTERS[_ac], 1);
            }
        }
        drawPositionBar(S.activeTrack);
    }
}


function drawDrumPositionBar(t) {
    const lsBase = S.drumLaneLoopStart[t] | 0;
    const len    = S.drumLaneLength[t];
    const startPage = lsBase >> 4;
    const winPages  = Math.max(1, Math.ceil(len / 16));
    const viewPage  = Math.max(0, Math.min(S.drumStepPage[t] - startPage, winPages - 1));
    const cs        = S.drumCurrentStep[t];
    const playPage  = (S.playing && S.trackClipPlaying[t] && cs >= lsBase && cs < lsBase + len)
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
    if (S.playing && S.trackClipPlaying[t] && cs >= lsBase && cs < lsBase + len) {
        const winPxW = winPages * (segW + segGap) - segGap;
        const dotX = startX + Math.floor((cs - lsBase) * winPxW / Math.max(1, len));
        const viewSegStart = startX + viewPage * (segW + segGap);
        const onSolid = dotX >= viewSegStart && dotX < viewSegStart + segW;
        fill_rect(dotX, barY, 1, barH, onSolid ? 0 : 1);
    }
    /* Extent markers from the active lane's step mirror. */
    const lane  = S.activeDrumLane[t];
    const steps = S.drumLaneSteps[t][lane];
    let hasLeft = false, hasRight = false;
    for (let s = 0; s < lsBase; s++) if (steps[s] !== '0') { hasLeft = true; break; }
    for (let s = lsBase + len; s < 256; s++) if (steps[s] !== '0') { hasRight = true; break; }
    if (hasLeft)  fill_rect(startX - 2, barY + 1, 1, barH - 2, 1);
    if (hasRight) {
        const xRight = startX + winPages * (segW + segGap) - segGap + 1;
        fill_rect(xRight, barY + 1, 1, barH - 2, 1);
    }
}

function fmtHex(b) {
    return (b & 0xff).toString(16).padStart(2, '0').toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                            */
/* ------------------------------------------------------------------ */

/* Inherit-picker entry. On first launch in a freshly-pasted Move duplicate
 * (Copy-suffixed name + no canonical state file), check the name index for
 * family members and either auto-inherit (one candidate) or show a picker
 * dialog (two or more). Returns one of:
 *   'auto'   — silently inherited from the single candidate
 *   'picker' — dialog opened, S.pendingInheritPicker set
 *   'blank'  — nothing to inherit; let normal flow proceed */
function maybeShowInheritPicker(uuid, name) {
    if (!uuid || !name) return 'blank';
    if (typeof host_file_exists !== 'function') return 'blank';
    if (host_file_exists(uuidToStatePath(uuid))) return 'blank';
    const idx = S.nameIndexCache || (S.nameIndexCache = loadNameIndex());
    const candidates = findInheritCandidates(name, idx);
    if (candidates.length === 0) return 'blank';
    if (candidates.length === 1) {
        copyStateFiles(candidates[0].uuid, uuid);
        return 'auto';
    }
    S.pendingInheritPicker = {
        dstUuid: uuid,
        dstName: name,
        candidates: candidates,
        selectedIndex: 0
    };
    S.screenDirty = true;
    return 'picker';
}

/* Resolve the inherit picker: action is either the candidates index to
 * inherit from, or -1 for "Start blank". Always trigger pendingSetLoad
 * so DSP runs its state_load handler — which both resets the internal
 * state (clip_init, drum_track_init, etc.) and reads the canonical file.
 * For "Start blank" the file is missing on purpose; the reset alone gives
 * a clean slate. For inherit, we copy the source's state files first so
 * the load reads the seeded content. */
function resolveInheritPicker(action) {
    const p = S.pendingInheritPicker;
    if (!p) return;
    if (action >= 0 && action < p.candidates.length) {
        copyStateFiles(p.candidates[action].uuid, p.dstUuid);
    }
    S.pendingSetLoad = true;
    S.pendingInheritPicker = null;
    S.screenDirty = true;
}

/* ------------------------------------------------------------------ */
/* Snapshots — Save state / Load state                                 */
/* Self-contained modal (S.snapshotPicker), modeled on the inherit     */
/* picker. Confirm dialogs are folded into the picker object so the     */
/* only integration points are draw, jog-rotate, jog-click and close.  */
/* ------------------------------------------------------------------ */

/* Flush live state to disk (deferred 'save') then copy it into snapshot
 * `id` next tick — pendingSnapshotCopy is drained one tick after the save,
 * by which point seq8_save_state has written the file synchronously.
 * Reusing an existing id overwrites that snapshot in place. */
function beginSnapshotSave(id) {
    S.pendingSnapshotCopy = { id: id, label: snapshotLabel() };
    saveState();
}

/* Save state action. Under the cap → new timestamped snapshot. At the cap →
 * open the overwrite picker to choose which existing one to replace. */
function openSaveSnapshot() {
    if (S.pendingSuspendSave || S.pendingSnapshotCopy) return;  /* save already in flight */
    const snaps = loadSnapshotManifest(S.currentSetUuid);
    if (snaps.length >= SNAPSHOT_CAP) {
        S.snapshotPicker = { mode: 'overwrite', snaps: snaps, sel: 0, confirm: null };
        S.globalMenuOpen = false;
        S.screenDirty = true;
        return;
    }
    beginSnapshotSave(String(Date.now()));
    S.globalMenuOpen = false;
    showActionPopup('STATE', 'SAVED');
}

/* Load state action. Empty → popup. If any snapshots predate the current
 * state version, offer to wipe them before showing the list. */
function openLoadSnapshot() {
    const snaps = loadSnapshotManifest(S.currentSetUuid);
    if (snaps.length === 0) {
        S.globalMenuOpen = false;
        showActionPopup('NO', 'SNAPSHOTS');
        return;
    }
    const stale = [];
    for (let i = 0; i < snaps.length; i++)
        if (snaps[i].sv !== STATE_VERSION) stale.push(snaps[i].id);
    S.snapshotPicker = { mode: 'load', snaps: snaps, sel: 0, confirm: null };
    if (stale.length > 0)
        S.snapshotPicker.confirm = { kind: 'wipe', sel: 1, wipeIds: stale };
    S.globalMenuOpen = false;
    S.screenDirty = true;
}

function closeSnapshotPicker() {
    S.snapshotPicker = null;
    S.screenDirty = true;
}

/* Jog rotation inside the picker: toggle a confirm's Yes/No, else move
 * the list selection. */
function snapshotPickerRotate(delta) {
    const p = S.snapshotPicker;
    if (!p || delta === 0) return;
    if (p.confirm) {
        p.confirm.sel = p.confirm.sel === 0 ? 1 : 0;
    } else {
        const n = p.snaps.length;
        if (n > 0) p.sel = (p.sel + (delta > 0 ? 1 : n - 1)) % n;
    }
    S.screenDirty = true;
}

/* Jog click inside the picker: resolve a confirm, or arm one for the
 * selected entry. */
function snapshotPickerClick() {
    const p = S.snapshotPicker;
    if (!p) return;
    if (p.confirm) {
        const yes = p.confirm.sel === 0;
        const kind = p.confirm.kind;
        if (kind === 'wipe') {
            if (yes) { p.snaps = dropSnapshots(S.currentSetUuid, p.confirm.wipeIds); p.sel = 0; }
            p.confirm = null;
            if (p.snaps.length === 0) closeSnapshotPicker();
            else S.screenDirty = true;
            return;
        }
        const id = p.confirm.targetId;
        closeSnapshotPicker();
        if (kind === 'load' && yes) {
            applySnapshotToLive(S.currentSetUuid, id);
            S.pendingSetLoad = true;          /* reuse the normal state_load reload path */
            showActionPopup('STATE', 'LOADED');
        } else if (kind === 'overwrite' && yes) {
            beginSnapshotSave(id);            /* reuse id → overwrite in place */
            showActionPopup('STATE', 'SAVED');
        }
        return;
    }
    const snap = p.snaps[p.sel];
    if (!snap) return;
    if (p.mode === 'load') {
        if (snap.sv !== STATE_VERSION) return;   /* incompatible: ignore press */
        p.confirm = { kind: 'load', sel: 1, targetId: snap.id };
    } else {
        p.confirm = { kind: 'overwrite', sel: 1, targetId: snap.id };
    }
    S.screenDirty = true;
}

/* ---- CLEAR AUTOMATION menu (Delete-tap on the AUTO bank) ---- */
function openClearAutoMenu() {
    S.clearAutoMenu = { sel: 0, at: false, cc: false };
    S.screenDirty = true;
}
function closeClearAutoMenu() {
    S.clearAutoMenu = null;
    S.screenDirty = true;
}
function clearAutoMenuRotate(delta) {
    const m = S.clearAutoMenu;
    if (!m || delta === 0) return;
    m.sel = (m.sel + (delta > 0 ? 1 : 4)) % 5;   /* 0=AT 1=PB 2=CC 3=CLEAR 4=Cancel */
    S.screenDirty = true;
}
function clearAutoMenuClick() {
    const m = S.clearAutoMenu;
    if (!m) return;
    if (m.sel === 0) { m.at = !m.at; }              /* Aftertouch (AT) */
    else if (m.sel === 1) { /* Pitch bend (PB) — placeholder, not selectable */ }
    else if (m.sel === 2) { m.cc = !m.cc; }         /* Control Change (CC) — all CC data */
    else if (m.sel === 4) { closeClearAutoMenu(); return; }   /* Cancel */
    else {                                           /* CLEAR — execute */
        const t = S.activeTrack, c = effectiveClip(t);
        if (m.cc) {
            S.trackCCAutoBits[t][c] = 0;
            S.trackCCLiveVal[t] = new Array(8).fill(-1);
            S.clipCCVal[t][c] = new Array(8).fill(-1);
            S.pendingDefaultSetParams.push({ key: 't' + t + '_cc_auto_clear', val: String(c) });
        }
        if (m.at) {
            S.clipAtHas[t][c] = false;
            S.pendingDefaultSetParams.push({ key: 't' + t + '_c' + c + '_at_clear', val: '1' });
        }
        const done = [];
        if (m.at) done.push('AT');
        if (m.cc) done.push('CC');
        if (done.length) {
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
        }
        closeClearAutoMenu();
        invalidateLEDCache();
        showActionPopup('CLEARED', done.length ? done.join(' ') : 'NOTHING');
        return;
    }
    S.screenDirty = true;
}

/* Open the Schwung-slot picker (first use) or enter co-run directly if the
 * track already has a slot assigned. Co-run keeps dAVEBOx loaded; the chain
 * editor for the picked slot takes over OLED + jog + track buttons, while
 * pads / step buttons / knobs / transport stay with dAVEBOx. */
function openSchwungSlotEditor(t) {
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
function enterSchwungCoRun(t, slot) {
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
function exitSchwungCoRun() {
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
function enterMoveNativeCoRun(t) {
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
function exitMoveNativeCoRun() {
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
    /* If a drum pad hold inject was in flight, send the note-off before the
     * co-run session ends so Move doesn't get a stuck note. */
    if (S.moveCoRunDrumHeld >= 0 && typeof move_midi_inject_to_move === 'function') {
        move_midi_inject_to_move([0x08, 0x80, S.moveCoRunDrumHeld, 0]);  /* plain pad off (no Shift was sent) */
    }
    S.moveCoRunDrumHeld = -1;
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

function restoreUiSidecar(applyDefaultsNow) {
    const uiSp = uuidToUiStatePath(S.currentSetUuid);
    let us = null;
    if (typeof host_read_file === 'function' && typeof host_file_exists === 'function'
            && host_file_exists(uiSp)) {
        try { us = JSON.parse(host_read_file(uiSp)); } catch (e) {}
    }
    if (us && us.v >= 1) {
        if (typeof us.at === 'number' && us.at >= 0 && us.at < NUM_TRACKS)
            S.activeTrack = us.at;
        if (Array.isArray(us.ac)) {
            for (let _t = 0; _t < NUM_TRACKS; _t++) {
                const _c = us.ac[_t];
                if (typeof _c === 'number' && _c >= 0 && _c < NUM_CLIPS)
                    S.trackActiveClip[_t] = _c;
            }
        }
        S.sessionView = us.sv === 1;
        if (Array.isArray(us.dl)) {
            for (let _t = 0; _t < NUM_TRACKS; _t++) {
                const _l = us.dl[_t];
                if (typeof _l === 'number' && _l >= 0 && _l < DRUM_LANES)
                    setActiveDrumLane(_t, _l);
            }
        }
        /* Bundle 2C-Rpt2: re-push drum_lane_page mirror after DSP
         * create_instance reset. Not sidecar-persisted, but JS state may
         * be non-zero if the user paged off-zero before the set-switch
         * that triggered this restore. Unconditional push (the setter
         * would early-return on matching values, missing the post-reset
         * DSP=0 case). */
        if (typeof host_module_set_param === 'function') {
            for (let _t = 0; _t < NUM_TRACKS; _t++)
                host_module_set_param('t' + _t + '_drum_lane_page', String(S.drumLanePage[_t]));
        }
        if (typeof us.bm === 'number') S.beatMarkersEnabled = us.bm !== 0;
        if (us.v >= 2) {
            if (typeof us.pm === 'number') S.perfModsToggled = us.pm & 0xFFFFFF;
            S.perfLatchMode = us.lm === 1;
            if (typeof us.rs === 'number' && us.rs >= 0 && us.rs < 16) {
                S.perfRecalledSlot = us.rs;
                if (Array.isArray(us.us)) {
                    for (let _i = 0; _i < 8; _i++) {
                        if (typeof us.us[_i] === 'number')
                            S.perfSnapshots[8 + _i] = us.us[_i];
                    }
                }
            }
            const _pm = S.perfModsToggled | S.perfModsHeld;
            if (_pm) S.pendingDefaultSetParams.push({ key: 'perf_mods', val: String(_pm) });
        }
        /* us.ss (per-track Schwung slot) is obsolete — the co-run slot is now
         * derived from each slot's receive channel at entry time, so old sidecars'
         * ss is ignored and no longer written. */
        if (us.v >= 5 && Array.isArray(us.dva)) {
            for (let _t = 0; _t < NUM_TRACKS; _t++)
                S.drumVelZoneArmed[_t] = us.dva[_t] === true;
        }
        if (us.v >= 6 && Array.isArray(us.dleu)) {
            for (let _t = 0; _t < NUM_TRACKS; _t++) {
                const _row = us.dleu[_t];
                if (!Array.isArray(_row)) continue;
                for (let _l = 0; _l < DRUM_LANES; _l++) {
                    const _n = _row[_l];
                    S.drumLaneEuclidN[_t][_l] = (typeof _n === 'number' && _n >= 0) ? (_n | 0) : 0;
                }
            }
        }
        if (us.v >= 7 && Array.isArray(us.to)) {
            for (let _t = 0; _t < NUM_TRACKS; _t++) {
                const _o = us.to[_t];
                if (typeof _o === 'number')
                    S.trackOctave[_t] = Math.max(-4, Math.min(4, _o | 0));
            }
        }
        if (us.v >= 8 && Array.isArray(us.tab)) {
            for (let _t = 0; _t < NUM_TRACKS; _t++) {
                const _b = us.tab[_t];
                S.trackActiveBank[_t] = (typeof _b === 'number' && _b >= 0 && _b <= 7) ? (_b | 0) : 0;
            }
            /* Sync live mirror to the restored active track. Subsequent
             * post-restore validity checks (e.g. hide bank 7 on melodic) still
             * apply because activeBank is a regular live variable from here on. */
            S.activeBank = S.trackActiveBank[S.activeTrack] | 0;
            if (S.activeBank === 7) S.allLanesConfirmed = false;
        }
        if (us.v >= 9 && Array.isArray(us.am)) {
            for (let _t = 0; _t < NUM_TRACKS; _t++) {
                const _m = us.am[_t];
                S.trackAtMode[_t] = (typeof _m === 'number' && _m >= 0 && _m <= 2) ? (_m | 0) : 0;
            }
        }
        /* Per-track Chromatic pad layout (Shift+Step 8). Additive field on v:9;
         * absent in older v:9 sidecars → defaults to In-Key (false). Restored
         * like to/tab — the post-restore computePadNoteMap picks it up. */
        if (Array.isArray(us.pchr)) {
            for (let _t = 0; _t < NUM_TRACKS; _t++)
                S.padLayoutChromatic[_t] = !!us.pchr[_t];
        }
    } else {
        S.scaleAware   = 1;
        S.metronomeVol = 100;
        S.trackPadMode[0] = PAD_MODE_DRUM;
        /* Sync t0's drum lane data + drumClipNonEmpty from the freshly-reset
         * DSP. syncClipsFromDsp already ran earlier in the post-DSP-sync
         * drain, but its drum-sync block was gated on JS trackPadMode==DRUM,
         * which was MELODIC at the time (doClearSession reset it). Without
         * this catch-up, S.drumClipNonEmpty[0] + drum lane meta retain pre-
         * Clear values and t1's session/drum pad LEDs render stale. */
        if (applyDefaultsNow && typeof host_module_get_param === 'function') {
            syncDrumClipContent(0);
            syncDrumLanesMeta(0);
            syncDrumLaneSteps(0, S.activeDrumLane[0] | 0);
        }
        if (applyDefaultsNow) {
            S.pendingDefaultSetParams = [
                { key: 'scale_aware', val: '1' },
                { key: 'metro_vol',   val: '100' },
                { key: 't0_pad_mode', val: String(PAD_MODE_DRUM) }
            ];
        }
    }
}

function syncClipsFromDsp() {
    if (typeof host_module_get_param !== 'function') return;
    for (let t = 0; t < NUM_TRACKS; t++) {
        for (let c = 0; c < NUM_CLIPS; c++) {
            const bulk = host_module_get_param('t' + t + '_c' + c + '_steps');
            if (bulk && bulk.length >= NUM_STEPS) {
                for (let s = 0; s < NUM_STEPS; s++)
                    S.clipSteps[t][c][s] = bulk[s] === '1' ? 1 : 0;
                S.clipNonEmpty[t][c] = clipHasContent(t, c);
            }
            const len = host_module_get_param('t' + t + '_c' + c + '_length');
            if (len !== null && len !== undefined)
                S.clipLength[t][c] = parseInt(len, 10) || 16;
            const ls = host_module_get_param('t' + t + '_c' + c + '_loop_start');
            if (ls !== null && ls !== undefined)
                S.clipLoopStart[t][c] = parseInt(ls, 10) | 0;
            const tpsRaw = host_module_get_param('t' + t + '_c' + c + '_tps');
            if (tpsRaw !== null && tpsRaw !== undefined) {
                const tpsVal = parseInt(tpsRaw, 10);
                S.clipTPS[t][c] = TPS_VALUES.indexOf(tpsVal) >= 0 ? tpsVal : 24;
            }
            var ccll = host_module_get_param('t' + t + '_c' + c + '_cc_lane_loops');
            if (ccll) {
                var _vals = ccll.split(' ');
                for (var _k = 0; _k < 8 && _k * 4 + 3 < _vals.length; _k++) {
                    S.ccLaneLoopStart[t][c][_k] = parseInt(_vals[_k * 4], 10) | 0;
                    S.ccLaneLength[t][c][_k]    = parseInt(_vals[_k * 4 + 1], 10) | 0;
                    S.ccLaneTps[t][c][_k]       = parseInt(_vals[_k * 4 + 2], 10) | 0;
                    S.ccLaneResTps[t][c][_k]    = parseInt(_vals[_k * 4 + 3], 10) | 0;
                }
            }
        }
        const ac2 = host_module_get_param('t' + t + '_active_clip');
        if (ac2 !== null && ac2 !== undefined) {
            S.trackActiveClip[t] = parseInt(ac2, 10) | 0;
            S.lastDspActiveClip[t] = S.trackActiveClip[t];
        }
        const po = host_module_get_param('t' + t + '_pad_octave');
        if (po !== null && po !== undefined) S.padOctave[t] = parseInt(po, 10) | 0;
        readTrackConfig(t);
        for (let b = 0; b < 7; b++) readBankParams(t, b);
        readTarpStepVel(t);
        readDrumRepeatRates(t);
        /* Drum track: sync clip content flags and active lane data */
        if (S.trackPadMode[t] === PAD_MODE_DRUM) {
            syncDrumClipContent(t);
            syncDrumLanesMeta(t);
            syncDrumLaneSteps(t, S.activeDrumLane[t]);
            refreshDrumLaneBankParams(t, S.activeDrumLane[t]);
        }
        /* Clamp the visible page into the (possibly non-zero) window so that
         * the step LEDs aren't stuck at absolute page 0 on session load when
         * the active clip has a loop_start > 0. */
        {
            const _ac = S.trackActiveClip[t];
            const _ls = (S.trackPadMode[t] === PAD_MODE_DRUM)
                ? (S.drumLaneLoopStart[t] | 0)
                : (S.clipLoopStart[t][_ac] | 0);
            const _ln = (S.trackPadMode[t] === PAD_MODE_DRUM)
                ? (S.drumLaneLength[t] | 0)
                : (S.clipLength[t][_ac] | 0);
            if (_ln > 0) {
                const _startPage = Math.floor(_ls / 16);
                const _lastPage  = Math.floor((_ls + _ln - 1) / 16);
                if (S.trackCurrentPage[t] < _startPage || S.trackCurrentPage[t] > _lastPage)
                    S.trackCurrentPage[t] = _startPage;
            }
        }
    }
    const kp = host_module_get_param('key');
    if (kp !== null && kp !== undefined) S.padKey   = parseInt(kp, 10) | 0;
    const sp = host_module_get_param('scale');
    if (sp !== null && sp !== undefined) S.padScale = parseInt(sp, 10) | 0;
    const lqp = host_module_get_param('launch_quant');
    if (lqp !== null && lqp !== undefined) S.launchQuant = parseInt(lqp, 10) | 0;
    const iqp = host_module_get_param('inp_quant');
    if (iqp !== null && iqp !== undefined) S.inpQuant = iqp === '1';
    const micp = host_module_get_param('midi_in_channel');
    if (micp !== null && micp !== undefined) S.midiInChannel = parseInt(micp, 10) | 0;
    const monRaw = host_module_get_param('metro_on');
    if (monRaw !== null && monRaw !== undefined) {
        S.metronomeOn = parseInt(monRaw, 10) | 0;
        if (S.metronomeOn !== 0) S.metronomeOnLast = S.metronomeOn;
    }
    const mvolRaw = host_module_get_param('metro_vol');
    if (mvolRaw !== null && mvolRaw !== undefined) S.metronomeVol = parseInt(mvolRaw, 10) | 0;
    const swaRaw = host_module_get_param('swing_amt');
    if (swaRaw !== null && swaRaw !== undefined) S.swingAmt = parseInt(swaRaw, 10) | 0;
    const swrRaw = host_module_get_param('swing_res');
    if (swrRaw !== null && swrRaw !== undefined) S.swingRes = parseInt(swrRaw, 10) | 0;
}

/* Targeted re-sync after undo/redo: re-read only the affected clips rather than all 64.
 * infoStr format: "d t c" (drum) or "m t0 c0 t1 c1 ..." (melodic, 1-16 pairs).
 * Falls back to full syncClipsFromDsp() if infoStr is missing or unparseable. */
function syncClipsTargeted(infoStr) {
    if (!infoStr || typeof host_module_get_param !== 'function') { syncClipsFromDsp(); return; }
    const parts = infoStr.split(' ');
    if (parts.length < 3) { syncClipsFromDsp(); return; }
    const isDrum = parts[0] === 'd';
    let i = 1;
    /* Parse melodic/drum pairs, stopping at any 'DR' token */
    while (i + 1 < parts.length) {
        if (parts[i] === 'DR') break;
        const t = parseInt(parts[i], 10), c = parseInt(parts[i + 1], 10);
        i += 2;
        if (t < 0 || t >= NUM_TRACKS || c < 0 || c >= NUM_CLIPS) continue;
        if (isDrum) {
            syncDrumClipContent(t);
            syncDrumLanesMeta(t);
            syncDrumLaneSteps(t, S.activeDrumLane[t]);
            refreshDrumLaneBankParams(t, S.activeDrumLane[t]);
        } else {
            const bulk = host_module_get_param('t' + t + '_c' + c + '_steps');
            if (bulk && bulk.length >= NUM_STEPS) {
                for (let s = 0; s < NUM_STEPS; s++)
                    S.clipSteps[t][c][s] = bulk[s] === '1' ? 1 : 0;
                S.clipNonEmpty[t][c] = clipHasContent(t, c);
            }
            const len = host_module_get_param('t' + t + '_c' + c + '_length');
            if (len !== null && len !== undefined) S.clipLength[t][c] = parseInt(len, 10) || 16;
            const tpsRaw = host_module_get_param('t' + t + '_c' + c + '_tps');
            if (tpsRaw !== null && tpsRaw !== undefined) {
                const tpsVal = parseInt(tpsRaw, 10);
                S.clipTPS[t][c] = TPS_VALUES.indexOf(tpsVal) >= 0 ? tpsVal : 24;
            }
            if (c === S.trackActiveClip[t]) refreshPerClipBankParams(t);
        }
        const _abits = host_module_get_param('t' + t + '_c' + c + '_cc_auto_bits');
        S.trackCCAutoBits[t][c] = _abits !== null ? (parseInt(_abits, 10) || 0) : 0;
        const _arest = host_module_get_param('t' + t + '_c' + c + '_cc_rest');
        if (_arest) {
            const _arp = _arest.split(' ');
            for (let k = 0; k < 8; k++) {
                const rv = parseInt(_arp[k], 10);
                S.clipCCVal[t][c][k] = (rv >= 0 && rv <= 127) ? rv : -1;
            }
        }
        const _ath = host_module_get_param('t' + t + '_c' + c + '_at_has');
        S.clipAtHas[t][c] = (_ath !== null && parseInt(_ath, 10) === 1);
    }
    /* Parse 'DR rowN' tokens — resync drum clip content for all tracks at those rows */
    while (i + 1 < parts.length) {
        if (parts[i] !== 'DR') { i += 2; continue; }
        const rowIdx = parseInt(parts[i + 1], 10);
        i += 2;
        if (rowIdx < 0 || rowIdx >= NUM_CLIPS) continue;
        for (let t2 = 0; t2 < NUM_TRACKS; t2++) {
            syncDrumClipContent(t2);
            if (rowIdx === S.trackActiveClip[t2]) {
                syncDrumLanesMeta(t2);
                syncDrumLaneSteps(t2, S.activeDrumLane[t2]);
                refreshDrumLaneBankParams(t2, S.activeDrumLane[t2]);
            }
        }
    }
    S.screenDirty = true;
}

function syncMuteSoloFromDsp() {
    if (typeof host_module_get_param !== 'function') return;
    const muteStr = host_module_get_param('mute_state');
    const soloStr = host_module_get_param('solo_state');
    if (muteStr) for (let _t = 0; _t < NUM_TRACKS; _t++) S.trackMuted[_t]  = muteStr[_t]  === '1';
    if (soloStr) for (let _t = 0; _t < NUM_TRACKS; _t++) S.trackSoloed[_t] = soloStr[_t] === '1';
    for (let _n = 0; _n < 16; _n++) {
        const snap = host_module_get_param('snap_' + _n);
        if (snap && snap.length >= 17) {
            S.snapshots[_n] = {
                mute: Array.from(snap.substring(0, 8)).map(function(c) { return c === '1'; }),
                solo: Array.from(snap.substring(9, 17)).map(function(c) { return c === '1'; })
            };
        } else {
            S.snapshots[_n] = null;
        }
    }
    const saRaw = host_module_get_param('scale_aware');
    if (saRaw !== null && saRaw !== undefined) S.scaleAware = saRaw === '1' ? 1 : 0;
    S.screenDirty = true;
}

/* --- DIAGNOSTIC (2026-05-23 crash investigation) ---------------------------
 * QuickJS swallows unhandled exceptions thrown inside entry-point callbacks:
 * the module silently stops (presents as a hang/freeze; orphaned audio thread
 * then spins → RT throttle). Wrap the top-level entry points so the NEXT
 * failure writes its error to a file we can pull over ssh instead of vanishing.
 * Deduped by (where|message) → a persistent error writes once (no I/O storm).
 * Errors are swallowed so the module survives. REMOVE once the crash is pinned. */
let _jsErrSeen = {};
let _jsErrBuf = '';
function captureError(where, e) {
    try {
        const msg = (e && e.message) ? e.message : String(e);
        const key = where + '|' + msg;
        if (_jsErrSeen[key]) return;
        _jsErrSeen[key] = 1;
        const stack = (e && e.stack) ? ('\n' + e.stack) : '';
        _jsErrBuf += '[tick=' + (S.tickCount | 0)
                   + ' sv=' + (S.sessionView ? 1 : 0)
                   + ' loop=' + (S.loopHeld ? 1 : 0)
                   + ' lock=' + (S.perfViewLocked ? 1 : 0)
                   + ' susp=' + (S.pendingSuspendSave ? 1 : 0)
                   + '] ' + where + ': ' + msg + stack + '\n\n';
        if (typeof host_write_file === 'function')
            host_write_file('/data/UserData/schwung/seq8-jserr.log', _jsErrBuf);
    } catch (_e) { /* the logger must never throw */ }
}

/* Own all LEDs in our full-overtake views. Clock Follow keeps Move's sequencer
 * running underneath, whose RGB pad/clip/grid LEDs ride cable-0 sysex that the
 * shim otherwise passes through — they'd fight our LEDs. Opt into sysex
 * suppression (patched Schwung only; no-op on older hosts). The host CLEARS this
 * flag whenever our module is parked (suspendOvertakeMode → suspend/resume, and
 * on overtake exit / co-run), so init() alone isn't enough — we must re-assert it
 * every time we return to full overtake (resume, co-run end), or Move's clip-side
 * LEDs leak back. Idempotent + typeof-guarded, so it's safe to call repeatedly. */
function assertOvertakeSysexSuppress() {
    if (typeof shadow_set_overtake_suppress_sysex === 'function')
        shadow_set_overtake_suppress_sysex(1);
}

globalThis.init = function () {
    installConsoleOverride('SEQ8');
    /* Clear any lingering co-run flag from a prior session — shim's SHM
     * may still hold target/id if we were warm-restarted (Shift+Back +
     * relaunch does not reset shadow_control). */
    S.schwungCoRunSlot = -1;
    S.moveCoRunTrack = -1;
    if (typeof shadow_corun_end === 'function') shadow_corun_end();
    assertOvertakeSysexSuppress();
    if (S.bankParams === null)
        S.bankParams = Array.from({length: NUM_TRACKS}, function() {
            return BANKS.map(function(bank) { return bank.knobs.map(function(k) { return k.def; }); });
        });

    const p = (typeof host_module_get_param === 'function')
        ? host_module_get_param('playing') : null;
    const dspSurvived = (p !== null && p !== undefined);

    console.log('SEQ8 init: ' + (p === '1' ? 'RESUMED playing' : 'FRESH/stopped'));

    /* Detect set mismatch: compare active_set.txt UUID with what the DSP currently has loaded.
     * Works regardless of JS context lifetime — no cross-init state needed.
     * If they differ, DSP has old set's data: save it, then load the active set. */
    {
        const _as = readActiveSet();
        S.currentSetUuid = _as.uuid;
        S.currentSetName = _as.name;
    }
    /* Inherit-picker decision tree for a freshly-pasted Move duplicate.
     * 'auto'   — single family candidate, silently inherited; force pendingSetLoad.
     * 'picker' — multiple candidates; dialog open, state_load is deferred.
     * 'blank'  — no candidates; fall through to normal mismatch/exists checks.
     * Force pendingSetLoad on success: create_instance already called
     * seq8_load_state with the (then-empty) duplicate path; DSP needs to
     * reload from the now-seeded file. */
    const inheritResult = maybeShowInheritPicker(S.currentSetUuid, S.currentSetName);
    const currentDspNonce = (typeof host_module_get_param === 'function')
        ? host_module_get_param('instance_id') : null;
    const dspUuid = (typeof host_module_get_param === 'function')
        ? (host_module_get_param('state_uuid') || '') : '';
    if (currentDspNonce) S.lastDspInstanceId = currentDspNonce;
    /* Check if DSP flagged a state version mismatch during create_instance.
     * If so, show the confirm dialog and suppress any pendingSetLoad — the
     * dialog's "Yes" handler will trigger state_load after the user confirms. */
    const _svMismatch = (typeof host_module_get_param === 'function')
        ? host_module_get_param('state_version_mismatch') : null;
    if (_svMismatch && parseInt(_svMismatch, 10) === 1) {
        S.confirmStateWipe = true;
        S.confirmStateWipeSel = 1;
        S.pendingSetLoad = false;
        S.screenDirty = true;
    } else if (inheritResult === 'auto') {
        S.pendingSetLoad = true;
    } else if (inheritResult === 'picker') {
        /* state_load deferred until resolveInheritPicker fires */
    } else if (S.currentSetUuid && dspUuid !== S.currentSetUuid) {
        S.pendingSetLoad = true;
    } else if (S.currentSetUuid && typeof host_file_exists === 'function') {
        const sp = '/data/UserData/schwung/set_state/' + S.currentSetUuid + '/seq8-state.json';
        if (!host_file_exists(sp)) S.pendingSetLoad = true;
    }
    /* Schedule orphan prune for the next quiet tick (after state_load settles). */
    S.pendingPruneOrphans = true;

    if (typeof host_module_get_param === 'function') {
        S.playing = dspSurvived;

        for (let t = 0; t < NUM_TRACKS; t++) {
            const ac = host_module_get_param('t' + t + '_active_clip');
            if (ac !== null && ac !== undefined) S.trackActiveClip[t] = parseInt(ac, 10) | 0;
            const cs = host_module_get_param('t' + t + '_current_step');
            const csVal = (cs !== null && cs !== undefined) ? (parseInt(cs, 10) | 0) : -1;
            S.trackCurrentStep[t] = csVal;
            S.trackCurrentPage[t] = csVal >= 0 ? Math.floor(csVal / 16) : 0;
            const qc = host_module_get_param('t' + t + '_queued_clip');
            S.trackQueuedClip[t] = (qc !== null && qc !== undefined) ? (parseInt(qc, 10) | 0) : -1;
        }

        syncClipsFromDsp();
        syncMuteSoloFromDsp();
    }

    extHeldNotes.clear();

    if (!S.hasInitedOnce) { S.sessionView = true; S.hasInitedOnce = true; }

    /* Restore UI state (active track, clip focus, view) from sidecar.
     * Deferred if pendingSetLoad: DSP hasn't loaded the new set yet, restoreUiSidecar
     * will be called again from the pendingDspSync completion path after the full resync. */
    restoreUiSidecar(!S.pendingSetLoad);

    /* PHASE-1: capability gate for DSP-owned input. On patched Schwung the
     * shim delivers pad MIDI to overtake DSP's on_midi on the audio thread,
     * removing the slow-brain JS hop. We detect via shadow_inbound_pad_midi_active
     * (added in legsmechanical/schwung phase-1-inbound). When active, we suppress
     * queueLiveNoteOn/Off in liveSendNote AND push tN_padmap to DSP — which
     * doubles as the DSP-side capability signal (its padmap handler sets
     * inst->dsp_inbound_enabled). The push happens on every computePadNoteMap
     * recompute, so it survives DSP instance recreate (state_load path).
     * Stock Schwung: function undefined, flag stays false, padmap never pushed,
     * existing JS path keeps working. Remove the gate when patches upstreamed. */
    S.dspInboundEnabled = (typeof shadow_inbound_pad_midi_active === 'function');

    computePadNoteMap();

    /* Apply cable-2 channel remap for the current active track immediately
     * (tick() change-detect also covers this, but fires one tick later). */
    _lastRemapTrack = -1;
    applyExtMidiRemap();

    S.ledInitComplete = false;
    invalidateLEDCache();
    S.ledInitQueue    = buildLedInitQueue();
    S.ledInitIndex    = 0;

    installFlagsWrap();

    S._origClearScreen = clear_screen;
    S._wasSuspended    = false;
};

var _lastRemapTrack = -1, _lastRemapRoute = -1, _lastRemapChannel = -1, _lastRemapMidiIn = -2;
var _lastSessionView = false;

globalThis.tick = function () { try { _tickImpl(); } catch (e) { captureError('tick', e); } };
function _tickImpl() {
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
        if (_rt !== _lastRemapTrack || _rr !== _lastRemapRoute ||
                _rc !== _lastRemapChannel || _rm !== _lastRemapMidiIn) {
            /* TARP latch is per-track musical intent — preserved across track/
             * route/channel/MIDI-in changes. Only Stop transport and Delete+Play
             * clear it deliberately. */
            applyExtMidiRemap();
            _lastRemapTrack = _rt; _lastRemapRoute = _rr;
            _lastRemapChannel = _rc; _lastRemapMidiIn = _rm;
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

    /* Flush live note batches; one set_param per track so no coalescing.
     * Defer for 1 tick after any step button event so the step set_param clears its audio
     * block before live_notes fires — otherwise live_notes can overwrite step toggles.
     *
     * Collision-aware ordering: a pitch with both an off and an on in this drain
     * emits its events in arrival order so a same-tick press+release (on then off)
     * doesn't get inverted into off→on. DSP's pfx_note_off_imm is a silent no-op
     * on inactive notes, so an inverted off→on activates the note and never gets
     * a follow-up off — the note hangs on Move. Pitches with only offs or only
     * ons keep the legacy offs-first sort, which still protects release-before-
     * retrigger semantics across different pitches. */
    if (S.tickCount > S.stepOpTick + 1) {
        for (let _t = 0; _t < NUM_TRACKS; _t++) {
            if (pendingLiveNotes[_t].length === 0) continue;
            const evts = pendingLiveNotes[_t];
            pendingLiveNotes[_t] = [];
            const offPitches = new Set();
            const onPitches  = new Set();
            for (const e of evts) (e.isOff ? offPitches : onPitches).add(e.pitch);
            const collide = new Set();
            for (const p of offPitches) if (onPitches.has(p)) collide.add(p);
            const parts = [];
            if (collide.size === 0) {
                for (const e of evts) if (e.isOff)  parts.push('off ' + e.pitch);
                for (const e of evts) if (!e.isOff) parts.push('on '  + e.pitch + ' ' + e.vel);
            } else {
                for (const e of evts) if (e.isOff  && !collide.has(e.pitch)) parts.push('off ' + e.pitch);
                for (const e of evts) if (!e.isOff && !collide.has(e.pitch)) parts.push('on '  + e.pitch + ' ' + e.vel);
                for (const e of evts) if (collide.has(e.pitch))
                    parts.push(e.isOff ? ('off ' + e.pitch) : ('on ' + e.pitch + ' ' + e.vel));
            }
            host_module_set_param('t' + _t + '_live_notes', parts.join(' '));
        }
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
        setButtonLED(MoveRec,    (S.recordArmed || S.recordScheduledStop) ? Red : LED_OFF, true);
        setButtonLED(MoveSample, S.dspMergeState >= 2 ? Green : S.dspMergeState === 1 ? Red : LED_OFF, true);
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
                 * plus the computed output value the lane produces there. The
                 * first knob-turn writes from the recorded point if set, else the
                 * clip resting value, else 0. */
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
                    S.ccStepEditVal[_ck] = _pv >= 0 ? _pv : (_rest >= 0 ? _rest : 0);
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
        } else {
            setButtonLED(MoveRec, S.recordArmed ? Red : LED_OFF);
        }
        setButtonLED(MoveSample, S.dspMergeState >= 2 ? Green : S.dspMergeState === 1 ? Red : DarkGrey);
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
        setButtonLED(MoveCapture, DarkGrey);
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
            const _sfs = (Math.floor(S.tickCount / 24) % 2) ? DarkGrey : LED_OFF;
            setButtonLED(MoveNoteSession, _sf);
            setButtonLED(MoveSample,      _sfs);
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
     * Note-ons take priority; note-offs wait until the next tick if both are pending. */
    if (S.recordArmed && !S.recordCountingIn && typeof host_module_set_param === 'function') {
        if (S._recNoteOns.length > 0) {
            const rt   = S._recNoteOns[0].rt;
            const pairs = S._recNoteOns.map(function(n) { return n.pitch + ' ' + n.vel; }).join(' ');
            host_module_set_param('t' + rt + '_record_note_on', pairs);
            S._recNoteOns.length = 0;
        } else if (_drumRecNoteOns.length > 0) {
            /* Batch all queued drum note-ons (same recordArmedTrack) into one
             * payload so a chord-press lands in DSP in a single audio buffer
             * rather than trickling out one-per-tick. */
            const rt = _drumRecNoteOns[0].track;
            const pairs = _drumRecNoteOns.map(function(n) { return n.laneNote + ' ' + n.vel; }).join(' ');
            host_module_set_param('t' + rt + '_drum_record_note_on', pairs);
            _drumRecNoteOns.length = 0;
        } else if (S._recNoteOffs.length > 0) {
            const rt     = S._recNoteOffs[0].rt;
            const pitches = S._recNoteOffs.map(function(n) { return n.pitch; }).join(' ');
            host_module_set_param('t' + rt + '_record_note_off', pitches);
            S._recNoteOffs.length = 0;
        } else if (_drumRecNoteOffs.length > 0) {
            const rt = _drumRecNoteOffs[0].track;
            const pitches = _drumRecNoteOffs.map(function(n) { return String(n.laneNote); }).join(' ');
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

/* ------------------------------------------------------------------ */
/* MIDI input                                                           */
/* ------------------------------------------------------------------ */

function _onCC_jog(d1, d2) {
    if (S.shiftTrackLEDActive) { S.shiftTrackLEDActive = false; S.screenDirty = true; }
    /* Inherit picker: jog click confirms selection (-1 = Start blank). */
    if (d1 === 3 && d2 === 127 && S.pendingInheritPicker) {
        const p = S.pendingInheritPicker;
        const action = (p.selectedIndex === p.candidates.length) ? -1 : p.selectedIndex;
        resolveInheritPicker(action);
        return;
    }
    /* Snapshot picker: jog click resolves a confirm or arms one. */
    if (d1 === 3 && d2 === 127 && S.snapshotPicker) {
        snapshotPickerClick();
        return;
    }
    /* CLEAR AUTOMATION modal: jog click toggles a row / executes CLEAR. */
    if (d1 === 3 && d2 === 127 && S.clearAutoMenu) {
        clearAutoMenuClick();
        return;
    }
    /* Scene bake confirm: two-phase jog flow — loop count, then wrap yes/no. */
    if (d1 === 3 && d2 === 127 && S.confirmBakeScene) {
        if (S.confirmBakeSceneCondPhase) {
            /* Apply-Conductor dialog: 0=YES, 1=NO, 2=CANCEL */
            if (S.confirmBakeSceneCondSel === 2) {
                /* Cancel: abort the whole scene bake. */
                S.confirmBakeSceneCondPhase = false;
                S.confirmBakeScene          = false;
                S.screenDirty               = true;
                return;
            }
            const _apply = S.confirmBakeSceneCondSel === 0 ? 1 : 0;
            commitSceneBake(S.confirmBakeSceneClip, S.confirmBakeSceneLoops,
                            S.confirmBakeSceneWrap, _apply);
            S.confirmBakeSceneCondPhase = false;
            S.confirmBakeScene          = false;
            S.screenDirty               = true;
            return;
        }
        if (S.confirmBakeSceneWrapPhase) {
            /* Wrap dialog: 0=YES, 1=NO, 2=CANCEL */
            if (S.confirmBakeSceneWrapSel < 2) {
                const _wrap = S.confirmBakeSceneWrapSel === 0 ? 1 : 0;
                if (sceneBakeHasConductor(S.confirmBakeSceneClip)) {
                    /* Advance to the Apply-Conductor phase; hold loop+wrap. */
                    S.confirmBakeSceneWrap      = _wrap;
                    S.confirmBakeSceneWrapPhase = false;
                    S.confirmBakeSceneCondPhase = true;
                    S.confirmBakeSceneCondSel   = 1; /* default: NO */
                    S.screenDirty               = true;
                    return;
                }
                /* No conductor / no responders: commit immediately (A=0). */
                commitSceneBake(S.confirmBakeSceneClip, S.confirmBakeSceneLoops, _wrap, 0);
            }
            S.confirmBakeSceneWrapPhase = false;
            S.confirmBakeScene          = false;
            S.screenDirty               = true;
            return;
        }
        if (S.confirmBakeSceneSel > 0) {
            /* Advance to wrap phase, hold loop count for the commit step. */
            S.confirmBakeSceneLoops     = [1, 2, 4][S.confirmBakeSceneSel - 1];
            S.confirmBakeSceneWrapPhase = true;
            S.confirmBakeSceneWrapSel   = 1; /* default: NO */
            S.screenDirty               = true;
            return;
        }
        S.confirmBakeScene = false;
        S.screenDirty      = true;
        return;
    }

    /* Lgto confirm: jog click commits (OK applies, CANCEL aborts). */
    if (d1 === 3 && d2 === 127 && S.confirmLgto) {
        const _sel = S.confirmLgtoSel | 0;
        S.confirmLgto = false;
        if (_sel === 0 && typeof host_module_set_param === 'function') {
            const _t = S.activeTrack;
            if (S.confirmLgtoIsDrum) {
                const _l = S.activeDrumLane[_t];
                host_module_set_param('t' + _t + '_l' + _l + '_lgto_apply', '1');
                S.pendingDrumResync      = 2;
                S.pendingDrumResyncTrack = _t;
            } else {
                host_module_set_param('t' + _t + '_lgto_apply', '1');
                S.pendingStepsReread      = 2;
                S.pendingStepsRereadTrack = _t;
                S.pendingStepsRereadClip  = S.trackActiveClip[_t];
            }
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
            showActionPopup('LGTO', 'APPLIED');
        }
        S.screenDirty = true;
        forceRedraw();
        return;
    }

    /* State version mismatch dialog: Yes = wipe + clean start; No = exit module. */
    if (d1 === 3 && d2 === 127 && S.confirmStateWipe) {
        S.confirmStateWipe = false;
        if (S.confirmStateWipeSel === 0) {
            S.pendingSetLoad = true;
        } else {
            removeFlagsWrap();
            clearAllLEDs();
            if (typeof host_exit_module === 'function') host_exit_module();
        }
        S.screenDirty = true;
        forceRedraw();
        return;
    }

    /* BPM-controlled-by-Move info: jog click = OK (dismiss). */
    if (d1 === 3 && d2 === 127 && S.bpmMoveInfo) {
        S.bpmMoveInfo = false;
        forceRedraw();
        return;
    }

    /* REC Unavailable dialog: jog click commits selection (OK = dismiss,
     * BAKE NOW = open standard bake confirm pre-targeted at active clip). */
    if (d1 === 3 && d2 === 127 && S.recordBlockedDialog) {
        const _sel = S.recordBlockedDialogSel | 0;
        S.recordBlockedDialog = false;
        if (_sel === 1) {
            /* Open bake confirm at active clip — same path as Capture-bare-tap. */
            const _bt = S.activeTrack, _bc = S.trackActiveClip[_bt];
            const _isDrum = S.trackPadMode[_bt] === PAD_MODE_DRUM;
            S.confirmBake             = true;
            S.confirmBakeIsDrum       = _isDrum;
            S.confirmBakeIsMultiLoop  = !_isDrum;
            S.confirmBakeSel          = _isDrum ? 2 : 1;
            S.confirmBakeTrack        = _bt;
            S.confirmBakeClip         = _bc;
            S.confirmBakeDrumLoopOpen = false;
            S.confirmBakeWrapPhase    = false;
        }
        S.screenDirty = true;
        forceRedraw();
        return;
    }

    /* Bake confirm: jog click confirms/cancels when dialog is open */
    if (d1 === 3 && d2 === 127 && S.confirmBake) {
        if (S.confirmBakeWrapPhase) {
            /* Wrap dialog: 0=YES, 1=NO, 2=CANCEL */
            if (S.confirmBakeWrapSel < 2) {
                const _wrap = S.confirmBakeWrapSel === 0 ? 1 : 0;
                const _loops = S.confirmBakeLoops;
                if (S.confirmBakeIsDrum) {
                    const _laneArg = S.confirmBakeDrumMode === 1 ? ' ' + S.activeDrumLane[S.confirmBakeTrack] : ' 0';
                    S.pendingDefaultSetParams.push({
                        key: 'bake',
                        val: S.confirmBakeTrack + ' ' + S.confirmBakeClip + ' ' + S.confirmBakeDrumMode + ' ' + _loops + _laneArg + ' ' + _wrap
                    });
                    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
                    showActionPopup('BAKED', _loops + 'x');
                    S.pendingBankRefresh = S.confirmBakeTrack;
                    if (S.confirmBakeClip === S.trackActiveClip[S.confirmBakeTrack]) {
                        S.pendingDrumResync      = 2;
                        S.pendingDrumResyncTrack = S.confirmBakeTrack;
                    }
                } else {
                    S.pendingDefaultSetParams.push({
                        key: 'bake',
                        val: S.confirmBakeTrack + ' ' + S.confirmBakeClip + ' 0 ' + _loops + ' 0 ' + _wrap
                    });
                    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
                    showActionPopup('BAKED', _loops + 'x');
                    S.pendingBankRefresh      = S.confirmBakeTrack;
                    S.pendingStepsReread      = 2;
                    S.pendingStepsRereadTrack = S.confirmBakeTrack;
                    S.pendingStepsRereadClip  = S.confirmBakeClip;
                }
            }
            S.confirmBakeWrapPhase    = false;
            S.confirmBakeDrumLoopOpen = false;
            S.confirmBake  = false;
            S.screenDirty  = true;
            return;
        }
        if (S.confirmBakeIsMultiLoop) {
            if (S.confirmBakeSel > 0) {
                /* advance to wrap dialog */
                S.confirmBakeLoops     = [1, 2, 4][S.confirmBakeSel - 1];
                S.confirmBakeWrapPhase = true;
                S.confirmBakeWrapSel   = 1; /* default: NO */
                S.screenDirty = true;
                return;
            }
        } else if (!S.confirmBakeIsDrum) {
            if (S.confirmBakeSel === 0) {
                host_module_set_param('bake', S.confirmBakeTrack + ' ' + S.confirmBakeClip);
                S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
                showActionPopup('BAKED');
                S.pendingBankRefresh = S.confirmBakeTrack;
                S.pendingStepsReread      = 2;
                S.pendingStepsRereadTrack = S.confirmBakeTrack;
                S.pendingStepsRereadClip  = S.confirmBakeClip;
            }
        } else if (S.confirmBakeDrumLoopOpen) {
            /* drum step 2: loop count — 0=CANCEL, 1-3 = 1x/2x/4x → wrap dialog */
            if (S.confirmBakeDrumLoopSel > 0) {
                S.confirmBakeLoops     = [1, 2, 4][S.confirmBakeDrumLoopSel - 1];
                S.confirmBakeWrapPhase = true;
                S.confirmBakeWrapSel   = 1; /* default: NO */
                S.screenDirty = true;
                return;
            }
            S.confirmBakeDrumLoopOpen = false;
            S.confirmBake = false;
            S.screenDirty = true;
            return;
        } else {
            /* drum step 1: 0=CLIP, 1=LANE, 2=CANCEL */
            if (S.confirmBakeSel < 2) {
                S.confirmBakeDrumMode     = S.confirmBakeSel === 0 ? 2 : 1;
                S.confirmBakeDrumLoopOpen = true;
                S.confirmBakeDrumLoopSel  = 1;
                S.screenDirty = true;
                return;
            }
        }
        S.confirmBake = false;
        S.screenDirty = true;
        return;
    }

    /* CC 3 = jog wheel physical click */
    if (d1 === 3 && d2 === 127 && S.tapTempoOpen) {
        closeTapTempo();
        S.screenDirty = true;
        return;
    }
    if (d1 === 3 && d2 === 127 && S.globalMenuOpen) {
        if (S.exportDoneDialog) {            /* OK dismiss */
            S.exportDoneDialog = false;
            S.globalMenuOpen   = false;
            S.screenDirty = true;
            return;
        }
        if (S.confirmClearSession) {
            if (S.confirmClearSel === 0) doClearSession();
            else { S.confirmClearSession = false; }
            S.screenDirty = true;
            return;
        }
        if (S.confirmSaveState) {
            const yes = S.confirmSaveSel === 0;
            S.confirmSaveState = false;
            if (yes) openSaveSnapshot();
            S.screenDirty = true;
            return;
        }
        if (S.confirmConvertToDrum) {
            const _ct = S.confirmConvertTrack;
            const _yes = S.confirmConvertToDrumSel === 0;
            closeConvertConfirm();
            /* Defer to tick() — this runs in the on_midi path where get_param
             * (inside convertTrackType -> syncClipsFromDsp) returns null. */
            if (_yes) S.pendingTrackConvert = { t: _ct, toDrum: true };
            S.screenDirty = true;
            return;
        }
        if (S.confirmConvertToConduct) {
            const _ct  = S.confirmConvertTrack;
            const _yes = S.confirmConvertToConductSel === 0;
            closeConvertConfirm();
            /* Defer to tick() — convertTrackToConduct's role readback uses
             * get_param, which returns null in the on_midi path. */
            if (_yes) S.pendingConductConvert = _ct;
            S.screenDirty = true;
            return;
        }
        if (S.menuInfoLines.length > 0) {
            /* Single-button INFO dialog — any click dismisses. */
            S.menuInfoLines = [];
            S.screenDirty = true;
            return;
        }
        if (S.confirmExportCondPhase) {
            confirmExportCondClick();   /* 0=YES,1=NO commit; 2=CANCEL aborts export */
            S.screenDirty = true;
            return;
        }
        if (S.confirmExport) {
            if (S.confirmExportSel === 0) confirmExportStart();   /* Yes → cond stage or arm export */
            else S.confirmExport = false;
            S.screenDirty = true;
            return;
        }
        if (S.confirmXpose) {                 /* "Transpose all clips?" Yes/No */
            if (S.confirmXposeSel === 0) xposeCommit(S.confirmXposeKey, S.confirmXposeScale);
            else                         xposeCancelPreview();
            S.confirmXpose = false;
            if (S.globalMenuState) { S.globalMenuState.editing = false; S.globalMenuState.editValue = null; }
            S.lastSentMenuEditValue = null; S.bpmWasEditing = false;
            S.screenDirty = true;
            return;
        }
        /* Key/Scale: intercept the click that would finalize the enum edit.
         * No change → exit. Has melodic notes → confirm. Empty → commit silently. */
        {
            const _it = (S.globalMenuState && S.globalMenuItems)
                        ? S.globalMenuItems[S.globalMenuState.selectedIndex] : null;
            if (_it && S.globalMenuState.editing && (_it.label === 'Key' || _it.label === 'Scale')) {
                const ev    = S.globalMenuState.editValue !== null ? S.globalMenuState.editValue : _it.get();
                const candK = _it.label === 'Key'   ? ev : S.padKey;
                const candS = _it.label === 'Scale' ? ev : S.padScale;
                if (candK === S.padKey && candS === S.padScale) {
                    xposeCancelPreview();
                    S.globalMenuState.editing = false; S.globalMenuState.editValue = null;
                    S.lastSentMenuEditValue = null; S.bpmWasEditing = false;
                } else if (anyMelodicClipHasContent()) {
                    S.confirmXpose = true; S.confirmXposeSel = 0;
                    S.confirmXposeKey = candK; S.confirmXposeScale = candS;
                    /* keep editing + preview armed under the dialog */
                } else {
                    xposeCommit(candK, candS);
                    S.globalMenuState.editing = false; S.globalMenuState.editValue = null;
                    S.lastSentMenuEditValue = null; S.bpmWasEditing = false;
                }
                S.screenDirty = true;
                return;
            }
        }
        /* Mode (track type): DEFERRED COMMIT. The click that finalizes the Mode
         * edit triggers the conversion confirm; scrolling never does (Mode set()
         * is a no-op). No change → exit. Mirrors the Key/Scale interceptor. */
        {
            const _mi = (S.globalMenuState && S.globalMenuItems)
                        ? S.globalMenuItems[S.globalMenuState.selectedIndex] : null;
            if (_mi && S.globalMenuState.editing && _mi.label === 'Mode') {
                const t      = S.activeTrack;
                const target = S.globalMenuState.editValue !== null ? S.globalMenuState.editValue : _mi.get();
                const cur    = S.trackPadMode[t];
                S.globalMenuState.editing = false; S.globalMenuState.editValue = null;
                S.lastSentMenuEditValue = null; S.bpmWasEditing = false;
                if (target !== cur) {
                    if (S.playing) {
                        showMenuInfo('Stop playback', 'to change the', 'track type.');
                        S.screenDirty = true;
                        return;
                    }
                    if (target === PAD_MODE_DRUM) {
                        /* Keys/Cond -> Drums: confirm only if notes would be lost. */
                        let hasData = false;
                        for (let c = 0; c < NUM_CLIPS; c++)
                            if (S.clipNonEmpty[t][c]) { hasData = true; break; }
                        if (hasData) {
                            S.confirmConvertToDrum = true; S.confirmConvertToDrumSel = 1;
                            S.confirmConvertTrack = t;
                        } else {
                            S.pendingTrackConvert = { t: t, toDrum: true };
                        }
                    } else if (target === PAD_MODE_CONDUCT) {
                        /* Pre-empt the common case: a Conductor already exists on
                         * a DIFFERENT track. DSP would refuse, and the action
                         * popup is invisible while the menu is open. Show the
                         * menu-visible info dialog instead of confirming/sending. */
                        const existingCond = conductorTrackIdx();
                        if (existingCond >= 0 && existingCond !== t) {
                            showMenuInfo('Conductor exists', 'on T' + (existingCond + 1) + '.', 'Route it back first.');
                        } else {
                            /* Keys/Drums -> Conductor: always confirm (keeps notes,
                             * clears FX/ARP/Auto; DSP enforces one Conductor). */
                            S.confirmConvertToConduct = true; S.confirmConvertToConductSel = 1;
                            S.confirmConvertTrack = t;
                        }
                    } else {
                        /* Drums/Conductor -> Keys: no prompt; defer to tick(). */
                        if (S.conductorTrack === t) S.conductorTrack = -1;
                        S.pendingTrackConvert = { t: t, toDrum: false };
                    }
                }
                S.screenDirty = true;
                return;
            }
        }
        handleMenuInput({
            cc: 3, value: d2,
            items: S.globalMenuItems, state: S.globalMenuState, stack: S.globalMenuStack,
            onBack: function() { S.globalMenuOpen = false; },
            shiftHeld: S.shiftHeld
        });
        S.screenDirty = true;
        return;
    }

    if (d1 === 3 && d2 === 127 && S.shiftHeld && S.deleteHeld && !S.sessionView) {
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            /* Drum: Shift+Delete+jog = reset all real-time FX banks + Dir/RvSt/SqFl */
            const _dt = S.activeTrack, _dl = S.activeDrumLane[_dt], _dac = effectiveClip(_dt);
            resetFxBanks(_dt);
            S.drumLanePlaybackDir[_dt][_dl] = 0;
            S.drumLanePlaybackAudioReverse[_dt][_dl] = 0;
            S.bankParams[_dt][0][6] = 0;
            S.clipSeqFollow[_dt][_dac] = true;
            S.bankParams[_dt][0][7] = 1;
            S.pendingDefaultSetParams.push({ key: 't' + _dt + '_l' + _dl + '_playback_dir', val: '0' });
            S.pendingDefaultSetParams.push({ key: 't' + _dt + '_l' + _dl + '_playback_audio_reverse', val: '0' });
            showActionPopup('LANE PARAMS', 'RESET');
        } else {
            /* Melodic: full reset — NOTE FX, HARMZ, MIDI DLY, + SEQ ARP */
            const _arpTrack = S.activeTrack;
            const _arpParams = Array.from({length: 8}, function(_, k) {
                const pm = BANKS[4].knobs[k]; return pm ? S.bankParams[_arpTrack][4][k] : 0;
            });
            resetFxBanks(_arpTrack);
            for (let k = 0; k < 8; k++) {
                const pm = BANKS[4].knobs[k];
                if (pm) S.bankParams[_arpTrack][4][k] = pm.def;
            }
            /* Bank reset also clears ALL automation (CC + AT, + PB later) for the clip. */
            const _ac2 = effectiveClip(_arpTrack);
            S.trackCCAutoBits[_arpTrack][_ac2] = 0;
            S.trackCCLiveVal[_arpTrack] = new Array(8).fill(-1);
            S.clipCCVal[_arpTrack][_ac2] = new Array(8).fill(-1);
            S.clipAtHas[_arpTrack][_ac2] = false;
            S.pendingDefaultSetParams.push({ key: 't' + _arpTrack + '_cc_auto_clear', val: String(_ac2) });
            S.pendingDefaultSetParams.push({ key: 't' + _arpTrack + '_c' + _ac2 + '_at_clear', val: '1' });
            S.undoSeqArpSnapshot = { track: _arpTrack, params: _arpParams };
            const _mac = effectiveClip(_arpTrack);
            S.clipPlaybackDir[_arpTrack][_mac] = 0;
            S.clipPlaybackAudioReverse[_arpTrack][_mac] = 0;
            S.bankParams[_arpTrack][0][6] = 0;
            S.clipSeqFollow[_arpTrack][_mac] = true;
            S.bankParams[_arpTrack][0][7] = 1;
            S.pendingDefaultSetParams.push({ key: 't' + _arpTrack + '_clip_playback_dir', val: '0' });
            S.pendingDefaultSetParams.push({ key: 't' + _arpTrack + '_clip_playback_audio_reverse', val: '0' });
            showActionPopup('CLIP PARAMS', 'RESET');
        }
        return;
    }
    if (d1 === 3 && d2 === 127 && S.deleteHeld && !S.sessionView) {
        /* CC PARAM bank (bank 6): Delete+jog clears all CC automation for the
         * active clip. This branch must run regardless of pad mode or drum
         * perform mode — previously it was nested inside the melodic branch,
         * so on a drum track in Rpt mode it was silently shadowed by the
         * repeat-groove reset path. */
        if (S.activeBank === 6) {
            /* AUTOMATION bank: Delete+jog clears ALL automation types for the
             * active clip (CC + AT, and PB once implemented). */
            const _t = S.activeTrack, _c = effectiveClip(_t);
            S.trackCCAutoBits[_t][_c] = 0;
            S.trackCCLiveVal[_t] = new Array(8).fill(-1);
            /* Reset the resting values too → "—" (cc_auto_clear clears both
             * automation and rest_val DSP-side). */
            S.clipCCVal[_t][_c] = new Array(8).fill(-1);
            S.clipAtHas[_t][_c] = false;
            /* Defer clear pushes — synchronous from jog handler coalesces. */
            S.pendingDefaultSetParams.push({ key: 't' + _t + '_cc_auto_clear', val: String(_c) });
            S.pendingDefaultSetParams.push({ key: 't' + _t + '_c' + _c + '_at_clear', val: '1' });
            showActionPopup('AUTOMATION', 'CLEAR');
            invalidateLEDCache();
            return;
        }
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            if (S.drumPerformMode[S.activeTrack] > 0) {
                /* Rpt/Rpt2 mode: Delete+jog = reset current lane groove params */
                const _rt = S.activeTrack;
                const _rl = S.activeDrumLane[_rt];
                S.drumRepeatGate[_rt][_rl]    = 0xFF;
                S.drumRepeatGateLen[_rt][_rl] = 8;
                for (let _s = 0; _s < 8; _s++) {
                    S.drumRepeatVelScale[_rt][_rl][_s] = 100;
                    S.drumRepeatNudge[_rt][_rl][_s]    = 0;
                }
                /* Defer reset push — synchronous from jog handler coalesces. */
                S.pendingDefaultSetParams.push({ key: 't' + _rt + '_l' + _rl + '_repeat_groove_reset', val: '1' });
                showActionPopup('RPT GROOVE', 'RESET');
            } else {
                /* Drum: Delete+jog = reset only the active real-time FX bank + Dir/RvSt/SqFl */
                const REAL_TIME_BANKS = [1, 2, 3];
                if (REAL_TIME_BANKS.indexOf(S.activeBank) >= 0) {
                    resetSingleFxBank(S.activeTrack, S.activeBank);
                }
                const _bt = S.activeTrack, _bl = S.activeDrumLane[_bt], _bac = effectiveClip(_bt);
                S.drumLanePlaybackDir[_bt][_bl] = 0;
                S.drumLanePlaybackAudioReverse[_bt][_bl] = 0;
                S.bankParams[_bt][0][6] = 0;
                S.clipSeqFollow[_bt][_bac] = true;
                S.bankParams[_bt][0][7] = 1;
                S.pendingDefaultSetParams.push({ key: 't' + _bt + '_l' + _bl + '_playback_dir', val: '0' });
                S.pendingDefaultSetParams.push({ key: 't' + _bt + '_l' + _bl + '_playback_audio_reverse', val: '0' });
                showActionPopup('BANK RESET');
            }
        } else if (S.activeBank === 5) {
            /* ARP IN bank: dedicated reset that clears every TARP param
             * (style/rate/oct/gate/steps_mode/retrigger/latch/sync + step arrays
             * + loop length). Shift+Delete+jog (above) intentionally leaves
             * ARP IN alone. */
            resetTarp(S.activeTrack);
            showActionPopup('ARP IN', 'RESET');
        } else {
            const _mt = S.activeTrack, _mac2 = effectiveClip(_mt);
            resetFxBanks(_mt);
            S.undoSeqArpSnapshot = null;
            S.clipPlaybackDir[_mt][_mac2] = 0;
            S.clipPlaybackAudioReverse[_mt][_mac2] = 0;
            S.bankParams[_mt][0][6] = 0;
            S.clipSeqFollow[_mt][_mac2] = true;
            S.bankParams[_mt][0][7] = 1;
            S.pendingDefaultSetParams.push({ key: 't' + _mt + '_clip_playback_dir', val: '0' });
            S.pendingDefaultSetParams.push({ key: 't' + _mt + '_clip_playback_audio_reverse', val: '0' });
            showActionPopup('BANK RESET');
        }
        return;
    }
    /* Plain jog click on SEQ ARP (bank 4) or TARP (bank 5) in Track View toggles
     * the Arp Steps interval-edit overlay: knobs K1-K8 become per-step scale-degree
     * offsets (±24), pad grid is the persistent step-vel level editor. Auto-clears
     * on next jog turn (handled in the main-knob delta branch below). */
    if (d1 === 3 && d2 === 127 && !S.shiftHeld && !S.deleteHeld && !S.copyHeld && !S.muteHeld &&
            !S.sessionView && S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM &&
            (S.activeBank === 4 || S.activeBank === 5)) {
        S.stepIntervalMode = !S.stepIntervalMode;
        /* Repush padmap so pads stop dispatching notes while the overlay is on. */
        computePadNoteMap();
        S.screenDirty = true;
        forceRedraw();
        return;
    }
    /* Plain jog click on an alt-param bank: toggle sticky alt-param mode.
     * Perform-mode switching now lives only on Shift+step-8 (see _onStepButtons).
     * The Arp-Steps block above is gated melodic-only, so on drum tracks bank 5
     * (REPEAT GROOVE) correctly falls through here to toggle VEL/NUDGE. */
    if (d1 === 3 && d2 === 127 && !S.shiftHeld && !S.deleteHeld && !S.copyHeld && !S.muteHeld &&
            !S.sessionView && bankHasAltParams(S.activeTrack, S.activeBank)) {
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7 && !S.allLanesConfirmed) {
            S.allLanesConfirmed = true;
            S.screenDirty = true;
            forceRedraw();
            return;
        }
        S.altMode = !S.altMode;
        S.screenDirty = true;
        forceRedraw();
        return;
    }

    if (d1 === MoveMainKnob) {

        /* Arp Steps interval mode: jog turn exits the overlay and swallows
         * the turn so the underlying bank knob param isn't nudged on exit. */
        if (S.stepIntervalMode) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                S.stepIntervalMode = false;
                computePadNoteMap();
                S.screenDirty = true;
                forceRedraw();
            }
            return;
        }

        if (S.pendingInheritPicker) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                const p = S.pendingInheritPicker;
                const total = p.candidates.length + 1;
                p.selectedIndex = (p.selectedIndex + (delta > 0 ? 1 : total - 1)) % total;
                S.screenDirty = true;
            }
            return;
        }
        if (S.snapshotPicker) {
            snapshotPickerRotate(decodeDelta(d2));
            return;
        }
        if (S.clearAutoMenu) {
            clearAutoMenuRotate(decodeDelta(d2));
            return;
        }
        if (S.confirmBakeScene) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                if (S.confirmBakeSceneCondPhase)
                    S.confirmBakeSceneCondSel = (S.confirmBakeSceneCondSel + (delta > 0 ? 1 : 2)) % 3;
                else if (S.confirmBakeSceneWrapPhase)
                    S.confirmBakeSceneWrapSel = (S.confirmBakeSceneWrapSel + (delta > 0 ? 1 : 2)) % 3;
                else
                    S.confirmBakeSceneSel = (S.confirmBakeSceneSel + (delta > 0 ? 1 : 3)) % 4;
                S.screenDirty = true;
            }
            return;
        }
        if (S.confirmStateWipe) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                S.confirmStateWipeSel = S.confirmStateWipeSel === 0 ? 1 : 0;
                S.screenDirty = true;
            }
            return;
        }
        if (S.recordBlockedDialog) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                S.recordBlockedDialogSel = S.recordBlockedDialogSel === 0 ? 1 : 0;
                S.screenDirty = true;
            }
            return;
        }
        if (S.confirmLgto) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                S.confirmLgtoSel = S.confirmLgtoSel === 0 ? 1 : 0;
                S.screenDirty = true;
            }
            return;
        }
        if (S.confirmBake && S.confirmBakeWrapPhase) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                S.confirmBakeWrapSel = (S.confirmBakeWrapSel + (delta > 0 ? 1 : 2)) % 3;
                S.screenDirty = true;
            }
            return;
        }
        if (S.confirmBake && S.confirmBakeIsDrum && S.confirmBakeDrumLoopOpen) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                S.confirmBakeDrumLoopSel = (S.confirmBakeDrumLoopSel + (delta > 0 ? 1 : 3)) % 4;
                S.screenDirty = true;
            }
            return;
        }
        if (S.confirmBake) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                if (S.confirmBakeIsDrum) {
                    S.confirmBakeSel = (S.confirmBakeSel + (delta > 0 ? 1 : 2)) % 3;
                } else if (S.confirmBakeIsMultiLoop) {
                    S.confirmBakeSel = (S.confirmBakeSel + (delta > 0 ? 1 : 3)) % 4;
                } else {
                    S.confirmBakeSel = S.confirmBakeSel === 0 ? 1 : 0;
                }
                S.screenDirty = true;
            }
            return;
        }
        if (S.tapTempoOpen && !S.shiftHeld) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                S.tapTempoBpm = Math.max(40, Math.min(250, S.tapTempoBpm + delta));
                host_module_set_param('bpm', String(S.tapTempoBpm));
                S.screenDirty = true;
            }
            return;
        }
        if (S.globalMenuOpen && !S.shiftHeld) {
            ensureGlobalMenuFresh();
            if (S.exportDoneDialog) {
                /* single OK button — jog does nothing */
            } else if (S.confirmClearSession) {
                const delta = decodeDelta(d2);
                if (delta !== 0) { S.confirmClearSel = S.confirmClearSel === 0 ? 1 : 0; S.screenDirty = true; }
            } else if (S.confirmSaveState) {
                const delta = decodeDelta(d2);
                if (delta !== 0) { S.confirmSaveSel = S.confirmSaveSel === 0 ? 1 : 0; S.screenDirty = true; }
            } else if (S.confirmConvertToDrum) {
                const delta = decodeDelta(d2);
                if (delta !== 0) { S.confirmConvertToDrumSel = S.confirmConvertToDrumSel === 0 ? 1 : 0; S.screenDirty = true; }
            } else if (S.confirmConvertToConduct) {
                const delta = decodeDelta(d2);
                if (delta !== 0) { S.confirmConvertToConductSel = S.confirmConvertToConductSel === 0 ? 1 : 0; S.screenDirty = true; }
            } else if (S.menuInfoLines.length > 0) {
                /* Single-button INFO dialog — no selection to toggle; swallow jog turns. */
            } else if (S.confirmExportCondPhase) {
                const delta = decodeDelta(d2);
                if (delta !== 0) { S.confirmExportCondSel = (S.confirmExportCondSel + (delta > 0 ? 1 : 2)) % 3; S.screenDirty = true; }
            } else if (S.confirmExport) {
                const delta = decodeDelta(d2);
                if (delta !== 0) { S.confirmExportSel = S.confirmExportSel === 0 ? 1 : 0; S.screenDirty = true; }
            } else if (S.confirmXpose) {
                const delta = decodeDelta(d2);
                if (delta !== 0) { S.confirmXposeSel = S.confirmXposeSel === 0 ? 1 : 0; S.screenDirty = true; }
            } else if (S.globalMenuState.editing) {
                const delta = decodeDelta(d2);
                if (delta !== 0) {
                    const item = S.globalMenuItems[S.globalMenuState.selectedIndex];
                    if (item && item.type === 'value') {
                        const cur = S.globalMenuState.editValue !== null ? S.globalMenuState.editValue : item.get();
                        S.globalMenuState.editValue = Math.min(item.max, Math.max(item.min, cur + delta));
                    } else if (item && item.type === 'enum') {
                        const opts = item.options || [];
                        const idx  = opts.indexOf(S.globalMenuState.editValue);
                        const sign = delta > 0 ? 1 : -1;
                        S.globalMenuState.editValue = opts[((idx + sign) % opts.length + opts.length) % opts.length];
                    }
                    S.screenDirty = true;
                }
            } else {
                handleMenuInput({
                    cc: MoveMainKnob, value: d2,
                    items: S.globalMenuItems, state: S.globalMenuState, stack: S.globalMenuStack,
                    onBack: function() { S.globalMenuOpen = false; },
                    shiftHeld: false
                });
                S.screenDirty = true;
            }
        } else {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                if (S.shiftHeld) {
                    /* Shift + jog (any view): step active track 0–7, clamp at ends */
                    const next = Math.min(NUM_TRACKS - 1, Math.max(0, S.activeTrack + delta));
                    if (next !== S.activeTrack) {
                        extNoteOffAll();
                        handoffRecordingToTrack(next);
                        _switchActiveTrack(next);
                        if (S.trackPadMode[next] === PAD_MODE_DRUM) {
                            if (S.activeBank === 2 || S.activeBank === 4) S.activeBank = 0;
                            resyncDrumTrack(next);
                        } else {
                            if (S.activeBank === 7) S.activeBank = 0;
                            refreshPerClipBankParams(next);
                        }
                        computePadNoteMap();
                        S.seqActiveNotes.clear();
                        S.seqLastStep = -1;
                        S.seqLastClip = -1;
                        forceRedraw();
                    }
                } else if (S.sessionView) {
                    S.sceneRow = Math.min(NUM_CLIPS - 4, Math.max(0, S.sceneRow + delta));
                    forceRedraw();
                } else if (S.loopHeld) {
                    /* Track View + Loop held: adjust length ±1 step */
                    const _t  = S.activeTrack;
                    if (S.recordArmed && !S.recordCountingIn) {
                        /* Block length changes during active recording */
                    } else if (S.trackPadMode[_t] === PAD_MODE_DRUM) {
                        if (allLanesGate()) return;
                        /* Drum: adjust length. In ALL LANES bank, length applies to all 32
                         * lanes atomically; in per-lane DRUM bank, just the active lane. */
                        const _lane = S.activeDrumLane[_t];
                        const _cur  = S.drumLaneLength[_t];
                        const _nv   = Math.max(1, Math.min(256, _cur + delta));
                        if (_nv !== _cur) {
                            S.drumLaneLength[_t] = _nv;
                            S.drumLaneLengthManuallySet[_t] = true;
                            /* Boundary page is window-aware: last absolute step is
                             * loop_start + length - 1, so the page containing it is
                             * floor((loop_start + length - 1) / 16). */
                            const _ls = S.drumLaneLoopStart[_t] | 0;
                            const _maxPage = Math.max(0, Math.floor((_ls + _nv - 1) / 16));
                            /* Show OOB step view in both modes — navigate to boundary page
                             * so the step-level OOB greying renders. */
                            S.loopJogActive = true;
                            S.loopJogLastTick = S.tickCount;
                            S.drumStepPage[_t] = _maxPage;
                            if (typeof host_module_set_param === 'function') {
                                if (S.activeBank === 7) {
                                    host_module_set_param('t' + _t + '_all_lanes_length', String(_nv));
                                } else {
                                    host_module_set_param('t' + _t + '_l' + _lane + '_clip_length', String(_nv));
                                }
                            }
                            forceRedraw();
                        }
                    } else if (S.activeBank === 6) {
                        var _ac = effectiveClip(_t);
                        var _ccL = S.ccActiveLane[_t];
                        var _cur = S.ccLaneLength[_t][_ac][_ccL];
                        if (_cur === 0) {
                            var _cTps = S.clipTPS[_t][_ac] || 24;
                            var _lTps = S.ccLaneTps[_t][_ac][_ccL] || _cTps;
                            _cur = Math.max(1, Math.round(S.clipLength[_t][_ac] * _cTps / _lTps));
                        }
                        var _nv  = Math.max(1, Math.min(256, _cur + delta));
                        if (_nv !== _cur) {
                            S.ccLaneLength[_t][_ac][_ccL] = _nv;
                            S.loopJogActive = true;
                            S.loopJogLastTick = S.tickCount;
                            var _ls = S.ccLaneLoopStart[_t][_ac][_ccL] | 0;
                            S.trackCurrentPage[_t] = Math.max(0, Math.floor((_ls + _nv - 1) / 16));
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + _t + '_c' + _ac + '_k' + _ccL + '_cc_lane_length', String(_nv));
                            forceRedraw();
                        }
                    } else {
                    const _ac = effectiveClip(_t);
                    const _cur = S.clipLength[_t][_ac];
                    const _nv  = Math.max(1, Math.min(256, _cur + delta));
                    if (_nv !== _cur) {
                        S.clipLength[_t][_ac] = _nv;
                        S.clipLengthManuallySet[_t][_ac] = true;
                        /* Show OOB step view: navigate to boundary page (window-aware) */
                        S.loopJogActive = true;
                        S.loopJogLastTick = S.tickCount;
                        const _ls = S.clipLoopStart[_t][_ac] | 0;
                        S.trackCurrentPage[_t] = Math.max(0, Math.floor((_ls + _nv - 1) / 16));
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + _t + '_clip_length', String(_nv));
                        forceRedraw();
                    }
                    }
                } else {
                    const cur = S.activeBank;
                    const isDrumJog = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM;
                    const isConductJog = S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT;
                    let next;
                    if (isConductJog) {
                        /* Conductor cycles 5 banks: Conduct(0=CLIP) → NOTE FX(1) → Responder → Octave → When */
                        const CONDUCT_BANK_ORDER = [0, 1, BANK_RESPONDER, BANK_OCTAVE, BANK_WHEN];
                        const ci = CONDUCT_BANK_ORDER.indexOf(cur);
                        const ni = Math.max(0, Math.min(CONDUCT_BANK_ORDER.length - 1, (ci >= 0 ? ci : 0) + delta));
                        next = CONDUCT_BANK_ORDER[ni];
                    } else if (isDrumJog) {
                        /* Drum bank order: ALL LANES(7) → DRUM LANE(0) → NOTE FX(1) → MIDI DLY(3) → RPT GROOVE(5) → CC PARAM(6) */
                        const DRUM_BANK_ORDER = [7, 0, 1, 3, 5, 6];
                        const ci = DRUM_BANK_ORDER.indexOf(cur);
                        const ni = Math.max(0, Math.min(DRUM_BANK_ORDER.length - 1, (ci >= 0 ? ci : 0) + delta));
                        next = DRUM_BANK_ORDER[ni];
                    } else {
                        next = Math.min(6, Math.max(0, cur + delta));
                    }
                    if (next !== cur) {
                        S.activeBank = next;
                        S.trackActiveBank[S.activeTrack] = next;
                        if (next === 7) S.allLanesConfirmed = false;
                        if (next === 6) S.schLabelFetchLane = 0;
                        readBankParams(S.activeTrack, next);
                        S.bankSelectTick = S.tickCount;
                        writeSidecar();
                        forceRedraw();
                    }
                }
            }
        }
        return;
    }

}

function _onCC_buttons(d1, d2) {
    if (d1 === MoveShift) {
        S.shiftHeld = d2 === 127;
        S.shiftTrackLEDActive = d2 === 127;
        /* PHASE-1: re-push padmap on Shift transitions so DSP on_midi sees
         * all-0xFF while Shift is held (suppress pad-shortcut notes) and
         * the real map again on release. See computePadNoteMap mute logic. */
        computePadNoteMap();
        /* Shift in Track View is a track-switch modifier (Shift+jog / Shift+pad),
         * not a param gesture. Cancel any transient param-bank display on BOTH
         * Shift edges so the OLED stays on the track overview while switching —
         * the usual gesture touches the jog (jogTouched→bank view) before pressing
         * Shift, and Shift-press never cleared it before. Mirrors the jog-release
         * clear in the MoveMainTouch handler. */
        if (!S.sessionView) { S.jogTouched = false; S.bankSelectTick = -1; }
        /* Deferred Shift+Step3 dispatch: fire on Shift release so the Shift
         * held state doesn't leak into Move firmware / Schwung chain editor. */
        if (!S.shiftHeld && S.pendingEditEntryTrack >= 0) {
            const _t = S.pendingEditEntryTrack;
            S.pendingEditEntryTrack = -1;
            if (S.trackRoute[_t] === 1 &&
                typeof shadow_corun_begin === 'function' &&
                typeof move_midi_inject_to_move === 'function') {
                enterMoveNativeCoRun(_t);
            } else if (S.trackRoute[_t] === 0 &&
                typeof shadow_corun_begin === 'function') {
                openSchwungSlotEditor(_t);
            }
        }
        if (!S.sessionView) forceRedraw();
    }

    /* Any non-Shift CC button press while Shift overlay is active clears the overlay */
    if (d1 !== MoveShift && d2 === 127 && S.shiftTrackLEDActive) {
        S.shiftTrackLEDActive = false;
    }

    if (d1 === MoveDelete) {
        S.deleteHeld = d2 === 127;
        /* Loop+Delete on auto bank: reset active lane's loop params */
        if (d2 === 127 && S.loopHeld && S.activeBank === 6 && !S.sessionView) {
            var _rdt = S.activeTrack, _rdac = effectiveClip(_rdt), _rdl = S.ccActiveLane[_rdt];
            S.ccLaneLoopStart[_rdt][_rdac][_rdl] = 0;
            S.ccLaneLength[_rdt][_rdac][_rdl] = 0;
            S.ccLaneTps[_rdt][_rdac][_rdl] = 0;
            S.ccLaneResTps[_rdt][_rdac][_rdl] = 0;
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
            S.pendingDefaultSetParams.push({ key: 't' + _rdt + '_c' + _rdac + '_k' + _rdl + '_cc_lane_reset', val: '1' });
            showActionPopup('LANE LOOP', 'RESET');
            forceRedraw();
            computePadNoteMap();
            return;
        }
        /* AUTO-bank Delete-tap → CLEAR AUTOMATION menu. Arm on press (melodic
         * AUTO bank only); a clean release (nothing happened while held, see the
         * disqualify check at the top of this handler) opens the menu. */
        if (d2 === 127) {
            S.deleteTapArmed = (S.activeBank === 6 && !S.sessionView &&
                                !S.clearAutoMenu);
        } else if (S.deleteTapArmed) {
            S.deleteTapArmed = false;
            openClearAutoMenu();
        }
        /* delete_held now rides as the 34th token in the tN_padmap payload
         * (computePadNoteMap), so it shares the tick-based self-heal and
         * avoids the onMidiMessage coalescing risk the old separate
         * t0_delete_held push had. */
        computePadNoteMap();
    }

    if (d1 === MoveCopy) {
        S.copyHeld = d2 === 127;
        if (!S.copyHeld) {
            S.copySrc = null;
            invalidateLEDCache();
        }
        computePadNoteMap();
    }

    if (d1 === MoveMute) {
        /* Schwung chain-edit co-run: Mute is the host-side slot-bypass modifier
         * (Mute + jog-click bypasses the focused chain component, handled in
         * shadow_ui). Cede it entirely — dAVEBOx ignores Mute as its own
         * track-mute modifier while chain-edit co-running, so it never holds a
         * muteHeld state that would re-fire its own mute gestures. */
        if (S.schwungCoRunSlot >= 0) {
            S.muteHeld = false;
        } else {
            S.muteHeld = d2 === 127;
            if (d2 === 127) S.muteUsedAsModifier = false;
            if (S.sessionView) invalidateLEDCache();
            computePadNoteMap();
        }
    }

    if (d1 === MoveCapture) {
        if (d2 === 127) {
            S.captureHeld           = true;
            S.captureUsedAsModifier = false;
            /* Press also cancels in-flight dialogs/pickers/merge — symmetric
             * with Sample's press behavior. */
            if (S.pendingSceneBakePicker) { S.pendingSceneBakePicker = false; S.captureUsedAsModifier = true; }
            if (S.pendingMergePlacement)  {
                S.pendingMergePlacement = false;
                S.captureUsedAsModifier = true;
                S.pendingDefaultSetParams.push({ key: 'merge_cancel', val: '1' });
            }
            if (S.confirmBake)            { S.confirmBake            = false; S.captureUsedAsModifier = true;
                                            S.confirmBakeDrumLoopOpen = false; S.confirmBakeWrapPhase = false; }
            if (S.confirmBakeScene)       { S.confirmBakeScene       = false; S.captureUsedAsModifier = true; }
            computePadNoteMap();
            forceRedraw();
        } else {
            S.captureHeld = false;
            /* Bare-tap release: open clip-bake (Track View) or scene-bake picker
             * (Session View). Suppressed when Capture was used as a modifier
             * (scene capture via Capture+row, drum-lane select via Capture+pad). */
            if (!S.captureUsedAsModifier) {
                if (S.sessionView) {
                    S.pendingSceneBakePicker = true;
                    S.screenDirty = true;
                } else {
                    const _bt = S.activeTrack, _bc = S.trackActiveClip[_bt];
                    const _isDrum = S.trackPadMode[_bt] === PAD_MODE_DRUM;
                    S.confirmBake             = true;
                    S.confirmBakeIsDrum       = _isDrum;
                    S.confirmBakeIsMultiLoop  = !_isDrum;
                    S.confirmBakeSel          = _isDrum ? 2 : 1;
                    S.confirmBakeTrack        = _bt;
                    S.confirmBakeClip         = _bc;
                    S.confirmBakeDrumLoopOpen = false;
                    S.confirmBakeWrapPhase    = false;
                    S.screenDirty             = true;
                }
            }
            computePadNoteMap();
            forceRedraw();
        }
        return;
    }

    /* Move's Menu button (CC 50) is in CORUN_KEEP_DEFAULT so the shim routes
     * it to us during co-run. Charles's framework reserves Back as the
     * canonical exit, but Menu-as-second-exit is a dAVEBOx convenience for
     * existing muscle memory — outside co-run dAVEBOx ignores Menu (no other
     * handler exists), so this branch is dormant unless a session is active. */
    if (d1 === 50 && d2 === 127) {
        /* Schwung co-run exits on Menu. Move co-run disables Menu entirely —
         * swallowed by the guard in the MoveNoteSession block below. */
        if (S.schwungCoRunSlot >= 0) {
            exitSchwungCoRun();
            forceRedraw();
            return;
        }
    }

    /* Note/Session view toggle: Shift+press = open global menu (Track View only);
     * tap = switch view; hold = session overview */
    if (d1 === MoveNoteSession) {
        /* Move co-run: Menu button is disabled — swallow press and release so it
         * neither exits co-run nor toggles the view. Step 3 / Back are the exits. */
        if (S.moveCoRunTrack >= 0) {
            /* Move co-run: Note/Session opens an FX screen as an overlay over the
             * Move synth — this fork's fx_picker where available, else the stock
             * master_fx (see the coRunOverlayScreen probe in pollDSP). corun target
             * stays MOVE_NATIVE, so pollDSP does NOT tear down — Back returns to the
             * synth. No addressable screen (older Schwung): swallow as before. */
            if (d2 === 127 && S.coRunOverlayScreen && typeof shadow_corun_open === 'function') {
                shadow_corun_open(S.coRunOverlayScreen, DAVEBOX_PICKER_KEEP_MASK);
            }
            return;
        }
        if (d2 === 127) {
            /* Co-run exit is the framework's job now — the shim catches Back
             * during corun_active() and calls shadow_corun_end() itself, and
             * pollDSP picks up target=NONE on the next frame and runs
             * exitMoveNativeCoRun()/exitSchwungCoRun() for the JS cleanup.
             * No Menu intercept needed here. */
            if (S.snapshotPicker) {
                /* Back out of a confirm to the list, else close the picker. */
                if (S.snapshotPicker.confirm) S.snapshotPicker.confirm = null;
                else closeSnapshotPicker();
                forceRedraw();
                return;
            }
            if (S.shiftHeld) {
                if (S.globalMenuOpen) { S.globalMenuOpen = false; forceRedraw(); }
                else { openGlobalMenu(); }
            } else if (S.tapTempoOpen) {
                closeTapTempo();
                forceRedraw();
            } else if (S.confirmStateWipe) {
                S.confirmStateWipe = false;
                removeFlagsWrap();
                clearAllLEDs();
                if (typeof host_exit_module === 'function') host_exit_module();
                forceRedraw();
            } else if (S.bpmMoveInfo) {
                S.bpmMoveInfo = false;
                forceRedraw();
            } else if (S.recordBlockedDialog) {
                S.recordBlockedDialog = false;
                forceRedraw();
            } else if (S.confirmLgto) {
                S.confirmLgto = false;
                forceRedraw();
            } else if (S.confirmBake) {
                S.confirmBake          = false;
                S.confirmBakeWrapPhase = false;
                forceRedraw();
            } else if (S.globalMenuOpen && S.confirmClearSession) {
                S.confirmClearSession = false;
                forceRedraw();
            } else if (S.globalMenuOpen && S.confirmSaveState) {
                S.confirmSaveState = false;
                forceRedraw();
            } else if (S.globalMenuOpen && S.confirmConvertToDrum) {
                closeConvertConfirm();
                forceRedraw();
            } else if (S.globalMenuOpen && S.confirmConvertToConduct) {
                closeConvertConfirm();
                forceRedraw();
            } else if (S.globalMenuOpen && S.menuInfoLines.length > 0) {
                S.menuInfoLines = [];
                forceRedraw();
            } else if (S.globalMenuOpen && S.exportDoneDialog) {
                S.exportDoneDialog = false;
                S.globalMenuOpen   = false;
                forceRedraw();
            } else if (S.globalMenuOpen && S.confirmExportCondPhase) {
                S.confirmExportCondPhase = false;   /* Back from cond stage aborts export */
                forceRedraw();
            } else if (S.globalMenuOpen && S.confirmExport) {
                S.confirmExport = false;
                forceRedraw();
            } else if (S.globalMenuOpen) {
                S.globalMenuOpen = false;
                S.lastSentMenuEditValue = null;
                forceRedraw();
            } else if (S.stepIntervalMode && !S.sessionView) {
                /* Arp Steps overlay: Note/Session exits the overlay without switching view. */
                S.stepIntervalMode = false;
                computePadNoteMap();
                forceRedraw();
            } else {
                /* Switch immediately (like Loop entering perf); tap vs hold resolved on release */
                S.noteSessionPressedTick = S.tickCount;
                S.sessionViewMomentary   = true;
                S.sessionView            = !S.sessionView;
                _switchViewCleanup();
                invalidateLEDCache();
                S.screenDirty = true;
            }
        } else if (d2 === 0) {
            if (S.noteSessionPressedTick >= 0 &&
                    (S.tickCount - S.noteSessionPressedTick) < NOTE_SESSION_HOLD_TICKS) {
                /* Tap release: make permanent (don't switch back) */
                S.sessionViewMomentary = false;
            } else if (S.sessionViewMomentary) {
                /* Hold release: switch back to original view */
                S.sessionViewMomentary = false;
                S.sessionView          = !S.sessionView;
                _switchViewCleanup();
                invalidateLEDCache();
                forceRedraw();
            }
            S.noteSessionPressedTick = -1;
        }
    }

    /* Loop button (CC 58, Session View): enter/exit Performance Mode.
     * Pad presses in Perf Mode drive rate capture + modifier engage.
     * Double-tap locks the view after Loop is released. */
    if (d1 === MoveLoop && S.sessionView) {
        if (d2 === 127) {
            if (S.shiftHeld) {
                /* Shift+Loop: toggle perf latch mode (mod pads momentary vs sticky). */
                S.perfLatchMode = !S.perfLatchMode;
                forceRedraw();
                return;
            }
            S.loopPressTick = S.tickCount;
            S.loopHeld      = true;
            forceRedraw();
            return;
        }
        const heldDuration = S.tickCount - S.loopPressTick;
        const wasTap       = heldDuration < LOOP_TAP_TICKS;

        if (S.perfViewLocked) {
            /* Locked + tap → unlock + stop. */
            if (wasTap) {
                S.perfViewLocked    = false;
                S.loopHeld          = false;
                S.loopJogActive     = false;
                S.perfStack         = [];
                S.perfStickyLengths = new Set();
                S.perfHoldPadHeld   = false;
                S.perfModsHeld      = 0;
                sendPerfMods();
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('looper_stop', '1');
                invalidateLEDCache();
                forceRedraw();
            }
            return;
        }

        if (wasTap) {
            /* Tap → lock Perf Mode; preserve running loop + mods. */
            S.perfViewLocked = true;
            S.loopHeld       = true;
            forceRedraw();
            return;
        }

        /* Hold release: exit Perf Mode. Sticky lengths/hold pad auto-lock if still active. */
        S.loopHeld      = false;
        S.loopJogActive = false;
        S.perfModsHeld = 0;
        if (S.perfStickyLengths.size > 0 || S.perfHoldPadHeld) {
            S.perfViewLocked = true;
            if (!S.perfHoldPadHeld)
                S.perfStack = S.perfStack.filter(function(e) { return S.perfStickyLengths.has(e.idx); });
            if (S.perfStack.length > 0 && typeof host_module_set_param === 'function')
                host_module_set_param('looper_arm', String(S.perfStack[S.perfStack.length - 1].ticks));
        } else {
            if (S.perfStack.length > 0 && typeof host_module_set_param === 'function')
                host_module_set_param('looper_stop', '1');
            S.perfStack = [];
        }
        sendPerfMods();
        invalidateLEDCache();
        forceRedraw();
        return;
    }

    /* Loop button (CC 58, Track View): hold + step buttons sets clip length */
    if (d1 === MoveLoop && !S.sessionView) {
        S.loopHeld = d2 === 127;
        computePadNoteMap();
        /* Arp Steps overlay: Loop is repurposed as a modifier for the pad-column
         * loop-length gesture. Skip every other Loop side-effect (TARP unlatch,
         * drum repeat latch, loop-window gesture) while the overlay is active. */
        if (S.stepIntervalMode) {
            if (!S.loopHeld && S.loopGestureStart >= 0) S.loopGestureStart = -1;
            forceRedraw();
            return;
        }
        if (S.loopHeld) {
            /* Latch or clear drum repeat on the active track */
            const _lrt = S.activeTrack;
            S.loopPressTick = S.tickCount;
            /* Tap-loop-alone unlatch eligibility (drum tracks only). Snapshot
             * "no fresh physical pad press" at press time so the release path
             * can distinguish a true alone-tap from a tap-while-latching
             * gesture. For Rpt1, drumRepeatHeldPad doubles as the latched-pad
             * reference once latched, so we must allow that case (latched +
             * no fresh press = the unlatch gesture we want). Rpt2 uses two
             * separate sets (held vs latched) so its check is simpler. */
            S.loopTapUnlatchTrack = -1;
            const _rpt1FreshHold = S.drumRepeatHeldPad[_lrt] >= 0 && !S.drumRepeatLatched[_lrt];
            const _rpt2FreshHold = S.drumRepeat2HeldLanes[_lrt].size > 0;
            if (S.trackPadMode[_lrt] === PAD_MODE_DRUM &&
                !_rpt1FreshHold && !_rpt2FreshHold &&
                S.liveActiveNotes.size === 0) {
                S.loopTapUnlatchTrack = _lrt;
            }
            /* Delete+Loop on auto bank: reset active lane's loop/res/zoom to clip defaults */
            if (S.deleteHeld && S.activeBank === 6) {
                var _rac = effectiveClip(_lrt);
                var _rl = S.ccActiveLane[_lrt];
                S.ccLaneLoopStart[_lrt][_rac][_rl] = 0;
                S.ccLaneLength[_lrt][_rac][_rl] = 0;
                S.ccLaneTps[_lrt][_rac][_rl] = 0;
                S.ccLaneResTps[_lrt][_rac][_rl] = 0;
                S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
                S.pendingDefaultSetParams.push({ key: 't' + _lrt + '_c' + _rac + '_k' + _rl + '_cc_lane_reset', val: '1' });
                showActionPopup('LANE LOOP', 'RESET');
                forceRedraw();
                return;
            }
            /* Delete+Loop: unconditionally stop active drum repeat latch */
            if (S.deleteHeld && S.trackPadMode[_lrt] === PAD_MODE_DRUM) {
                if (S.drumPerformMode[_lrt] === 1 && S.drumRepeatLatched[_lrt]) {
                    S.drumRepeatLatched[_lrt] = false;
                    S.drumRepeatHeldPad[_lrt] = -1;
                    S.drumRepeatHeldPadsStack[_lrt].length = 0;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + _lrt + '_drum_repeat_stop', '1');
                } else if (S.drumPerformMode[_lrt] === 2 && S.drumRepeat2LatchedLanes[_lrt].size > 0) {
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + _lrt + '_drum_repeat2_stop', '1');
                    S.drumRepeat2LatchedLanes[_lrt].clear();
                }
                forceRedraw();
                return;
            }
            /* TARP latch shortcut: Loop press while holding a pad on a melodic track */
            if (S.trackPadMode[_lrt] !== PAD_MODE_DRUM && S.liveActiveNotes.size > 0) {
                const _latchNow = (S.bankParams[_lrt][5][7] | 0) !== 0;
                if (_latchNow) {
                    /* Latch ON: holding any pad + loop turns it off */
                    S.bankParams[_lrt][5][7] = 0;
                    if (typeof host_module_set_param === 'function')
                        S.pendingDefaultSetParams.push({ key: 't' + _lrt + '_tarp_latch', val: '0' });
                } else if ((S.bankParams[_lrt][5][0] | 0) !== 0) {
                    /* Latch OFF: turn it on (only when TARP style is set) */
                    S.bankParams[_lrt][5][7] = 1;
                    if (typeof host_module_set_param === 'function')
                        S.pendingDefaultSetParams.push({ key: 't' + _lrt + '_tarp_latch', val: '1' });
                }
            } else if (S.trackPadMode[_lrt] !== PAD_MODE_DRUM &&
                       (S.bankParams[_lrt][5][7] | 0) !== 0 &&
                       S.tarpHeldNotes[_lrt].size > 0) {
                /* Loop press with no pads held + latch on + notes in buffer:
                 * clear the latched buffer without changing tarp_latch. */
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + _lrt + '_tarp_clear_latched', '1');
                S.tarpHeldNotes[_lrt].clear();
            }
            if (S.drumPerformMode[_lrt] === 2) {
                S.rpt2LoopPadUsed = false;
                if (S.drumRepeat2HeldLanes[_lrt].size > 0) {
                    for (const _ll of S.drumRepeat2HeldLanes[_lrt]) {
                        S.drumRepeat2LatchedLanes[_lrt].add(_ll);
                    }
                    /* Phase 1 / Bundle 2C-Rpt2: one atomic DSP push for all
                     * currently-held lanes. A per-lane loop here would coalesce
                     * (same set_param key, different values) — only the last
                     * lane would land. The DSP handler ORs active|pending into
                     * the latched bitmask. */
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + _lrt + '_drum_repeat2_latch_held', '1');
                    S.rpt2LoopPadUsed = true;
                }
            } else if (S.drumRepeatHeldPad[_lrt] >= 0) {
                S.drumRepeatLatched[_lrt] = true;
                /* Phase 1 / Bundle 2C-Rpt1: also push DSP-side latched bit
                 * for parity (used by audio-thread unlatch-tap detection in
                 * drum_pad_event). Rpt1's release handler is still JS-driven
                 * so this isn't strictly required, but keeps DSP in sync. */
                if (typeof host_module_set_param === 'function')
                    S.pendingDefaultSetParams.push({ key: 't' + _lrt + '_drum_repeat_latched', val: '1' });
            }
            S.heldStepBtn        = -1;
            S.heldStep           = -1;
            S.heldStepNotes      = [];
            S.stepWasEmpty       = false;
            S.stepWasHeld        = false;
            S.stepBtnPressedTick.fill(-1);
            S.sessionStepHeld    = -1;
            S.sessionStepHeldCtx = 0;
        } else {
            S.loopJogActive = false;
            /* Loop released before the held start step — treat as aborted
             * gesture and fire the length-only fallback (single-tap semantics). */
            if (S.loopGestureStart >= 0) {
                _resolveLoopGesture(true);
                S.loopTapUnlatchTrack = -1;
            }
            /* Tap-loop-alone: unlatch all latched repeats on active drum track.
             * Eligibility was snapshotted at press (no pads/lanes held + drum
             * track). A long hold disqualifies (treated like a gesture timeout). */
            if (S.loopTapUnlatchTrack >= 0 &&
                (S.tickCount - S.loopPressTick) < LOOP_TAP_TICKS) {
                const _ut = S.loopTapUnlatchTrack;
                if (S.drumRepeatLatched[_ut]) {
                    S.drumRepeatLatched[_ut] = false;
                    S.drumRepeatHeldPad[_ut] = -1;
                    S.drumRepeatHeldPadsStack[_ut].length = 0;
                    S.pendingDefaultSetParams.push({ key: 't' + _ut + '_drum_repeat_stop', val: '1' });
                }
                if (S.drumRepeat2LatchedLanes[_ut].size > 0) {
                    S.drumRepeat2LatchedLanes[_ut].clear();
                    S.pendingDefaultSetParams.push({ key: 't' + _ut + '_drum_repeat2_stop', val: '1' });
                }
            }
            S.loopTapUnlatchTrack = -1;
        }
        forceRedraw();
    }

}

/* Universal unlatch sweep — clears Rpt1, Rpt2 latched lanes, and TARP latch
 * chip on every track. Called from both branches of the Delete+Play
 * handler so the gesture leaves UI mirrors and audio in agreement
 * regardless of transport state. DSP-side, tN_tarp_latch=0 invokes
 * tarp_drop_latched()→tarp_silence() to clear held-buffer entries and
 * cancel any sounding TARP note. */
function unlatchAllTracks() {
    for (let t = 0; t < NUM_TRACKS; t++) {
        if (S.drumRepeatLatched[t]) {
            S.drumRepeatLatched[t] = false;
            S.drumRepeatHeldPad[t] = -1;
            S.drumRepeatHeldPadsStack[t].length = 0;
            S.pendingDefaultSetParams.push({ key: 't' + t + '_drum_repeat_stop', val: '1' });
        }
        if (S.drumRepeat2LatchedLanes[t].size > 0) {
            S.drumRepeat2LatchedLanes[t].forEach(function(lane) {
                S.pendingDefaultSetParams.push({ key: 't' + t + '_drum_repeat2_lane_off', val: String(lane) });
            });
            S.drumRepeat2LatchedLanes[t].clear();
        }
        if (S.bankParams[t] && S.bankParams[t][5] && S.bankParams[t][5][7]) {
            S.bankParams[t][5][7] = 0;
            S.pendingDefaultSetParams.push({ key: 't' + t + '_tarp_latch', val: '0' });
        }
    }
}

function _onCC_transport(d1, d2) {
    /* Back: close global menu if open; otherwise (with Shift) hide module.
     * Back during co-run never reaches us because dAVEBOx opts out of the
     * framework Back-as-exit (CORUN_KEEP_BACK in keep_mask) and cedes Back
     * to the peer (chain editor sub-view pop / Move firmware navigation).
     * Menu is the dAVEBOx exit during co-run, handled in _onCC_buttons. */
    if (d1 === MoveBack && d2 === 127) {
        if (S.tapTempoOpen) {
            closeTapTempo();
            forceRedraw();
        } else if (S.confirmBake) {
            S.confirmBake          = false;
            S.confirmBakeWrapPhase = false;
            forceRedraw();
        } else if (S.globalMenuOpen && S.confirmClearSession) {
            S.confirmClearSession = false;
            forceRedraw();
        } else if (S.globalMenuOpen && S.confirmSaveState) {
            S.confirmSaveState = false;
            forceRedraw();
        } else if (S.globalMenuOpen && S.confirmConvertToDrum) {
            closeConvertConfirm();
            forceRedraw();
        } else if (S.globalMenuOpen && S.confirmConvertToConduct) {
            closeConvertConfirm();
            forceRedraw();
        } else if (S.globalMenuOpen && S.menuInfoLines.length > 0) {
            S.menuInfoLines = [];
            forceRedraw();
        } else if (S.globalMenuOpen && S.exportDoneDialog) {
            S.exportDoneDialog = false;
            S.globalMenuOpen   = false;
            forceRedraw();
        } else if (S.globalMenuOpen && S.confirmExportCondPhase) {
            S.confirmExportCondPhase = false;   /* Back from cond stage aborts export */
            forceRedraw();
        } else if (S.globalMenuOpen && S.confirmExport) {
            S.confirmExport = false;
            forceRedraw();
        } else if (S.globalMenuOpen) {
            S.globalMenuOpen = false;
            S.lastSentMenuEditValue = null;
            forceRedraw();
        } else if (S.shiftHeld) {
            if (S.schwungCoRunSlot >= 0) exitSchwungCoRun();
            saveState();                       /* sets pendingSuspendSave */
            S.pendingHideAfterSave = true;     /* drained one tick after save fires */
        }
    }

    /* Undo button: press = undo; Shift+Undo = redo */
    if (d1 === MoveUndo && d2 === 127) {
        if (S.shiftHeld) {
            if (S.redoAvailable) {
                if (S.redoSeqArpSnapshot) {
                    const _t = S.redoSeqArpSnapshot.track;
                    S.undoSeqArpSnapshot = { track: _t, params: S.bankParams[_t][4].slice() };
                } else {
                    S.undoSeqArpSnapshot = null;
                }
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('redo_restore', '1');
                if (S.redoSeqArpSnapshot) {
                    const { track, params } = S.redoSeqArpSnapshot;
                    for (let k = 0; k < 8; k++) {
                        const pm = BANKS[4].knobs[k];
                        if (pm) S.bankParams[track][4][k] = params[k];
                    }
                }
                S.undoAvailable = true;
                S.redoAvailable = false;
                S.pendingUndoSync = 5;
                showActionPopup('REDO');
            } else {
                showActionPopup('NOTHING TO', 'REDO');
            }
        } else {
            if (S.undoAvailable) {
                if (S.undoSeqArpSnapshot) {
                    const _t = S.undoSeqArpSnapshot.track;
                    S.redoSeqArpSnapshot = { track: _t, params: S.bankParams[_t][4].slice() };
                } else {
                    S.redoSeqArpSnapshot = null;
                }
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('undo_restore', '1');
                if (S.undoSeqArpSnapshot) {
                    const { track, params } = S.undoSeqArpSnapshot;
                    for (let k = 0; k < 8; k++) {
                        const pm = BANKS[4].knobs[k];
                        if (pm) S.bankParams[track][4][k] = params[k];
                    }
                }
                S.redoAvailable = true;
                S.undoAvailable = false;
                S.pendingUndoSync = 5;
                showActionPopup('UNDO');
            } else {
                showActionPopup('NOTHING TO', 'UNDO');
            }
        }
        S.screenDirty = true;
    }

    /* Play: toggle transport; Shift+Play = restart transport; Delete+Play = deactivate_all; Mute+Play = toggle metro */
    if (d1 === MovePlay && d2 === 127) {
        if (S.deleteHeld) {
            if (typeof host_module_set_param === 'function') {
                if (!S.playing) {
                    /* Stopped: panic clears will_relaunch + all clip state atomically for all tracks. */
                    host_module_set_param('transport', 'panic');
                    for (let t = 0; t < NUM_TRACKS; t++) {
                        S.trackWillRelaunch[t] = false;
                        S.trackQueuedClip[t]   = -1;
                    }
                    /* Mirror the playing-branch sweep so LEDs/UI stay in sync with audio panic. */
                    unlatchAllTracks();
                } else {
                    host_module_set_param('transport', 'deactivate_all');
                    /* Unlatch Rpt1/Rpt2/TARP across all tracks — queued one-per-tick via pendingDefaultSetParams to avoid coalescing */
                    unlatchAllTracks();
                }
            }
        } else if (S.muteHeld) {
            S.muteUsedAsModifier = true;
            if (S.metronomeOn !== 0) S.metronomeOnLast = S.metronomeOn;
            S.metronomeOn = S.metronomeOn === 0 ? S.metronomeOnLast : 0;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('metro_on', String(S.metronomeOn));
            showActionPopup('METRO ' + (S.metronomeOn === 0 ? 'OFF' : 'ON'));
        } else if (S.loopHeld && !S.sessionView) {
            /* Loop+Play (Track View only): restart with active clip starting at
             * the first step of the visible page; other tracks land at the
             * musically-equivalent offset. Atomic single set_param. */
            const _lpAt   = S.activeTrack;
            const _lpIsDr = S.trackPadMode[_lpAt] === PAD_MODE_DRUM;
            const _lpPage = _lpIsDr ? (S.drumStepPage[_lpAt] | 0) : (S.trackCurrentPage[_lpAt] | 0);
            const _lpLane = _lpIsDr ? (S.activeDrumLane[_lpAt] | 0) : -1;
            if (typeof host_module_set_param === 'function') {
                host_module_set_param('transport', 'restart_at:' + _lpAt + ':' + _lpPage + ':' + _lpLane);
            }
        } else if (S.shiftHeld) {
            /* Restart: atomic DSP-side stop+play. Single set_param avoids
             * coalescing flakiness when stop+play land in same audio block. */
            if (typeof host_module_set_param === 'function') {
                host_module_set_param('transport', S.playing ? 'restart' : 'play');
            }
        } else {
            if (S.recordCountingIn) {
                disarmRecord();
            } else if (typeof host_module_set_param === 'function') {
                /* Use the combined `transport=play_focus:T:C` set_param so the
                 * DSP arms the focused track's clip + sets playing=1 in a
                 * single buffer. Sending launch_clip + transport=play as two
                 * separate set_params coalesces (same buffer same channel),
                 * leaving clip_playing=0 on the first cycle after a clip
                 * clear (since clear leaves will_relaunch=0). */
                if (!S.playing && !S.sessionView
                        && !S.trackClipPlaying[S.activeTrack]
                        && !S.trackWillRelaunch[S.activeTrack]) {
                    const _at = S.activeTrack;
                    const _ac = S.trackActiveClip[_at];
                    host_module_set_param('transport', 'play_focus:' + _at + ':' + _ac);
                    S.trackQueuedClip[_at] = _ac;
                } else {
                    host_module_set_param('transport', S.playing ? 'stop' : 'play');
                }
            }
        }
    }

    /* Record button (CC 86): toggle arm/disarm */
    if (d1 === MoveRec && d2 === 127) {
        if (S.recordArmed) {
            if (S.recordCountingIn) {
                /* Record pressed during count-in → cancel queued transport+record */
                disarmRecord();
            } else {
            const _recT  = S.recordArmedTrack >= 0 ? S.recordArmedTrack : S.activeTrack;
            const _recAc = S.trackActiveClip[_recT];
            if (S.clipAdaptiveMode[_recT][_recAc] && !S.recordScheduledStop && S.playing) {
                /* Schedule stop at end of current page */
                const _recDrum = S.trackPadMode[_recT] === PAD_MODE_DRUM;
                const _recStp  = _recDrum ? S.drumCurrentStep[_recT] : S.trackCurrentStep[_recT];
                S.recordScheduledStop       = true;
                S.recordScheduledStopTarget = (Math.floor(_recStp / 16) + 1) * 16;
            } else {
                disarmRecord();
            }
            } /* end else (not counting in) */
        } else {
            /* Arming path. First gate: refuse if the active clip / lane is
             * playing in any non-Forward direction. Recording into Bwd / PPf /
             * PPb is confusing because the visual playhead is captured but
             * next-loop semantics fire the note at a shifted position. RvSt
             * (Step/Audio) is only meaningful during reverse motion, so it's
             * a no-op when Dir=Fwd and doesn't need to gate recording. */
            const _at = S.activeTrack;
            const _aac = S.trackActiveClip[_at];
            const _aIsDrum = S.trackPadMode[_at] === PAD_MODE_DRUM;
            const _apd = _aIsDrum
                ? (S.drumLanePlaybackDir[_at][S.activeDrumLane[_at]] | 0)
                : (S.clipPlaybackDir[_at][_aac] | 0);
            if (_apd !== 0) {
                S.recordBlockedDialog    = true;
                S.recordBlockedDialogSel = 0;  /* default OK */
                forceRedraw();
            } else if (!S.playing) {
            /* Stopped → DSP-side 1-bar count-in; transport+recording fire from render thread */
            const rawBpm = typeof host_module_get_param === 'function'
                ? parseFloat(host_module_get_param('bpm')) : 120;
            const bpm = (rawBpm > 0 && isFinite(rawBpm)) ? rawBpm : 120;
            S.recordArmed         = true;
            S.recordCountingIn    = true;
            S.recordArmedTrack    = S.activeTrack;
            S.recordBpm           = bpm;
            S.countInStartTick    = S.tickCount;
            S.countInBeatStartTick = S.tickCount;
            S.countInQuarterTicks = Math.round(196 * 60 / bpm);
            S.pendingPrerollNotes       = [];
            S.pendingPrerollToggleQueue = [];
            if (typeof host_module_set_param === 'function')
                host_module_set_param('record_count_in', String(S.activeTrack));
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
            setButtonLED(MoveRec, Red);
            /* Adaptive mode: entered when count-in finishes (transport start edge in tick) */
        } else {
            /* Playing → arm with no count-in. Two paths by mode:
             *   Adaptive (empty clip + length not manually set): defer DSP
             *     recording=1 to next bar boundary AND reset playhead to
             *     loop_start at fire time (next page becomes new step 0,
             *     avoiding an empty leading page). Record LED blinks until
             *     DSP fires. JS sends recording=2.
             *   Fixed (clip exists / length locked): record immediately at
             *     the current step — the existing clip grid is the meaningful
             *     frame. JS sends recording=1 (legacy). No blink. */
            const rawBpmLive = typeof host_module_get_param === 'function'
                ? parseFloat(host_module_get_param('bpm')) : 120;
            const _at = S.activeTrack, _ac = S.trackActiveClip[_at];
            const _isDrum = S.trackPadMode[_at] === PAD_MODE_DRUM;
            const _adaptive = _isDrum
                ? (!S.drumClipNonEmpty[_at][_ac] && !S.drumLaneLengthManuallySet[_at])
                : (!S.clipNonEmpty[_at][_ac] && !S.clipLengthManuallySet[_at][_ac]);
            S.recordArmed       = true;
            S.recordCountingIn  = false;
            S.recordArmedTrack  = _at;
            S.recordPendingPage = _adaptive;
            S.recordBpm        = (rawBpmLive > 0 && isFinite(rawBpmLive)) ? rawBpmLive : 120;
            if (_adaptive) S.clipAdaptiveMode[_at][_ac] = true;
            setButtonLED(MoveRec, Red);
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + _at + '_recording', _adaptive ? '2' : '1');
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
        }
        } /* end arming else (direction-gated) */
    }

    /* Sample press (no modifier): track held state; cancel dialogs/merge immediately on press */
    if (d1 === MoveSample && d2 === 127 && !S.shiftHeld) {
        S.sampleHeld           = true;
        S.sampleUsedAsModifier = false;
        if (S.pendingInheritPicker) {
            resolveInheritPicker(-1);  /* Cancel = Start blank */
            S.sampleUsedAsModifier = true;
        } else if (S.confirmBakeScene) {
            S.confirmBakeScene     = false;
            S.sampleUsedAsModifier = true;
            forceRedraw();
        } else if (S.confirmBake) {
            S.confirmBake             = false;
            S.confirmBakeDrumLoopOpen = false;
            S.confirmBakeWrapPhase    = false;
            S.sampleUsedAsModifier    = true;
            forceRedraw();
        } else if (S.dspMergeState !== 0) {
            S.pendingDefaultSetParams.push({ key: 'merge_stop', val: '1' });
            S.sampleUsedAsModifier = true;
            /* LED stays green until DSP finalizes at page boundary */
        }
    }
    /* Sample release (no modifier): in Session View arm/stop multi-track live
     * merge; in Track View bare tap is a no-op (clip bake moved off Sample
     * onto Capture). Sample-held + scene row still opens scene bake directly
     * (Sample is also a modifier — flagged via sampleUsedAsModifier). */
    if (d1 === MoveSample && d2 === 0 && !S.shiftHeld) {
        S.sampleHeld = false;
        if (!S.sampleUsedAsModifier && S.sessionView) {
            if (S.dspMergeState !== 0) {
                S.pendingDefaultSetParams.push({ key: 'merge_stop', val: '1' });
                /* LED stays Red until DSP finalizes at page boundary, then
                 * placement dialog opens via dspMergeState→IDLE detection. */
            } else {
                S.pendingDefaultSetParams.push({ key: 'merge_arm', val: '1' });
                S.pendingMergeArm = true;
                setButtonLED(MoveSample, Red);
                /* Explain what's happening — multi-track merge is non-obvious
                 * and the user needs time to read. Override the standard popup
                 * window to ~3 seconds. */
                showActionPopup('LIVE MERGE', 'Capturing all 8', 'tracks. Tap Sample', 'again to stop.');
                S.actionPopupEndTick = S.tickCount + 280;
            }
        }
    }

    /* Mute button: Delete+Mute = clear all (both views); toggle mute/solo on active track (Track View only).
     * Press: handle Delete+Mute immediately. Release: toggle mute/solo, but only if Mute was not used as
     * a modifier key (e.g. Mute+Play = metro toggle).
     * Skipped entirely during Schwung chain-edit co-run — Mute is ceded to the host as the slot-bypass
     * modifier there (see the MoveMute press tracker above). */
    if (d1 === MoveMute && d2 === 127 && S.schwungCoRunSlot < 0) {
        if (S.deleteHeld) {
            if (!S.sessionView && S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
                /* Delete+Mute in drum track view: clear all drum lane mute/solo */
                S.drumLaneMute[S.activeTrack] = 0;
                S.drumLaneSolo[S.activeTrack] = 0;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + S.activeTrack + '_drum_mute_all_clear', '1');
                S.muteUsedAsModifier = true;
                forceRedraw();
            } else {
                clearAllMuteSolo();
            }
        }
    }
    if (d1 === MoveMute && d2 === 0 && S.schwungCoRunSlot < 0) {
        if (!S.muteUsedAsModifier && !S.deleteHeld && !S.sessionView) {
            if (S.shiftHeld) setTrackSolo(S.activeTrack, !S.trackSoloed[S.activeTrack]);
            else           setTrackMute(S.activeTrack, !S.trackMuted[S.activeTrack]);
        }
    }

    /* Left/Right: page nav in Track View — clamp to the loop window so
     * step-edit nav never lands on a page that won't play. */
    if ((d1 === MoveLeft || d1 === MoveRight) && d2 === 127 && !S.sessionView) {
        var _t_lr = S.activeTrack;
        if (S.loopHeld && S.activeBank === 6) {
            var RES_TPS = [12, 24, 48, 96, 384];
            var _ac_lr = effectiveClip(_t_lr);
            var _ccL_lr = S.ccActiveLane[_t_lr];
            var _dispTpsLr = S.ccLaneTps[_t_lr][_ac_lr][_ccL_lr] || (S.clipTPS[_t_lr][_ac_lr] || 24);
            var _curTps = S.ccLaneResTps[_t_lr][_ac_lr][_ccL_lr] || _dispTpsLr;
            var _ci = RES_TPS.indexOf(_curTps);
            if (_ci < 0) _ci = 1;
            if (d1 === MoveLeft && _ci > 0) _ci--;
            else if (d1 === MoveRight && _ci < RES_TPS.length - 1) _ci++;
            S.ccLaneResTps[_t_lr][_ac_lr][_ccL_lr] = RES_TPS[_ci];
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + _t_lr + '_c' + _ac_lr + '_k' + _ccL_lr + '_cc_lane_res_tps',
                                      String(RES_TPS[_ci]));
            forceRedraw();
            return;
        }
        if (S.trackPadMode[_t_lr] === PAD_MODE_DRUM) {
            var lsBase = S.drumLaneLoopStart[_t_lr] | 0;
            var startPage = lsBase >> 4;
            var lastPage  = startPage + Math.max(1, Math.ceil(S.drumLaneLength[_t_lr] / 16)) - 1;
            if (d1 === MoveLeft)
                S.drumStepPage[_t_lr] = Math.max(startPage, S.drumStepPage[_t_lr] - 1);
            else
                S.drumStepPage[_t_lr] = Math.min(lastPage, S.drumStepPage[_t_lr] + 1);
        } else {
            var ac = effectiveClip(_t_lr);
            var lsBase, startPage, lastPage;
            if (S.activeBank === 6) {
                var _ccL2 = S.ccActiveLane[_t_lr];
                var _llen = S.ccLaneLength[_t_lr][ac][_ccL2];
                if (_llen > 0) {
                    lsBase = S.ccLaneLoopStart[_t_lr][ac][_ccL2] | 0;
                    startPage = lsBase >> 4;
                    lastPage = startPage + Math.max(1, Math.ceil(_llen / 16)) - 1;
                }
            }
            if (lastPage === undefined) {
                lsBase = S.clipLoopStart[_t_lr][ac] | 0;
                startPage = lsBase >> 4;
                lastPage = startPage + Math.max(1, Math.ceil(S.clipLength[_t_lr][ac] / 16)) - 1;
            }
            if (d1 === MoveLeft)
                S.trackCurrentPage[_t_lr] = Math.max(startPage, S.trackCurrentPage[_t_lr] - 1);
            else
                S.trackCurrentPage[_t_lr] = Math.min(lastPage, S.trackCurrentPage[_t_lr] + 1);
        }
        /* Manual navigation disables SeqFollow so the view stays where the user navigated */
        const _sfAc = effectiveClip(S.activeTrack);
        if (S.clipSeqFollow[S.activeTrack][_sfAc]) {
            S.clipSeqFollow[S.activeTrack][_sfAc] = false;
            S.bankParams[S.activeTrack][0][7] = 0;
        }
        S.screenDirty = true;
    }

    /* Up/Down: scene group nav in Session View or while overview held; octave shift in Track View */
    if (d1 === MoveDown && d2 === 127 && (S.sessionView || S.sessionOverlayHeld) && S.sceneRow < NUM_CLIPS - 4) { S.sceneRow = Math.min(NUM_CLIPS - 4, S.sceneRow + 4); forceRedraw(); }
    if (d1 === MoveUp   && d2 === 127 && (S.sessionView || S.sessionOverlayHeld) && S.sceneRow > 0)              { S.sceneRow = Math.max(0, S.sceneRow - 4);              forceRedraw(); }
    if ((d1 === MoveUp || d1 === MoveDown) && d2 > 0 && !S.sessionView && !S.sessionOverlayHeld &&
            S.loopHeld && S.activeBank === 6) {
        var RES_TPS = [12, 24, 48, 96, 384];
        var _zt = S.activeTrack, _zac = effectiveClip(_zt), _zL = S.ccActiveLane[_zt];
        var _zOldTps = S.ccLaneTps[_zt][_zac][_zL] || (S.clipTPS[_zt][_zac] || 24);
        var _zci = RES_TPS.indexOf(_zOldTps);
        if (_zci < 0) _zci = 1;
        if (d1 === MoveDown && _zci > 0) _zci--;
        else if (d1 === MoveUp && _zci < RES_TPS.length - 1) _zci++;
        var _zNewTps = RES_TPS[_zci];
        if (_zNewTps !== _zOldTps) {
            var _zOldLen = S.ccLaneLength[_zt][_zac][_zL] || S.clipLength[_zt][_zac];
            var _zOldTicks = _zOldLen * _zOldTps;
            var _zNewLen = Math.ceil(_zOldTicks / _zNewTps);
            if (_zNewLen <= 256) {
                S.ccLaneTps[_zt][_zac][_zL] = _zNewTps;
                S.ccLaneLength[_zt][_zac][_zL] = _zNewLen;
                var _zOldRes = S.ccLaneResTps[_zt][_zac][_zL];
                if (_zOldRes > 0) {
                    var _zNewRes = Math.round(_zOldRes * _zNewTps / _zOldTps);
                    var _zResValid = RES_TPS.indexOf(_zNewRes) >= 0;
                    S.ccLaneResTps[_zt][_zac][_zL] = _zResValid ? _zNewRes : 0;
                }
                var _zPre = 't' + _zt + '_c' + _zac + '_k' + _zL;
                S.pendingDefaultSetParams.push({ key: _zPre + '_cc_lane_tps', val: String(_zNewTps) });
                S.pendingDefaultSetParams.push({ key: _zPre + '_cc_loop_set',
                    val: String(((S.ccLaneLoopStart[_zt][_zac][_zL] | 0) << 16) | (_zNewLen & 0xFFFF)) });
                if (_zOldRes > 0)
                    S.pendingDefaultSetParams.push({ key: _zPre + '_cc_lane_res_tps',
                        val: String(S.ccLaneResTps[_zt][_zac][_zL]) });
                var _zMaxPage = Math.max(0, Math.ceil(_zNewLen / 16) - 1);
                if (S.trackCurrentPage[_zt] > _zMaxPage) S.trackCurrentPage[_zt] = _zMaxPage;
                forceRedraw();
            }
        }
        return;
    }
    if (d1 === MoveUp   && d2 > 0 && !S.sessionView && !S.sessionOverlayHeld) {
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            setDrumLanePage(S.activeTrack, 1);
            syncDrumLanesMeta(S.activeTrack);
            syncDrumLaneSteps(S.activeTrack, S.activeDrumLane[S.activeTrack]);
            computePadNoteMap();  /* PHASE-1: drum page change shifts lane mapping; re-push */
            forceRedraw();
        } else {
        for (const p of S.liveActiveNotes) queueLiveNoteOff(S.activeTrack, p);
        S.liveActiveNotes.clear();
        S.trackOctave[S.activeTrack] = Math.min(4, S.trackOctave[S.activeTrack] + 1);
        computePadNoteMap();  /* PHASE-1: re-bake octave offset into DSP padmap */
        S.screenDirty = true;
        if (S.heldStep >= 0) forceRedraw();
        }
    }
    if (d1 === MoveDown && d2 > 0 && !S.sessionView && !S.sessionOverlayHeld) {
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            setDrumLanePage(S.activeTrack, 0);
            syncDrumLanesMeta(S.activeTrack);
            syncDrumLaneSteps(S.activeTrack, S.activeDrumLane[S.activeTrack]);
            computePadNoteMap();  /* PHASE-1: drum page change shifts lane mapping; re-push */
            forceRedraw();
        } else {
        for (const p of S.liveActiveNotes) queueLiveNoteOff(S.activeTrack, p);
        S.liveActiveNotes.clear();
        S.trackOctave[S.activeTrack] = Math.max(-4, S.trackOctave[S.activeTrack] - 1);
        computePadNoteMap();  /* PHASE-1: re-bake octave offset into DSP padmap */
        S.screenDirty = true;
        if (S.heldStep >= 0) forceRedraw();
        }
    }

}

function _onCC_side(d1, d2) {
    /* Track buttons CC40-43 */
    if (d1 >= 40 && d1 <= 43 && d2 === 127) {
        const idx     = d1 - 40;
        const clipIdx = S.sceneRow + (3 - idx);
        /* Scene-bake picker (set by Session-View Capture tap): row press selects
         * the scene to bake and goes straight to the scene-bake confirm dialog.
         * Picker is consumed before any other gesture so it doesn't double-fire. */
        if (S.pendingSceneBakePicker) {
            S.pendingSceneBakePicker    = false;
            S.confirmBakeScene          = true;
            S.confirmBakeSceneWrapPhase = false;
            S.confirmBakeSceneCondPhase = false;
            S.confirmBakeSceneSel       = 1;
            S.confirmBakeSceneClip      = clipIdx;
            S.screenDirty               = true;
            return;
        }
        /* Multi-track live merge placement: post-stop, row press picks
         * destination row and commits captured clips (per-track skip when
         * no notes captured — preserves existing clips on those tracks). */
        if (S.pendingMergePlacement) {
            S.pendingMergePlacement = false;
            S.pendingDefaultSetParams.push({ key: 'merge_place_row', val: String(clipIdx) });
            S.screenDirty = true;
            return;
        }
        if (S.copyHeld) {
            if (S.copySrc && S.copySrc.kind === 'step') {
                /* step copy in progress: swallow track/scene buttons — don't mix copy types */
            } else if (S.sessionView) {
                /* Copy/Cut: row-to-row gesture */
                if (!S.copySrc) {
                    S.copySrc = S.shiftHeld
                        ? { kind: 'cut_row', row: clipIdx }
                        : { kind: 'row', row: clipIdx };
                    invalidateLEDCache();
                    showActionPopup(S.shiftHeld ? 'CUT' : 'COPIED');
                } else if (S.copySrc.kind === 'row') {
                    copyRow(S.copySrc.row, clipIdx);
                    invalidateLEDCache();
                    forceRedraw();
                    showActionPopup('PASTED');
                } else if (S.copySrc.kind === 'cut_row') {
                    cutRow(S.copySrc.row, clipIdx);
                    S.copySrc = { kind: 'row', row: clipIdx };
                    invalidateLEDCache();
                    forceRedraw();
                    showActionPopup('PASTED');
                }
                /* clip/cut_clip kinds: swallow — don't mix copy types */
            } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
                /* Track View drum clip copy/cut via track button */
                if (!S.copySrc) {
                    S.copySrc = S.shiftHeld
                        ? { kind: 'cut_drum_clip', track: S.activeTrack, clip: clipIdx }
                        : { kind: 'drum_clip',     track: S.activeTrack, clip: clipIdx };
                    invalidateLEDCache();
                    showActionPopup(S.shiftHeld ? 'CUT' : 'COPIED');
                } else if (S.copySrc.kind === 'drum_clip') {
                    copyDrumClip(S.copySrc.track, S.copySrc.clip, S.activeTrack, clipIdx);
                    invalidateLEDCache();
                    forceRedraw();
                    showActionPopup('PASTED');
                } else if (S.copySrc.kind === 'cut_drum_clip') {
                    cutDrumClip(S.copySrc.track, S.copySrc.clip, S.activeTrack, clipIdx);
                    S.copySrc = { kind: 'drum_clip', track: S.activeTrack, clip: clipIdx };
                    invalidateLEDCache();
                    forceRedraw();
                    showActionPopup('PASTED');
                }
                /* Other kinds: swallow — don't mix copy types */
            } else {
                /* Track View melodic clip copy/cut via track button */
                if (!S.copySrc) {
                    S.copySrc = S.shiftHeld
                        ? { kind: 'cut_clip', track: S.activeTrack, clip: clipIdx }
                        : { kind: 'clip', track: S.activeTrack, clip: clipIdx };
                    invalidateLEDCache();
                    showActionPopup(S.shiftHeld ? 'CUT' : 'COPIED');
                } else if (S.copySrc.kind === 'clip') {
                    copyClip(S.copySrc.track, S.copySrc.clip, S.activeTrack, clipIdx);
                    invalidateLEDCache();
                    forceRedraw();
                    showActionPopup('PASTED');
                } else if (S.copySrc.kind === 'cut_clip') {
                    cutClip(S.copySrc.track, S.copySrc.clip, S.activeTrack, clipIdx);
                    S.copySrc = { kind: 'clip', track: S.activeTrack, clip: clipIdx };
                    invalidateLEDCache();
                    forceRedraw();
                    showActionPopup('PASTED');
                }
                /* row/cut_row kinds: swallow — don't mix copy types */
            }
        } else if (S.shiftHeld && S.deleteHeld) {
            if (S.sessionView) {
                /* Shift+Delete+scene row (Session View): hard reset all 8 clips in row */
                for (let t = 0; t < NUM_TRACKS; t++) hardResetClip(t, clipIdx);
                forceRedraw();
                showActionPopup('CLIPS', 'CLEARED');
            } else {
                /* Shift+Delete+clip (Track View): full factory reset */
                hardResetClip(S.activeTrack, clipIdx);
                forceRedraw();
                showActionPopup('CLIP', 'CLEARED');
            }
        } else if (S.deleteHeld) {
            if (S.sessionView) {
                /* Delete + scene row button (Session View): clear all 8 clips in that row */
                clearRow(clipIdx);
                forceRedraw();
                showActionPopup('SEQUENCES', 'CLEARED');
            } else {
                /* Delete + track button (Track View): clear the clip; keep S.playing if it's currently active */
                clearClip(S.activeTrack, clipIdx, true);
                forceRedraw();
                showActionPopup('SEQUENCE', 'CLEARED');
            }
        } else if (S.captureHeld) {
            /* Capture + scene row: copy each track's currently *playing* or
             * *queued* clip into this row. Inactive/focused-but-not-playing
             * clips are skipped — only what's actually live participates in
             * the capture. Mark Capture as consumed so the upcoming release
             * doesn't open the
             * scene-bake picker. */
            S.captureUsedAsModifier = true;
            let scooped = 0;
            for (let t = 0; t < NUM_TRACKS; t++) {
                /* Only tracks whose active clip is *playing* (sequencer running)
                 * OR is currently queued contribute to the scene capture.
                 * Inactive/focused-but-silent tracks don't paint into the row. */
                const isLive = (S.trackClipPlaying[t] && S.trackActiveClip[t] !== clipIdx)
                            || (S.trackQueuedClip[t] >= 0 && S.trackQueuedClip[t] !== clipIdx);
                if (!isLive) continue;
                const srcC = S.trackQueuedClip[t] >= 0 ? S.trackQueuedClip[t] : S.trackActiveClip[t];
                if (srcC === clipIdx) continue;
                if (!trackClipHasContent(t, srcC)) continue;
                if (S.trackPadMode[t] === PAD_MODE_DRUM) {
                    copyDrumClip(t, srcC, t, clipIdx);
                } else {
                    copyClip(t, srcC, t, clipIdx);
                }
                scooped++;
            }
            invalidateLEDCache();
            forceRedraw();
            if (scooped > 0) showActionPopup('CAPTURED', 'TO ROW ' + (clipIdx + 1));
            else             showActionPopup('NOTHING', 'TO CAPTURE');
        } else if (S.sessionView) {
            S.sceneBtnFlashTick[idx] = S.tickCount;
            /* Shift+side-button forces next-bar boundary launch regardless of
             * global launch_quant. Plain press honors launch_quant as before. */
            const _scKey = S.shiftHeld ? 'launch_scene_quant' : 'launch_scene';
            S.pendingDefaultSetParams.push({ key: _scKey, val: String(clipIdx) });
        } else {
            const t            = S.activeTrack;
            const isActiveClip = S.trackActiveClip[t] === clipIdx;
            if (S.trackClipPlaying[t] && isActiveClip) {
                if (S.trackPendingPageStop[t]) {
                    /* Pending stop → cancel by re-launching legato */
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
                } else {
                    /* Playing → arm stop at next page boundary */
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_stop_at_end', '1');
                }
            } else if (S.trackWillRelaunch[t] && isActiveClip) {
                /* Transport stopped, clip primed to restart → cancel */
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_deactivate', '1');
            } else if (S.trackQueuedClip[t] === clipIdx) {
                /* Queued to launch → cancel */
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_deactivate', '1');
            } else {
                /* Focus immediately so pads/OLED show the selected clip even
                 * while the prior clip is still playing toward its legato
                 * switch boundary. pollDSP will keep trackActiveClip in sync
                 * when DSP actually crosses the boundary.
                 * Page snaps to the page containing the clip's loop_start so
                 * a clip with a non-zero loop window doesn't briefly render
                 * its OOB region on select. Drum tracks: leave at 0 (drum
                 * loop_start is per-lane and refreshed by pendingDrumResync). */
                S.trackActiveClip[t]  = clipIdx;
                S.trackCurrentPage[t] = S.trackPadMode[t] === PAD_MODE_DRUM
                    ? 0
                    : Math.floor((S.clipLoopStart[t][clipIdx] | 0) / 16);
                refreshPerClipBankParams(t);
                if (S.trackPadMode[t] === PAD_MODE_DRUM) {
                    S.pendingDrumResync      = 2;
                    S.pendingDrumResyncTrack = t;
                }
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
            }
        }
    }

}

/* CC-knob acceleration. The Move knobs fire ~2-4 ±1 detent messages per
 * physical click at ~8-35ms apart, so timing can't tell slow from fast. We use
 * a fractional accumulator: each message adds `gain` (1 at the start) to an
 * accumulator and emits whole units of BASE. BASE=3 makes the slow/fine rate
 * ~1 value per 3 messages; `gain` grows only
 * after sustained continuous turning, so big sweeps accelerate. A direction
 * change or a pause (>180ms) resets. Returns a signed integer step (0 if the
 * accumulator hasn't reached a whole unit yet). */
function ccKnobDelta(d2, k) {
    const sign = (d2 >= 1 && d2 <= 63) ? 1 : (d2 >= 65 && d2 <= 127) ? -1 : 0;
    if (!sign) return 0;
    const now = Date.now();
    const gap = now - (S.knobAccelLast[k] || 0);
    S.knobAccelLast[k] = now;
    if (sign !== S.knobAccelDir[k] || gap > 180) { S.knobAccelRun[k] = 0; S.knobAccelAcc[k] = 0; }
    S.knobAccelDir[k] = sign;
    S.knobAccelRun[k]++;
    const run  = S.knobAccelRun[k];
    const gain = run <= 12 ? 1 : run <= 24 ? 2 : run <= 36 ? 4 : 6;
    const BASE = 3;
    S.knobAccelAcc[k] += gain;
    const units = Math.floor(S.knobAccelAcc[k] / BASE);
    if (units === 0) return 0;
    S.knobAccelAcc[k] -= units * BASE;
    return sign * units;
}

function _onCC_stepedit(d1, d2) {
    /* CC step-edit: bank 6 + held step — all 8 knobs write CC automation at step's tick */
    if (S.heldStep >= 0 && S.activeBank === 6 && d1 >= 71 && d1 <= 78) {
        const _kIdx = d1 - 71;
        const _acc  = ccKnobDelta(d2, _kIdx);  /* run-length acceleration */
        if (_acc === 0) return;
        const _t    = S.activeTrack;
        const _ac   = effectiveClip(_t);
        S.knobTouched          = _kIdx;
        S.knobTurnedTick[_kIdx] = S.tickCount;
        S.ccActiveLane[_t]      = _kIdx;
        S.screenDirty  = true;
        var _laneTps = S.ccLaneTps[_t][_ac][_kIdx];
        const _tps   = (_laneTps > 0) ? _laneTps : (S.clipTPS[_t][_ac] || 24);
        const _tick  = S.heldStep * _tps;
        const _hold  = Math.min(65535, _tick + _tps - 1);
        /* Floor at "—": from an unset step, down → stays "—" (clear this knob's
         * point in the step window); up → writes the seed (recorded point if
         * any, else clip resting value, else 0; computed at step-hold time).
         * From a set step, down past 0 → clears back to "—". */
        if (!S.ccStepEditSet[_kIdx]) {
            if (_acc < 0) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + _t + '_cc_auto_clear_range',
                        _ac + ' ' + _kIdx + ' ' + _tick + ' ' + _hold);
                return;   /* stays "—" */
            }
            S.ccStepEditSet[_kIdx] = true;   /* keep the seed value */
        } else {
            const _nv = S.ccStepEditVal[_kIdx] + _acc;
            if (_nv < 0) {
                /* down past 0 → "—": drop this knob's point(s) in the step window */
                S.ccStepEditSet[_kIdx] = false;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + _t + '_cc_auto_clear_range',
                        _ac + ' ' + _kIdx + ' ' + _tick + ' ' + _hold);
                /* refresh the auto bit (knob may still have points elsewhere) */
                return;
            }
            S.ccStepEditVal[_kIdx] = Math.min(127, _nv);
        }
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + _t + '_cc_auto_set2',
                _ac + ' ' + _kIdx + ' ' + _tick + ' ' + _hold + ' ' + S.ccStepEditVal[_kIdx]);
        S.trackCCAutoBits[_t][_ac] |= (1 << _kIdx);
        return;
    }

    /* Drum step edit: K1 Leng, K2 Vel, K3 Nudg, K4 —, K5 Iter, K6 Prob, K7 Ratch, K8 —.
     * Bank-gated off the AUTO bank (6): there the held-step + knob edits CC
     * automation (the CC step editor above), mirroring the melodic NOTE editor. */
    if (S.heldStep >= 0 && S.heldStepNotes.length > 0 && d1 >= 71 && d1 <= 78 &&
            S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank !== 6) {
        const knobIdx = d1 - 71;
        const dir     = (d2 >= 1 && d2 <= 63) ? 1 : -1;
        const t       = S.activeTrack;
        const lane    = S.activeDrumLane[t];
        S.knobTouched          = knobIdx;
        S.knobTurnedTick[knobIdx] = S.tickCount;
        S.screenDirty = true;
        if (knobIdx === 3 || knobIdx === 7) return;
        if (knobIdx === 0) {
            const _tpsD = S.drumLaneTPS[t] || 24;
            const _gmaxD = Math.min(65535, 256 * _tpsD);
            const _acc = ccKnobDelta(d2, knobIdx);
            if (_acc === 0) return;
            const _steps = S.stepEditGate / _tpsD;
            const _inc = _steps <= 16 ? Math.round(_tpsD / 4)
                       : _steps <= 64 ? _tpsD
                       :                 _tpsD * 8;
            let _nv = S.stepEditGate + _acc * _inc;
            if (_inc > 1) _nv = Math.round(_nv / _inc) * _inc;
            S.stepEditGate = Math.max(1, Math.min(_gmaxD, _nv));
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_gate', String(S.stepEditGate));
        } else if (knobIdx === 1) {
            S.stepEditVel = Math.max(0, Math.min(127, S.stepEditVel + dir));
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_vel', String(S.stepEditVel));
        } else if (knobIdx === 2) {
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 8) {
                S.knobAccum[knobIdx] = 0;
                const _tpsN1 = (S.drumLaneTPS[t] || 24) - 1;
                S.stepEditNudge = Math.max(-_tpsN1, Math.min(_tpsN1, S.stepEditNudge + dir));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_nudge', String(S.stepEditNudge));
            }
        } else if (knobIdx === 4) {
            /* K5 Iter: one entry per detent (no accel — 36-entry list, ~1 turn end-to-end) */
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 3) {
                S.knobAccum[knobIdx] = 0;
                let idx = STEP_ITER_LIST.indexOf(S.stepEditIter);
                if (idx < 0) idx = 0;
                idx = Math.max(0, Math.min(STEP_ITER_LIST.length - 1, idx + dir));
                S.stepEditIter = STEP_ITER_LIST[idx];
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_iter', String(S.stepEditIter));
            }
        } else if (knobIdx === 5) {
            /* K6 Prob: 0..100 with accel */
            const acc = ccKnobDelta(d2, knobIdx);
            if (acc !== 0) {
                S.stepEditRand = Math.max(0, Math.min(100, S.stepEditRand + acc));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_rand', String(S.stepEditRand));
            }
        } else if (knobIdx === 6) {
            /* K7 Ratch: 0..4, sens=8 (10 detents per step at low gain) */
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 8) {
                S.knobAccum[knobIdx] = 0;
                S.stepEditRatch = Math.max(0, Math.min(4, S.stepEditRatch + dir));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_ratch', String(S.stepEditRatch));
            }
        }
        return;
    }
    /* Melodic step edit: K1 Oct, K2 Note, K3 Leng, K4 Vel, K5 Nudg, K6 Iter, K7 Prob, K8 Ratch */
    if (S.heldStep >= 0 && S.heldStepNotes.length > 0 && d1 >= 71 && d1 <= 78 && S.activeBank !== 6) {
        const knobIdx = d1 - 71;
        const dir     = (d2 >= 1 && d2 <= 63) ? 1 : -1;
        const t       = S.activeTrack;
        const ac      = effectiveClip(t);
        const pfx     = 't' + t + '_c' + ac + '_step_' + S.heldStep;
        S.knobTouched          = knobIdx;
        S.knobTurnedTick[knobIdx] = S.tickCount;
        S.screenDirty   = true;
        if (knobIdx === 0) {
            /* K1 Oct: shift all notes ±12 semitones, sens=12 */
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 12) {
                S.knobAccum[knobIdx] = 0;
                S.heldStepNotes = S.heldStepNotes.map(function(n) {
                    return Math.max(0, Math.min(127, n + dir * 12));
                });
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pfx + '_set_notes', S.heldStepNotes.join(' '));
            }
        } else if (knobIdx === 1) {
            /* K2 Pitch: shift each note ±1 scale degree (or ±1 semitone if scale-aware off), sens=10 */
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 10) {
                S.knobAccum[knobIdx] = 0;
                S.heldStepNotes = S.heldStepNotes.map(function(n) {
                    return scaleNudgeNote(n, dir, S.padKey, S.padScale);
                });
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pfx + '_set_notes', S.heldStepNotes.join(' '));
            }
        } else if (knobIdx === 2) {
            /* K3 Dur: accelerated with breakpoints at 16/64 steps */
            { const _acD = effectiveClip(S.activeTrack);
              const _tpsD = S.clipTPS[S.activeTrack][_acD] || 24;
              const _gmaxD = Math.min(65535, 256 * _tpsD);
              const _acc = ccKnobDelta(d2, knobIdx);
              if (_acc === 0) return;
              const _steps = S.stepEditGate / _tpsD;
              const _inc = _steps <= 16 ? Math.round(_tpsD / 4)
                         : _steps <= 64 ? _tpsD
                         :                 _tpsD * 8;
              let _nv = S.stepEditGate + _acc * _inc;
              if (_inc > 1) _nv = Math.round(_nv / _inc) * _inc;
              S.stepEditGate = Math.max(1, Math.min(_gmaxD, _nv)); }
            if (typeof host_module_set_param === 'function')
                host_module_set_param(pfx + '_gate', String(S.stepEditGate));
        } else if (knobIdx === 3) {
            /* K4 Vel: velocity 0-127 */
            S.stepEditVel = Math.max(0, Math.min(127, S.stepEditVel + dir));
            if (typeof host_module_set_param === 'function')
                host_module_set_param(pfx + '_vel', String(S.stepEditVel));
        } else if (knobIdx === 4) {
            /* K5 Nudge: tick offset ±(TPS-1), sens=8 */
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 8) {
                S.knobAccum[knobIdx] = 0;
                const _acN = effectiveClip(S.activeTrack);
                const _tpsN1 = (S.clipTPS[S.activeTrack][_acN] || 24) - 1;
                S.stepEditNudge = Math.max(-_tpsN1, Math.min(_tpsN1, S.stepEditNudge + dir));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pfx + '_nudge', String(S.stepEditNudge));
            }
        } else if (knobIdx === 5) {
            /* K6 Iter: discrete step, sens=3 (no accel) */
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 3) {
                S.knobAccum[knobIdx] = 0;
                let idx = STEP_ITER_LIST.indexOf(S.stepEditIter);
                if (idx < 0) idx = 0;
                idx = Math.max(0, Math.min(STEP_ITER_LIST.length - 1, idx + dir));
                S.stepEditIter = STEP_ITER_LIST[idx];
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pfx + '_iter', String(S.stepEditIter));
            }
        } else if (knobIdx === 6) {
            /* K7 Rand: 0..100 with accel */
            const acc = ccKnobDelta(d2, knobIdx);
            if (acc !== 0) {
                S.stepEditRand = Math.max(0, Math.min(100, S.stepEditRand + acc));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pfx + '_rand', String(S.stepEditRand));
            }
        } else if (knobIdx === 7) {
            /* K8 Ratch: 0..4, sens=8 */
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 8) {
                S.knobAccum[knobIdx] = 0;
                S.stepEditRatch = Math.max(0, Math.min(4, S.stepEditRatch + dir));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pfx + '_ratch', String(S.stepEditRatch));
            }
        }
        return;
    }

}

function _onCC_knobs(d1, d2) {
    /* Knob CCs 71-78: apply delta to active bank parameter.
     * Relative encoder: d2 1-63 = CW (+1), d2 64-127 = CCW (-1).
     * pm.sens > 1 = accumulate that many ticks before firing one unit change.
     * pm.lock = true: fire once then block until touch release (S.knobLocked). */
    if (d1 >= 71 && d1 <= 78) {
        /* Exclusive overlays — knob turns have no visible effect and should be swallowed. */
        if (S.heldStep >= 0) return;
        if (S.globalMenuOpen || S.tapTempoOpen || S.confirmBake || S.confirmClearSession || S.confirmConvertToDrum || S.confirmConvertToConduct || S.menuInfoLines.length > 0 || S.confirmExport || S.exportDoneDialog || S.recordBlockedDialog || S.confirmStateWipe || S.bpmMoveInfo) return;
        const knobIdx = d1 - 71;
        S.knobTouched          = knobIdx;
        S.knobTurnedTick[knobIdx] = S.tickCount;
        S.screenDirty = true;
        const bank    = S.activeBank;
        /* Arp Steps interval-mode overlay: K1-K8 set per-step scale-degree
         * offset (±24) for SEQ ARP (bank 4, per-clip) or TARP (bank 5, per-track).
         * Sens=2: ~ half-turn covers the full range. */
        if (S.stepIntervalMode && (bank === 4 || bank === 5)) {
            const t   = S.activeTrack;
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            S.knobAccum[knobIdx]++;
            if (S.knobAccum[knobIdx] >= 2) {
                S.knobAccum[knobIdx] = 0;
                if (bank === 4) {
                    const ac = effectiveClip(t);
                    const cur = S.seqArpStepInt[t][ac][knobIdx] | 0;
                    const nxt = Math.max(-24, Math.min(24, cur + dir));
                    if (nxt !== cur) {
                        S.seqArpStepInt[t][ac][knobIdx] = nxt;
                        /* Writes to active-clip pfx_params via pfx_set; matches the
                         * tN_seq_arp_step_vel routing. */
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_seq_arp_step_int', knobIdx + ' ' + nxt);
                    }
                } else {
                    const cur = S.tarpStepInt[t][knobIdx] | 0;
                    const nxt = Math.max(-24, Math.min(24, cur + dir));
                    if (nxt !== cur) {
                        S.tarpStepInt[t][knobIdx] = nxt;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_tarp_step_int', knobIdx + ' ' + nxt);
                    }
                }
            }
            return;
        }
        /* Conductor Responder/Octave/When banks: knob k edits track k's per-clip
         * value. Gated strictly on the active track being a Conductor AND one of
         * the three banks, so normal bank editing is untouched. The Move emits
         * MULTIPLE CC msgs per physical detent, so we route through the SAME
         * accumulation siblings use → ONE detent = ONE action:
         *   - Octave: knobAccum threshold (sens=16, matches drum LaneOct/LaneNote
         *     at ~9424) → one ±1 step per detent.
         *   - Responder/When: knobLocked one-action-per-gesture (matches K2 Stch
         *     ~9150 / K4 Lgto ~9196) → one toggle flip per physical turn,
         *     regardless of msg count; lock clears on knob touch-release. */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT &&
                (bank === BANK_RESPONDER || bank === BANK_OCTAVE || bank === BANK_WHEN)) {
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            if (bank === BANK_OCTAVE) {
                /* sens=16 — matches drum NOTE FX LaneOct/LaneNote ±1 stepping */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    applyConductGridKnob(BANK_OCTAVE, knobIdx, dir);
                }
            } else {
                /* Responder / When: single-fire toggle, locked per gesture */
                if (S.knobLocked[knobIdx]) return;
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    S.knobLocked[knobIdx] = true;
                    applyConductGridKnob(bank, knobIdx, dir);
                }
            }
            return;
        }
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 0) {
            const t    = S.activeTrack;
            const ac   = effectiveClip(t);
            const lane = S.activeDrumLane[t];
            const dir  = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }

            if (knobIdx === 0) {
                /* K1 = Res (normal=proportional rescale; alt=zoom, sens=16) */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    const curIdx = Math.max(0, TPS_VALUES.indexOf(S.drumLaneTPS[t]));
                    const nv = Math.max(0, Math.min(5, curIdx + dir));
                    if (nv !== curIdx) {
                        if (S.altMode) {
                            const newTps = TPS_VALUES[nv];
                            const newLen = Math.ceil(S.drumLaneLength[t] * S.drumLaneTPS[t] / newTps);
                            if (newLen > 256) {
                                showActionPopup('NOTES OUT', 'OF RANGE');
                                forceRedraw();
                            } else if (S.heldStep >= 0) {
                                /* blocked during step edit */
                            } else {
                                S.drumLaneTPS[t]    = newTps;
                                S.drumLaneLength[t] = newLen;
                                S.bankParams[t][0][knobIdx] = nv;
                                const maxPage = Math.max(0, Math.ceil(newLen / 16) - 1);
                                if (S.drumStepPage[t] > maxPage) S.drumStepPage[t] = maxPage;
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + t + '_l' + lane + '_clip_resolution_zoom', String(nv));
                                S.pendingDrumLaneResync = 2; S.pendingDrumLaneResyncTrack = t; S.pendingDrumLaneResyncLane = lane;
                                forceRedraw();
                            }
                        } else {
                            S.drumLaneTPS[t] = TPS_VALUES[nv];
                            S.bankParams[t][0][knobIdx] = nv;
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_l' + lane + '_clip_resolution', String(nv));
                            S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
                        }
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 1) {
                /* K2 = Stch (beat stretch, lock, sens=16) */
                if (S.knobLocked[knobIdx]) return;
                const len = S.drumLaneLength[t];
                const canFire = dir === 1 ? (len * 2 <= 256) : (len >= 2);
                if (!canFire) return;
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_beat_stretch', String(dir));
                    S.knobLocked[knobIdx] = true;
                    const blocked = host_module_get_param('t' + t + '_beat_stretch_blocked') === '1';
                    if (dir === -1 && blocked) {
                        S.stretchBlockedEndTick = S.tickCount + STRETCH_BLOCKED_TICKS;
                    } else {
                        S.drumLaneLength[t] = dir === 1 ? len * 2 : Math.floor(len / 2);
                        const maxPage = Math.max(0, Math.ceil(S.drumLaneLength[t] / 16) - 1);
                        if (S.drumStepPage[t] > maxPage) S.drumStepPage[t] = maxPage;
                        S.bankParams[t][0][1] = dir;
                        S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 2) {
                /* K3 = Shft (clock shift, sens=8). Alt = Nudge (sens=4, faster). */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= (S.altMode ? 4 : 8)) {
                    S.knobAccum[knobIdx] = 0;
                    if (S.altMode) {
                        S.bankParams[t][0][knobIdx] += dir;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_nudge', String(dir));
                    } else {
                        S.clockShiftTouchDelta += dir;
                        S.bankParams[t][0][knobIdx] = S.clockShiftTouchDelta;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_clock_shift', String(dir));
                    }
                    S.pendingDrumLaneResync = 2; S.pendingDrumLaneResyncTrack = t; S.pendingDrumLaneResyncLane = lane;
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 3) {
                /* K4 = Lgto: destructive one-shot. Right-turn opens confirm dialog. */
                if (S.knobLocked[knobIdx]) return;
                if (dir !== 1) return;
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    S.confirmLgto       = true;
                    S.confirmLgtoSel    = 0;
                    S.confirmLgtoIsDrum = true;
                    S.knobLocked[knobIdx] = true;
                    forceRedraw();
                }
                return;
            }
            if (knobIdx === 4) {
                /* K5 = Eucl (Bjorklund hit count, sens=8) */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 8) {
                    S.knobAccum[knobIdx] = 0;
                    const len  = S.drumLaneLength[t];
                    const prev = Math.min(S.drumLaneEuclidN[t][lane] | 0, len);
                    const nv   = Math.max(0, Math.min(len, prev + dir));
                    if (nv !== prev) {
                        const vel = stepEntryVelocity(t, -1, true);
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_euclid_stamp',
                                                  prev + ' ' + nv + ' ' + vel);
                        S.drumLaneEuclidN[t][lane] = nv;
                        S.bankParams[t][0][4] = nv;
                        S.pendingDrumLaneResync = 2; S.pendingDrumLaneResyncTrack = t; S.pendingDrumLaneResyncLane = lane;
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 6) {
                /* K7 = Dir (per-lane playback direction, sens=16).
                 * AltMode flips this to Step / Audio playback style (sens=4). */
                S.knobAccum[knobIdx]++;
                const _k7Sens = S.altMode ? 4 : 16;
                if (S.knobAccum[knobIdx] >= _k7Sens) {
                    S.knobAccum[knobIdx] = 0;
                    if (S.altMode) {
                        const _cur = S.drumLanePlaybackAudioReverse[t][lane] | 0;
                        const _nv  = Math.max(0, Math.min(1, _cur + dir));
                        if (_nv !== _cur) {
                            S.drumLanePlaybackAudioReverse[t][lane] = _nv;
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_l' + lane + '_playback_audio_reverse', String(_nv));
                        }
                    } else {
                        const _cur = S.drumLanePlaybackDir[t][lane] | 0;
                        const _nv  = Math.max(0, Math.min(3, _cur + dir));
                        if (_nv !== _cur) {
                            S.drumLanePlaybackDir[t][lane] = _nv;
                            S.bankParams[t][0][6] = _nv;
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_l' + lane + '_playback_dir', String(_nv));
                        }
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 7) {
                /* K8 = SqFl: sens=16 — matches melodic */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    const _cur = S.clipSeqFollow[t][ac] ? 1 : 0;
                    const _nv  = Math.max(0, Math.min(1, _cur + dir));
                    if (_nv !== _cur) {
                        S.clipSeqFollow[t][ac] = _nv !== 0;
                        S.bankParams[t][0][7]  = _nv;
                        S.screenDirty = true;
                    }
                }
                return;
            }
        }
        /* ALL LANES bank (drum, bank 7): K1=Res K2=Stch K3=Shft K4=Qnt K5=VelIn K6=InQ K7=Dir K8=SyncRpt */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 7 && !S.allLanesConfirmed) {
            S.screenDirty = true;
            return;
        }
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 7) {
            const t   = S.activeTrack;
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            if (knobIdx === 0) {
                /* K1 = Res: set resolution on all 32 lanes (absolute), sens=16 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    const curIdx = S.bankParams[t][7][0] < 0 ? -1 : S.bankParams[t][7][0];
                    const nv = Math.max(0, Math.min(5, curIdx + dir));
                    if (nv !== curIdx) {
                        S.bankParams[t][7][0] = nv;
                        S.drumLaneTPS[t] = TPS_VALUES[nv];
                        host_module_set_param('t' + t + '_all_lanes_clip_resolution', String(nv));
                        S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 1) {
                /* K2 = Stch: beat stretch all lanes, lock, sens=16 */
                if (S.knobLocked[knobIdx]) return;
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    host_module_set_param('t' + t + '_all_lanes_beat_stretch', String(dir));
                    S.knobLocked[knobIdx] = true;
                    S.bankParams[t][7][1] += dir;
                    S.pendingAllLanesStretchCheck = t;
                    S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 2) {
                /* K3 = Shft: clock shift all lanes, sens=8. Alt = Nudge (sens=1). */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= (S.altMode ? 1 : 8)) {
                    S.knobAccum[knobIdx] = 0;
                    if (S.altMode) {
                        S.bankParams[t][7][2] += dir;
                        host_module_set_param('t' + t + '_all_lanes_nudge', String(dir));
                    } else {
                        S.clockShiftTouchDelta += dir;
                        S.bankParams[t][7][2] = S.clockShiftTouchDelta;
                        host_module_set_param('t' + t + '_all_lanes_clock_shift', String(dir));
                    }
                    S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 3) {
                /* K4 = Qnt: quantize all lanes 0-100, sens=1 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 1) {
                    S.knobAccum[knobIdx] = 0;
                    const cur7q = S.bankParams[t][7][3] < 0 ? 0 : S.bankParams[t][7][3];
                    const nv = Math.max(0, Math.min(100, cur7q + dir));
                    if (nv !== cur7q) {
                        S.bankParams[t][7][3] = nv;
                        S.drumLaneQnt[t] = nv;
                        S.bankParams[t][1][2] = nv;
                        host_module_set_param('t' + t + '_drum_lanes_qnt', String(nv));
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 4) {
                /* K5 = VelIn: track velocity override, sens=1 */
                const cur7v = S.trackVelOverride[t];
                const nv = Math.max(0, Math.min(127, cur7v + dir));
                if (nv !== cur7v) applyTrackConfig(t, 'track_vel_override', nv);
                S.screenDirty = true;
                return;
            }
            if (knobIdx === 5) {
                /* K6 = InQ: per-track drum input quantize, 9 values (0=Off..8=1/4T), sens=8 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 8) {
                    S.knobAccum[knobIdx] = 0;
                    const nv = Math.max(0, Math.min(8, S.drumInpQuant[t] + dir));
                    if (nv !== S.drumInpQuant[t]) {
                        S.drumInpQuant[t] = nv;
                        S.bankParams[t][7][5] = nv;
                        host_module_set_param('t' + t + '_diq', String(nv));
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 6) {
                /* K7 = Dir: set playback direction on all 32 lanes, sens=16.
                 * Alt = RvSt (audio reverse on all lanes), sens=4. */
                S.knobAccum[knobIdx]++;
                const _k7Sens = S.altMode ? 4 : 16;
                if (S.knobAccum[knobIdx] >= _k7Sens) {
                    S.knobAccum[knobIdx] = 0;
                    if (S.altMode) {
                        const curRv = S.bankParams[t][7][6] < 0 ? -1 : S.bankParams[t][7][6];
                        const nvRv = Math.max(0, Math.min(1, curRv + dir));
                        if (nvRv !== curRv) {
                            S.bankParams[t][7][6] = nvRv;
                            host_module_set_param('t' + t + '_all_lanes_playback_audio_reverse', String(nvRv));
                        }
                    } else {
                        const curDir = S.bankParams[t][7][6] < 0 ? -1 : S.bankParams[t][7][6];
                        const nvDir = Math.max(0, Math.min(3, curDir + dir));
                        if (nvDir !== curDir) {
                            S.bankParams[t][7][6] = nvDir;
                            host_module_set_param('t' + t + '_all_lanes_playback_dir', String(nvDir));
                        }
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 7) {
                /* K8 = SyncRpt: per-track drum repeat sync toggle, bool, sens=8 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 8) {
                    S.knobAccum[knobIdx] = 0;
                    const cur7s = S.bankParams[t][7][7] | 0;
                    const nv = Math.max(0, Math.min(1, cur7s + dir));
                    if (nv !== cur7s) {
                        S.bankParams[t][7][7] = nv;
                        host_module_set_param('t' + t + '_drum_repeat_sync', String(nv));
                    }
                    S.screenDirty = true;
                }
                return;
            }
            return;
        }
        /* Drum NOTE FX bank (bank 1): K1=LaneOct K2=LaneNote K3=Vel K4=Qnt K5=Len(placeholder) K6=Gate; K7/K8 blocked */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 1) {
            if (knobIdx >= 6) return;
            const t    = S.activeTrack;
            const lane = S.activeDrumLane[t];
            const dir  = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            if (knobIdx === 0 || knobIdx === 1) {
                /* K1 = LaneOct (±12 semitones), K2 = LaneNote (±1 semitone), sens=16 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    const delta = knobIdx === 0 ? dir * 12 : dir;
                    const nv = Math.max(0, Math.min(127, S.drumLaneNote[t][lane] + delta));
                    if (nv !== S.drumLaneNote[t][lane]) {
                        S.drumLaneNote[t][lane] = nv;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_lane_note', String(nv));
                        /* PHASE-1: DSP padmap caches the resolved lane notes; re-push
                         * so on_midi dispatches the new note for this lane's pads. */
                        if (t === S.activeTrack) computePadNoteMap();
                        S.screenDirty = true;
                    }
                }
                return;
            }
            if (knobIdx === 2) {
                /* K3 = Vel: -127..127, sens=1 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 1) {
                    S.knobAccum[knobIdx] = 0;
                    const nv = Math.max(-127, Math.min(127, (S.bankParams[t][1][1] | 0) + dir));
                    if (nv !== S.bankParams[t][1][1]) {
                        S.bankParams[t][1][1] = nv;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_pfx_set', 'velocity_offset ' + nv);
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 3) {
                /* K4 = Qnt — per-lane quantize, sens=1 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 1) {
                    S.knobAccum[knobIdx] = 0;
                    const nv = Math.max(0, Math.min(100, S.drumLaneQnt[t] + dir));
                    if (nv !== S.drumLaneQnt[t]) {
                        S.drumLaneQnt[t] = nv;
                        S.bankParams[t][1][2] = nv;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_pfx_set', 'quantize ' + nv);
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 4) {
                /* K5 = Len: 0..8 (--/.25/.5/.75/1/2/4/8/16), sens=8 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 8) {
                    S.knobAccum[knobIdx] = 0;
                    const cur = S.drumLaneLenMode[t][lane] | 0;
                    const nv  = Math.max(0, Math.min(8, cur + dir));
                    if (nv !== cur) {
                        S.drumLaneLenMode[t][lane] = nv;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_pfx_set', 'note_length_mode ' + nv);
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 5) {
                /* K6 = Gate: 0-400, sens=2 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 2) {
                    S.knobAccum[knobIdx] = 0;
                    const nv = Math.max(0, Math.min(400, (S.bankParams[t][1][0] | 0) + dir));
                    if (nv !== S.bankParams[t][1][0]) {
                        S.bankParams[t][1][0] = nv;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_pfx_set', 'gate_time ' + nv);
                    }
                    S.screenDirty = true;
                }
                return;
            }
            return;
        }
        /* Repeat Groove bank (bank 6 on drum tracks): vel scale (unshifted) or nudge (Shift) */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 5) {
            const t    = S.activeTrack;
            const lane = S.activeDrumLane[t];
            const dir  = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            S.knobAccum[knobIdx]++;
            if (S.knobAccum[knobIdx] >= 2) {
                S.knobAccum[knobIdx] = 0;
                const step = knobIdx;
                if (S.altMode) {
                    const nv = Math.max(-50, Math.min(50, (S.drumRepeatNudge[t][lane][step] | 0) + dir));
                    if (nv !== S.drumRepeatNudge[t][lane][step]) {
                        S.drumRepeatNudge[t][lane][step] = nv;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_repeat_nudge', step + ' ' + nv);
                    }
                } else {
                    const nv = Math.max(0, Math.min(200, (S.drumRepeatVelScale[t][lane][step] | 0) + dir * 3));
                    if (nv !== S.drumRepeatVelScale[t][lane][step]) {
                        S.drumRepeatVelScale[t][lane][step] = nv;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_repeat_vel_scale', step + ' ' + nv);
                    }
                }
                S.screenDirty = true;
            }
            return;
        }
        /* CC PARAM bank (bank 6): see notes/cc-automation-redesign.md §5/§8.
         * Shift+turn = pick type (AT) / CC number; normal turn = set the clip's
         * resting value, record automation (armed), or audition (automated+playing);
         * Delete+turn = clear the knob's automation + resting value → "—". */
        if (bank === 6) {
            const t  = S.activeTrack;
            const ac = effectiveClip(t);
            const _setp = (k, v) => { if (typeof host_module_set_param === "function") host_module_set_param("t" + t + "_" + k, v); };
            /* Active lane = last-touched knob; persistent (no timeout). */
            S.ccActiveLane[t] = knobIdx;
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            S.knobAccum[knobIdx]++;

            /* alt mode: type/number ladder — Sch1..Sch8 (type 2) ↔ AT (type 1) ↔ CC0..CC127 (type 0).
             * Sch (chain knob) only available when patched Schwung is present.
             * Unified position: CC0..127 = 0..127, AT = -1, Sch1 = -2, Sch2 = -3, ..., Sch8 = -9.
             * When type=2, trackCCAssign holds the chain knob number (1-8). */
            if (S.altMode) {
                if (S.knobAccum[knobIdx] >= 4) {
                    S.knobAccum[knobIdx] = 0;
                    const hasSch = typeof shadow_set_param === 'function';
                    const cur = (S.trackCCType[t][knobIdx] === 2) ? -(S.trackCCAssign[t][knobIdx] + 1)
                              : (S.trackCCType[t][knobIdx] === 1) ? -1
                              : S.trackCCAssign[t][knobIdx];
                    const minVal = hasSch ? -9 : -1;
                    const nx  = Math.max(minVal, Math.min(127, cur + dir));
                    if (nx <= -2) {
                        const schKnob = -(nx + 1);
                        S.trackCCType[t][knobIdx] = 2;
                        S.trackCCAssign[t][knobIdx] = schKnob;
                        S.schLabel[t][knobIdx] = null;
                        _setp('cc_type_assign', knobIdx + ' 2 ' + schKnob);
                    } else if (nx === -1) {
                        S.trackCCType[t][knobIdx] = 1;
                        _setp('cc_type_assign', knobIdx + ' 1 ' + S.trackCCAssign[t][knobIdx]);
                    } else {
                        S.trackCCType[t][knobIdx] = 0;
                        S.trackCCAssign[t][knobIdx] = nx;
                        _setp('cc_type_assign', knobIdx + ' 0 ' + nx);
                    }
                    S.screenDirty = true;
                }
                return;
            }

            /* Held step: the step editor (_onCC_stepedit) is the sole writer. */
            if (S.heldStep >= 0) return;  /* held step → CC step editor owns it (drum + melodic) */

            /* Delete+turn: clear this knob's automation AND resting value → "—". */
            if (S.deleteHeld) {
                S.trackCCAutoBits[t][ac] &= ~(1 << knobIdx);
                S.trackCCLiveVal[t][knobIdx] = -1;
                S.clipCCVal[t][ac][knobIdx]  = -1;
                _setp('cc_auto_clear_k', ac + ' ' + knobIdx);
                showActionPopup('CC', 'CLEAR');
                invalidateLEDCache();
                return;
            }

            /* Normal turn: run-length acceleration (first few clicks ±1, sustained turning ramps up). */
            const accel = ccKnobDelta(d2, knobIdx);
            if (accel === 0) return;
            /* Gate the record path on S.playing rather than !S.recordCountingIn:
             * recordCountingIn only clears when pollDSP catches the count-in 1->0
             * edge (~every POLL_INTERVAL), so for up to ~43ms after the count-in
             * downbeat a knob turn would be misrouted to cc_rest and never engage
             * the DSP latch. S.playing is 0 for the whole count-in and flips to 1
             * atomically with tr->recording at fire, so it tracks the real arm. */
            const armed   = S.recordArmed && S.recordArmedTrack === t && S.playing;
            const hasAuto = (S.trackCCAutoBits[t][ac] >> knobIdx) & 1;

            if (armed) {
                /* Record automation. */
                const base = (S.trackCCLiveVal[t][knobIdx] >= 0) ? S.trackCCLiveVal[t][knobIdx]
                           : (S.clipCCVal[t][ac][knobIdx] >= 0 ? S.clipCCVal[t][ac][knobIdx] : 0);
                const nv = Math.max(0, Math.min(127, base + accel));
                S.trackCCLiveVal[t][knobIdx] = nv;
                _setp('cc_send', knobIdx + ' ' + nv);
                S.trackCCAutoBits[t][ac] |= (1 << knobIdx);
                S.screenDirty = true;
                return;
            }
            if (S.playing && hasAuto) {
                /* Automated lane, playing, not armed: transient live audition only. */
                const base = (S.trackCCLiveVal[t][knobIdx] >= 0) ? S.trackCCLiveVal[t][knobIdx] : 0;
                const nv = Math.max(0, Math.min(127, base + accel));
                S.trackCCLiveVal[t][knobIdx] = nv;
                _setp('cc_send', knobIdx + ' ' + nv);
                S.screenDirty = true;
                return;
            }
            /* Stopped, or playing on an un-automated lane: set the clip resting value.
             * "—" floor: crossing below 0 → "—"; from "—" the first up-step lands on 0. */
            const cur = S.clipCCVal[t][ac][knobIdx];
            let nv;
            if (cur < 0) nv = (accel > 0) ? (accel - 1) : -1;
            else        { nv = cur + accel; if (nv < 0) nv = -1; }
            nv = Math.max(-1, Math.min(127, nv));
            if (nv === cur) return;
            S.clipCCVal[t][ac][knobIdx]  = nv;
            S.trackCCLiveVal[t][knobIdx] = nv;
            _setp('cc_rest', ac + ' ' + knobIdx + ' ' + (nv < 0 ? 255 : nv));
            S.screenDirty = true;
            return;
        }
        /* Alt+K8 on NOTE FX (bank 1) or DELAY (bank 3), melodic: cycle random algorithm (Pure/Gaus/Walk) */
        if (S.altMode && S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM &&
                ((bank === 1 && knobIdx === 7) || (bank === 3 && knobIdx === 7))) {
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            S.knobAccum[knobIdx]++;
            if (S.knobAccum[knobIdx] >= 16) {
                S.knobAccum[knobIdx] = 0;
                const t = S.activeTrack;
                const isMidi = bank === 3;
                const cur = isMidi ? (S.midiDlyRandomMode[t] || 0) : (S.noteFXRandomMode[t] || 0);
                const nv = ((cur + dir) % 3 + 3) % 3;
                if (isMidi) { S.midiDlyRandomMode[t] = nv; }
                else        { S.noteFXRandomMode[t]  = nv; }
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(isMidi ? 'delay_pitch_random_mode' : 'noteFX_random_mode', String(nv));
                S.screenDirty = true;
            }
            return;
        }
        /* Shift+K1 on DELAY bank (melodic): clock feedback. K7 now hosts
         * delay_retrig (replaces the prior standalone Clk knob); clock_fb
         * folds onto the unused Shift modifier on K1 with a label flip
         * "Rate"↔"ClkF" in the OLED render. Mirror stored in S.delayClockFb
         * since bankParams[t][3][6] now stores retrig. */
        if (S.altMode && S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM &&
                bank === 3 && knobIdx === 0) {
            const t   = S.activeTrack;
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            S.knobAccum[knobIdx]++;
            if (S.knobAccum[knobIdx] >= 1) {
                S.knobAccum[knobIdx] = 0;
                const nv = Math.max(-100, Math.min(100, (S.delayClockFb[t] | 0) + dir));
                if (nv !== S.delayClockFb[t]) {
                    S.delayClockFb[t] = nv;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_delay_clock_fb', String(nv));
                }
                S.screenDirty = true;
            }
            return;
        }
        /* Melodic CLIP K6 = InQ — per-track input quantize, mirrors drum
         * ALL LANES K5. Custom path keeps S.drumInpQuant (the shared JS
         * mirror used by both bank-overview render paths) in sync with
         * bankParams[t][0][4]. The DSP field is `tr->drum_inp_quant` —
         * historical name; now per-track-type-agnostic. */
        if (S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM && bank === 0 && knobIdx === 4) {
            const t   = S.activeTrack;
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            S.knobAccum[knobIdx]++;
            if (S.knobAccum[knobIdx] >= 8) {
                S.knobAccum[knobIdx] = 0;
                const nv = Math.max(0, Math.min(8, S.drumInpQuant[t] + dir));
                if (nv !== S.drumInpQuant[t]) {
                    S.drumInpQuant[t] = nv;
                    S.bankParams[t][0][4] = nv;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_diq', String(nv));
                }
                S.screenDirty = true;
            }
            return;
        }
        /* Conduct bank (CLIP bank 0 on a Conductor) K6 = CdLk lock toggle.
         * Single-fire per gesture (knobLocked), matching Responder/When.
         * Off=gate-hold, Lock=sample-and-hold. Pushes per-clip cond_lock to
         * DSP (N=conductor track, C=active conductor clip). Melodic/drum CLIP
         * K6 is unassigned and falls through to the generic stub (no-op). */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT && bank === 0 && knobIdx === 5) {
            if (S.knobLocked[knobIdx]) return;
            const t   = S.activeTrack;
            const ac  = S.trackActiveClip[t] | 0;
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            S.knobAccum[knobIdx]++;
            if (S.knobAccum[knobIdx] >= 16) {
                S.knobAccum[knobIdx] = 0;
                S.knobLocked[knobIdx] = true;
                S.condLock[ac] = S.condLock[ac] ? 0 : 1;   /* single-fire toggle */
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_c' + ac + '_cond_lock', String(S.condLock[ac]));
                S.screenDirty = true;
            }
            return;
        }
        /* Conductor NOTE FX (bank 1) is slimmed: only K1(Oct)/K2(Ofs)/K8(Rnd)
         * + alt-K8 random-mode (handled above) apply. K3-K6 (Vel/Qnt/Len/Gate)
         * are inert — swallow the detent so nothing writes. K1/K2/K8 fall
         * through to the generic param handler (writes per-clip pfx via the
         * tN_noteFX_* → active-clip pfx_set path). */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT && bank === 1 &&
                (knobIdx === 2 || knobIdx === 3 || knobIdx === 4 || knobIdx === 5)) {
            return;
        }
        const pm      = BANKS[bank].knobs[knobIdx];
        if (pm && pm.abbrev && pm.scope !== 'stub' && !S.knobLocked[knobIdx]) {
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) {
                S.knobAccum[knobIdx]   = 0;
                S.knobLastDir[knobIdx] = dir;
            }
            S.knobAccum[knobIdx]++;
            /* Shift+Shft (Nudge mode) fires twice as fast as plain Clock Shift. */
            const _effSens = (pm.dspKey === 'clock_shift' && S.altMode) ? Math.max(1, (pm.sens >> 1))
                           : (pm.dspKey === 'clip_playback_dir' && S.altMode) ? 4
                           : pm.sens;
            if (S.knobAccum[knobIdx] >= _effSens) {
                S.knobAccum[knobIdx] = 0;
                S.screenDirty = true;
                if (pm.scope === 'action') {
                    const t   = S.activeTrack;
                    const ac  = S.trackActiveClip[t];
                    const len = S.clipLength[t][ac];
                    /* Lgto knob (CLIP K8): right-turn opens the destructive
                     * confirm dialog. Left-turn is a no-op (one-way action). */
                    if (pm.dspKey === 'lgto_apply') {
                        if (dir !== 1) return;
                        S.confirmLgto       = true;
                        S.confirmLgtoSel    = 0;  /* default OK */
                        S.confirmLgtoIsDrum = false;
                        S.knobLocked[knobIdx] = true;
                        forceRedraw();
                        return;
                    }
                    if (pm.lock) {
                        /* Beat Stretch: one-shot, then lock until touch release */
                        const canFire = dir === 1 ? (len * 2 <= 256) : (len >= 2);
                        if (canFire && typeof host_module_set_param === 'function') {
                            host_module_set_param('t' + t + '_' + pm.dspKey, String(dir));
                            S.knobLocked[knobIdx] = true;
                            /* For compress: check if DSP blocked due to step collision */
                            if (dir === -1 && host_module_get_param('t' + t + '_beat_stretch_blocked') === '1') {
                                S.stretchBlockedEndTick = S.tickCount + STRETCH_BLOCKED_TICKS;
                            } else {
                                /* Mirror DSP step rewrite in JS S.clipSteps */
                                const steps = S.clipSteps[t][ac];
                                if (dir === 1) {
                                    for (let si = len - 1; si >= 1; si--) {
                                        steps[si * 2] = steps[si];
                                        steps[si] = 0;
                                    }
                                    for (let si = 1; si < len * 2; si += 2) steps[si] = 0;
                                    S.clipLength[t][ac] = len * 2;
                                } else {
                                    const halfLen = len >> 1;
                                    const tmp = new Array(halfLen).fill(0);
                                    for (let si = 0; si < len; si++) {
                                        if (steps[si] === 1 && !tmp[si >> 1]) tmp[si >> 1] = 1;
                                    }
                                    for (let si = 0; si < len; si++) {
                                        if (steps[si] === 2 && !tmp[si >> 1]) tmp[si >> 1] = 2;
                                    }
                                    for (let si = 0; si < len; si++) steps[si] = 0;
                                    for (let si = 0; si < halfLen; si++) steps[si] = tmp[si];
                                    S.clipLength[t][ac] = halfLen;
                                }
                                /* Clamp page index to new length */
                                const newPages = Math.max(1, Math.ceil(S.clipLength[t][ac] / 16));
                                if (S.trackCurrentPage[t] >= newPages)
                                    S.trackCurrentPage[t] = newPages - 1;
                                /* Per-touch label: dir +1 → fmtStretch shows 'x2', -1 → '/2' */
                                S.bankParams[t][bank][knobIdx] = dir;
                            }
                        }
                    } else if (pm.dspKey === 'clock_shift') {
                        if (S.altMode) {
                            /* alt = Nudge — fire DSP, mirror counter for display, schedule re-read */
                            if (typeof host_module_set_param === 'function') {
                                host_module_set_param('t' + t + '_nudge', String(dir));
                                S.bankParams[t][bank][knobIdx] += dir;
                                S.pendingStepsReread      = 2;
                                S.pendingStepsRereadTrack = t;
                                S.pendingStepsRereadClip  = ac;
                            }
                        } else if (len >= 2 && typeof host_module_set_param === 'function') {
                            /* Clock Shift: continuous rotation, no lock */
                            host_module_set_param('t' + t + '_' + pm.dspKey, String(dir));
                            const steps = S.clipSteps[t][ac];
                            if (dir === 1) {
                                const last = steps[len - 1];
                                for (let si = len - 1; si > 0; si--) steps[si] = steps[si - 1];
                                steps[0] = last;
                            } else {
                                const first = steps[0];
                                for (let si = 0; si < len - 1; si++) steps[si] = steps[si + 1];
                                steps[len - 1] = first;
                            }
                            S.clockShiftTouchDelta += dir;
                            S.bankParams[t][bank][knobIdx] = S.clockShiftTouchDelta;
                        }
                    }
                } else if (S.altMode && pm && pm.dspKey === 'clip_playback_dir' &&
                           S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM) {
                    /* AltMode CLIP K5: toggle Step / Audio playback style on
                     * the active melodic clip. Values 0..1, clamped. */
                    const _t  = S.activeTrack;
                    const _ac = effectiveClip(_t);
                    const _cur = S.clipPlaybackAudioReverse[_t][_ac] | 0;
                    const _nv  = Math.max(0, Math.min(1, _cur + dir));
                    if (_nv !== _cur) {
                        S.clipPlaybackAudioReverse[_t][_ac] = _nv;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + _t + '_clip_playback_audio_reverse', String(_nv));
                    }
                } else {
                    const cur  = S.bankParams[S.activeTrack][bank][knobIdx];
                    const step = pm.step || 1;
                    let nv  = Math.max(pm.min, Math.min(pm.max, cur + dir * step));
                    if (nv !== cur) {
                        if (S.altMode && pm.dspKey === 'clip_resolution') {
                            const _t   = S.activeTrack;
                            const _ac  = effectiveClip(_t);
                            const _old_tps = S.clipTPS[_t][_ac];
                            const _new_tps = TPS_VALUES[nv];
                            const _old_ticks = S.clipLength[_t][_ac] * _old_tps;
                            const _new_len = Math.ceil(_old_ticks / _new_tps);
                            if (_new_len > 256) {
                                showActionPopup('NOTES OUT', 'OF RANGE');
                                forceRedraw();
                            } else if (S.heldStep >= 0 || (S.recordArmed && !S.recordCountingIn && S.recordArmedTrack === _t)) {
                                /* blocked — do nothing */
                            } else {
                                S.bankParams[S.activeTrack][bank][knobIdx] = nv;
                                S.clipTPS[_t][_ac]    = _new_tps;
                                S.clipLength[_t][_ac] = _new_len;
                                const _maxPage = Math.max(0, Math.ceil(_new_len / 16) - 1);
                                if (S.trackCurrentPage[_t] > _maxPage) S.trackCurrentPage[_t] = _maxPage;
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + _t + '_clip_resolution_zoom', String(nv));
                                S.pendingStepsReread      = 2;
                                S.pendingStepsRereadTrack = _t;
                                S.pendingStepsRereadClip  = _ac;
                                refreshPerClipBankParams(_t);
                                forceRedraw();
                            }
                        } else {
                            S.bankParams[S.activeTrack][bank][knobIdx] = nv;
                            applyBankParam(S.activeTrack, bank, knobIdx, nv);
                            if (bank === 5 && knobIdx === 0 && nv !== 0)
                                S.lastTarpStyle[S.activeTrack] = nv;
                        }
                    }
                }
            }
        }
    }
}

function _switchViewCleanup() {
    S.heldStepBtn        = -1;
    S.heldStep           = -1;
    S.heldStepNotes      = [];
    S.stepWasEmpty       = false;
    S.stepWasHeld        = false;
    S.stepBtnPressedTick.fill(-1);
    S.sessionStepHeld    = -1;
    S.sessionStepHeldCtx = 0;
    /* Leaving Session View stops any active loop; mods/latch persist. */
    if (!S.sessionView && (S.perfViewLocked || S.perfStack.length > 0)) {
        const _hadLoop = S.perfStack.length > 0;
        S.perfStack         = [];
        S.perfStickyLengths = new Set();
        S.perfHoldPadHeld   = false;
        S.perfViewLocked    = false;
        S.loopHeld          = false;
        S.loopJogActive     = false;
        S.perfModsHeld      = 0;
        sendPerfMods();
        if (_hadLoop && typeof host_module_set_param === 'function')
            host_module_set_param('looper_stop', '1');
    }
    if (S.sessionView) {
        for (let i = 0; i < 16; i++) setLED(16 + i, LED_OFF);
        for (let t = 0; t < 8; t++) setLED(TRACK_PAD_BASE + t, LED_OFF);
    } else {
        for (let row = 0; row < 4; row++)
            for (let t = 0; t < 8; t++) setLED(92 - row * 8 + t, LED_OFF);
    }
}

function _onCCMsg(d1, d2) {
    _onCC_jog(d1, d2);
    _onCC_buttons(d1, d2);
    _onCC_transport(d1, d2);
    _onCC_side(d1, d2);
    _onCC_stepedit(d1, d2);
    _onCC_knobs(d1, d2);
}


function _onPadPressTrackView(status, d1, d2) {

    if (d1 >= TRACK_PAD_BASE && d1 < TRACK_PAD_BASE + 32) {
        const padIdx = d1 - TRACK_PAD_BASE;


        /* Drum lane RESET: Shift+Delete+lane pad — full factory reset (length,
         * loop, pfx, Rpt groove all wiped). midi_note is preserved (lane
         * identity). */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.shiftHeld && S.deleteHeld) {
            const t    = S.activeTrack;
            const lane = drumPadToLane(padIdx);
            if (lane >= 0 && lane < DRUM_LANES) {
                S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_l' + lane + '_hard_reset', '1');
                setActiveDrumLane(t, lane);
                S.drumLaneLength[t]     = 16;
                for (let s = 0; s < 256; s++) S.drumLaneSteps[t][lane][s] = '0';
                S.drumLaneHasNotes[t][lane] = false;
                /* Per-lane Rpt1 + Rpt2 groove reset to fresh-session defaults
                 * (matches drum_repeat_init_defaults + doClearSession). */
                S.drumRepeatGate[t][lane] = 0xFF;
                for (let _s = 0; _s < 8; _s++) {
                    S.drumRepeatVelScale[t][lane][_s] = 100;
                    S.drumRepeatNudge[t][lane][_s]    = 0;
                }
                S.drumRepeat2RatePerLane[t][lane] = 0;
                const ac = S.trackActiveClip[t];
                S.drumClipNonEmpty[t][ac] = false;
                for (let ol = 0; ol < DRUM_LANES; ol++) {
                    if (S.drumLaneHasNotes[t][ol]) { S.drumClipNonEmpty[t][ac] = true; break; }
                }
                /* Defer refreshDrumLaneBankParams via pendingDrumLaneResync so it
                 * runs AFTER DSP _hard_reset has drained (2 ticks). Synchronous
                 * refresh was reading pre-reset DSP values, leaving NOTE FX /
                 * DELAY mirrors un-defaulted. */
                S.pendingDrumLaneResync      = 2;
                S.pendingDrumLaneResyncTrack = t;
                S.pendingDrumLaneResyncLane  = lane;
                showActionPopup('LANE', 'RESET');
                forceRedraw();
            }
            return;
        }

        /* Drum lane CLEAR: Delete+lane pad (no shift) — notes-only clear,
         * preserves length, loop window, pfx params, midi_note. Undoable. */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && !S.shiftHeld && S.deleteHeld) {
            const t    = S.activeTrack;
            const lane = drumPadToLane(padIdx);
            if (lane >= 0 && lane < DRUM_LANES) {
                S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_l' + lane + '_clear', '1');
                setActiveDrumLane(t, lane);
                for (let s = 0; s < 256; s++) S.drumLaneSteps[t][lane][s] = '0';
                S.drumLaneHasNotes[t][lane] = false;
                const ac = S.trackActiveClip[t];
                S.drumClipNonEmpty[t][ac] = false;
                for (let ol = 0; ol < DRUM_LANES; ol++) {
                    if (S.drumLaneHasNotes[t][ol]) { S.drumClipNonEmpty[t][ac] = true; break; }
                }
                showActionPopup('LANE', 'CLEARED');
                forceRedraw();
            }
            return;
        }
        /* Drum Repeat mode pad handling (intercepts left 4 cols when S.drumPerformMode===1) */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.drumPerformMode[S.activeTrack] === 1 &&
                !S.shiftHeld && !S.copyHeld && !S.muteHeld) {
            const t   = S.activeTrack;
            const col = padIdx % 8;
            const row = Math.floor(padIdx / 8);
            if (col >= 4 && row < 2) {
                /* Rate pad (right side, bottom 2 rows): start/retrigger repeat */
                const rateIdx = row * 4 + (col - 4);
                const lane    = S.activeDrumLane[t];
                const vel     = d2;
                if (S.drumRepeatLatched[t] && S.drumRepeatHeldPad[t] === padIdx) {
                    /* Same latched pad pressed again: unlatch and stop.
                     * Phase 1 / Bundle 2C-Rpt1: on patched Schwung, DSP
                     * drum_pad_event detects the same gesture synchronously
                     * on the audio thread (reads tr->drum_repeat_latched
                     * mirror) and calls drum_repeat_stop_internal — closes
                     * the JS-tick race that would otherwise fire one extra
                     * repeat at fast rates. The set_param below stays as
                     * idempotent backstop + stock-Schwung path. */
                    S.drumRepeatLatched[t]  = false;
                    S.drumRepeatHeldPad[t]  = -1;
                    S.drumRepeatHeldPadsStack[t].length = 0;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_drum_repeat_stop', '1');
                } else {
                    /* New rate or held: push previous held pad so release can resume it */
                    if (S.drumRepeatHeldPad[t] >= 0 && !S.drumRepeatLatched[t]) {
                        const _pp = S.drumRepeatHeldPad[t];
                        const _pr = Math.floor(_pp / 8) * 4 + (_pp % 8) - 4;
                        S.drumRepeatHeldPadsStack[t].push({ padIdx: _pp, rateIdx: _pr, vel: S.drumRepeatHeldPadVel[t] });
                    }
                    S.drumRepeatHeldPad[t]    = padIdx;
                    S.drumRepeatHeldPadVel[t] = vel;
                    S.drumRepeatLatched[t]    = S.loopHeld;
                    if (typeof host_module_set_param === 'function') {
                        /* Phase 1 / Bundle 2C-Rpt1: on patched Schwung the
                         * audio-thread drum_pad_event has already called
                         * drum_repeat_start_internal for this press. Firing
                         * the set_param here too would re-prime phase=0
                         * after the first hit has already played, producing
                         * an audible double-trigger. Gate to stock-only.
                         * The release-side stack-resume drum_repeat_start
                         * push (elsewhere in this file) is NOT gated — DSP
                         * doesn't classify release events, so JS owns that
                         * path on both stock and patched. */
                        if (!S.dspInboundEnabled)
                            host_module_set_param('t' + t + '_drum_repeat_start', lane + ' ' + rateIdx + ' ' + vel);
                        /* Latched flag — JS is authoritative DSP-side after
                         * the 2C-Rpt2 fix removed the defensive clear in
                         * drum_repeat_start_internal. Push BOTH 0 and 1 so
                         * a rate-switch-while-latched-without-Loop (JS sets
                         * drumRepeatLatched=false) correctly clears the bit.
                         * Lets drum_pad_event detect re-tap-to-unlatch on
                         * the audio thread with zero JS-tick race. */
                        host_module_set_param('t' + t + '_drum_repeat_latched', S.loopHeld ? '1' : '0');
                    }
                }
                S.screenDirty = true;
                return;
            } else if (col >= 4 && row >= 2) {
                /* Gate mask pad (right side, top 2 rows) */
                const lane = S.activeDrumLane[t];
                const step = (row - 2) * 4 + (col - 4);
                if (S.deleteHeld) {
                    /* Delete + gate pad: reset vel_scale and nudge for this step */
                    S.drumRepeatVelScale[t][lane][step] = 100;
                    S.drumRepeatNudge[t][lane][step]    = 0;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_repeat_defaults', String(step));
                } else if (S.loopHeld) {
                    /* Loop + gate pad: set gate cycle length and fill mask to steps 0..step */
                    const gLen = step + 1;
                    const fillMask = (1 << gLen) - 1;
                    S.drumRepeatGate[t][lane] = fillMask;
                    S.drumRepeatGateLen[t][lane] = gLen;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_repeat_gate_and_len', fillMask + ' ' + gLen);
                } else {
                    /* Tap: toggle gate bit */
                    S.drumRepeatGate[t][lane] = (S.drumRepeatGate[t][lane] ^ (1 << step)) & 0xFF;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_repeat_gate_toggle', String(step));
                }
                forceRedraw();
                return;
            }
        }
        /* Drum Repeat 2 mode pad handling (multi-lane simultaneous repeat) */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.drumPerformMode[S.activeTrack] === 2 &&
                !S.shiftHeld && !S.copyHeld && !S.muteHeld) {
            const t   = S.activeTrack;
            const col = padIdx % 8;
            const row = Math.floor(padIdx / 8);
            if (col >= 4 && row < 2) {
                /* Rate pad: assign rate to active lane.
                 * Phase 1 / Bundle 2C-Rpt2: on patched Schwung drum_pad_event
                 * already called drum_repeat2_rate_internal on the audio
                 * thread; firing the set_param here would be redundant. */
                const rateIdx = row * 4 + (col - 4);
                const lane = S.activeDrumLane[t];
                S.drumRepeat2RatePerLane[t][lane] = rateIdx;
                if (typeof host_module_set_param === 'function' && !S.dspInboundEnabled)
                    host_module_set_param('t' + t + '_drum_repeat2_rate', lane + ' ' + rateIdx);
                S.screenDirty = true;
                return;
            } else if (col >= 4 && row >= 2) {
                /* Gate mask: same as Rpt mode */
                const lane = S.activeDrumLane[t];
                const step = (row - 2) * 4 + (col - 4);
                if (S.deleteHeld) {
                    S.drumRepeatVelScale[t][lane][step] = 100;
                    S.drumRepeatNudge[t][lane][step]    = 0;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_repeat_defaults', String(step));
                } else if (S.loopHeld) {
                    /* Loop + gate pad: set gate cycle length and fill mask to steps 0..step */
                    const gLen = step + 1;
                    const fillMask = (1 << gLen) - 1;
                    S.drumRepeatGate[t][lane] = fillMask;
                    S.drumRepeatGateLen[t][lane] = gLen;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_repeat_gate_and_len', fillMask + ' ' + gLen);
                } else {
                    S.drumRepeatGate[t][lane] = (S.drumRepeatGate[t][lane] ^ (1 << step)) & 0xFF;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_repeat_gate_toggle', String(step));
                }
                forceRedraw();
                return;
            } else if (col < 4 && !S.deleteHeld) {
                /* Lane pad: add/unlatch multi-lane repeat.
                 * Phase 1 / Bundle 2C-Rpt2: on patched Schwung drum_pad_event
                 * already toggled the lane via drum_repeat2_lane_on/off_internal
                 * on the audio thread. The set_params here stay as the stock
                 * Schwung path. JS-side bookkeeping (HeldLanes/LatchedLanes
                 * Sets) is parallel state for OLED display — stays correct
                 * because JS and DSP run the same toggle logic. */
                const lane = drumPadToLane(padIdx);
                if (lane >= 0 && lane < DRUM_LANES) {
                    setActiveDrumLane(t, lane);
                    syncDrumLaneSteps(t, lane);
                    refreshDrumLaneBankParams(t, lane);
                    if (S.drumRepeat2LatchedLanes[t].has(lane)) {
                        S.drumRepeat2LatchedLanes[t].delete(lane);
                        if (typeof host_module_set_param === 'function' && !S.dspInboundEnabled)
                            host_module_set_param('t' + t + '_drum_repeat2_lane_off', String(lane));
                        if (S.loopHeld) S.rpt2LoopPadUsed = true;
                    } else {
                        S.drumRepeat2HeldLanes[t].add(lane);
                        if (S.loopHeld) { S.drumRepeat2LatchedLanes[t].add(lane); S.rpt2LoopPadUsed = true; }
                        padPitch[padIdx] = -1;
                        if (typeof host_module_set_param === 'function') {
                            if (!S.dspInboundEnabled)
                                host_module_set_param('t' + t + '_drum_repeat2_lane_on', lane + ' ' + d2);
                            /* Phase 1 / Bundle 2C-Rpt2: Loop-held latch via
                             * the atomic latch_held set_param (handler ORs
                             * active|pending into latched). Avoids the
                             * coalescing trap of per-lane edge pushes: when
                             * multiple lanes are pressed simultaneously with
                             * Loop held, each press would push the same
                             * set_param key with a different lane payload
                             * → only the last lane would land. Non-Loop
                             * engagement needs no push (latched bit is 0
                             * by invariant: previously-latched lanes go
                             * through the unlatch path, not the engage path). */
                            if (S.loopHeld)
                                host_module_set_param('t' + t + '_drum_repeat2_latch_held', '1');
                        }
                    }
                    forceRedraw();
                }
                return;
            }
        }
        /* Capture + drum pad: silently select lane without playing a note */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.captureHeld && !S.muteHeld && !S.copyHeld && !S.deleteHeld) {
            const _sl_lane = drumPadToLane(padIdx);
            if (_sl_lane >= 0 && _sl_lane < DRUM_LANES) {
                const t = S.activeTrack;
                S.captureUsedAsModifier = true;
                padPitch[padIdx] = 0xFF;
                setActiveDrumLane(t, _sl_lane);
                syncDrumLaneSteps(t, _sl_lane);
                refreshDrumLaneBankParams(t, _sl_lane);
                forceRedraw();
                return;
            }
        }
        /* Drum mode pad handling */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && (!S.shiftHeld || S.muteHeld || S.copyHeld)) {
            const t = S.activeTrack;
            const lane = drumPadToLane(padIdx);
            const velZone = drumPadToVelZone(padIdx);
            if (velZone >= 0) {
                /* Velocity pad: which pad determines the zone; zone determines velocity.
                 * Pad pressure is ignored — zone vel used for monitoring, step-edit, recording. */
                S.drumLastVelZone[t] = velZone;
                S.drumVelZoneArmed[t] = true;
                const zoneVel  = drumVelZoneToVelocity(velZone);
                const lane_vp  = S.activeDrumLane[t];
                const laneNote = S.drumLaneNote[t][lane_vp];
                liveSendNote(t, 0x90, laneNote, zoneVel, true);
                padPitch[padIdx] = laneNote;
                padPressTick[padIdx] = S.tickCount;
                S.liveActiveNotes.add(laneNote);
                if (S.heldStep >= 0 && S.heldStepNotes.length > 0) {
                    /* Active vel-pad press while step held → zone wins (beats VelIn) */
                    const _heldWriteVel = stepEntryVelocity(t, zoneVel, true);
                    S.stepEditVel = _heldWriteVel;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane_vp + '_step_' + S.heldStep + '_vel', String(_heldWriteVel));
                    S.stepBtnPressedTick[S.heldStepBtn] = -1;
                }
                /* Record hit at zone velocity if armed */
                if (S.recordArmed && !S.recordCountingIn && t === S.recordArmedTrack) {
                    _drumRecNoteOns.push({ track: t, laneNote: laneNote, vel: zoneVel });
                    /* Monitor: DSP drum_record_note_on inline-fires live_note_on for
                     * ROUTE_MOVE, so a separate live_notes set_param here would just
                     * coalesce with the record payload. Mirrors melodic recording. */
                    S.pendingDrumLaneResync      = 3;
                    S.pendingDrumLaneResyncTrack = t;
                    S.pendingDrumLaneResyncLane  = lane_vp;
                }
                S.screenDirty = true;
            } else if (lane >= 0 && lane < DRUM_LANES && S.copyHeld && !S.muteHeld) {
                /* Copy+lane pad: drum lane copy/cut gesture (same track, active clip) */
                if (!S.copySrc) {
                    S.copySrc = S.shiftHeld
                        ? { kind: 'cut_drum_lane', track: t, lane: lane }
                        : { kind: 'drum_lane',     track: t, lane: lane };
                    invalidateLEDCache();
                    showActionPopup(S.shiftHeld ? 'CUT' : 'COPIED');
                } else if (S.copySrc.kind === 'drum_lane' && S.copySrc.track === t) {
                    copyDrumLane(t, S.copySrc.lane, lane);
                    setActiveDrumLane(t, lane);
                    refreshDrumLaneBankParams(t, lane);
                    invalidateLEDCache();
                    forceRedraw();
                    showActionPopup('PASTED');
                } else if (S.copySrc.kind === 'cut_drum_lane' && S.copySrc.track === t) {
                    cutDrumLane(t, S.copySrc.lane, lane);
                    S.copySrc = { kind: 'drum_lane', track: t, lane: lane };
                    setActiveDrumLane(t, lane);
                    refreshDrumLaneBankParams(t, lane);
                    invalidateLEDCache();
                    forceRedraw();
                    showActionPopup('PASTED');
                }
                /* Other S.copySrc kinds or cross-track: swallow */
            } else if (lane >= 0 && lane < DRUM_LANES && S.muteHeld) {
                /* Mute+pad: toggle lane mute; Shift+Mute+pad: toggle lane solo */
                S.muteUsedAsModifier = true;
                const bit = 1 << lane;
                if (S.shiftHeld) {
                    const wasOn = !!(S.drumLaneSolo[t] & bit);
                    if (wasOn) { S.drumLaneSolo[t] &= ~bit; }
                    else {
                        S.drumLaneSolo[t] |= bit;
                        if (S.drumLaneMute[t] & bit) {
                            S.drumLaneMute[t] &= ~bit;
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_l' + lane + '_mute', '0');
                        }
                    }
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_solo', wasOn ? '0' : '1');
                } else {
                    const wasOn = !!(S.drumLaneMute[t] & bit);
                    if (wasOn) { S.drumLaneMute[t] &= ~bit; }
                    else {
                        S.drumLaneMute[t] |= bit;
                        if (S.drumLaneSolo[t] & bit) {
                            S.drumLaneSolo[t] &= ~bit;
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_l' + lane + '_solo', '0');
                        }
                    }
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_mute', wasOn ? '0' : '1');
                }
                forceRedraw();
            } else if (lane >= 0 && lane < DRUM_LANES) {
                if (S.deleteHeld) {
                    /* Delete + lane pad: clear all steps in this lane */
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_clear', '1');
                    setActiveDrumLane(t, lane);
                    for (let s = 0; s < 256; s++) S.drumLaneSteps[t][lane][s] = '0';
                    S.drumLaneHasNotes[t][lane] = false;
                    const ac = S.trackActiveClip[t];
                    S.drumClipNonEmpty[t][ac] = false;
                    for (let ol = 0; ol < DRUM_LANES; ol++) {
                        if (S.drumLaneHasNotes[t][ol]) { S.drumClipNonEmpty[t][ac] = true; break; }
                    }
                    refreshDrumLaneBankParams(t, lane);
                    showActionPopup('LANE CLEARED');
                    forceRedraw();
                } else {
                    /* Lane pad: select lane, sync its steps and bank params */
                    setActiveDrumLane(t, lane);
                    syncDrumLaneSteps(t, lane);
                    refreshDrumLaneBankParams(t, lane);
                    if (S.moveCoRunTrack >= 0) {
                        /* Move co-run: the plain pad-on injected to Move (in _onPadPress)
                         * both sounds and selects this drum cell for editing. Suppress
                         * dAVEBOx's own monitor note + record so the tap is one Move-native
                         * hit, not a double. padPitch=0xFF makes _onPadRelease skip the
                         * dAVEBOx note-off too (same sentinel the Capture+pad select uses).
                         * Lane selection/sync above still runs so dAVEBOx state stays in
                         * sync; the held pad-off to Move is sent from _onPadRelease. */
                        padPitch[padIdx] = 0xFF;
                        forceRedraw();
                    } else {
                    /* Preview lane note at actual pad velocity */
                    const vel = effectiveVelocity(d2);
                    const laneNote = S.drumLaneNote[t][lane];
                    liveSendNote(t, 0x90, laneNote, vel);
                    padPitch[padIdx] = laneNote;
                    padPressTick[padIdx] = S.tickCount;
                    S.liveActiveNotes.add(laneNote);
                    /* Record step hit if armed */
                    if (S.recordArmed && !S.recordCountingIn && t === S.recordArmedTrack) {
                        const tvo = S.trackVelOverride[t];
                        const recVel = tvo > 0 ? tvo : vel;
                        _drumRecNoteOns.push({ track: t, laneNote: laneNote, vel: recVel });
                        /* Monitor: DSP drum_record_note_on inline-fires live_note_on for
                         * ROUTE_MOVE; explicit queueLiveNoteOn here would coalesce. */
                        S.pendingDrumLaneResync      = 3;
                        S.pendingDrumLaneResyncTrack = t;
                        S.pendingDrumLaneResyncLane  = lane;
                    }
                    /* Pre-roll capture: any press during count-in → deferred to step 0 after transport starts */
                    if (S.recordArmed && S.recordCountingIn && t === S.recordArmedTrack) {
                        const tvo = S.trackVelOverride[t];
                        const recVel = tvo > 0 ? tvo : vel;
                        S.pendingPrerollNote = { track: t, lane: lane, laneNote: laneNote,
                                                 vel: recVel, isDrum: true,
                                                 pressedAtTick: S.tickCount, countInStart: S.countInStartTick };
                    }
                    /* Phase 1 / Bundle 2C-Rpt1+Rpt2: lane-swap-while-holding-a-rate-pad.
                     * On patched Schwung drum_pad_event has called
                     * drum_repeat_lane_internal on the audio thread (folded
                     * into Bundle 2C-Rpt2 once drum_lane_page mirror was
                     * available). Set_param push kept as the stock fallback. */
                    if (S.drumPerformMode[t] === 1 && (S.drumRepeatHeldPad[t] >= 0 || S.drumRepeatLatched[t])) {
                        if (typeof host_module_set_param === 'function' && !S.dspInboundEnabled)
                            host_module_set_param('t' + t + '_drum_repeat_lane', String(lane));
                    }
                    forceRedraw();
                    }
                }
            }
        } else if (S.heldStep >= 0 && !S.shiftHeld) {
            /* Step edit: tap pad to toggle note assignment for held step */
            if (S.padNoteMap[padIdx] === 0xFF) return; /* OOB pad — no note to toggle */
            const ac    = effectiveClip(S.activeTrack);
            const _pitchRaw = S.padNoteMap[padIdx] + S.trackOctave[S.activeTrack] * 12;
            if (_pitchRaw < 0 || _pitchRaw > 127) return; /* OOB after track-octave shift */
            const pitch = _pitchRaw;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + S.activeTrack + '_c' + ac + '_step_' + S.heldStep + '_toggle', pitch + ' ' + stepEntryVelocity(S.activeTrack, effectiveVelocity(d2), false));
            /* Read back authoritative note list */
            const raw = typeof host_module_get_param === 'function'
                ? host_module_get_param('t' + S.activeTrack + '_c' + ac + '_step_' + S.heldStep + '_notes')
                : null;
            S.heldStepNotes = (raw && raw.trim().length > 0)
                ? raw.trim().split(' ').map(Number).filter(n => n >= 0 && n <= 127)
                : [];
            /* Mirror step active state in JS */
            S.clipSteps[S.activeTrack][ac][S.heldStep] = S.heldStepNotes.length > 0 ? 1 : 0;
            if (S.heldStepNotes.length > 0) {
                S.clipNonEmpty[S.activeTrack][ac] = true;
            } else if (S.clipNonEmpty[S.activeTrack][ac]) {
                S.clipNonEmpty[S.activeTrack][ac] = clipHasContent(S.activeTrack, ac);
            }
            refreshSeqNotesIfCurrent(S.activeTrack, ac, S.heldStep);
            /* Preview note */
            padPitch[padIdx] = pitch;
            S.liveActiveNotes.add(pitch);
            liveSendNote(S.activeTrack, 0x90, pitch, effectiveVelocity(d2));
            forceRedraw();
        } else if (S.shiftHeld && padIdx >= 24 && padIdx <= 31) {
            const _padOff = padIdx - 24;
            const _isDrum = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM;
            const _isConduct = S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT;
            let bankIdx;
            if (_isDrum) {
                /* Drum pad map: 92=ALL LANES(7) 93=DRUM LANE(0) 94=NOTE FX(1)
                                 95=MIDI DLY(3) 96=RPT GROOVE(5) 97=hidden
                                 98=CC PARAM(6) 99=hidden */
                const DRUM_PAD_MAP = [7, 0, 1, 3, 5, -1, 6, -1];
                bankIdx = DRUM_PAD_MAP[_padOff];
            } else if (_isConduct) {
                /* Conductor reaches only its five banks: pads 0-4 select
                   CONDUCT(0)/NOTE FX(1)/RESPONDER/OCTAVE/WHEN; pads 5-7 are no-ops. */
                const CONDUCT_PAD_MAP = [0, 1, BANK_RESPONDER, BANK_OCTAVE, BANK_WHEN, -1, -1, -1];
                bankIdx = CONDUCT_PAD_MAP[_padOff];
            } else {
                bankIdx = _padOff;
            }
            /* 8-10 reachable only via CONDUCT_PAD_MAP; drum/melodic cap at 7 */
            if (bankIdx >= 0 && bankIdx < BANKS.length && BANKS[bankIdx]) {
                if (S.activeBank === bankIdx) {
                    S.bankSelectTick = -1;
                } else {
                    S.activeBank = bankIdx;
                    S.trackActiveBank[S.activeTrack] = bankIdx;
                    if (bankIdx === 7) S.allLanesConfirmed = false;
                    if (bankIdx === 6) S.schLabelFetchLane = 0;
                    readBankParams(S.activeTrack, bankIdx);
                    S.bankSelectTick = S.tickCount;
                    writeSidecar();
                }
                S.screenDirty = true;
            }
        } else if (S.shiftHeld && padIdx < NUM_TRACKS) {
            /* Shift + bottom-row pad: select active track */
            extNoteOffAll();
            handoffRecordingToTrack(padIdx);
            _switchActiveTrack(padIdx);
            refreshPerClipBankParams(padIdx);
            computePadNoteMap();
            S.seqActiveNotes.clear();
            S.seqLastStep = -1;
            S.seqLastClip = -1;
            /* Sync drum lane metadata for the new track */
            if (S.trackPadMode[padIdx] === PAD_MODE_DRUM) {
                /* Fall back from banks hidden on drum tracks */
                if (S.activeBank === 2 || S.activeBank === 4) S.activeBank = 0;
                resyncDrumTrack(padIdx);
            } else {
                if (S.activeBank === 7) S.activeBank = 0;
            }
            S.screenDirty = true;
        } else if (!S.shiftHeld) {
            /* Live note — apply per-track octave shift; skip OOB to avoid ghost
             * dispatches of clamped note 0 (or 127) when multiple pads' shifted
             * pitches land outside [0,127]. */
            const basePitch = S.padNoteMap[padIdx];
            if (basePitch === 0xFF) return; /* OOB base */
            const _pitchRaw = basePitch + S.trackOctave[S.activeTrack] * 12;
            if (_pitchRaw < 0 || _pitchRaw > 127) return; /* OOB after track-octave shift */
            const pitch = _pitchRaw;
            padPitch[padIdx] = pitch;
            S.atLastSent[padIdx] = -1;   /* fresh press → next aftertouch always sends */
            S.lastPlayedNote  = pitch;
            S.lastPadVelocity = effectiveVelocity(d2);
            S.liveActiveNotes.add(pitch);
            liveSendNote(S.activeTrack, 0x90, pitch, effectiveVelocity(d2));
            /* Record capture: queue into _recNoteOns regardless of count-in
             * state. Flush is gated on !S.recordCountingIn so events accumulate
             * during count-in and drain at the count-in→recording transition.
             * DSP authoritatively filters: on patched Schwung, presses without
             * an active on_midi slot are dropped (early count-in window etc.),
             * so JS doesn't need its own (rate-mismatched) timing filter. */
            if (S.recordArmed && S.activeTrack === S.recordArmedTrack)
                recordNoteOn(pitch, effectiveVelocity(d2), S.recordArmedTrack);
        }
    }
}

function _onPadPress(status, d1, d2) {
        /* Move-native co-run + drum-mode active track: inject a PLAIN pad-on
         * (cable-0, no Shift) so Move firmware both plays the drum AND focuses
         * that cell for editing — a plain tap selects on Move. dAVEBOx then
         * SUPPRESSES its own monitor note for this pad (see the moveCoRunTrack
         * branch in _onPadPressTrackView), so the tap is a single Move-native
         * hit, not a double. No Shift injection anywhere → nothing for Move to
         * latch (an earlier Shift-based scheme double-tap-latched Move's Shift).
         * Mask: left 4 columns of each pad row, where notes 68-99 are laid out
         * bottom-to-top as 68-75 / 76-83 / 84-91 / 92-99 — left-4x4 is
         * (d1 - 68) % 8 < 4. Note-on (status 0x9_) with d2 > 0 only. Pass the
         * actual pad velocity (d2) through so Move plays at the hit velocity,
         * just like a real physical pad press. The pad stays open until physical
         * release (_onPadRelease sends the matching pad-off). */
        if (S.moveCoRunTrack >= 0 &&
                S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM &&
                d1 >= 68 && d1 <= 99 && ((d1 - 68) % 8) < 4 &&
                (status & 0xF0) === 0x90 && d2 > 0 &&
                typeof move_midi_inject_to_move === 'function') {
            move_midi_inject_to_move([0x09, 0x90, d1, d2 & 0x7F]);  /* plain pad on at hit velocity — held until release */
            S.moveCoRunDrumHeld = d1;
        }
        if (S.tapTempoOpen && d1 >= 68 && d1 <= 99) {
            registerTapTempo(d1);
            return;
        }
        /* Arp Steps interval mode (jog-clicked into bank 4): pad press = step vel level edit.
         * Column = step (0..7); row sets level (1=bottom..4=top). Bottom-row
         * press when already at level 1 → level 0 (step off). Persistent (no Steps Mode gate).
         * Loop-held: pad column sets step pattern loop length (1..8). */
        if (!S.sessionView && S.stepIntervalMode && S.activeBank === 4 &&
                d1 >= 68 && d1 <= 99) {
            const idx = d1 - 68;
            const col = idx % 8;
            const t   = S.activeTrack;
            const ac  = effectiveClip(t);
            if (S.loopHeld) {
                const newLen = col + 1;
                if (S.seqArpStepLoopLen[t][ac] !== newLen) {
                    S.seqArpStepLoopLen[t][ac] = newLen;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_seq_arp_step_loop_len', String(newLen));
                    forceRedraw();
                }
                return;
            }
            const row = Math.floor(idx / 8);
            const cur = S.seqArpStepVel[t][ac][col] | 0;
            const newLvl = (row === 0 && cur === 1) ? 0 : (row + 1);
            if (newLvl !== cur) {
                S.seqArpStepVel[t][ac][col] = newLvl;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_seq_arp_step_vel', col + ' ' + newLvl);
                forceRedraw();
            }
            return;
        }
        /* Arp Steps interval mode (jog-clicked into bank 5 = TARP): pad press = step vel level edit.
         * Loop-held: pad column sets step pattern loop length (1..8). */
        if (!S.sessionView && S.stepIntervalMode && S.activeBank === 5 &&
                d1 >= 68 && d1 <= 99) {
            const idx = d1 - 68;
            const col = idx % 8;
            const t   = S.activeTrack;
            if (S.loopHeld) {
                const newLen = col + 1;
                if (S.tarpStepLoopLen[t] !== newLen) {
                    S.tarpStepLoopLen[t] = newLen;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_tarp_step_loop_len', String(newLen));
                    forceRedraw();
                }
                return;
            }
            const row = Math.floor(idx / 8);
            const cur = S.tarpStepVel[t][col] | 0;
            const newLvl = (row === 0 && cur === 1) ? 0 : (row + 1);
            if (newLvl !== cur) {
                S.tarpStepVel[t][col] = newLvl;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_tarp_step_vel', col + ' ' + newLvl);
                forceRedraw();
            }
            return;
        }
        /* Performance Mode pad intercept: absorb all pad presses when Perf Mode is active. */
        if (S.sessionView && (S.loopHeld || S.perfViewLocked) && d1 >= 68 && d1 <= 99) {
            if (d1 >= 68 && d1 <= 75) {
                /* R0: rate pads 0-4 (arm/stack), hold (5), sync (6), latch (7) */
                const subIdx = d1 - 68;
                if (subIdx === 7) {
                    S.perfLatchPressedTick = S.tickCount;
                } else if (subIdx === 6) {
                    S.perfSync = !S.perfSync;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('looper_sync', S.perfSync ? '1' : '0');
                } else if (subIdx === 5) {
                    /* Hold pad: in sticky mode → cancel sticky + stop loop.
                     * Otherwise → momentary hold (length releases don't pop while held). */
                    if (S.perfStickyLengths.size > 0) {
                        S.perfStickyLengths = new Set();
                        S.perfStack         = [];
                        if (!S.loopHeld) S.perfViewLocked = false;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('looper_stop', '1');
                    } else {
                        S.perfHoldPadHeld = true;
                    }
                } else {
                    const ticks = LOOPER_RATES_STRAIGHT[subIdx];
                    if (S.shiftHeld) {
                        /* Shift+length toggles sticky hold for that length */
                        if (S.perfStickyLengths.has(subIdx)) {
                            /* Remove sticky + pop from stack */
                            S.perfStickyLengths.delete(subIdx);
                            const sIdx = S.perfStack.findIndex(function(e) { return e.idx === subIdx; });
                            if (sIdx >= 0) S.perfStack.splice(sIdx, 1);
                            if (typeof host_module_set_param === 'function') {
                                if (S.perfStack.length === 0) host_module_set_param('looper_stop', '1');
                                else host_module_set_param('looper_arm', String(S.perfStack[S.perfStack.length - 1].ticks));
                            }
                            if (S.perfStickyLengths.size === 0 && !S.loopHeld) S.perfViewLocked = false;
                        } else {
                            /* Add sticky + ensure on stack + lock view */
                            S.perfStickyLengths.add(subIdx);
                            if (S.perfStack.findIndex(function(e) { return e.idx === subIdx; }) < 0) {
                                S.perfStack.push({ idx: subIdx, ticks: ticks });
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('looper_arm', String(ticks));
                            }
                            S.perfViewLocked = true;
                        }
                    } else {
                        const inStack = S.perfStack.findIndex(function(e) { return e.idx === subIdx; }) >= 0;
                        const inHeld  = S.perfStickyLengths.has(subIdx) || S.perfHoldPadHeld;
                        if (!inStack) {
                            S.perfStack.push({ idx: subIdx, ticks: ticks });
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('looper_arm', String(ticks));
                        } else if (inHeld) {
                            /* Re-trigger capture for a held loop: atomic stop + arm */
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('looper_retrigger', String(ticks));
                        }
                    }
                }
            } else {
                const modIdx = PERF_MOD_PAD_MAP[d1];
                if (modIdx !== undefined) {
                    const bit = (1 << modIdx);
                    if (S.perfLatchMode) {
                        S.perfModsToggled ^= bit;
                    } else if (S.perfModsToggled & bit) {
                        /* Non-latch press on an already-on bit (e.g. from preset recall):
                         * clear it instead of stacking a momentary held bit on top. */
                        S.perfModsToggled &= ~bit;
                    } else {
                        S.perfModsHeld |= bit;
                    }
                    S.perfModPopupName    = PERF_MOD_FULL_NAMES[modIdx] || '';
                    S.perfModPopupEndTick = S.tickCount + PERF_MOD_POPUP_TICKS;
                    sendPerfMods();
                }
            }
            forceRedraw();
            return;
        }
        if (S.sessionView) {
            for (let row = 0; row < 4; row++) {
                const rowBase = 92 - row * 8;
                if (d1 >= rowBase && d1 < rowBase + NUM_TRACKS) {
                    const t = d1 - rowBase;
                    if (S.muteHeld) {
                        /* Mute-held + pad: toggle mute/solo on that track's column */
                        if (S.shiftHeld) setTrackSolo(t, !S.trackSoloed[t]);
                        else           setTrackMute(t, !S.trackMuted[t]);
                    } else if (S.copyHeld) {
                        /* Copy + clip pad (Session View): clip-to-clip copy */
                        const clipIdx = S.sceneRow + row;
                        const isDrumT = S.trackPadMode[t] === PAD_MODE_DRUM;
                        if (S.copySrc && S.copySrc.kind === 'step') {
                            /* step copy in progress: swallow */
                        } else if (!S.copySrc) {
                            if (isDrumT) {
                                S.copySrc = S.shiftHeld
                                    ? { kind: 'cut_drum_clip', track: t, clip: clipIdx }
                                    : { kind: 'drum_clip',     track: t, clip: clipIdx };
                            } else {
                                S.copySrc = S.shiftHeld
                                    ? { kind: 'cut_clip', track: t, clip: clipIdx }
                                    : { kind: 'clip',     track: t, clip: clipIdx };
                            }
                            invalidateLEDCache();
                            showActionPopup(S.shiftHeld ? 'CUT' : 'COPIED');
                        } else if (S.copySrc.kind === 'clip') {
                            copyClip(S.copySrc.track, S.copySrc.clip, t, clipIdx);
                            invalidateLEDCache();
                            forceRedraw();
                            showActionPopup('PASTED');
                        } else if (S.copySrc.kind === 'cut_clip') {
                            cutClip(S.copySrc.track, S.copySrc.clip, t, clipIdx);
                            S.copySrc = { kind: 'clip', track: t, clip: clipIdx };
                            invalidateLEDCache();
                            forceRedraw();
                            showActionPopup('PASTED');
                        } else if (S.copySrc.kind === 'drum_clip' && isDrumT) {
                            copyDrumClip(S.copySrc.track, S.copySrc.clip, t, clipIdx);
                            invalidateLEDCache();
                            forceRedraw();
                            showActionPopup('PASTED');
                        } else if (S.copySrc.kind === 'cut_drum_clip' && isDrumT) {
                            cutDrumClip(S.copySrc.track, S.copySrc.clip, t, clipIdx);
                            S.copySrc = { kind: 'drum_clip', track: t, clip: clipIdx };
                            invalidateLEDCache();
                            forceRedraw();
                            showActionPopup('PASTED');
                        }
                        /* row/cut_row kinds, drum→melodic or melodic→drum mismatch: swallow */
                    } else if (S.shiftHeld && S.deleteHeld) {
                        /* Shift+Delete + clip pad (Session View): hard reset that clip */
                        const clipIdx = S.sceneRow + row;
                        hardResetClip(t, clipIdx);
                        forceRedraw();
                        showActionPopup('CLIP', 'CLEARED');
                    } else if (S.deleteHeld) {
                        /* Delete + clip pad (Session View): clear that clip, keep transport */
                        const clipIdx = S.sceneRow + row;
                        clearClip(t, clipIdx, true);
                        forceRedraw();
                        showActionPopup('SEQUENCE', 'CLEARED');
                    } else {
                        const clipIdx      = S.sceneRow + row;
                        const isActiveClip = S.trackActiveClip[t] === clipIdx;
                        if (S.shiftHeld) {
                            /* Shift+pad: open clip for editing (focus + jump to
                             * Track View). It must NOT turn on a stopped clip
                             * that has notes — "off until I turn it on". So the
                             * actual launch fires only when playing (the engine
                             * can only show/edit the DSP's active clip while
                             * running — pollDSP re-syncs trackActiveClip each
                             * tick) or when the clip is empty (harmless). */
                            const isPlaying = S.trackClipPlaying[t] && isActiveClip;
                            const isWR      = S.trackWillRelaunch[t] && isActiveClip;
                            const isQueued  = S.trackQueuedClip[t] === clipIdx;
                            if (!isPlaying && !isWR && !isQueued) {
                                if (!S.playing) {
                                    const prevClip = S.trackActiveClip[t];
                                    S.trackActiveClip[t]  = clipIdx;
                                    /* Snap to page containing loop_start so
                                     * non-zero-start clips don't show OOB
                                     * region on initial select. */
                                    S.trackCurrentPage[t] = S.trackPadMode[t] === PAD_MODE_DRUM
                                        ? 0
                                        : Math.floor((S.clipLoopStart[t][clipIdx] | 0) / 16);
                                    refreshPerClipBankParams(t);
                                    if (S.trackPadMode[t] === PAD_MODE_DRUM && prevClip !== clipIdx) {
                                        S.pendingDrumResync      = 2;
                                        S.pendingDrumResyncTrack = t;
                                    }
                                }
                                if ((S.playing || _clipIsEmpty(t, clipIdx))
                                        && typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
                            }
                            handoffRecordingToTrack(t);
                            _switchActiveTrack(t);
                            refreshPerClipBankParams(t);
                            S.sessionView = false;
                            S.shiftTrackLEDActive = false;
                            invalidateLEDCache();
                            forceRedraw();
                        } else if (S.trackClipPlaying[t] && isActiveClip) {
                            handoffRecordingToTrack(t);
                            _switchActiveTrack(t);
                            refreshPerClipBankParams(t);
                            if (S.trackPendingPageStop[t]) {
                                /* Pending stop → cancel by re-launching */
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
                            } else {
                                /* Playing → arm stop at next page boundary */
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + t + '_stop_at_end', '1');
                            }
                        } else if (S.trackWillRelaunch[t] && isActiveClip) {
                            /* Transport stopped, clip primed to restart → cancel */
                            handoffRecordingToTrack(t);
                            _switchActiveTrack(t);
                            refreshPerClipBankParams(t);
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_deactivate', '1');
                        } else if (S.trackQueuedClip[t] === clipIdx) {
                            /* Queued to launch → cancel */
                            handoffRecordingToTrack(t);
                            _switchActiveTrack(t);
                            refreshPerClipBankParams(t);
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_deactivate', '1');
                        } else {
                            /* Launch clip for this track */
                            handoffRecordingToTrack(t);
                            _switchActiveTrack(t);
                            if (!S.playing) {
                                const prevClip = S.trackActiveClip[t];
                                S.trackActiveClip[t]  = clipIdx;
                                S.trackCurrentPage[t] = 0;
                                if (S.trackPadMode[t] === PAD_MODE_DRUM && prevClip !== clipIdx) {
                                    S.pendingDrumResync      = 2;
                                    S.pendingDrumResyncTrack = t;
                                }
                            }
                            refreshPerClipBankParams(t);
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
                        }
                    }
                    break;
                }
            }
        } else {
            _onPadPressTrackView(status, d1, d2);
        }
}

function _jumpToMenuLabel(label) {
    openGlobalMenu();
    if (!S.globalMenuItems || !S.globalMenuState) return;
    for (let i = 0; i < S.globalMenuItems.length; i++) {
        const it = S.globalMenuItems[i];
        if (it && it.label === label) {
            S.globalMenuState.selectedIndex = i;
            return;
        }
    }
}

function _doShiftStepCommon(idx) {
    if      (idx === 1) _jumpToMenuLabel('Global');
    else if (idx === 2 && !S.sessionView) {
        /* Track View only — Session View Shift+Step3 is reserved for the
         * existing menu-shortcut set. Defer co-run entry until Shift releases
         * — otherwise the held Shift CC leaks into Move firmware / Schwung
         * chain editor (the shim starts forwarding Shift on co-run entry).
         * Dispatch happens in _onCC_buttons Shift-release branch. */
        S.pendingEditEntryTrack = S.activeTrack;
    }
    else if (idx === 4) {
        if (S.clockFollowOn) { S.bpmMoveInfo = true; forceRedraw(); }
        else openTapTempo();
    }
    else if (idx === 5) {
        S.metronomeOn = (S.metronomeOn === 1) ? 3 : 1;
        if (typeof host_module_set_param === 'function')
            host_module_set_param('metro_on', String(S.metronomeOn));
        showActionPopup(['Off', 'Cnt-In', 'Play', 'Always'][S.metronomeOn]);
    }
    else if (idx === 6) _jumpToMenuLabel('Swing Amt');
    else if (idx === 8) _jumpToMenuLabel('Scale');
}

/* Loop+step gesture fire helpers — both the deferred fallback (length-only,
 * loop_start=0) and the active range gesture (loop_start=a*16, length=(b-a+1)*16)
 * route through the new atomic `*_loop_set` DSP keys so there is exactly one
 * DSP write path. Packed encoding mirrors seq8_set_param.c: ls<<16 | length. */
function _fireLoopWindowSet(track, ctx, startStep, lenSteps) {
    if (typeof host_module_set_param !== 'function') return;
    if (ctx === 3) { _fireLoopWindowSetCC(track, startStep, lenSteps); return; }
    const packed = (startStep << 16) | (lenSteps & 0xFFFF);
    if (ctx === 0) {
        /* Melodic per-active-clip */
        const ac = effectiveClip(track);
        S.clipLength[track][ac]     = lenSteps;
        S.clipLoopStart[track][ac]  = startStep;
        S.clipLengthManuallySet[track][ac] = true;
        const startPage = startStep >> 4;
        const lastPage  = startPage + ((lenSteps + 15) >> 4) - 1;
        if (S.trackCurrentPage[track] < startPage) S.trackCurrentPage[track] = startPage;
        else if (S.trackCurrentPage[track] > lastPage) S.trackCurrentPage[track] = lastPage;
        host_module_set_param('t' + track + '_c' + ac + '_loop_set', String(packed));
    } else if (ctx === 1) {
        /* Drum lane (active lane on this track) */
        const lane = S.activeDrumLane[track];
        S.drumLaneLength[track]    = lenSteps;
        S.drumLaneLoopStart[track] = startStep;
        S.drumLaneLengthManuallySet[track] = true;
        const startPage = startStep >> 4;
        const lastPage  = startPage + ((lenSteps + 15) >> 4) - 1;
        if (S.drumStepPage[track] < startPage) S.drumStepPage[track] = startPage;
        else if (S.drumStepPage[track] > lastPage) S.drumStepPage[track] = lastPage;
        host_module_set_param('t' + track + '_l' + lane + '_loop_set', String(packed));
    } else {
        if (allLanesGate()) return;
        /* ALL LANES: all 32 drum lanes of the active drum clip get the same window */
        S.drumLaneLength[track]    = lenSteps;
        S.drumLaneLoopStart[track] = startStep;
        S.drumLaneLengthManuallySet[track] = true;
        const startPage = startStep >> 4;
        const lastPage  = startPage + ((lenSteps + 15) >> 4) - 1;
        if (S.drumStepPage[track] < startPage) S.drumStepPage[track] = startPage;
        else if (S.drumStepPage[track] > lastPage) S.drumStepPage[track] = lastPage;
        S.pendingDrumResync = 2; S.pendingDrumResyncTrack = track;
        host_module_set_param('t' + track + '_all_lanes_loop_set', String(packed));
    }
}

function _fireLoopWindowSetCC(track, startStep, lenSteps) {
    if (typeof host_module_set_param !== 'function') return;
    var ac = effectiveClip(track);
    var lane = S.ccActiveLane[track];
    S.ccLaneLoopStart[track][ac][lane] = startStep;
    S.ccLaneLength[track][ac][lane] = lenSteps;
    var packed = (startStep << 16) | (lenSteps & 0xFFFF);
    host_module_set_param('t' + track + '_c' + ac + '_k' + lane + '_cc_loop_set', String(packed));
    var startPage = startStep >> 4;
    var lastPage  = startPage + ((lenSteps + 15) >> 4) - 1;
    if (S.trackCurrentPage[track] < startPage) S.trackCurrentPage[track] = startPage;
    else if (S.trackCurrentPage[track] > lastPage) S.trackCurrentPage[track] = lastPage;
}

/* Snapshot the gesture context at press-time so a later release fires in the
 * same context the user started in (immune to track/lane/bank flips). */
function _loopGestureCtxFor(track) {
    if (S.trackPadMode[track] !== PAD_MODE_DRUM) {
        if (S.activeBank === 6) return 3;
        return 0;
    }
    return S.activeBank === 7 ? 2 : 1;
}

/* Drop any partial Loop+step gesture, optionally firing the length-only
 * fallback if a B-tap never landed. Called on step release of the held
 * start page AND on Loop button release.
 *
 * Fallback semantics:
 *   loop_start == 0 → length = (a+1)*16, loop_start stays 0 (the original
 *                     pre-window single-tap behavior, preserved).
 *   loop_start > 0  → if a >= startPage: length = (a - startPage + 1)*16,
 *                     loop_start unchanged ("set END at page a, keep start").
 *                     if a < startPage: tap is below the window — re-anchor
 *                     by resetting to loop_start=0, length=(a+1)*16. */
function _resolveLoopGesture(fireFallback) {
    const a = S.loopGestureStart;
    if (a < 0) return;
    const ctx   = S.loopGestureCtx;
    const trk   = S.loopGestureTrack;
    const clip  = S.loopGestureClip;
    const fired = S.loopGestureFired;
    S.loopGestureStart = -1;
    S.loopGestureFired = false;
    S.loopGestureTrack = -1;
    S.loopGestureClip  = -1;
    S.loopGestureLane  = -1;
    if (fired) { forceRedraw(); return; }
    if (fireFallback) {
        var currentLs, currentLen;
        if (ctx === 3) {
            var _ccLane = S.ccActiveLane[trk];
            currentLs  = S.ccLaneLoopStart[trk][clip][_ccLane] | 0;
            currentLen = S.ccLaneLength[trk][clip][_ccLane] | 0;
            if (currentLen === 0) {
                var _cTps = S.clipTPS[trk][clip] || 24;
                var _lTps = S.ccLaneTps[trk][clip][_ccLane] || _cTps;
                currentLs  = Math.round((S.clipLoopStart[trk][clip] | 0) * _cTps / _lTps);
                currentLen = Math.max(1, Math.round(S.clipLength[trk][clip] * _cTps / _lTps));
            }
        } else if (ctx === 0) {
            currentLs  = S.clipLoopStart[trk][clip] | 0;
            currentLen = S.clipLength[trk][clip] | 0;
        } else {
            currentLs  = S.drumLaneLoopStart[trk] | 0;
            currentLen = S.drumLaneLength[trk] | 0;
        }
        const startPage = currentLs >> 4;
        let newLs, newLen;
        if (currentLs === 0 || a < startPage) {
            newLs  = 0;
            newLen = (a + 1) * 16;
        } else {
            newLs  = currentLs;
            newLen = (a - startPage + 1) * 16;
        }
        if (newLen === currentLen && currentLen === 32) {
            newLen = 16;
        }
        _fireLoopWindowSet(trk, ctx, newLs, newLen);
    }
    forceRedraw();
}

function _onStepButtons(d1, d2) {
    /* Co-run (Schwung chain-edit or Move-native): the step grid is blanked down
     * to a single exit affordance (the blinking Step 3 button + lit icon).
     * Step 3 (idx 2) exits co-run; every other step press is swallowed so it
     * can't edit the clip hidden underneath. Mirrors the Menu (CC 50) exit. */
    if (S.schwungCoRunSlot >= 0 || S.moveCoRunTrack >= 0) {
        if (d1 - 16 === 2) {
            if (S.moveCoRunTrack >= 0) exitMoveNativeCoRun();
            else { exitSchwungCoRun(); forceRedraw(); }
        }
        return;
    }
    if (S.tapTempoOpen) return;
    if (d2 > 0 && S.shiftTrackLEDActive) { S.shiftTrackLEDActive = false; S.screenDirty = true; }
    S.stepOpTick = S.tickCount;
    const idx = d1 - 16;
    /* Delete+step in session view: clear perf preset or mute snapshot slot immediately. */
    if (S.sessionView && S.deleteHeld) {
        if (S.loopHeld || S.perfViewLocked) {
            S.perfSnapshots[idx] = 0;
            if (S.perfRecalledSlot === idx) { S.perfRecalledSlot = -1; S.perfModsToggled = 0; sendPerfMods(); }
            showActionPopup('PERF PRESET', 'CLEARED');
        } else if (S.muteHeld) {
            S.snapshots[idx] = null;
            S.pendingDefaultSetParams.push({ key: 'snap_delete', val: String(idx) });
            showActionPopup('MUTE STATE', 'CLEARED');
        }
        forceRedraw();
        return;
    }
    /* Perf Mode: step buttons are preset snapshot slots — defer to release for tap/hold decision. */
    if (S.sessionView && (S.loopHeld || S.perfViewLocked)) {
        S.stepBtnPressedTick[idx] = S.tickCount;
        S.sessionStepHeld         = idx;
        S.sessionStepHeldCtx      = 1;  /* perf */
        return;
    }
    if (S.sessionView) {
        /* Scene-bake picker active (set by Session-View Capture tap): step
         * press selects scene → straight to scene-bake confirm. */
        if (S.pendingSceneBakePicker) {
            S.pendingSceneBakePicker = false;
            S.confirmBakeScene          = true;
            S.confirmBakeSceneWrapPhase = false;
            S.confirmBakeSceneCondPhase = false;
            S.confirmBakeSceneSel    = 1;
            S.confirmBakeSceneClip   = idx;
            S.screenDirty            = true;
            return;
        }
        /* Multi-track live merge placement: step press picks destination row. */
        if (S.pendingMergePlacement) {
            S.pendingMergePlacement = false;
            S.pendingDefaultSetParams.push({ key: 'merge_place_row', val: String(idx) });
            S.screenDirty = true;
            return;
        }
        if (S.muteHeld) {
            /* All 16 step buttons are snapshot slots — defer to release for tap/hold decision. */
            S.stepBtnPressedTick[idx] = S.tickCount;
            S.sessionStepHeld         = idx;
            S.sessionStepHeldCtx      = 2;  /* mute */
            return;
        } else if (S.shiftHeld) {
            _doShiftStepCommon(idx);
            forceRedraw();
        } else if (!S.deleteHeld) {
            S.pendingDefaultSetParams.push({ key: 'launch_scene', val: String(idx) });
        }
        /* S.deleteHeld (non-mute/shift) in Session View: swallow */
    } else if (S.loopHeld) {
        if (S.recordArmed && !S.recordCountingIn) {
            /* Block length changes during active recording */
        } else if (S.loopGestureStart < 0) {
            /* First press: arm the gesture. Defer the actual DSP write to
             * either a B-tap (range) or this step's release (length-only
             * fallback) so a single tap retains its existing semantics. */
            const t = S.activeTrack;
            S.loopGestureStart = idx;
            S.loopGestureFired = false;
            S.loopGestureCtx   = _loopGestureCtxFor(t);
            S.loopGestureTrack = t;
            S.loopGestureClip  = (S.loopGestureCtx === 0 || S.loopGestureCtx === 3) ? effectiveClip(t) : -1;
            S.loopGestureLane  = (S.loopGestureCtx === 1) ? S.activeDrumLane[t] : -1;
            forceRedraw();
        } else if (idx !== S.loopGestureStart) {
            /* Second tap while holding start — fire the range. B<A swaps so
             * the window is always [min, max]. Multiple B taps re-fire (last
             * tap wins, allowing scrub without releasing the start page). */
            const a = Math.min(S.loopGestureStart, idx);
            const b = Math.max(S.loopGestureStart, idx);
            const startStep = a * 16;
            const lenSteps  = (b - a + 1) * 16;
            _fireLoopWindowSet(S.loopGestureTrack, S.loopGestureCtx, startStep, lenSteps);
            S.loopGestureFired = true;
            forceRedraw();
        }
        /* idx === loopGestureStart while held: ignore (same-page tap is a no-op) */
    } else if (S.copyHeld) {
        /* Copy + step button (Track View): step-to-step copy within active clip */
        const ac     = effectiveClip(S.activeTrack);
        const absIdx = S.trackCurrentPage[S.activeTrack] * 16 + idx;
        if (!S.copySrc) {
            S.copySrc = { kind: 'step', absStep: absIdx };
            invalidateLEDCache();
        } else if (S.copySrc.kind === 'step') {
            if (S.copySrc.absStep !== absIdx) copyStep(S.activeTrack, ac, S.copySrc.absStep, absIdx);
            invalidateLEDCache();
            forceRedraw();
        }
        /* S.copySrc.kind !== 'step': swallow — don't mix copy types */
    } else if (S.deleteHeld) {
        /* Delete + step button (Track View): clear all notes from that step.
         * On the CC bank (melodic), instead clear all knobs' points in the step. */
        if (S.activeBank === 6) {
            var t = S.activeTrack, ac = effectiveClip(t);
            var absIdx = S.trackCurrentPage[t] * 16 + idx;
            var _ccL_d = S.ccActiveLane[t];
            var _ltps_d = S.ccLaneTps[t][ac][_ccL_d];
            var tps = (_ltps_d > 0) ? _ltps_d : (S.clipTPS[t][ac] || 24);
            var t1 = absIdx * tps, t2 = Math.min(65535, t1 + tps - 1);
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + t + '_cc_auto_clear_step', ac + ' ' + t1 + ' ' + t2);
            /* DSP may have emptied some lanes — refresh auto bits / rest on next tick
             * (get_param is null from this MIDI handler). */
            S.pendingCCBitsRefresh = ac;
            showActionPopup('CC STEP', 'CLEAR');
            invalidateLEDCache();
            forceRedraw();
        } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            /* Drum mode: clear step in active lane */
            const t       = S.activeTrack;
            const lane    = S.activeDrumLane[t];
            const absStep = S.drumStepPage[t] * 16 + idx;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + t + '_l' + lane + '_step_' + absStep + '_clear', '1');
            S.drumLaneSteps[t][lane][absStep] = '0';
            S.drumLaneHasNotes[t][lane] = S.drumLaneSteps[t][lane].some(c => c !== '0');
            forceRedraw();
        } else {
        const ac     = effectiveClip(S.activeTrack);
        const absIdx = S.trackCurrentPage[S.activeTrack] * 16 + idx;
        clearStep(S.activeTrack, ac, absIdx);
        forceRedraw();
        }
    } else if (S.shiftHeld) {
        /* Shift+step shortcuts */
        _doShiftStepCommon(idx);
        const t      = S.activeTrack;
        const isDrum = S.trackPadMode[t] === PAD_MODE_DRUM;
        if (idx === 7) {
            /* Step 8 (Track View only): drum=cycle perform mode; melodic=toggle chromatic */
            if (isDrum) {
                if (S.drumPerformMode[t] === 1) {
                    host_module_set_param('t' + t + '_drum_repeat_stop', '1');
                    S.drumRepeatHeldPad[t] = -1;
                    S.drumRepeatHeldPadsStack[t].length = 0;
                }
                if (S.drumPerformMode[t] === 2) {
                    S.drumRepeat2HeldLanes[t].clear();
                    S.drumRepeat2LatchedLanes[t].clear();
                    host_module_set_param('t' + t + '_drum_repeat2_stop', '1');
                }
                S.drumRepeatLatched[t] = false;
                setDrumPerformMode(t, (S.drumPerformMode[t] + 1) % 3);
                if (S.drumPerformMode[t] > 0) S.activeBank = 5;
                showModePopup('PERFORMANCE PADS',
                    ['Velocity', 'Repeat Play (Rpt1)', 'Repeat Set (Rpt2)'],
                    S.drumPerformMode[t]);
            } else {
                S.padLayoutChromatic[t] = !S.padLayoutChromatic[t];
                computePadNoteMap();
                showActionPopup(S.padLayoutChromatic[t] ? 'CHROMATIC' : 'IN-SCALE');
            }
        } else if (idx === 9) {
            /* Step 10: toggle VelIn between Live and 100 */
            const curVel = S.trackVelOverride[t];
            const nextVel = curVel === 0 ? 100 : 0;
            applyTrackConfig(t, 'track_vel_override', nextVel);
        } else if (idx === 10 && !isDrum) {
            /* Step 11: toggle TRACK ARP style on/off (melodic only) */
            const curStyle = S.bankParams[t][5][0] | 0;
            const nextStyle = curStyle !== 0 ? 0 : S.lastTarpStyle[t];
            S.bankParams[t][5][0] = nextStyle;
            applyBankParam(t, 5, 0, nextStyle);
        } else if (idx === 14) {
            /* Step 15: double-and-fill */
            if (S.activeBank === 6 && !isDrum) {
                doLaneDoubleFill();
            } else {
                doDoubleFill();
            }
        } else if (idx === 15 && S.activeBank !== 6) {
            /* Step 16: set quantize to 100% (not on auto bank) */
            if (isDrum) {
                if (S.activeBank === 7) {
                    /* ALL LANES: quantize all drum lanes */
                    if (allLanesGate()) return;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_drum_lanes_qnt', '100');
                    S.bankParams[t][7][3] = 100;
                    S.drumLaneQnt[t] = 100;
                    S.bankParams[t][1][2] = 100;
                } else {
                    const lane = S.activeDrumLane[t];
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_pfx_set', 'quantize 100');
                    S.drumLaneQnt[t] = 100;
                    S.bankParams[t][1][2] = 100;
                }
            } else {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_quantize', '100');
            }
            if (!isDrum) S.bankParams[t][1][3] = 100;  /* K4 = Qnt (melodic NOTE FX) */
            showActionPopup('QUANT 100%');
        }
        forceRedraw();
    } else if (!S.shiftHeld && S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
        /* Drum mode: tap toggles hit; hold enters step edit (Leng/Vel).
         * Press records time and state; toggle/clear deferred to release. */
        const t       = S.activeTrack;
        const lane    = S.activeDrumLane[t];
        const absStep = S.drumStepPage[t] * 16 + idx;
        S.stepBtnPressedTick[idx] = S.tickCount;
        if (S.heldStep < 0) {
            S.heldStepBtn = idx;
            S.heldStep    = absStep;
            const cur   = S.drumLaneSteps[t][lane][absStep];
            if (cur !== '0') {
                S.stepWasEmpty  = false;
                S.heldStepNotes = [S.drumLaneNote[t][lane]];
                const rv = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + t + '_l' + lane + '_step_' + absStep + '_vel') : null;
                const rg = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + t + '_l' + lane + '_step_' + absStep + '_gate') : null;
                const rn = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + t + '_l' + lane + '_step_' + absStep + '_nudge') : null;
                S.stepEditVel   = rv !== null ? parseInt(rv, 10) : 100;
                S.stepEditGate  = rg !== null ? parseInt(rg, 10) : (S.drumLaneTPS[t] || 24);
                S.stepEditNudge = rn !== null ? parseInt(rn, 10) : 0;
                const ri = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + t + '_l' + lane + '_step_' + absStep + '_iter') : null;
                const rr = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + t + '_l' + lane + '_step_' + absStep + '_rand') : null;
                const rx = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + t + '_l' + lane + '_step_' + absStep + '_ratch') : null;
                S.stepEditIter  = ri !== null ? parseInt(ri, 10) : 0;
                S.stepEditRand  = rr !== null ? parseInt(rr, 10) : 0;
                S.stepEditRatch = rx !== null ? parseInt(rx, 10) : 0;
            } else {
                S.stepWasEmpty  = true;
                S.heldStepNotes = [];
                S.stepEditVel   = stepEntryVelocity(t, -1, true);
                S.stepEditGate  = S.drumLaneTPS[t] || 24;
                S.stepEditNudge = 0;
                S.stepEditIter  = 0;
                S.stepEditRand  = 0;
                S.stepEditRatch = 0;
            }
            forceRedraw();
        } else if (S.stepBtnPressedTick[S.heldStepBtn] >= 0) {
            /* Primary still in tap window: multi-toggle this step immediately */
            const absStep2 = S.drumStepPage[t] * 16 + idx;
            const cur2     = S.drumLaneSteps[t][lane][absStep2];
            if (typeof host_module_set_param === 'function') {
                if (cur2 !== '1') {
                    host_module_set_param('t' + t + '_l' + lane + '_step_' + absStep2 + '_toggle', String(stepEntryVelocity(t, -1, true)));
                    S.drumLaneSteps[t][lane][absStep2] = '1';
                    S.drumLaneHasNotes[t][lane] = true;
                } else {
                    host_module_set_param('t' + t + '_l' + lane + '_step_' + absStep2 + '_clear', '1');
                    S.drumLaneSteps[t][lane][absStep2] = '0';
                    S.drumLaneHasNotes[t][lane] = S.drumLaneSteps[t][lane].some(c => c !== '0');
                }
            }
            S.stepBtnPressedTick[idx] = -1;
            forceRedraw();
        } else if (S.heldStepNotes.length > 0) {
            /* Primary in step edit (past tap threshold): tap sets gate span */
            S.stepBtnPressedTick[S.heldStepBtn] = -1;
            S.stepWasHeld = true;
            const tappedStep = S.drumStepPage[t] * 16 + idx;
            if (tappedStep !== S.heldStep) {
                const len     = S.drumLaneLength[t];
                const tps     = S.drumLaneTPS[t] || 24;
                /* Extend THROUGH the tapped step: gate spans up to the start
                 * of (tappedStep + 1), not just up to tappedStep. */
                const dist    = tappedStep > S.heldStep
                    ? tappedStep - S.heldStep + 1
                    : len - S.heldStep + tappedStep + 1;
                const newGate = Math.max(1, Math.min(dist * tps, 65535));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_gate', String(newGate));
                S.stepEditGate = newGate;
                forceRedraw();
            }
        }
    } else if (!S.shiftHeld) {
        /* Record press time for tap detection on release.
         * Enter step edit immediately — tap vs hold decided on release. */
        S.stepBtnPressedTick[idx] = S.tickCount;
        if (S.heldStep < 0) {
            const ac_p   = effectiveClip(S.activeTrack);
            const absP   = S.trackCurrentPage[S.activeTrack] * 16 + idx;
            S.heldStepBtn  = idx;
            S.heldStep     = absP;
            const pref_p = 't' + S.activeTrack + '_c' + ac_p + '_step_' + absP;
            /* get_param returns null in MIDI context — use clipSteps mirror to detect
             * truly empty (0) vs has-data (1=active, 2=inactive). Notes/vel/gate
             * are deferred to hold threshold where get_param works. */
            const _stepState = S.clipSteps[S.activeTrack][ac_p][absP];
            if (_stepState === 0) {
                S.stepWasEmpty  = true;
                S.heldStepNotes = [];
                if (S.activeBank === 6) {
                    S.ccStepEditActive = true;
                } else {
                    S.stepEditVel   = 100;
                    S.stepEditGate  = 12;
                    S.stepEditNudge = 0;
                    S.stepEditIter  = 0;
                    S.stepEditRand  = 0;
                    S.stepEditRatch = 0;
                }
            } else {
                S.stepWasEmpty  = false;
                S.heldStepNotes = [];   /* populated at hold threshold from tick context */
                if (S.activeBank === 6) {
                    S.ccStepEditActive = true;
                } else {
                    S.stepEditVel   = 100;
                    S.stepEditGate  = 12;
                    S.stepEditNudge = 0;
                    S.stepEditIter  = 0;
                    S.stepEditRand  = 0;
                    S.stepEditRatch = 0;
                }
            }
            /* Chord-first: pads were held before this step was pressed.
             * Store full context now — tick() may run after heldStep is cleared on quick release. */
            if (S.liveActiveNotes.size > 0 && S.activeBank !== 6 &&
                    S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM) {
                S.pendingChordToStep  = {
                    t:       S.activeTrack,
                    ac:      ac_p,
                    step:    absP,
                    wasEmpty: _stepState === 0,
                    pitches: [...S.liveActiveNotes].sort(function(a, b) { return a - b; }),
                    vel:     stepEntryVelocity(S.activeTrack, effectiveVelocity(S.lastPadVelocity), false)
                };
                S.stepBtnPressedTick[idx] = -1;   /* bypass tap-toggle on release */
                S.stepWasHeld = true;
            }
            forceRedraw();
        } else if (S.stepBtnPressedTick[S.heldStepBtn] >= 0 && S.activeBank !== 6) {
            /* Primary still in tap window: multi-toggle this step immediately.
             * Use S.clipSteps for state — get_param is unreliable from onMidiMessage context. */
            const ac_mp    = effectiveClip(S.activeTrack);
            const absStep2 = S.trackCurrentPage[S.activeTrack] * 16 + idx;
            const pref_mp  = 't' + S.activeTrack + '_c' + ac_mp + '_step_' + absStep2;
            const state_mp = S.clipSteps[S.activeTrack][ac_mp][absStep2]; // 0=empty, 1=active, 2=inactive-with-notes
            if (state_mp === 0) {
                const assignNote3 = S.lastPlayedNote >= 0 ? S.lastPlayedNote : -1;
                if (assignNote3 >= 0 && typeof host_module_set_param === 'function') {
                    host_module_set_param(pref_mp + '_toggle', assignNote3 + ' ' + stepEntryVelocity(S.activeTrack, -1, false));
                    S.clipSteps[S.activeTrack][ac_mp][absStep2] = 1;
                    S.clipNonEmpty[S.activeTrack][ac_mp] = true;
                    refreshSeqNotesIfCurrent(S.activeTrack, ac_mp, absStep2);
                }
            } else if (state_mp === 1) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pref_mp, '0');
                S.clipSteps[S.activeTrack][ac_mp][absStep2] = 2;
                if (S.clipNonEmpty[S.activeTrack][ac_mp]) S.clipNonEmpty[S.activeTrack][ac_mp] = clipHasContent(S.activeTrack, ac_mp);
                refreshSeqNotesIfCurrent(S.activeTrack, ac_mp, absStep2);
            } else {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pref_mp, '1');
                S.clipSteps[S.activeTrack][ac_mp][absStep2] = 1;
                S.clipNonEmpty[S.activeTrack][ac_mp] = true;
                refreshSeqNotesIfCurrent(S.activeTrack, ac_mp, absStep2);
            }
            S.stepBtnPressedTick[idx] = -1;
            forceRedraw();
        } else if (S.heldStepNotes.length > 0 && S.activeBank !== 6) {
            /* Primary in step edit (past tap threshold): tap sets gate span.
             * Clear S.heldStepBtn press-tick so the first step's release doesn't also tap-toggle. */
            S.stepBtnPressedTick[S.heldStepBtn] = -1;
            S.stepWasHeld = true;
            const ac_tap     = effectiveClip(S.activeTrack);
            const tappedStep = S.trackCurrentPage[S.activeTrack] * 16 + idx;
            if (tappedStep !== S.heldStep) {
                const len     = S.clipLength[S.activeTrack][ac_tap];
                const tps     = S.clipTPS[S.activeTrack][ac_tap] || 24;
                /* Extend THROUGH the tapped step; shrink if already at that span. */
                const dist    = tappedStep > S.heldStep
                    ? tappedStep - S.heldStep + 1
                    : len - S.heldStep + tappedStep + 1;
                const spanGate = dist * tps;
                const newGate = Math.max(1, Math.min(
                    S.stepEditGate >= spanGate ? (dist - 1) * tps : spanGate, 65535));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + S.activeTrack + '_c' + ac_tap + '_step_' + S.heldStep + '_gate', String(newGate));
                S.stepEditGate = newGate;
                forceRedraw();
            }
        }
    }
}

function _onPadRelease(status, d1, d2) {
    if (S.tapTempoOpen && d1 >= 68 && d1 <= 99) return;
    /* Co-run drum hold release: if the hold-threshold inject fired, send note-off
     * to close the held note in Move firmware. Always clear hold state on any
     * release of the tracked pad, even if the threshold hadn't fired yet. */
    if (S.moveCoRunTrack >= 0 && S.moveCoRunDrumHeld === d1 &&
            typeof move_midi_inject_to_move === 'function') {
        move_midi_inject_to_move([0x08, 0x80, d1, 0]);    /* plain pad off (no Shift was sent) */
        S.moveCoRunDrumHeld = -1;
    }
    /* Step buttons (notes 16-31): if a Loop+step gesture is in flight and
     * the released step is the held start, resolve the gesture — fire the
     * length-only fallback when no B-tap landed, or just clear state when
     * the range already fired on the B-tap. */
    if (d1 >= 16 && d1 <= 31 && S.loopGestureStart >= 0) {
        const idx = d1 - 16;
        if (idx === S.loopGestureStart) _resolveLoopGesture(true);
        return;
    }
    /* Swallow pad releases while SEQ ARP step-level editor is open. */
    if (!S.sessionView && S.activeBank === 4 && S.knobTouched === 4 &&
            (S.bankParams[S.activeTrack][4][4] | 0) !== 0 &&
            d1 >= 68 && d1 <= 99) {
        const _pi = d1 - TRACK_PAD_BASE;
        if (_pi >= 0 && _pi < 32 && padPitch[_pi] >= 0) {
            liveSendNote(S.activeTrack, 0x80, padPitch[_pi], 0);
            S.liveActiveNotes.delete(padPitch[_pi]);
            padPitch[_pi] = -1;
        }
        return;
    }
    /* Swallow pad releases while TRACK ARP step-level editor is open. */
    if (!S.sessionView && S.activeBank === 5 && S.knobTouched === 4 &&
            (S.bankParams[S.activeTrack][5][4] | 0) !== 0 &&
            d1 >= 68 && d1 <= 99) {
        const _pi = d1 - TRACK_PAD_BASE;
        if (_pi >= 0 && _pi < 32 && padPitch[_pi] >= 0) {
            liveSendNote(S.activeTrack, 0x80, padPitch[_pi], 0);
            S.liveActiveNotes.delete(padPitch[_pi]);
            padPitch[_pi] = -1;
        }
        return;
    }
    /* Perf Mode pad release: handle R0 rate pad pop + mod pad release. */
    if (S.sessionView && (S.loopHeld || S.perfViewLocked) && d1 >= 68 && d1 <= 99) {
        if (d1 >= 68 && d1 <= 75) {
            const subIdx = d1 - 68;
            if (subIdx === 7) {
                /* Latch release: toggle latch mode (mod pads momentary vs sticky). */
                S.perfLatchMode = !S.perfLatchMode;
            } else if (subIdx === 5) {
                /* Hold pad release: drop momentary state + stop all loops it was holding */
                if (S.perfHoldPadHeld) {
                    S.perfHoldPadHeld = false;
                    if (S.perfStack.length > 0) {
                        S.perfStack = [];
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('looper_stop', '1');
                    }
                }
            } else if (subIdx < 5) {
                /* Rate pad release: pop from stack — unless sticky-held or hold-pad held */
                if (!S.perfStickyLengths.has(subIdx) && !S.perfHoldPadHeld) {
                    const sIdx = S.perfStack.findIndex(function(e) { return e.idx === subIdx; });
                    if (sIdx >= 0) {
                        S.perfStack.splice(sIdx, 1);
                        if (S.perfStack.length === 0) {
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('looper_stop', '1');
                        } else {
                            const top = S.perfStack[S.perfStack.length - 1];
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('looper_arm', String(top.ticks));
                        }
                    }
                }
            }
        } else {
            /* Modifier pad release: clear momentary held bit */
            const modIdx = PERF_MOD_PAD_MAP[d1];
            if (modIdx !== undefined) {
                S.perfModsHeld &= ~(1 << modIdx);
                sendPerfMods();
            }
        }
        forceRedraw();
        return;
    }
    /* Step button release: tap-toggle if within threshold, always exit step edit */
    if (d1 >= 16 && d1 <= 31) {
        S.stepOpTick = S.tickCount;
        const btn = d1 - 16;
        /* Session view hold-to-save: if still pending (tick hasn't fired save yet) → tap recall */
        if (S.sessionStepHeld === btn) {
            const ctx = S.sessionStepHeldCtx;
            S.sessionStepHeld    = -1;
            S.sessionStepHeldCtx = 0;
            S.stepBtnPressedTick[btn] = -1;
            if (ctx === 1) {
                /* Perf recall */
                if (S.perfRecalledSlot === btn) {
                    S.perfRecalledSlot = -1;
                    S.perfModsToggled  = 0;
                } else {
                    S.perfRecalledSlot = btn;
                    S.perfModsToggled  = S.perfSnapshots[btn];
                }
                sendPerfMods();
            } else {
                /* Mute recall */
                if (S.snapshots[btn] !== null) {
                    const snap = S.snapshots[btn];
                    for (let _t = 0; _t < NUM_TRACKS; _t++) {
                        S.trackMuted[_t]  = snap.mute[_t];
                        S.trackSoloed[_t] = snap.solo[_t];
                        if (snap.drumEffMute) {
                            S.drumLaneMute[_t] = snap.drumEffMute[_t];
                            S.drumLaneSolo[_t] = 0;
                        }
                    }
                    S.pendingDefaultSetParams.push({ key: 'snap_load', val: String(btn) });
                }
            }
            forceRedraw();
            return;
        }
        if (btn === S.heldStepBtn) {
            if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
                /* Drum step release: tap toggles, hold-release exits + vel confirm */
                const t    = S.activeTrack;
                const lane = S.activeDrumLane[t];
                let drumStepCleared = false;
                if (S.stepBtnPressedTick[btn] >= 0) {
                    S.stepBtnPressedTick[btn] = -1;
                    if (S.stepWasEmpty) {
                        /* Empty step tapped: assign now with current velocity */
                        const _writeVel = stepEntryVelocity(t, -1, true);
                        S.stepEditVel = _writeVel;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_toggle', String(_writeVel));
                        S.drumLaneSteps[t][lane][S.heldStep] = '1';
                        S.drumLaneHasNotes[t][lane] = true;
                    } else {
                        /* Occupied step tapped: clear it */
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_clear', '1');
                        S.drumLaneSteps[t][lane][S.heldStep] = '0';
                        S.drumLaneHasNotes[t][lane] = S.drumLaneSteps[t][lane].some(c => c !== '0');
                        drumStepCleared = true;
                    }
                    if (typeof host_module_get_param === 'function') {
                        const ac = S.trackActiveClip[t];
                        const hcRaw = host_module_get_param('t' + t + '_c' + ac + '_drum_has_content');
                        S.drumClipNonEmpty[t][ac] = hcRaw === '1';
                    }
                }
                /* Hold release: reassign to adjacent step if nudge crossed midpoint */
                let drumDidReassign = false;
                if (S.stepWasHeld && S.heldStepNotes.length > 0) {
                    const _tpsMid = Math.floor((S.drumLaneTPS[t] || 24) / 2);
                    let dstStep = -1;
                    if (S.stepEditNudge >= _tpsMid)
                        dstStep = (S.heldStep + 1) % S.drumLaneLength[t];
                    else if (S.stepEditNudge < -_tpsMid)
                        dstStep = (S.heldStep - 1 + S.drumLaneLength[t]) % S.drumLaneLength[t];
                    if (dstStep >= 0) {
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_reassign', String(dstStep));
                        S.drumLaneSteps[t][lane][S.heldStep] = '0';
                        S.pendingDrumLaneResync      = 3;
                        S.pendingDrumLaneResyncTrack = t;
                        S.pendingDrumLaneResyncLane  = lane;
                        drumDidReassign = true;
                    }
                }
                /* Confirm vel at release — ensures it sticks even if mid-hold send was coalesced */
                if (!drumStepCleared && !drumDidReassign && S.heldStepNotes.length > 0) {
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_vel', String(S.stepEditVel));
                }
            } else {
            if (S.stepBtnPressedTick[btn] >= 0 && S.activeBank !== 6) {
                /* Quick release within threshold — commit as tap toggle */
                const ac_t   = effectiveClip(S.activeTrack);
                const absIdx = S.heldStep;
                S.stepBtnPressedTick[btn] = -1;
                if (S.stepWasEmpty) {
                    /* Tap on empty step: assign lastPlayedNote now */
                    if (S.lastPlayedNote >= 0) {
                        const assignNote_t = S.lastPlayedNote;
                        const assignVel_t  = stepEntryVelocity(S.activeTrack, -1, false);
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + S.activeTrack + '_c' + ac_t + '_step_' + absIdx + '_toggle', assignNote_t + ' ' + assignVel_t);
                        S.clipSteps[S.activeTrack][ac_t][absIdx] = 1;
                        S.clipNonEmpty[S.activeTrack][ac_t] = true;
                        refreshSeqNotesIfCurrent(S.activeTrack, ac_t, absIdx);
                    } else {
                        S.noNoteFlashEndTick = S.tickCount + NO_NOTE_FLASH_TICKS;
                        S.screenDirty = true;
                    }
                } else {
                    /* Step had data — tap clears it entirely */
                    clearStep(S.activeTrack, ac_t, absIdx);
                    refreshSeqNotesIfCurrent(S.activeTrack, ac_t, absIdx);
                }
            }
            /* On long-hold release: if nudge moved notes past the step midpoint,
             * reassign them to the adjacent step slot so it's editable from there. */
            if (S.stepWasHeld && S.heldStep >= 0 && S.heldStepNotes.length > 0 && S.activeBank !== 6) {
                const ac_ra = effectiveClip(S.activeTrack);
                const lenRa = S.clipLength[S.activeTrack][ac_ra];
                let dstStep = -1;
                if (S.stepEditNudge >= 12)
                    dstStep = (S.heldStep + 1) % lenRa;
                else if (S.stepEditNudge <= -13)
                    dstStep = (S.heldStep - 1 + lenRa) % lenRa;
                if (dstStep >= 0) {
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + S.activeTrack + '_c' + ac_ra + '_step_' + S.heldStep + '_reassign', String(dstStep));
                    S.clipSteps[S.activeTrack][ac_ra][S.heldStep] = 0;
                }
                /* Always re-read after hold release: poll may have set a neighbor lit */
                S.pendingStepsReread = 2;
                S.pendingStepsRereadTrack = S.activeTrack;
                S.pendingStepsRereadClip  = ac_ra;
            }
            } /* end melodic branch */
            /* Always exit step edit on release of the held button */
            S.heldStepBtn   = -1;
            S.heldStep      = -1;
            S.heldStepNotes = [];
            S.stepWasEmpty  = false;
            S.stepWasHeld   = false;
            forceRedraw();
        }
    }
    if (d1 >= TRACK_PAD_BASE && d1 < TRACK_PAD_BASE + 32) {
        const padIdx = d1 - TRACK_PAD_BASE;
        const t = S.activeTrack;
        /* Repeat mode: swallow all right-grid (col 4-7) releases; stop or resume prior rate */
        if (S.trackPadMode[t] === PAD_MODE_DRUM && S.drumPerformMode[t] === 1 &&
                (padIdx % 8) >= 4) {
            if (S.drumRepeatHeldPad[t] === padIdx && !S.drumRepeatLatched[t]) {
                const _prev = S.drumRepeatHeldPadsStack[t].length > 0
                    ? S.drumRepeatHeldPadsStack[t].pop() : null;
                if (_prev) {
                    /* Resume the previously held rate pad */
                    S.drumRepeatHeldPad[t] = _prev.padIdx;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_drum_repeat_start',
                            S.activeDrumLane[t] + ' ' + _prev.rateIdx + ' ' + _prev.vel);
                } else {
                    S.drumRepeatHeldPad[t] = -1;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_drum_repeat_stop', '1');
                }
            } else if (S.drumRepeatHeldPad[t] !== padIdx) {
                /* A queued-but-not-yet-active pad released — remove from stack */
                const _si = S.drumRepeatHeldPadsStack[t].findIndex(e => e.padIdx === padIdx);
                if (_si >= 0) S.drumRepeatHeldPadsStack[t].splice(_si, 1);
            }
            S.screenDirty = true;
            return;
        }
        /* Rpt2 mode: lane pad release — stop only if not latched */
        if (S.trackPadMode[t] === PAD_MODE_DRUM && S.drumPerformMode[t] === 2 &&
                (padIdx % 8) < 4) {
            const lane = drumPadToLane(padIdx);
            if (lane >= 0 && lane < DRUM_LANES && S.drumRepeat2HeldLanes[t].has(lane)) {
                S.drumRepeat2HeldLanes[t].delete(lane);
                if (!S.drumRepeat2LatchedLanes[t].has(lane)) {
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_drum_repeat2_lane_off', String(lane));
                }
                S.screenDirty = true;
            }
            return;
        }
        /* Rpt2 mode: swallow all right-grid releases */
        if (S.trackPadMode[t] === PAD_MODE_DRUM && S.drumPerformMode[t] === 2 &&
                (padIdx % 8) >= 4) {
            S.screenDirty = true;
            return;
        }
        const pitch = padPitch[padIdx] >= 0 ? padPitch[padIdx] : S.padNoteMap[padIdx];
        if (pitch === 0xFF) return; /* OOB pad — press was skipped, nothing to release */
        S.liveActiveNotes.delete(pitch);
        if (S.pendingPrerollNote !== null) {
            const _prRelPitch = S.pendingPrerollNote.laneNote;
            if (_prRelPitch === pitch)
                S.pendingPrerollNote.releasedAtTick = S.tickCount;
        }
        for (let _pri = 0; _pri < S.pendingPrerollNotes.length; _pri++) {
            if (S.pendingPrerollNotes[_pri].pitch === pitch) {
                S.pendingPrerollNotes[_pri].releasedAtTick = S.tickCount;
                break;
            }
        }
        padPitch[padIdx] = -1;
        if (!S.sessionView) {
            const t = S.activeTrack;
            if (S.trackPadMode[t] === PAD_MODE_DRUM &&
                    (S.tickCount - padPressTick[padIdx]) < DRUM_TAP_TICKS)
                pendingDrumNoteOffs[t].push(pitch);
            else
                liveSendNote(t, 0x80, pitch, 0);
        }
        padPressTick[padIdx] = -1;
        if (S.recordArmed) {
            const _t = S.activeTrack;
            if (S.trackPadMode[_t] === PAD_MODE_DRUM) {
                if (_t === S.recordArmedTrack)
                    _drumRecNoteOffs.push({ track: _t, laneNote: pitch });
            } else {
                recordNoteOff(pitch);
            }
        }
    }
}

globalThis.onMidiMessageInternal = function (data) { try { _onMidiInternalImpl(data); } catch (e) { captureError('onMidiInternal', e); } };
function _onMidiInternalImpl(data) {
    const status = data[0] | 0;
    const d1     = (data[1] ?? 0) | 0;
    const d2     = (data[2] ?? 0) | 0;

    /* Pad pressure arrives as poly aftertouch (0xA0) with the pad note in d1.
     * isNoiseMessage() classifies all 0xA0/0xD0 as noise, so handle pressure
     * here BEFORE that filter would drop it, then return. */
    if ((status & 0xF0) === 0xA0) {
        if (d1 >= TRACK_PAD_BASE && d1 < TRACK_PAD_BASE + 32) _onPadAftertouch(d1, d2);
        return;
    }
    if (isNoiseMessage(data)) return;

    /* Master volume knob (CC 79) + its capacitive touch (note 8) are owned by
     * Move firmware (button_passthrough[79] + the shim's overtake-mode volume
     * passthrough). dAVEBOx does nothing with them, but the host still forwards
     * the full detent stream to us in overtake mode — processing every one
     * competes with sequencer/MIDI output and stutters playback. Drop them
     * immediately so volume adjustment stays entirely Move-native. */
    if ((status & 0xF0) === 0xB0 && d1 === 79) return;
    if (((status & 0xF0) === 0x90 || (status & 0xF0) === 0x80) && d1 === 8) return;

    /* AUTO-bank Delete-tap detection: any input other than the Delete button
     * itself while Delete is armed disqualifies the tap, so Delete+jog /
     * Delete+knob / Delete+step keep their combos and don't also open the
     * CLEAR AUTOMATION menu on release. */
    if (S.deleteTapArmed && (status & 0x80) &&
            !((status & 0xF0) === 0xB0 && d1 === MoveDelete))
        S.deleteTapArmed = false;   /* (status & 0x80) ignores the Move's null/heartbeat (0x00) messages */

    /* Snapshot picker is a mid-session modal: swallow all input except the jog
     * (CC 3 click + CC 14 rotate, → _onCC_jog) and Note/Session (CC 50, closes
     * it), so pads/steps/transport/knobs can't edit the underlying clip while
     * the picker is on screen. */
    if (S.snapshotPicker) {
        const _ccPick = (status & 0xF0) === 0xB0 &&
            (d1 === 3 || d1 === MoveMainKnob || d1 === MoveNoteSession);
        if (!_ccPick) return;
    }

    /* CLEAR AUTOMATION modal: swallow all input except the jog (CC 3 click +
     * CC 14 rotate, → _onCC_jog / MoveMainKnob). Exits without changing anything:
     * Note/Session (the menu button), or tapping Delete again. */
    if (S.clearAutoMenu) {
        if ((status & 0xF0) === 0xB0 && d2 === 127 &&
                (d1 === MoveNoteSession || d1 === MoveDelete)) {
            closeClearAutoMenu();
            return;
        }
        const _ccMenu = (status & 0xF0) === 0xB0 && (d1 === 3 || d1 === MoveMainKnob);
        if (!_ccMenu) return;
    }

    /* While session overview is held, swallow everything except CC 50 release and Up/Down scroll. */
    if (S.sessionOverlayHeld) {
        const isRelease = (status === 0xB0 && d1 === MoveNoteSession && d2 === 0);
        const isScroll  = (status === 0xB0 && (d1 === MoveUp || d1 === MoveDown) && d2 === 127);
        if (!isRelease && !isScroll) return;
    }


    /* Knob touch (notes 0-7). MoveKnob1-8Touch = notes 0-7.
     * Hardware: d2=127 = touch on; d2 in 0-63 (via 0x90 or 0x80) = touch off.
     * Note 9 (jog touch): shows bank overview while held, locked out in global menu. */
    if (d1 >= 0 && d1 <= 9) {
        if ((status & 0xF0) === 0x90) {
            if (d2 === 127) {
                if (d1 <= 7 && S.activeBank >= 0) {
                    S.knobTouched = d1; S.knobTurnedTick[d1] = -1; S.screenDirty = true;
                    /* CC bank: touching a knob makes it the active lane (persistent
                     * — drives the step-LED gradient and highlighted overview cell). */
                    if (S.activeBank === 6) {
                        S.ccActiveLane[S.activeTrack] = d1;
                        invalidateLEDCache();
                    }
                    /* Perf view: touch knob k toggles looper for track k */
                    if (S.perfViewLocked) {
                        const _lt = d1;
                        const _newLooper = S.trackLooper[_lt] !== 0 ? 0 : 1;
                        S.trackLooper[_lt] = _newLooper;
                        applyTrackConfig(_lt, 'track_looper', _newLooper);
                        showActionPopup('LOOPER ' + (_newLooper ? 'ON' : 'OFF'), 'TRACK ' + (_lt + 1));
                        setButtonLED(71 + _lt, _newLooper ? trackColor(_lt) : LED_OFF, true);
                    }
                    /* CC bank: Delete+touch clears this knob's automation + resting value → "—" */
                    if (S.activeBank === 6 && S.deleteHeld && !S.shiftHeld) {
                        const _dt = S.activeTrack, _dac = effectiveClip(_dt);
                        S.trackCCAutoBits[_dt][_dac] &= ~(1 << d1);
                        S.trackCCLiveVal[_dt][d1] = -1;
                        S.clipCCVal[_dt][_dac][d1] = -1;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + _dt + '_cc_auto_clear_k', _dac + ' ' + d1);
                        showActionPopup('CC', 'CLEAR');
                        invalidateLEDCache();
                    }
                    /* SEQ ARP K5 / TRACK ARP K5 touch: switch pads to vel-slider editor immediately. */
                    if ((S.activeBank === 4 && d1 === 4) || (S.activeBank === 5 && d1 === 4)) forceRedraw();
                }
                if (d1 === MoveMainTouch && !S.globalMenuOpen && !S.shiftHeld) { S.jogTouched = true; forceRedraw(); }
            } else if (d2 < 64) {
                if (d1 <= 7) {
                    if (S.activeBank >= 0 && BANKS[S.activeBank].knobs[d1]) {
                        const relPm = BANKS[S.activeBank].knobs[d1];
                        if (relPm.dspKey === 'nudge') {
                            S.bankParams[S.activeTrack][S.activeBank][d1] = 0;
                            if (typeof host_module_set_param === 'function') {
                                const _isAllLanesNdg = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7;
                                const _isDrumNdg = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 0;
                                if (_isAllLanesNdg)
                                    host_module_set_param('t' + S.activeTrack + '_all_lanes_nudge', '0');
                                else if (_isDrumNdg)
                                    host_module_set_param('t' + S.activeTrack + '_l' + S.activeDrumLane[S.activeTrack] + '_nudge', '0');
                                else
                                    host_module_set_param('t' + S.activeTrack + '_nudge', '0');
                            }
                        } else if (relPm.dspKey === 'clock_shift' || relPm.dspKey === 'beat_stretch') {
                            S.clockShiftTouchDelta = 0;
                            S.bankParams[S.activeTrack][S.activeBank][d1] = 0;
                            /* Shft knob doubles as Nudge under Shift held — reset DSP nudge
                             * accumulator on release in case the user finished a Shift+turn. */
                            if (relPm.dspKey === 'clock_shift' &&
                                    typeof host_module_set_param === 'function') {
                                const _isAllLanes = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7;
                                const _isDrum     = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 0;
                                if (_isAllLanes)
                                    host_module_set_param('t' + S.activeTrack + '_all_lanes_nudge', '0');
                                else if (_isDrum)
                                    host_module_set_param('t' + S.activeTrack + '_l' + S.activeDrumLane[S.activeTrack] + '_nudge', '0');
                                else
                                    host_module_set_param('t' + S.activeTrack + '_nudge', '0');
                            }
                        }
                        /* ALL LANES: schedule display reset to '--' after ~500ms on touch release */
                        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7) {
                            if (d1 === 0) { S.allLanesResResetTick = S.tickCount + 47; S.allLanesResResetTrack = S.activeTrack; }
                            if (d1 === 3) { S.allLanesQntResetTick = S.tickCount + 47; S.allLanesQntResetTrack = S.activeTrack; }
                            if (d1 === 6) { S.allLanesDirResetTick = S.tickCount + 47; S.allLanesDirResetTrack = S.activeTrack; }
                        }
                    }
                    /* SEQ ARP K5 / TRACK ARP K5 release: refresh pads (vel-slider editor → normal pads). */
                    if ((S.activeBank === 4 && d1 === 4) || (S.activeBank === 5 && d1 === 4)) forceRedraw();
                    S.knobTouched = -1;
                    S.knobLocked[d1] = false;
                    S.knobAccum[d1]  = 0;
                    S.screenDirty = true;
                }
                if (d1 === MoveMainTouch && S.jogTouched) { S.jogTouched = false; S.bankSelectTick = -1; forceRedraw(); }
            }
            return;
        }
        if ((status & 0xF0) === 0x80) {
            if (d1 <= 7) {
                if (S.activeBank >= 0 && BANKS[S.activeBank].knobs[d1]) {
                    const relPm = BANKS[S.activeBank].knobs[d1];
                    if (relPm.dspKey === 'nudge') {
                        S.bankParams[S.activeTrack][S.activeBank][d1] = 0;
                        if (typeof host_module_set_param === 'function') {
                            const _isAllLanesNdg = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7;
                            const _isDrumNdg = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 0;
                            if (_isAllLanesNdg)
                                host_module_set_param('t' + S.activeTrack + '_all_lanes_nudge', '0');
                            else if (_isDrumNdg)
                                host_module_set_param('t' + S.activeTrack + '_l' + S.activeDrumLane[S.activeTrack] + '_nudge', '0');
                            else
                                host_module_set_param('t' + S.activeTrack + '_nudge', '0');
                        }
                    } else if (relPm.dspKey === 'clock_shift' || relPm.dspKey === 'beat_stretch') {
                        S.clockShiftTouchDelta = 0;
                        S.bankParams[S.activeTrack][S.activeBank][d1] = 0;
                    }
                    /* ALL LANES K4 (Qnt): schedule display reset to '--' after ~500ms */
                    if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7 && d1 === 3) {
                        S.allLanesQntResetTick  = S.tickCount + 47;
                        S.allLanesQntResetTrack = S.activeTrack;
                    }
                }
                if ((S.activeBank === 4 && d1 === 4) || (S.activeBank === 5 && d1 === 4)) forceRedraw();
                S.knobTouched = -1;
                S.knobLocked[d1] = false;
                S.knobAccum[d1]  = 0;
                S.screenDirty = true;
            }
            if (d1 === MoveMainTouch && S.jogTouched) { S.jogTouched = false; S.bankSelectTick = -1; forceRedraw(); }
            return;
        }
    }

    if (status === 0xB0) { _onCCMsg(d1, d2); return; }

    /* Step buttons: notes 16-31, note-on only */
    if ((status & 0xF0) === 0x90 && d1 >= 16 && d1 <= 31 && d2 > 0) { _onStepButtons(d1, d2); return; }

    /* Pad presses: note-on */
    if ((status & 0xF0) === 0x90 && d2 > 0) { _onPadPress(status, d1, d2); return; }

    /* Pad releases: note-off */
    if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && d2 === 0)) { _onPadRelease(status, d1, d2); return; }

};

/* Pad pressure (poly aftertouch). On drum tracks: routes continuous pressure to
 * the held drum-repeat pad's velocity (Rpt1) or the held repeat lanes (Rpt2). On
 * melodic tracks: forwards pad pressure as aftertouch to the track output per the
 * track's AftTch mode (Off/Poly/Channel). Called from the top of
 * _onMidiInternalImpl, before isNoiseMessage would drop the 0xA0. */
function _onPadAftertouch(d1, d2) {
    const t      = S.activeTrack;
    const padIdx = d1 - TRACK_PAD_BASE;

    /* Melodic aftertouch send (Phase 1: live). DSP tN_live_at routes via pfx_send
     * for the track's route (Move inject / Schwung internal / External USB). Poly
     * carries the sounded pitch (padPitch[]); Channel is track-wide. Deduped per
     * pad so a steady press doesn't spam the set_param channel. */
    if (S.trackPadMode[t] !== PAD_MODE_DRUM) {
        let mode = S.trackAtMode[t] | 0;
        if (mode === 0) return;                       /* Off — send nothing */
        if (S.trackRoute[t] === 1 && mode === 2) mode = 1;  /* Move = poly only */
        if (padIdx < 0 || padIdx >= 32) return;
        const pitch = padPitch[padIdx];
        if (pitch < 0) return;                        /* no live note on this pad */
        if (S.atLastSent[padIdx] === d2) return;      /* unchanged — skip */
        S.atLastSent[padIdx] = d2;
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + t + '_live_at', pitch + ' ' + d2 + ' ' + mode);
        return;
    }

    if (S.trackPadMode[t] === PAD_MODE_DRUM && S.drumPerformMode[t] === 1 &&
            S.drumRepeatHeldPad[t] === padIdx && d2 > 0) {
        S.drumRepeatHeldPadVel[t] = d2;
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + t + '_drum_repeat_vel', String(d2));
    }
    if (S.trackPadMode[t] === PAD_MODE_DRUM && S.drumPerformMode[t] === 2 && d2 > 0) {
        const col2 = padIdx % 8;
        if (col2 < 4) {
            const lane = drumPadToLane(padIdx);
            if (lane >= 0 && S.drumRepeat2HeldLanes[t].has(lane)) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_drum_repeat2_vel', lane + ' ' + d2);
            }
        }
    }
}

globalThis.onMidiMessageExternal = function (data) { try { _onMidiExternalImpl(data); } catch (e) { captureError('onMidiExternal', e); } };
function _onMidiExternalImpl(data) {
    const status  = data[0] | 0;
    const d1      = (data[1] ?? 0) | 0;
    const d2      = (data[2] ?? 0) | 0;
    const msgType = status & 0xF0;
    const msgCh   = (status & 0x0F) + 1;  /* 1-indexed */

    /* Route to S.activeTrack in all views — S.activeTrack always reflects last Track View focus */
    const t = S.activeTrack;

    /* ROUTE_MOVE: Move receives external cable-2 MIDI natively in overtake mode.
     * Never inject — injecting causes an echo cascade (Move echoes cable-2 back
     * as cable-2, we re-inject, infinite loop → crash). */
    const routeIsMove = S.trackRoute[t] === 1;

    /* Channel filter. When the cable-2 remap is active for a ROUTE_MOVE track the
     * shim rewrites the channel byte before we see it — messages arrive on
     * trackChannel[t], not their original channel. Filter against the remapped
     * channel so we don't accidentally drop them. */
    if (S.extMidiRemapActive && routeIsMove) {
        if (msgCh !== S.trackChannel[t]) return;
    } else {
        if (S.midiInChannel !== 0 && msgCh !== S.midiInChannel) return;
    }

    /* Drum track: route by pitch to lanes; skip melodic step assignment */
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        if (msgType === 0x90 && d2 > 0) {
            const vel = effectiveVelocity(d2);
            S.lastPadVelocity = vel;
            if (!routeIsMove) liveSendNote(t, 0x90, d1, vel);
            const isSeqEcho = routeIsMove && S.seqActiveNotes.has(d1);
            const isRec = !isSeqEcho && S.recordArmed && !S.recordCountingIn && t === S.recordArmedTrack;
            if (isRec) {
                _drumRecNoteOns.push({ track: t, laneNote: d1, vel: vel });
                const recLane = S.drumLaneNote[t].indexOf(d1);
                if (recLane >= 0) {
                    S.pendingDrumLaneResync      = 3;
                    S.pendingDrumLaneResyncTrack = t;
                    S.pendingDrumLaneResyncLane  = recLane;
                }
            }
            extHeldNotes.set(d1, { track: t, recording: isRec });
        } else if (msgType === 0x80 || (msgType === 0x90 && d2 === 0)) {
            const info = extHeldNotes.get(d1);
            const noteTrack = info ? info.track : t;
            if (S.trackRoute[noteTrack] !== 1) liveSendNote(noteTrack, 0x80, d1, 0);
            if (info && info.recording && S.recordArmed && !S.recordCountingIn)
                _drumRecNoteOffs.push({ track: noteTrack, laneNote: d1 });
            extHeldNotes.delete(d1);
        } else if (msgType === 0xB0 || msgType === 0xD0 || msgType === 0xA0 || msgType === 0xE0) {
            if (!routeIsMove) liveSendNote(t, msgType, d1, d2);
        }
        return;
    }

    if (msgType === 0x90 && d2 > 0) {
        const vel = effectiveVelocity(d2);
        S.lastPlayedNote  = d1;
        S.lastPadVelocity = vel;
        if (!routeIsMove) liveSendNote(t, 0x90, d1, vel);
        /* ROUTE_MOVE: sequencer inject echoes come back here on cable-2. Skip recording
         * for pitches the sequencer is already S.playing — those are echoes, not keyboard input.
         * Preserve any existing recording-active entry so the keyboard gate isn't overwritten. */
        const isSeqEcho = routeIsMove && S.seqActiveNotes.has(d1);
        const isRec = !isSeqEcho && S.recordArmed && !S.recordCountingIn && t === S.recordArmedTrack;
        if (isRec) recordNoteOn(d1, vel, t);
        const prevInfo = extHeldNotes.get(d1);
        if (!prevInfo || !prevInfo.recording || !isSeqEcho) {
            extHeldNotes.set(d1, { track: t, recording: isRec });
        }
        if (S.heldStep >= 0 && !S.shiftHeld && !S.sessionView) {
            const ac = effectiveClip(t);
            if (typeof host_module_set_param === 'function')
                /* Replace auto-assigned note if step was empty on hold; otherwise additive */
                if (S.stepWasEmpty && S.heldStepNotes.length > 0)
                    host_module_set_param('t' + t + '_c' + ac + '_step_' + S.heldStep + '_set_notes', String(d1));
                else
                    host_module_set_param('t' + t + '_c' + ac + '_step_' + S.heldStep + '_toggle', d1 + ' ' + vel);
            const raw = typeof host_module_get_param === 'function'
                ? host_module_get_param('t' + t + '_c' + ac + '_step_' + S.heldStep + '_notes') : null;
            S.heldStepNotes = (raw && raw.trim().length > 0)
                ? raw.trim().split(' ').map(Number).filter(function(n) { return n >= 0 && n <= 127; })
                : [];
            S.clipSteps[t][ac][S.heldStep] = S.heldStepNotes.length > 0 ? 1 : 0;
            if (S.heldStepNotes.length > 0) {
                S.clipNonEmpty[t][ac] = true;
            } else if (S.clipNonEmpty[t][ac]) {
                S.clipNonEmpty[t][ac] = clipHasContent(t, ac);
            }
            refreshSeqNotesIfCurrent(t, ac, S.heldStep);
            forceRedraw();
        }
    } else if (msgType === 0x80 || (msgType === 0x90 && d2 === 0)) {
        const info = extHeldNotes.get(d1);
        const noteTrack = info ? info.track : t;
        if (S.trackRoute[noteTrack] !== 1) liveSendNote(noteTrack, 0x80, d1, 0);
        if (info && info.recording) recordNoteOff(d1);
        extHeldNotes.delete(d1);
    } else if (msgType === 0xB0 || msgType === 0xD0 || msgType === 0xA0 || msgType === 0xE0) {
        if (!routeIsMove) liveSendNote(t, msgType, d1, d2);
    }
};

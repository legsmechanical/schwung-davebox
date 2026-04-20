import {
    MoveShift,
    MoveBack,
    MovePlay,
    MoveLeft,
    MoveRight,
    MoveUp,
    MoveDown
} from '/data/UserData/schwung/shared/constants.mjs';

/* CC 50 = Note/Session toggle (three-bar button left of track buttons). */
const MoveNoteSession = 50;

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
    HotMagenta,
    DeepMagenta,
    Cyan,
    PurpleBlue,
    Bright,
    BurntOrange,
    White,
    Lime,
    VeryDarkGreen
} from '/data/UserData/schwung/shared/constants.mjs';

import {
    setLED,
    setButtonLED
} from '/data/UserData/schwung/shared/input_filter.mjs';

import {
    installConsoleOverride
} from '/data/UserData/schwung/shared/logger.mjs';

const LED_OFF         = 0;
const LED_STEP_ACTIVE = 36;
const LED_STEP_CURSOR = 127;
const LEDS_PER_FRAME  = 8;
const NUM_TRACKS      = 8;
const NUM_CLIPS       = 16;
const PULSE_PERIOD    = 12;   /* ticks per dim→bright→dim cycle (halved for 8-track LED load) */

/* shim ui_flags bits that must be masked while SEQ8 owns the display.
 * JUMP_TO_TOOLS (0x80) and JUMP_TO_OVERTAKE (0x04) both bypass our normal
 * exit path (no clearAllLEDs, no host_hide_module), leaving hardware LEDs
 * in a dirty state that corrupts the native Move UI. We wrap
 * shadow_get_ui_flags() to intercept these flags, fire clearAllLEDs()
 * immediately, and swallow them so shadow_ui.js never opens either menu. */
const FLAG_JUMP_TO_OVERTAKE = 0x04;
const FLAG_JUMP_TO_TOOLS    = 0x80;
const SEQ8_NAV_FLAGS        = FLAG_JUMP_TO_OVERTAKE | FLAG_JUMP_TO_TOOLS;

const NUM_STEPS       = 256;  /* steps per clip (DSP array size) */

/* Track colors: bright and dim pairs (Move uses fixed palette indices, not brightness).
 * Dim pairs for tracks 4-7: PurpleBlue for Cyan (no dark-cyan in palette),
 * DarkGrey for White. These may need refinement after hardware verification. */
const TRACK_COLORS     = [Red,    Blue,     VividYellow, Green,
                           HotMagenta, Cyan,      Bright,   Lime];
const TRACK_DIM_COLORS = [DeepRed, DarkBlue, Mustard,    DeepGreen,
                           DeepMagenta, PurpleBlue, BurntOrange, VeryDarkGreen];
const SCENE_LETTERS = 'ABCDEFGHIJKLMNOP';

/* Move pad rows (confirmed on hardware, bottom-to-top):
 *   Bottom row (nearest player):  notes 68-75
 *   Row 2:                        notes 76-83
 *   Row 3:                        notes 84-91
 *   Top row (nearest display):    notes 92-99 */
const TRACK_PAD_BASE = 68;

let ledInitQueue    = [];
let ledInitIndex    = 0;
let ledInitComplete = false;  /* false until init queue fully flushed; tick() blocks normal render */
let shiftHeld       = false;

/* clipSteps[track][clip][step] — JS-authoritative mirror of DSP step data */
let clipSteps        = Array.from({length: NUM_TRACKS}, () =>
                           Array.from({length: NUM_CLIPS}, () => new Array(NUM_STEPS).fill(0)));
let clipLength       = Array.from({length: NUM_TRACKS}, () => new Array(NUM_CLIPS).fill(16));
let trackCurrentStep = new Array(NUM_TRACKS).fill(-1);
let trackCurrentPage = new Array(NUM_TRACKS).fill(0);  /* 0..15: which 16-step page is visible */
let trackActiveClip  = new Array(NUM_TRACKS).fill(0);
let trackQueuedClip  = new Array(NUM_TRACKS).fill(-1);
let playing          = false;
let activeTrack      = 0;
let sessionView      = false;
let sceneGroup       = 0;     /* 0-3: which group of 4 scenes is visible */
let pulseStep        = 0;     /* 0..PULSE_PERIOD-1, drives clip LED pulse */
let pulseUseBright   = false; /* current dim/bright decision for this tick */

function clipHasContent(t, c) {
    const s = clipSteps[t][c];
    for (let i = 0; i < NUM_STEPS; i++) if (s[i]) return true;
    return false;
}

/* Synchronously zero every LED that SEQ8 owns — call before host_hide_module()
 * so the native Move UI inherits a clean LED state. */
function clearAllLEDs() {
    let n, c;
    for (n = 68; n <= 99; n++) setLED(n, LED_OFF);       /* 32 pads */
    for (n = 16; n <= 31; n++) setLED(n, LED_OFF);       /* 16 step buttons */
    for (c = 16; c <= 31; c++) setButtonLED(c, LED_OFF); /* step button LEDs */
    for (c = 40; c <= 43; c++) setButtonLED(c, LED_OFF); /* track buttons */
    for (const cc of [49, 50, 51, 52, 54, 55, 56, 58, 60, 62, 63])
        setButtonLED(cc, LED_OFF);
    for (c = 71; c <= 78; c++) setButtonLED(c, LED_OFF);
    for (const cc of [85, 86, 88, 118, 119]) setButtonLED(cc, LED_OFF);
}

/* Install a wrapper around shadow_get_ui_flags that masks navigation flags
 * which would silently tear us down without clearAllLEDs().
 *
 * The wrapper stores its own original reference as a property so re-installs
 * (reconnect path where module vars are re-evaluated) detect the existing
 * wrapper and re-enable it instead of double-wrapping.
 *
 * On Shift+Back, removeFlagsWrap() restores the original before we hide so
 * native UI always gets the real function back. */
function installFlagsWrap() {
    if (typeof shadow_get_ui_flags !== 'function') return;
    /* Reconnect: prior wrapper already on globalThis — just re-enable it. */
    if (globalThis.shadow_get_ui_flags._seq8) {
        globalThis.shadow_get_ui_flags._active = true;
        return;
    }
    const orig = globalThis.shadow_get_ui_flags;
    const wrap = function () {
        const f = orig();
        const hit = f & SEQ8_NAV_FLAGS;
        if (hit && wrap._active) {
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
    for (const c of [49, 50, 51, 52, 54, 55, 56, 58, 60, 62, 63]) {
        q.push({ kind: 'cc', id: c });
    }
    for (let c = 71; c <= 78; c++) q.push({ kind: 'cc', id: c });
    for (const c of [85, 86, 88, 118, 119]) q.push({ kind: 'cc', id: c });
    return q;
}

function drainLedInit() {
    const end = Math.min(ledInitIndex + LEDS_PER_FRAME, ledInitQueue.length);
    for (let i = ledInitIndex; i < end; i++) {
        const led = ledInitQueue[i];
        if (led.kind === 'cc') setButtonLED(led.id, LED_OFF);
        else setLED(led.id, LED_OFF);
    }
    ledInitIndex = end;
    if (ledInitIndex >= ledInitQueue.length) ledInitComplete = true;
}

function pollDSP() {
    if (typeof host_module_get_param !== 'function') return;
    const p = host_module_get_param('playing');
    playing = (p === '1');
    for (let t = 0; t < NUM_TRACKS; t++) {
        const cs = host_module_get_param('t' + t + '_current_step');
        trackCurrentStep[t] = (cs !== null && cs !== undefined)
            ? (parseInt(cs, 10) | 0) : -1;
        const ac = host_module_get_param('t' + t + '_active_clip');
        if (ac !== null && ac !== undefined) trackActiveClip[t] = parseInt(ac, 10) | 0;
        const qc = host_module_get_param('t' + t + '_queued_clip');
        trackQueuedClip[t] = (qc !== null && qc !== undefined)
            ? (parseInt(qc, 10) | 0) : -1;
    }
}

function updateStepLEDs() {
    if (!ledInitComplete) return;
    const ac     = trackActiveClip[activeTrack];
    const steps  = clipSteps[activeTrack][ac];
    const cs     = trackCurrentStep[activeTrack];
    const page   = trackCurrentPage[activeTrack];
    const base   = page * 16;
    for (let i = 0; i < 16; i++) {
        const absStep = base + i;
        let color;
        if (playing && absStep === cs) {
            color = LED_STEP_CURSOR;
        } else if (steps[absStep]) {
            color = LED_STEP_ACTIVE;
        } else {
            color = LED_OFF;
        }
        setLED(16 + i, color);
    }
}

function groupHasContent(group) {
    for (let row = 0; row < 4; row++) {
        const sceneIdx = group * 4 + row;
        for (let t = 0; t < NUM_TRACKS; t++)
            if (clipHasContent(t, sceneIdx)) return true;
    }
    return false;
}

function sceneAllPlaying(sceneIdx) {
    if (!playing) return false;
    for (let t = 0; t < NUM_TRACKS; t++)
        if (trackActiveClip[t] !== sceneIdx) return false;
    return true;
}

function updateSceneMapLEDs() {
    if (!ledInitComplete) return;
    for (let i = 0; i < 16; i++) {
        let color;
        if (sceneAllPlaying(i)) {
            color = pulseUseBright ? White : LED_OFF;
        } else {
            const group = Math.floor(i / 4);
            color = (group === sceneGroup) ? LED_STEP_CURSOR
                  : groupHasContent(group) ? LED_STEP_ACTIVE
                  : LED_OFF;
        }
        setLED(16 + i, color);
    }
}

function updateSessionLEDs() {
    if (!ledInitComplete) return;
    for (let row = 0; row < 4; row++) {
        const sceneIdx = sceneGroup * 4 + row;
        for (let t = 0; t < 8; t++) {
            const note = 92 - row * 8 + t;  /* row 0=top(92-99), row 3=bottom(68-75) */
            if (t >= NUM_TRACKS) {
                setLED(note, LED_OFF);
                continue;
            }
            const hasContent = clipHasContent(t, sceneIdx);
            const isActive   = trackActiveClip[t] === sceneIdx;
            const isPlaying  = isActive && playing && hasContent;
            const isQueued   = hasContent && trackQueuedClip[t] === sceneIdx;
            let color;
            if (isPlaying || isQueued) {
                color = pulseUseBright ? TRACK_COLORS[t] : TRACK_DIM_COLORS[t];
            } else if (isActive && hasContent) {
                color = TRACK_COLORS[t];
            } else if (hasContent) {
                color = TRACK_DIM_COLORS[t];
            } else {
                color = DarkGrey;
            }
            setLED(note, color);
        }
    }
}

function updateTrackLEDs() {
    if (!ledInitComplete) return;

    /* Pad rows: only in Note View. Session View row 3 (notes 68-75) is owned by
     * updateSessionLEDs — writing here too would double-write and cause flicker. */
    if (!sessionView) {
        for (let t = 0; t < 8; t++) {
            setLED(TRACK_PAD_BASE + t,
                   t < NUM_TRACKS ? (t === activeTrack ? TRACK_COLORS[t] : TRACK_DIM_COLORS[t])
                                  : LED_OFF);
            setLED(TRACK_PAD_BASE + 8 + t, LED_OFF);
        }
    }

    /* Track buttons CC40-43: one per visible scene row (CC40=row3, CC43=row0).
     * Session View: White for playing row, off otherwise.
     * Note View: clip-column state for active track. */
    for (let idx = 0; idx < 4; idx++) {
        const row      = 3 - idx;
        const sceneIdx = sceneGroup * 4 + row;
        let color;
        if (sessionView) {
            color = sceneAllPlaying(sceneIdx) ? White : LED_OFF;
        } else {
            const t          = activeTrack;
            const hasContent = clipHasContent(t, sceneIdx);
            const isActive   = trackActiveClip[t] === sceneIdx;
            const isPlaying  = isActive && playing && hasContent;
            const isQueued   = hasContent && trackQueuedClip[t] === sceneIdx;
            if (isPlaying || isQueued) {
                color = pulseUseBright ? TRACK_COLORS[t] : TRACK_DIM_COLORS[t];
            } else if (isActive && hasContent) {
                color = TRACK_COLORS[t];
            } else if (hasContent) {
                color = TRACK_DIM_COLORS[t];
            } else {
                color = DarkGrey;
            }
        }
        setButtonLED(40 + idx, color);
    }
}

function forceRedraw() {
    if (!ledInitComplete) return;
    if (sessionView) {
        updateSessionLEDs();
        updateSceneMapLEDs();
    } else {
        updateStepLEDs();
    }
    updateTrackLEDs();
}

function drawUI() {
    clear_screen();
    if (sessionView) {
        const base = sceneGroup * 4;
        print(4, 10, 'SESSION  GRP ' + (sceneGroup + 1), 1);
        print(4, 22, SCENE_LETTERS[base] + '-' + SCENE_LETTERS[base + 3] + '  ROWS 1-4', 1);
        print(4, 34, '1 2 3 4 5 6 7 8', 1);
        let line4 = '';
        for (let t = 0; t < NUM_TRACKS; t++) {
            line4 += SCENE_LETTERS[trackActiveClip[t]];
            if (t < NUM_TRACKS - 1) line4 += ' ';
        }
        print(4, 46, line4, 1);
    } else {
        const ac = trackActiveClip[activeTrack];
        const page       = trackCurrentPage[activeTrack];
        const totalPages = Math.max(1, Math.ceil(clipLength[activeTrack][ac] / 16));
        /* \xb7 = middle dot · */
        print(4, 10, 'TR' + (activeTrack + 1) + ' \xb7 ' + SCENE_LETTERS[ac] +
                     '  PG ' + (page + 1) + '/' + totalPages, 1);
        print(4, 34, '1 2 3 4 5 6 7 8', 1);
        let line4 = '';
        for (let t = 0; t < NUM_TRACKS; t++) {
            line4 += SCENE_LETTERS[trackActiveClip[t]];
            if (t < NUM_TRACKS - 1) line4 += ' ';
        }
        print(4, 46, line4, 1);
    }
}

function fmtHex(b) {
    return (b & 0xff).toString(16).padStart(2, '0').toUpperCase();
}

globalThis.init = function () {
    installConsoleOverride('SEQ8');

    /* Recover DSP state — JS module vars reset on every re-entry because
     * shadow_load_ui_module() re-evaluates this file. On tool reconnect
     * (Shift+Back hide → re-select from Tools menu) the DSP instance is still
     * alive; on cold boot (first launch or after another tool replaced us)
     * create_instance restores from seq8-state.json. Either way, read params. */
    const p = (typeof host_module_get_param === 'function')
        ? host_module_get_param('playing') : null;
    const dspSurvived = (p !== null && p !== undefined);

    console.log('SEQ8 init: ' + (p === '1' ? 'RESUMED playing' : 'FRESH/stopped'));

    if (typeof host_module_get_param === 'function') {
        playing = dspSurvived;

        /* Recover per-track state */
        for (let t = 0; t < NUM_TRACKS; t++) {
            const ac = host_module_get_param('t' + t + '_active_clip');
            if (ac !== null && ac !== undefined) trackActiveClip[t] = parseInt(ac, 10) | 0;
            const cs = host_module_get_param('t' + t + '_current_step');
            const csVal = (cs !== null && cs !== undefined) ? (parseInt(cs, 10) | 0) : -1;
            trackCurrentStep[t] = csVal;
            /* Start on the page that contains the active step */
            trackCurrentPage[t] = csVal >= 0 ? Math.floor(csVal / 16) : 0;
            const qc = host_module_get_param('t' + t + '_queued_clip');
            trackQueuedClip[t] = (qc !== null && qc !== undefined) ? (parseInt(qc, 10) | 0) : -1;

            /* Bulk step + length recovery */
            for (let c = 0; c < NUM_CLIPS; c++) {
                const bulk = host_module_get_param('t' + t + '_c' + c + '_steps');
                if (bulk && bulk.length >= NUM_STEPS) {
                    for (let s = 0; s < NUM_STEPS; s++)
                        clipSteps[t][c][s] = bulk[s] === '1' ? 1 : 0;
                }
                const len = host_module_get_param('t' + t + '_c' + c + '_length');
                if (len !== null && len !== undefined)
                    clipLength[t][c] = parseInt(len, 10) || 16;
            }
        }
    }

    /* Block normal tick() rendering until the init queue is fully flushed. */
    ledInitComplete = false;
    ledInitQueue    = buildLedInitQueue();
    ledInitIndex    = 0;

    /* Intercept navigation flags that bypass our normal exit path. */
    installFlagsWrap();
};

globalThis.tick = function () {
    /* Triangle-wave pulse: 4 equal phases per cycle.
     * Phase 0 (dim), phase 1 (bright), phase 2 (bright), phase 3 (dim).
     * 50% duty cycle with transitions at predictable quarter-period boundaries. */
    pulseStep = (pulseStep + 1) % PULSE_PERIOD;
    const phase = Math.floor(pulseStep * 4 / PULSE_PERIOD);
    pulseUseBright = (phase === 1 || phase === 2);

    if (!ledInitComplete) {
        drainLedInit();
    } else {
        pollDSP();
        if (sessionView) {
            updateSessionLEDs();
            updateSceneMapLEDs();
        } else {
            updateStepLEDs();
        }
        updateTrackLEDs();
    }
    drawUI();
};

/* Power button: sends a D-Bus signal to the Schwung shim — NOT a MIDI CC.
 * There is nothing to intercept here. Hide SEQ8 first (Shift+Back), then
 * power down from the Move UI. */

globalThis.onMidiMessageInternal = function (data) {
    const status = data[0] | 0;
    const d1     = (data[1] ?? 0) | 0;
    const d2     = (data[2] ?? 0) | 0;

    if (status === 0xB0) {
        if (d1 === MoveShift) {
            shiftHeld = d2 === 127;
        }

        /* Note/Session view toggle */
        if (d1 === MoveNoteSession && d2 === 127) {
            sessionView = !sessionView;
            if (sessionView) {
                /* Clear step buttons and bottom pad row before session redraw */
                for (let i = 0; i < 16; i++) setLED(16 + i, LED_OFF);
                for (let t = 0; t < 8; t++) setLED(TRACK_PAD_BASE + t, LED_OFF);
            } else {
                /* Clear all session pad rows before note view redraw */
                for (let row = 0; row < 4; row++)
                    for (let t = 0; t < 8; t++) setLED(92 - row * 8 + t, LED_OFF);
            }
            forceRedraw();
        }

        /* Shift+Back = hide: clear all LEDs first so the native Move UI inherits
         * a clean state, then hide. DSP stays alive, MIDI keeps playing.
         * host_hide_module() → hideToolOvertake() (tool path):
         *   - does NOT send overtake_dsp:unload
         *   - keeps overtakeModuleLoaded=true and toolHiddenModulePath set
         *   - returns to Tools menu
         * Re-entry via Tools menu → startInteractiveTool() detects dspAlreadyLoaded,
         * reconnects without overtake_dsp:load, reloads JS only, calls init(). */
        if (d1 === MoveBack && d2 === 127 && shiftHeld) {
            removeFlagsWrap();
            clearAllLEDs();
            if (typeof host_hide_module === 'function') {
                host_hide_module();
            }
        }

        /* Play: toggle transport; Shift+Play = panic */
        if (d1 === MovePlay && d2 === 127) {
            if (shiftHeld) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('transport', 'panic');
            } else {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('transport', playing ? 'stop' : 'play');
            }
        }

        /* Left/Right: page nav in Note View; no-op in Session View */
        if ((d1 === MoveLeft || d1 === MoveRight) && d2 === 127 && !sessionView) {
            const ac         = trackActiveClip[activeTrack];
            const totalPages = Math.max(1, Math.ceil(clipLength[activeTrack][ac] / 16));
            if (d1 === MoveLeft)
                trackCurrentPage[activeTrack] = Math.max(0, trackCurrentPage[activeTrack] - 1);
            else
                trackCurrentPage[activeTrack] = Math.min(totalPages - 1, trackCurrentPage[activeTrack] + 1);
        }

        /* Up/Down: scene group nav in Session View */
        if (d1 === MoveDown && d2 === 127 && sessionView && sceneGroup < 3) { sceneGroup++; forceRedraw(); }
        if (d1 === MoveUp   && d2 === 127 && sessionView && sceneGroup > 0) { sceneGroup--; forceRedraw(); }

        /* Track buttons CC40-43 */
        if (d1 >= 40 && d1 <= 43 && d2 === 127) {
            const idx = d1 - 40;
            if (sessionView) {
                /* Launch scene row across all tracks.
                 * CC40=MoveRow4 (physical bottom), CC43=MoveRow1 (physical top).
                 * Session View row 0 is at the top (notes 92-99), so invert. */
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('launch_scene', String(sceneGroup * 4 + (3 - idx)));
            } else {
                /* Launch clip on active track.
                 * CC40=bottom button → row 3 (bottom of current group), same inversion as
                 * Session View so the physical button positions match the visual layout. */
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + activeTrack + '_launch_clip',
                                          String(sceneGroup * 4 + (3 - idx)));
            }
        }
    }

    /* Step buttons: notes 16-31, note-on only */
    if ((status & 0xF0) === 0x90 && d1 >= 16 && d1 <= 31 && d2 > 0) {
        const idx = d1 - 16;
        if (sessionView) {
            /* All 16 step buttons map to the 16 clips (scene map).
             * Pressing step N jumps to the group containing scene N.
             * Shift+step launches that scene across all tracks. */
            const targetGroup = Math.floor(idx / 4);
            if (shiftHeld) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('launch_scene', String(idx));
            } else {
                sceneGroup = targetGroup;
            }
        } else {
            /* Toggle step at current page offset */
            const ac     = trackActiveClip[activeTrack];
            const absIdx = trackCurrentPage[activeTrack] * 16 + idx;
            clipSteps[activeTrack][ac][absIdx] ^= 1;
            if (typeof host_module_set_param === 'function')
                host_module_set_param(
                    't' + activeTrack + '_c' + ac + '_step_' + absIdx,
                    clipSteps[activeTrack][ac][absIdx] ? '1' : '0'
                );
        }
    }

    /* Pad presses: note-on */
    if ((status & 0xF0) === 0x90 && d2 > 0) {
        if (sessionView) {
            /* All 8 pads of each row launch clips; row 0=top(92-99), row 3=bottom(68-75).
             * Also sync activeTrack so Note View reflects the last-touched track. */
            for (let row = 0; row < 4; row++) {
                const rowBase = 92 - row * 8;
                if (d1 >= rowBase && d1 < rowBase + NUM_TRACKS) {
                    const t = d1 - rowBase;
                    activeTrack = t;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_launch_clip',
                                              String(sceneGroup * 4 + row));
                    break;
                }
            }
        } else {
            /* Note View: Shift + bottom row selects active track (notes 68-75 for 8 tracks) */
            if (shiftHeld && d1 >= TRACK_PAD_BASE && d1 < TRACK_PAD_BASE + NUM_TRACKS) {
                activeTrack = d1 - TRACK_PAD_BASE;
            }
        }
    }
};

globalThis.onMidiMessageExternal = function (data) {
    const status = data[0] | 0;
    const d1     = (data[1] ?? 0) | 0;
    const d2     = (data[2] ?? 0) | 0;
    console.log("MIDI EXT: status=0x" + fmtHex(status) + " data1=" + fmtHex(d1) + " data2=" + fmtHex(d2));
};

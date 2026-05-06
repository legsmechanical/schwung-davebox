import {
    MidiNoteOn, MidiCC,
    MoveMainKnob, MoveMainButton
} from '/data/UserData/schwung/shared/constants.mjs';

import { setLED, setButtonLED, decodeDelta } from '/data/UserData/schwung/shared/input_filter.mjs';

const PAD_BASE = 68;
const NUM_PADS = 32;
const NUM_PAGES = 4;

/* Known names for notable palette entries */
const NAMES = {
    0: 'Off', 7: 'VividYellow', 29: 'Mustard', 32: 'DeepGreen',
    49: 'BeatMarker(49)', 50: 'OOB Grey(50)', 65: 'DeepRed',
    95: 'DarkBlue', 124: 'DimWhite', 125: 'Blue',
    126: 'Green', 127: 'White'
};

let page     = 0;
let hovered  = -1;
let prev     = -1;
let initIdx  = 0;
let initDone = false;
let dirty    = true;

function sendPads() {
    const base = page * NUM_PADS;
    for (let i = 0; i < NUM_PADS; i++)
        setLED(PAD_BASE + i, base + i, true);
    const curColor = hovered >= 0 ? hovered : 0;
    const prvColor = prev    >= 0 ? prev    : 0;
    for (let i = 0; i < 8;  i++) setLED(16 + i, curColor, true);
    for (let i = 8; i < 16; i++) setLED(16 + i, prvColor, true);
}

function drawOled() {
    clear_screen();
    fill_rect(0, 0, 128, 12, 1);
    const lo = page * NUM_PADS;
    const hi = lo + NUM_PADS - 1;
    print(2, 2, 'PALETTE p.' + (page + 1) + '/4  [' + lo + '-' + hi + ']', 0);

    if (hovered >= 0) {
        print(2, 16, 'cur: ' + hovered + '  ' + (NAMES[hovered] || ''), 1);
    }
    if (prev >= 0) {
        print(2, 28, 'prv: ' + prev + '  ' + (NAMES[prev] || ''), 1);
    }
    if (hovered < 0 && prev < 0) {
        print(2, 24, 'tap pad to inspect', 1);
    }
    print(2, 52, 'jog=pg  click=exit', 1);
}

globalThis.init = function() {
    page     = 0;
    hovered  = -1;
    prev     = -1;
    initIdx  = 0;
    initDone = false;
    dirty    = true;
};

globalThis.tick = function() {
    if (!initDone) {
        const base = page * NUM_PADS;
        const end  = Math.min(initIdx + 8, NUM_PADS);
        for (let i = initIdx; i < end; i++)
            setLED(PAD_BASE + i, base + i, true);

        initIdx = end;
        if (initIdx >= NUM_PADS) { initDone = true; dirty = true; }
        return;
    }
    if (dirty) {
        sendPads();
        drawOled();
        dirty = false;
    }
};

globalThis.onMidiMessageInternal = function(data) {
    const status = data[0] & 0xF0;
    const d1 = data[1];
    const d2 = data[2];

    /* Jog click → exit */
    if (status === 0xB0 && d1 === MoveMainButton && d2 === 127) {
        if (typeof host_exit_module === 'function') host_exit_module();
        return;
    }

    /* Jog turn → change page */
    if (status === 0xB0 && d1 === MoveMainKnob) {
        const delta = decodeDelta(d2);
        if (delta !== 0) {
            page     = (page + (delta > 0 ? 1 : NUM_PAGES - 1)) % NUM_PAGES;
            initIdx  = 0;
            initDone = false;
            dirty    = true;
        }
        return;
    }

    /* Pad press → show index */
    if (status === 0x90 && d2 > 0 && d1 >= PAD_BASE && d1 < PAD_BASE + NUM_PADS) {
        prev    = hovered;
        hovered = page * NUM_PADS + (d1 - PAD_BASE);
        dirty   = true;
        return;
    }
};

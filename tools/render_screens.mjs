// tools/render_screens.mjs — render current dAVEBOx OLED screens to individual
// PNGs for the manual. Stubs the three host draw primitives into a 128x64
// framebuffer and drives the REAL draw code:
//   - bank/param pages: the real ui_constants BANKS defs mapped through a
//     verbatim copy of ui_render's kitCellForKnob(), then ui_movy's
//     drawKitBankPage — pixel-identical to the device.
//   - custom-drawn screens (REPEAT GROOVE): their exact draw block, replicated.
// The device-absolute imports in ui_constants are satisfied by render_loader.
// Run:  node --import ./tools/render_loader.mjs tools/render_screens.mjs [stem]
import { writeFileSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';

const W = 128, H = 64;
let fb = new Uint8Array(W * H);
globalThis.set_pixel = (x, y, v) => { x |= 0; y |= 0; if (x >= 0 && x < W && y >= 0 && y < H) fb[y * W + x] = v ? 1 : 0; };
globalThis.fill_rect = (x, y, w, h, v) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) globalThis.set_pixel(x + i, y + j, v); };
globalThis.clear_screen = () => { fb.fill(0); };

const kit = await import('../ui/ui_movy.mjs');
const C = await import('../ui/ui_constants.mjs');   // real BANKS + fmt tables (via loader)
const { BANKS } = C;

// ---- verbatim copy of ui_render.mjs cell mapping (pure; fmt refs come from C
//      so `knob.fmt === C.fmtBool` identity holds against the real BANKS defs) ----
const KIT_ENUM_FMTS = [C.fmtRes, C.fmtDiq, C.fmtPlayDir, C.fmtLen, C.fmtGateMod,
                       C.fmtDly, C.fmtArpStyle, C.fmtArpRate, C.fmtArpSteps, C.fmtRevStyle];
const KIT_DIR_NAMES = ['Forward', 'Backward', 'Ping Pong', 'Rev Ping Pong'];
const KIT_ARP_STYLE_NAMES = ['Off', 'Up', 'Down', 'Up/Down', 'Down/Up',
                             'Converge', 'Diverge', 'Ordered', 'Random', 'Rnd Order'];
function _discreteOpts(knob) { const o = []; for (let i = knob.min; i <= knob.max; i++) o.push(knob.fmt(i)); return o; }
function kitCellForKnob(knob, val) {
    if (!knob || !knob.abbrev) return { kind: 'blank', label: '' };
    const v = val | 0;
    const text = knob.fmt(v);
    const base = { label: knob.abbrev, name: knob.full, text };
    if (knob.fmt === C.fmtBool) { base.kind = 'hbar'; base.norm = v ? 1 : 0; return base; }
    if (knob.fmt === C.fmtLgto) { base.kind = 'action'; base.oneWay = true; return base; }
    if (knob.scope === 'action') { base.kind = 'action'; return base; }
    if (knob.fmt === C.fmtPlayDir) { base.kind = 'dirsq'; base.options = KIT_DIR_NAMES; base.sel = v; return base; }
    if (KIT_ENUM_FMTS.indexOf(knob.fmt) >= 0) {
        base.kind = 'enumsq';
        if (knob.fmt === C.fmtArpStyle) base.options = KIT_ARP_STYLE_NAMES;
        else { base.options = []; for (let i = knob.min; i <= knob.max; i++) base.options.push(knob.fmt(i)); }
        base.sel = v - knob.min;
        return base;
    }
    if (knob.min < 0) {
        if (knob.max <= 24) { base.kind = 'valsq'; base.options = _discreteOpts(knob); base.sel = v - knob.min; return base; }
        base.kind = 'arcbip';
        const halfR = Math.max(1, Math.max(knob.max, -knob.min));
        base.signed = Math.max(-1, Math.min(1, v / halfR));
        return base;
    }
    if (knob.fmt === C.fmtPlain && knob.max <= 16) { base.kind = 'valsq'; base.options = _discreteOpts(knob); base.sel = v - knob.min; return base; }
    if (knob.fmt === C.fmtPitchRnd) { base.kind = 'valsq'; base.options = _discreteOpts(knob); base.sel = v - knob.min; return base; }
    base.kind = 'arc';
    base.norm = Math.max(0, Math.min(1, (v - knob.min) / ((knob.max - knob.min) || 1)));
    return base;
}

// Build a bank page's cells from the real BANKS[bank].knobs + a values array.
// vals defaults to each knob's `def`; overrides let a screen show a "used" state.
const bankCells = (bank, overrides = {}) =>
    BANKS[bank].knobs.map((k, i) => kitCellForKnob(k, i in overrides ? overrides[i] : (k ? k.def : 0)));

// ---- screen catalog ----
// Generic bank pages: {bank, section, over?, touchedIdx?, altArrowShow?}.
// header always = BANKS[bank].name, inverted=false (matches drawKitPage on device).
const BANK_SCREENS = [
    { file: 'bank-clip',      bank: 0, section: '9.1 CLIP bank',      over: { 0: 1, 6: 2 }, altArrowShow: true },
    { file: 'bank-notefx',    bank: 1, section: '10.1 NOTE FX bank',  over: { 0: 1, 1: 7, 2: -23, 3: 50 }, touchedIdx: 2 },
    { file: 'bank-harmony',   bank: 2, section: '10.2 HARMONY bank',  over: { 0: 1, 1: 7, 2: 12, 3: -5 } },
    { file: 'bank-delay',     bank: 3, section: '10.3 DELAY bank',    over: { 0: 10, 2: 4, 4: 12, 7: 3 }, touchedIdx: 0 },
    { file: 'bank-seqarp',    bank: 4, section: '10.4 SEQ ARP bank',  over: { 0: 1, 1: 3, 2: 1 } },
    { file: 'bank-livearp',   bank: 5, section: '10.5 LIVE ARP bank', over: { 0: 1, 1: 2, 2: 2 }, altArrowShow: true },
];

// Custom cell grids (drawn via drawKitBankPage but not from BANKS knobs).
const enumC = (label, name, options, sel) => ({ kind: 'enumsq', label, name, text: options[sel], options, sel });
const DIR = ['Fwd', 'Bwd', 'PPf', 'PPb'], RES = ['1/32','1/16','1/8','1/4','1/2','1bar'];
const DIQ = ['Off','1/64','1/32','1/16','1/16T','1/8','1/8T','1/4','1/4T'];
const CUSTOM_KIT = [
    {
        file: 'bank-drumlane', section: '9.2 DRUM LANE bank', header: 'DRUM LANE',
        cells: [
            enumC('Res', 'Resolution', RES, 1),
            { kind: 'action', label: 'Strch', name: 'Beat Stretch', text: '1x' },
            { kind: 'action', label: 'Shift', name: 'Clock Shift', text: '+0' },
            { kind: 'action', oneWay: true, label: 'Lgto', name: 'Apply Legato', text: '->' },
            { kind: 'valsq', label: 'Eucld', name: 'Euclid Fill', text: '0' },
            { kind: 'blank', label: '' },
            { kind: 'dirsq', label: 'Dir', name: 'Playback Dir', text: 'Fwd', options: DIR, sel: 0 },
            { kind: 'hbar', label: 'SeqFl', name: 'Seq Follow', text: 'ON', norm: 1 },
        ],
    },
    {
        file: 'bank-alllanes', section: '9.3 ALL LANES bank', header: 'ALL LANES',
        cells: [
            { kind: 'valsq', label: 'Res', name: 'Resolution', text: '--' },
            { kind: 'action', label: 'Strch', name: 'Beat Stretch', text: '1x' },
            { kind: 'action', label: 'Shift', name: 'Clock Shift', text: '+0' },
            { kind: 'valsq', label: 'Quant', name: 'Quantize', text: '--' },
            { kind: 'valsq', label: 'VelIn', name: 'Velocity Input', text: 'Live' },
            enumC('InQnt', 'Input Quantize', DIQ, 0),
            { kind: 'dirsq', label: 'Dir', name: 'Playback Dir', text: 'Fwd', options: DIR, sel: 0 },
            { kind: 'hbar', label: 'RSync', name: 'Repeat Sync', text: 'ON', norm: 1 },
        ],
    },
    {
        file: 'bank-conductor-octave', section: '8.3 Conductor banks (C-OCTAVE)', header: 'C-OCTAVE',
        cells: [
            { kind: 'valsq', label: 'Tr1', name: 'Track 1', text: '+1' },
            { kind: 'blank', label: 'Cndct' },
            { kind: 'valsq', label: 'Tr3', name: 'Track 3', text: '--' },
            { kind: 'valsq', label: 'Tr4', name: 'Track 4', text: '-2' },
            { kind: 'valsq', label: 'Tr5', name: 'Track 5', text: '--' },
            { kind: 'valsq', label: 'Tr6', name: 'Track 6', text: '--' },
            { kind: 'valsq', label: 'Tr7', name: 'Track 7', text: '+3' },
            { kind: 'valsq', label: 'Tr8', name: 'Track 8', text: '--' },
        ],
        opts: { pageIdx: 3, pageCount: 5 },
    },
];

// Fully custom-drawn screens: replicate the exact draw block from ui_render.mjs.
const print = (x, y, s, col) => kit.pf3Print(x, y, s, col);  // small font used by device print()
const CUSTOM_DRAW = [
    {
        file: 'bank-repeatgroove', section: '9.4 REPEAT GROOVE bank',
        // ui_render.mjs drum bank===5 (RPT GROOVE): 8-col velocity bar row.
        draw: () => {
            const gLen = 6;
            const vel = [127, 100, 84, 127, 116, 90, 0, 0];  // per-step velocity (illustrative)
            const gate = 0b00111101;                          // filled vs outline per step
            kit.drawKitHeader('REPEAT GROOVE', true);         // drawBankHeadingInverted
            const colW = 16, barW = 10, top = 14, bot = 54, numY = 57;
            fill_rect(0, bot + 1, 128, 1, 1);                 // velocity baseline
            for (let k = 0; k < 8; k++) {
                const x = k * colW + 3;
                if (k >= gLen) { fill_rect(x + 3, bot - 1, 4, 1, 1); continue; }
                const gateOn = !!(gate & (1 << k));
                const mag = Math.round(vel[k] / 127 * (bot - top));
                const y = bot - mag;
                if (gateOn) fill_rect(x, y, barW, mag, 1);
                else { kit.rectOutline(x, y, barW, Math.max(1, mag), 1); }
                const num = String(k + 1);
                kit.mvPrint(x + Math.round((barW - kit.mvWidth(num)) / 2), numY, num, 1);
            }
        },
    },
];

// ---- PNG writer (RGBA, nearest-neighbour scaled, OLED-styled) ----
const SCALE = 4, PAD = 4, BG = [10, 12, 16], ON = [235, 235, 240], MAT = [30, 30, 34];
function writePng(fbuf, outPath) {
    const iw = W * SCALE + 2 * PAD, ih = H * SCALE + 2 * PAD;
    const img = Buffer.alloc(iw * ih * 4);
    for (let i = 0; i < iw * ih; i++) { img[i*4]=MAT[0]; img[i*4+1]=MAT[1]; img[i*4+2]=MAT[2]; img[i*4+3]=255; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const c = fbuf[y * W + x] ? ON : BG;
        for (let sy = 0; sy < SCALE; sy++) for (let sx = 0; sx < SCALE; sx++) {
            const p = ((PAD + y*SCALE + sy) * iw + PAD + x*SCALE + sx) * 4;
            img[p]=c[0]; img[p+1]=c[1]; img[p+2]=c[2]; img[p+3]=255;
        }
    }
    const crc32 = (buf) => { let c = ~0; for (let i=0;i<buf.length;i++){c^=buf[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));} return ~c>>>0; };
    const chunk = (type, data) => { const t=Buffer.from(type,'ascii'); const len=Buffer.alloc(4); len.writeUInt32BE(data.length); const body=Buffer.concat([t,data]); const crc=Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len,body,crc]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(iw,0); ihdr.writeUInt32BE(ih,4); ihdr[8]=8; ihdr[9]=6;
    const raw = Buffer.alloc(ih * (1 + iw*4));
    for (let y=0;y<ih;y++){ raw[y*(1+iw*4)]=0; img.copy(raw, y*(1+iw*4)+1, y*iw*4, (y+1)*iw*4); }
    const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',ihdr), chunk('IDAT',zlib.deflateSync(raw)), chunk('IEND',Buffer.alloc(0))]);
    writeFileSync(outPath, png);
}

// ---- drive ----
const OUT = 'docs/working/img';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
let n = 0;
const emit = (file, section, name, drawFn) => {
    if (only && file !== only) return;
    fb = new Uint8Array(W * H);
    drawFn();
    writePng(fb, `${OUT}/${file}.png`);
    console.log(`  ${(file + '.png').padEnd(30)} ${section} — ${name}`);
    n++;
};
for (const s of BANK_SCREENS) {
    emit(s.file, s.section, BANKS[s.bank].name, () => {
        const cells = bankCells(s.bank, s.over || {});
        const pos = { pageIdx: s.bank, pageCount: 7 };
        kit.drawKitBankPage(cells, { headerText: BANKS[s.bank].name, ...pos,
            touchedIdx: s.touchedIdx ?? -1, altArrowShow: !!s.altArrowShow });
    });
}
for (const s of CUSTOM_KIT) {
    emit(s.file, s.section, s.header, () =>
        kit.drawKitBankPage(s.cells, { headerText: s.header, pageIdx: 0, pageCount: 6, touchedIdx: -1, ...(s.opts || {}) }));
}
for (const s of CUSTOM_DRAW) emit(s.file, s.section, 'custom draw', s.draw);
console.log(`\nwrote ${n} screen${n === 1 ? '' : 's'} to ${OUT}/`);

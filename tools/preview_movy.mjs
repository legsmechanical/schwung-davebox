// tools/preview_movy.mjs — off-device preview of the canvaskit-styled
// track-view parameter pages. Stubs the host draw globals into a 128x64
// framebuffer, imports ui/ui_movy.mjs (standalone, no device imports), and
// renders representative pages to one stacked PNG.
//   node tools/preview_movy.mjs [out.png]
import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const W = 128, H = 64;
let fb = new Uint8Array(W * H);
globalThis.set_pixel = (x, y, v) => {
    x |= 0; y |= 0;
    if (x >= 0 && x < W && y >= 0 && y < H) fb[y * W + x] = v ? 1 : 0;
};
globalThis.fill_rect = (x, y, w, h, v) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) globalThis.set_pixel(x + i, y + j, v);
};

const kit = await import('../ui/ui_movy.mjs');

const enumCell = (label, name, options, sel) =>
    ({ kind: 'enumsq', label, name, text: options[sel], options, sel });

const RES  = ['1/32', '1/16', '1/8', '1/4', '1/2', '1bar'];
const DIQ  = ['Off', '1/64', '1/32', '1/16', '1/16T', '1/8', '1/8T', '1/4', '1/4T'];
const DIR  = ['Fwd', 'Bwd', 'PPf', 'PPb'];
const DLY  = ['1/64','1/64D','1/32','1/16T','1/32D','1/16','1/8T','1/16D','1/8','1/4T','1/8D','1/4','1/4D','1/2','1/2D','1/1','1/1D'];
const STYL = ['Off','Up','Dn','U/D','D/U','Cnv','Div','Ord','Rnd','RnO'];

const frames = [];
function frame(name, cells, opts) {
    fb = new Uint8Array(W * H);
    kit.drawKitBankPage(cells, opts);
    frames.push({ name, fb });
}

/* 1 — CLIP bank, resting */
frame('CLIP (melodic, resting)', [
    enumCell('Res', 'Resolution', RES, 1),
    { kind: 'valsq', label: 'Stch', name: 'Beat Stretch', text: '1x' },
    { kind: 'valsq', label: 'Shft', name: 'Clock Shift', text: '+0' },
    { kind: 'valsq', label: 'Lgto', name: 'Apply Legato', text: '->' },
    enumCell('InQ', 'Input Quantize', DIQ, 0),
    { kind: 'blank', label: '' },
    enumCell('Dir', 'Playback Dir', DIR, 0),
    { kind: 'hbar', label: 'SqFl', name: 'Seq Follow', text: 'ON', norm: 1 },
], { headerText: 'CLIP', pageIdx: 0, pageCount: 7, touchedIdx: -1, altArrowShow: true });

/* 2 — NOTE FX, knob 3 (Vel, bipolar arc) touched: inverted header + value swap */
frame('NOTE FX (Vel touched)', [
    { kind: 'valsq', label: 'Oct', name: 'Octave Shift', text: '+1' },
    { kind: 'arcbip', label: 'Ofs', name: 'Note Offset', text: '+7', signed: 7 / 24 },
    { kind: 'arcbip', label: 'Vel', name: 'Velocity Offset', text: '-23', signed: -23 / 127 },
    { kind: 'arc', label: 'Qnt', name: 'Quantize', text: '50%', norm: 0.5 },
    enumCell('Len>', 'Note Length', ['--', '.25', '.50', '.75', '1', '2', '4', '8', '16'], 4),
    { kind: 'arc', label: '>Gate', name: 'Gate Time', text: '100%', norm: 0.25 },
    { kind: 'blank', label: '' },
    { kind: 'arc', label: 'Rnd', name: 'Pitch Random', text: 'OFF', norm: 0 },
], { headerText: 'NOTE FX', pageIdx: 1, pageCount: 7, touchedIdx: 2 });

/* 3 — DELAY, Rate (17-option enum) touched: scrolling overlay */
frame('DELAY (Rate touched, enum overlay)', [
    enumCell('Rate', 'Delay Time', DLY, 10),
    { kind: 'arc', label: 'Lvl', name: 'Delay Level', text: '127', norm: 1 },
    { kind: 'valsq', label: 'Rep', name: 'Repeats', text: '4' },
    { kind: 'arcbip', label: 'Vfb', name: 'Vel Feedback', text: '+0', signed: 0 },
    { kind: 'arcbip', label: 'Pfb', name: 'Pitch Feedback', text: '+12', signed: 0.5 },
    enumCell('Gate', 'Gate', ['Off','1/64','1/32','1/16T','1/16','1/8T','1/8','1/4T','1/4','1/2','1bar'], 0),
    { kind: 'hbar', label: 'Rtrg', name: 'Retrig', text: 'ON', norm: 1 },
    { kind: 'arc', label: 'Rnd', name: 'Pitch Random', text: '3', norm: 3 / 24 },
], { headerText: 'DELAY', pageIdx: 3, pageCount: 7, touchedIdx: 0 });

/* 4 — ARP IN, resting: inverted (secondary-bank) header + alt arrow */
frame('ARP IN (resting, inverted header)', [
    enumCell('Styl', 'Arp Style', STYL, 1),
    enumCell('Rate', 'Arp Rate', ['1/32','1/16','1/16t','1/8','1/8t','1/4','1/4t','1/2','1/2t','1bar'], 2),
    { kind: 'valsq', label: 'Oct', name: 'Octave Range', text: '+2' },
    { kind: 'arc', label: 'Gate', name: 'Arp Gate', text: '100%', norm: 0.5 },
    enumCell('Stps', 'Steps Mode', ['Off','Mute','Step'], 1),
    { kind: 'hbar', label: 'Rtrg', name: 'Retrigger', text: 'OFF', norm: 0 },
    { kind: 'hbar', label: 'Sync', name: 'Sync to Clock', text: 'ON', norm: 1 },
    { kind: 'hbar', label: 'Ltch', name: 'Latch', text: 'OFF', norm: 0 },
], { headerText: 'ARP IN', headerInvert: true, pageIdx: 5, pageCount: 7, touchedIdx: -1, altArrowShow: true });

/* 5 — drum ALL LANES, resting */
frame('ALL LANES (drum, resting)', [
    { kind: 'valsq', label: 'Res', name: 'Resolution', text: '--' },
    { kind: 'valsq', label: 'Stch', name: 'Beat Stretch', text: '1x' },
    { kind: 'valsq', label: 'Shft', name: 'Clock Shift', text: '+0' },
    { kind: 'valsq', label: 'Qnt', name: 'Quantize', text: '--' },
    { kind: 'valsq', label: 'VelIn', name: 'Velocity Input', text: 'Live' },
    enumCell('InQ', 'Input Quantize', DIQ, 3),
    enumCell('Dir', 'Playback Dir', DIR, 0),
    { kind: 'hbar', label: 'SyncRpt', name: 'Repeat Sync', text: 'ON', norm: 1 },
], { headerText: 'ALL LANES', pageIdx: 0, pageCount: 6, touchedIdx: -1 });

/* 6 — Conductor OCTAVE grid (per-track value squares) */
frame('C-OCTAVE (conductor grid)', [
    { kind: 'valsq', label: 'Tr1', name: 'Track 1', text: '+1' },
    { kind: 'blank', label: 'Cndct' },
    { kind: 'valsq', label: 'Tr3', name: 'Track 3', text: '--' },
    { kind: 'valsq', label: 'Tr4', name: 'Track 4', text: '-2' },
    { kind: 'valsq', label: 'Tr5', name: 'Track 5', text: '--' },
    { kind: 'valsq', label: 'Tr6', name: 'Track 6', text: '--' },
    { kind: 'valsq', label: 'Tr7', name: 'Track 7', text: '+3' },
    { kind: 'valsq', label: 'Tr8', name: 'Track 8', text: '--' },
], { headerText: 'C-OCTAVE', pageIdx: 3, pageCount: 5, touchedIdx: -1 });

/* 7 — drum REPEAT GROOVE (gate bars + % labels), step 3 touched */
frame('REPEAT GROOVE (step 3 touched)', [
    { kind: 'hbar', label: '100%', name: 'Step 1', text: '100%', norm: 1 },
    { kind: 'hbar', label: '80%', name: 'Step 2', text: '80%', norm: 0 },
    { kind: 'hbar', label: '65%', name: 'Step 3', text: '65%', norm: 1 },
    { kind: 'hbar', label: '100%', name: 'Step 4', text: '100%', norm: 1 },
    { kind: 'hbar', label: '90%', name: 'Step 5', text: '90%', norm: 0 },
    { kind: 'hbar', label: '100%', name: 'Step 6', text: '100%', norm: 1 },
    { kind: 'blank', label: '' },
    { kind: 'blank', label: '' },
], { headerText: 'REPEAT GROOVE', headerInvert: true, pageIdx: 4, pageCount: 6, touchedIdx: 2 });

/* ---- stacked PNG ---- */
const SCALE = 3, GAP = 6;
const rows = frames.length;
const cellW = W * SCALE, cellH = H * SCALE;
const imgW = cellW + 2 * GAP;
const imgH = rows * (cellH + GAP) + GAP;
const img = Buffer.alloc(imgW * imgH * 4);
for (let i = 0; i < imgW * imgH; i++) { img[i * 4] = 30; img[i * 4 + 1] = 30; img[i * 4 + 2] = 34; img[i * 4 + 3] = 255; }
frames.forEach((f, idx) => {
    const oy = GAP + idx * (cellH + GAP), ox = GAP;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const on = f.fb[y * W + x];
        const r = on ? 235 : 10, g = on ? 235 : 12, b = on ? 240 : 16;
        for (let sy = 0; sy < SCALE; sy++) for (let sx = 0; sx < SCALE; sx++) {
            const p = ((oy + y * SCALE + sy) * imgW + ox + x * SCALE + sx) * 4;
            img[p] = r; img[p + 1] = g; img[p + 2] = b; img[p + 3] = 255;
        }
    }
});

function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
    return ~c >>> 0;
}
function chunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(imgW, 0); ihdr.writeUInt32BE(imgH, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc(imgH * (1 + imgW * 4));
for (let y = 0; y < imgH; y++) { raw[y * (1 + imgW * 4)] = 0; img.copy(raw, y * (1 + imgW * 4) + 1, y * imgW * 4, (y + 1) * imgW * 4); }
const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
]);
const out = process.argv[2] || 'tools/movy_preview.png';
writeFileSync(out, png);
console.log(`wrote ${out} (${imgW}x${imgH}, ${frames.length} frames)`);
frames.forEach((f, i) => console.log(`  frame ${i}: ${f.name}`));

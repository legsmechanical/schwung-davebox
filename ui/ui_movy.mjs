/* ui_movy.mjs
 * Canvaskit/movy visual language for the track-view parameter pages: the
 * schwung-canvaskit v27 chassis (header font + page-indicator bar + inverted
 * touch header, movy widgets: arc knobs / bar toggles / enum + value squares,
 * proportional label strips with the name<->value touch swap, enum list
 * overlay) translated from the kit's ctx-based canvas contract onto davebox's
 * host draw globals (set_pixel / fill_rect). Pure drawing — NO imports, no S
 * access: callers pass precomputed cell descriptors, so this file also loads
 * standalone in node for the off-device previewer (tools/preview_movy.mjs).
 *
 * Provenance: widgets + label/5x3 fonts adapted from schwung-movy (MIT,
 * (c) 2026 megadake) via schwung-canvaskit; header font = "6x6 Pixel Font"
 * by asciimario (fontstruct.com/fontstructions/show/821131, CC BY-NC 3.0).
 *
 * Cell descriptor (everything precomputed by the caller — no param reads):
 *   { kind:  'blank' | 'arc' | 'arcbip' | 'hbar' | 'enumsq' | 'valsq' | 'frac',
 *            ('valsq' = numeric / note read-out: big font, frameless — see
 *             drawBigNum; 'enumsq' = the framed micro-font square for NAMED
 *             enums, whose words don't fit the big font),
 *     label: short label strip text ("Stch"),
 *     name:  full param name for the touched header ("Beat Stretch"),
 *     text:  formatted value string ("x2", "1/16t", "OFF"),
 *     norm:  0..1 fill (arc / hbar),
 *     signed:-1..1 offset from center (arcbip),
 *     sq:    optional single-line square label (else derived from text),
 *     options / sel: enum option strings + selected index (enumsq overlay;
 *                    sel < 0 = unset, no overlay) }
 */

/* ---- layout (kit v27 vertical map, 128x64) ----
 * hdr 0-7 (text 1-6) | blank 8 | page bar 9 | gap 10-13 |
 * w0 14-29 | lbl0 30-36 | gap 37-40 | w1 41-56 | lbl1 57-63 */
export const MV_HDR_H = 8;
export const MV_BAR_Y = 9;
export const MV_ROW0_Y = 14, MV_LBL0_Y = 30, MV_ROW1_Y = 41, MV_LBL1_Y = 57;
export const MV_CELL_W = 32, MV_KW = 20, MV_KH = 16, MV_LBL_H = 7;
/* Centered overlay box shared by the turn-to-reveal value zoom (ui_render) and
 * the picker list overlay below — same footprint so both read as one control. */
export const MV_ZOOM_X = 32, MV_ZOOM_Y = 14, MV_ZOOM_W = 64, MV_ZOOM_H = 48;
const SCREEN_W = 128;

/* ---- header font: "6x6 Pixel Font" by asciimario (CC BY-NC 3.0) ----
 * Glyph: [advance, ...6 rowBits], bit0 = leftmost; [n] alone = blank;
 * null = unmapped. Uppercase-only (lowercase rows repeat caps). */
const HDR_G = [
  [7], [7,12,12,12,12,0,12], null, [7,10,31,10,31,10,0], null, [7,51,48,12,12,3,51], null, null,
  [4,6,3,3,3,3,6], [4,3,6,6,6,6,3], null, [7,0,12,63,63,12,0], [7,0,0,0,0,12,4], [7,0,0,30,30,0,0], [7,0,0,0,0,12,12], [7,48,48,12,12,3,3],
  [7,30,51,59,55,51,30], [7,12,14,12,12,12,30], [7,30,51,48,30,3,63], [7,30,48,28,48,51,30], [7,24,28,30,27,63,24], [7,31,3,31,48,51,30], [7,30,3,31,51,51,30], [7,63,51,48,24,12,12],
  [7,30,51,30,51,51,30], [7,30,51,51,62,48,30], [7,12,12,0,0,12,12], null, [7,48,12,3,3,12,48], null, [7,3,12,48,48,12,3], [7,30,51,24,12,0,12],
  null, [7,30,51,51,63,51,51], [7,31,51,31,51,51,31], [7,30,51,3,3,51,30], [7,31,51,51,51,51,31], [7,63,3,31,3,3,63], [7,63,3,3,31,3,3], [7,30,51,3,59,51,62],
  [7,51,51,63,51,51,51], [7,30,12,12,12,12,30], [7,56,48,48,48,51,30], [7,51,27,15,15,27,51], [7,3,3,3,3,3,63], [7,35,55,63,43,35,35], [7,35,39,47,59,51,35], [7,30,51,51,51,51,30],
  [7,31,51,51,31,3,3], [7,30,51,51,59,19,46], [7,31,51,51,31,51,51], [7,30,3,30,48,51,30], [7,63,12,12,12,12,12], [7,51,51,51,51,51,30], [7,51,51,51,51,30,12], [7,35,35,43,63,55,35],
  [7,51,51,30,30,51,51], [7,51,51,51,30,12,12], [7,63,56,28,14,7,63], null, null, null, null, null,
  null, [7,30,51,51,63,51,51], [7,31,51,31,51,51,31], [7,30,51,3,3,51,30], [7,31,51,51,51,51,31], [7,63,3,31,3,3,63], [7,63,3,3,31,3,3], [7,30,51,3,59,51,62],
  [7,51,51,63,51,51,51], [7,30,12,12,12,12,30], [7,56,48,48,48,51,30], [7,51,27,15,15,27,51], [7,3,3,3,3,3,63], [7,35,55,63,43,35,35], [7,35,39,47,59,51,35], [7,30,51,51,51,51,30],
  [7,31,51,51,31,3,3], [7,30,51,51,59,19,46], [7,31,51,51,31,51,51], [7,30,3,30,48,51,30], [7,63,12,12,12,12,12], [7,51,51,51,51,51,30], [7,51,51,51,51,30,12], [7,35,35,43,63,55,35],
  [7,51,51,30,30,51,51], [7,51,51,51,30,12,12], [7,63,56,28,14,7,63], null, null, null, null
];

/* TRUE lowercase 'd' and 't' — the only two in this font. Everything else in
 * the lowercase range duplicates its capital (the font is a caps design), but
 * a capital D is a 0 with the diagonal removed, so "1/64D" reads as "1/640"
 * in the stacked-fraction read-out. Triplet/dotted suffixes therefore use
 * real minuscules: 'd' = bowl + right ascender, 't' = stem + crossbar + tail.
 * 6 columns, 6 rows, bit0 = leftmost — same encoding as HDR_G above. */
HDR_G[0x64 - 0x20] = [7, 48, 48, 62, 51, 51, 62];   /* 'd' */
HDR_G[0x74 - 0x20] = [7, 12, 30, 12, 12, 12, 28];   /* 't' */

function hdrGlyph(cp) { return (cp < 0x20 || cp > 0x7E) ? null : HDR_G[cp - 0x20]; }

export function hdrWidth(text) {
    const s = String(text);
    let w = 0;
    for (let i = 0; i < s.length; i++) {
        const g = hdrGlyph(s.charCodeAt(i));
        w += g ? g[0] : 7;
    }
    return Math.max(0, w - 1);
}

export function hdrPrint(x, y, text, color) {
    const s = String(text);
    let cx = Math.round(x);
    const oy = Math.round(y), v = color ? 1 : 0;
    for (let i = 0; i < s.length; i++) {
        const g = hdrGlyph(s.charCodeAt(i));
        if (!g) { cx += 7; continue; }
        for (let r = 0; r < 6; r++) {
            const bits = g[1 + r] || 0;
            for (let c = 0; c < 15; c++) if (bits & (1 << c)) set_pixel(cx + c, oy + r, v);
        }
        cx += g[0];
    }
}

/* ALL-CAPS header text, trimmed from the end until it fits maxW px. */
export function fitHdr(text, maxW) {
    let t = String(text).toUpperCase();
    while (t.length > 0 && hdrWidth(t) > maxW) t = t.slice(0, -1);
    return t;
}

/* ---- movy main font (proportional, 5px tall; schwung-movy MIT) ----
 * Glyph: [advance, yOff, w, h, ...rowBits], bit0 = leftmost; -1px gap. */
const MV_G = [
  [6, 0, 0, 0],
  [3, 0, 3, 5, 2, 2, 2, 0, 2],
  [5, 0, 5, 2, 10, 10],
  [7, 0, 7, 5, 20, 62, 20, 62, 20],
  [7, 0, 7, 5, 60, 10, 28, 40, 30],
  [5, 0, 5, 5, 10, 8, 4, 2, 10],
  [5, 0, 5, 5, 4, 10, 4, 10, 12],
  [3, 0, 3, 2, 2, 2],
  [4, 0, 4, 5, 4, 2, 2, 2, 4],
  [4, 0, 4, 5, 2, 4, 4, 4, 2],
  [5, 1, 5, 3, 10, 4, 10],
  [5, 2, 5, 3, 4, 14, 4],
  [4, 4, 4, 3, 6, 4, 2],
  [5, 3, 5, 1, 14],
  [3, 4, 3, 1, 2],
  [5, 0, 5, 5, 8, 8, 4, 2, 2],
  [6, 0, 6, 5, 30, 18, 18, 18, 30],
  [5, 0, 5, 5, 6, 4, 4, 4, 14],
  [6, 0, 6, 5, 30, 16, 30, 2, 30],
  [6, 0, 6, 5, 30, 16, 28, 16, 30],
  [6, 0, 6, 5, 18, 18, 30, 16, 16],
  [6, 0, 6, 5, 30, 2, 30, 16, 30],
  [6, 0, 6, 5, 30, 2, 30, 18, 30],
  [6, 0, 6, 5, 30, 16, 8, 4, 4],
  [6, 0, 6, 5, 30, 18, 30, 18, 30],
  [6, 0, 6, 5, 30, 18, 30, 16, 30],
  [4, 1, 4, 3, 4, 0, 4],
  [4, 1, 4, 4, 4, 0, 4, 2],
  [5, 0, 5, 5, 8, 4, 2, 4, 8],
  [5, 2, 5, 3, 14, 0, 14],
  [5, 0, 5, 5, 2, 4, 8, 4, 2],
  [5, -1, 5, 6, 6, 8, 4, 4, 0, 4],
  [7, 0, 7, 5, 28, 32, 44, 42, 28],
  [6, 0, 6, 5, 12, 18, 30, 18, 18],
  [6, 0, 6, 5, 14, 18, 14, 18, 14],
  [6, 0, 6, 5, 12, 18, 2, 18, 12],
  [6, 0, 6, 5, 14, 18, 18, 18, 14],
  [6, 0, 6, 5, 30, 2, 14, 2, 30],
  [6, 0, 6, 5, 30, 2, 14, 2, 2],
  [6, 0, 6, 5, 12, 2, 26, 18, 12],
  [6, 0, 6, 5, 18, 18, 30, 18, 18],
  [3, 0, 3, 5, 2, 2, 2, 2, 2],
  [5, 0, 5, 5, 8, 8, 8, 10, 6],
  [5, 0, 5, 5, 10, 10, 6, 10, 10],
  [6, 0, 6, 5, 2, 2, 2, 2, 30],
  [7, 0, 7, 5, 30, 42, 42, 34, 34],
  [6, 0, 6, 5, 12, 18, 18, 18, 18],
  [6, 0, 6, 5, 12, 18, 18, 18, 12],
  [6, 0, 6, 5, 14, 18, 18, 14, 2],
  [6, 0, 6, 5, 12, 18, 18, 26, 28],
  [6, 0, 6, 5, 14, 18, 18, 14, 18],
  [6, 0, 6, 5, 28, 2, 12, 16, 14],
  [5, 0, 5, 5, 14, 4, 4, 4, 4],
  [6, 0, 6, 5, 18, 18, 18, 18, 12],
  [6, 0, 6, 5, 18, 18, 18, 10, 6],
  [7, 0, 7, 5, 34, 34, 42, 42, 30],
  [5, 0, 5, 5, 10, 10, 4, 10, 10],
  [6, 0, 6, 5, 18, 18, 28, 16, 14],
  [6, 0, 6, 5, 30, 16, 12, 2, 30],
  [4, 0, 4, 5, 6, 2, 2, 2, 6],
  [5, 0, 5, 5, 2, 2, 4, 8, 8],
  [4, 0, 4, 5, 6, 4, 4, 4, 6],
  [5, 0, 5, 2, 4, 10],
  [6, 5, 6, 1, 30],
  [4, 0, 4, 2, 2, 4],
  [6, 0, 6, 5, 12, 18, 30, 18, 18],
  [6, 0, 6, 5, 14, 18, 14, 18, 14],
  [6, 0, 6, 5, 12, 18, 2, 18, 12],
  [6, 0, 6, 5, 14, 18, 18, 18, 14],
  [6, 0, 6, 5, 30, 2, 14, 2, 30],
  [6, 0, 6, 5, 30, 2, 14, 2, 2],
  [6, 0, 6, 5, 12, 2, 26, 18, 12],
  [6, 0, 6, 5, 18, 18, 30, 18, 18],
  [3, 0, 3, 5, 2, 2, 2, 2, 2],
  [5, 0, 5, 5, 8, 8, 8, 10, 6],
  [5, 0, 5, 5, 10, 10, 6, 10, 10],
  [6, 0, 6, 5, 2, 2, 2, 2, 30],
  [7, 0, 7, 5, 30, 42, 42, 34, 34],
  [6, 0, 6, 5, 12, 18, 18, 18, 18],
  [6, 0, 6, 5, 12, 18, 18, 18, 12],
  [6, 0, 6, 5, 14, 18, 18, 14, 2],
  [6, 0, 6, 5, 12, 18, 18, 26, 28],
  [6, 0, 6, 5, 14, 18, 18, 14, 18],
  [6, 0, 6, 5, 28, 2, 12, 16, 14],
  [5, 0, 5, 5, 14, 4, 4, 4, 4],
  [6, 0, 6, 5, 18, 18, 18, 18, 12],
  [6, 0, 6, 5, 18, 18, 18, 10, 6],
  [7, 0, 7, 5, 34, 34, 42, 42, 30],
  [5, 0, 5, 5, 10, 10, 4, 10, 10],
  [6, 0, 6, 5, 18, 18, 28, 16, 30],
  [6, 0, 6, 5, 30, 16, 12, 2, 30],
  [5, 0, 5, 5, 12, 4, 2, 4, 12],
  [3, 0, 3, 5, 2, 2, 2, 2, 2],
  [5, 0, 5, 5, 6, 4, 8, 4, 6],
  [6, 0, 6, 2, 20, 10]
];

function mvGlyph(cp) { return (cp < 0x20 || cp > 0x7E) ? null : MV_G[cp - 0x20]; }

export function mvWidth(text) {
    const s = String(text);
    let w = 0;
    for (let i = 0; i < s.length; i++) {
        const g = mvGlyph(s.charCodeAt(i));
        w += g ? g[0] : 5;
        if (i < s.length - 1) w -= 1;
    }
    return w;
}

export function mvPrint(x, y, text, color) {
    const s = String(text);
    let cx = Math.round(x);
    const oy = Math.round(y), v = color ? 1 : 0;
    for (let i = 0; i < s.length; i++) {
        const g = mvGlyph(s.charCodeAt(i));
        if (!g) { cx += 5; continue; }
        const yOff = g[1], w = g[2], h = g[3];
        for (let r = 0; r < h; r++) {
            const bits = g[4 + r];
            for (let c = 0; c < w; c++) if (bits & (1 << c)) set_pixel(cx + c, oy + yOff + r, v);
        }
        cx += g[0];
        if (i < s.length - 1) cx -= 1;
    }
}

/* Integer-scaled movy print: each source pixel becomes a scale×scale block.
 * Width scales linearly, so mvWidth(text) * scale is the rendered width. */
export function mvPrintScaled(x, y, text, color, scale) {
    const s = String(text);
    let cx = Math.round(x);
    const oy = Math.round(y), v = color ? 1 : 0;
    for (let i = 0; i < s.length; i++) {
        const g = mvGlyph(s.charCodeAt(i));
        if (!g) { cx += 5 * scale; continue; }
        const yOff = g[1], w = g[2], h = g[3];
        for (let r = 0; r < h; r++) {
            const bits = g[4 + r];
            for (let c = 0; c < w; c++)
                if (bits & (1 << c))
                    fill_rect(cx + c * scale, oy + (yOff + r) * scale, scale, scale, v);
        }
        cx += g[0] * scale;
        if (i < s.length - 1) cx -= scale;
    }
}

/* ---- 5x3 micro font (schwung-movy glyphs5x3, MIT) — inside the squares ---- */
const PF3_CHARS = " !\"'()+,-./:0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ%<>=?*";
const PF3_G = [
  [4,0,0,0],
  [4,0,3,5,1,1,1,0,1], [4,0,3,5,5,5,0,0,0], [4,0,3,5,2,2,0,0,0],
  [4,0,3,5,2,1,1,1,2], [4,0,3,5,1,2,2,2,1], [4,0,3,5,2,7,2,0,0],
  [4,0,3,5,0,0,3,3,2], [4,0,3,5,0,0,7,0,0], [4,0,3,5,0,0,0,3,3],
  [4,0,3,5,4,4,2,1,1], [4,0,3,5,3,3,0,3,3],
  [4,0,3,5,7,5,5,5,7], [4,0,3,5,2,3,2,2,7], [4,0,3,5,7,4,7,1,7],
  [4,0,3,5,7,4,6,4,7], [4,0,3,5,5,5,7,4,4], [4,0,3,5,7,1,7,4,7],
  [4,0,3,5,7,1,7,5,7], [4,0,3,5,7,4,4,4,4], [4,0,3,5,7,5,7,5,7],
  [4,0,3,5,7,5,7,4,7],
  [4,0,3,5,2,7,5,5,5], [4,0,3,5,7,5,3,5,7], [4,0,3,5,7,1,1,1,7],
  [4,0,3,5,3,5,5,5,3], [4,0,3,5,7,1,3,1,7], [4,0,3,5,7,1,3,1,1],
  [4,0,3,5,7,1,5,5,7], [4,0,3,5,5,5,7,5,5], [4,0,3,5,7,2,2,2,7],
  [4,0,3,5,4,4,4,5,7], [4,0,3,5,5,5,3,5,5], [4,0,3,5,1,1,1,1,7],
  [4,0,3,5,5,7,5,5,5], [4,0,3,5,5,3,5,5,5], [4,0,3,5,7,5,5,5,7],
  [4,0,3,5,7,5,7,1,1], [4,0,3,5,3,5,5,7,2], [4,0,3,5,7,5,3,5,5],
  [4,0,3,5,6,1,2,4,3], [4,0,3,5,7,2,2,2,2], [4,0,3,5,5,5,5,5,7],
  [4,0,3,5,5,5,5,5,2], [4,0,3,5,5,5,5,7,7], [4,0,3,5,5,5,2,5,5],
  [4,0,3,5,5,5,7,2,2], [4,0,3,5,7,4,2,1,7],
  [4,0,3,5,5,4,2,1,5], [4,0,3,5,4,2,1,2,4], [4,0,3,5,1,2,4,2,1],
  [4,0,3,5,7,0,7,0,0], [4,0,3,5,7,4,6,0,2], [4,0,3,5,2,7,2,5,0]
];

function pf3Glyph(ch) {
    const i = PF3_CHARS.indexOf(ch);
    return i >= 0 ? PF3_G[i] : null;
}

export function pf3Width(text) {
    const s = String(text).toUpperCase();
    let w = 0;
    for (let i = 0; i < s.length; i++) { const g = pf3Glyph(s[i]); w += g ? g[0] : 4; }
    return w;
}

export function pf3Print(x, y, text, color) {
    const s = String(text).toUpperCase();
    let cx = Math.round(x);
    const oy = Math.round(y), v = color ? 1 : 0;
    for (let i = 0; i < s.length; i++) {
        const g = pf3Glyph(s[i]);
        if (!g) { cx += 4; continue; }
        const yOff = g[1], w = g[2], h = g[3];
        for (let r = 0; r < h; r++) {
            const bits = g[4 + r];
            for (let c = 0; c < w; c++) if (bits & (1 << c)) set_pixel(cx + c, oy + yOff + r, v);
        }
        cx += g[0];
    }
}

/* ---- big font: 13pt Nokia bitmap (schwung-movy src/font/big.ts +
 * glyphs-big.ts, MIT) — cap-height 11px, ~9px-wide digits. The large numeric
 * readout movy uses for Tempo / Swing / Root / Condition / Length / Transpose.
 * Glyph format: [advance, yOff, w, h, ...rowBits], bit0 = leftmost pixel;
 * 1px inter-glyph gap (the source OTF leaves no side bearing). ---- */
export const MV_BIG_H = 11;
const BIG_GAP = 1;
const BIG_G = [
  [4, 0, 0, 0],// ' '
  [4, 0, 4, 11, 3, 3, 3, 3, 3, 3, 3, 3, 0, 3, 3],// '!'
  [7, 0, 7, 3, 27, 27, 9],// '"'
  [9, 1, 9, 10, 54, 54, 127, 127, 54, 54, 127, 127, 54, 54],// '#'
  [9, 0, 9, 12, 8, 62, 127, 11, 11, 63, 126, 104, 104, 127, 62, 8],// '$'
  [10, 0, 10, 11, 102, 101, 117, 51, 56, 24, 28, 204, 174, 166, 102],// '%'
  [10, 0, 10, 11, 30, 63, 3, 99, 254, 255, 99, 99, 99, 127, 62],// '&'
  [4, 0, 4, 3, 3, 3, 1],// "'"
  [6, 0, 6, 13, 12, 6, 6, 3, 3, 3, 3, 3, 3, 3, 6, 6, 12],// '('
  [6, 0, 6, 13, 3, 6, 6, 12, 12, 12, 12, 12, 12, 12, 6, 6, 3],// ')'
  [10, 2, 10, 9, 24, 24, 219, 255, 60, 255, 219, 24, 24],// '*'
  [8, 3, 8, 6, 12, 12, 63, 63, 12, 12],// '+'
  [5, 9, 5, 3, 6, 6, 3],// ','
  [7, 5, 7, 2, 31, 31],// '-'
  [4, 9, 4, 2, 3, 3],// '.'
  [6, 0, 6, 11, 12, 12, 12, 14, 6, 6, 6, 7, 3, 3, 3],// '/'
  [9, 0, 9, 11, 62, 127, 99, 99, 99, 99, 99, 99, 99, 127, 62],// '0'
  [8, 0, 8, 11, 48, 56, 60, 60, 48, 48, 48, 48, 48, 48, 48],// '1'
  [9, 0, 9, 11, 62, 127, 99, 96, 112, 56, 28, 14, 7, 127, 127],// '2'
  [9, 0, 9, 11, 62, 127, 99, 96, 60, 124, 96, 96, 99, 127, 62],// '3'
  [9, 0, 9, 11, 48, 56, 60, 54, 55, 51, 127, 127, 48, 48, 48],// '4'
  [9, 0, 9, 11, 63, 63, 3, 3, 63, 127, 96, 96, 99, 127, 62],// '5'
  [9, 0, 9, 11, 62, 127, 3, 63, 127, 99, 99, 99, 99, 127, 62],// '6'
  [9, 0, 9, 11, 127, 127, 48, 48, 24, 24, 12, 12, 12, 12, 12],// '7'
  [9, 0, 9, 11, 62, 127, 99, 99, 62, 127, 99, 99, 99, 127, 62],// '8'
  [9, 0, 9, 11, 62, 127, 99, 99, 99, 127, 126, 96, 99, 127, 62],// '9'
  [4, 5, 4, 6, 3, 3, 0, 0, 3, 3],// ':'
  [5, 5, 5, 7, 6, 6, 0, 0, 6, 6, 3],// ';'
  [8, 1, 8, 10, 48, 56, 28, 14, 7, 7, 14, 28, 56, 48],// '<'
  [7, 4, 7, 5, 31, 31, 0, 31, 31],// '='
  [8, 1, 8, 10, 3, 7, 14, 28, 56, 56, 28, 14, 7, 3],// '>'
  [9, 0, 9, 11, 62, 127, 99, 99, 120, 60, 12, 12, 0, 12, 12],// '?'
  [13, 0, 13, 11, 508, 1022, 1799, 1779, 1755, 1755, 2011, 1011, 7, 1022, 508],// '@'
  [9, 0, 9, 11, 62, 127, 99, 99, 99, 99, 99, 127, 127, 99, 99],// 'A'
  [9, 0, 9, 11, 63, 127, 99, 99, 63, 127, 99, 99, 99, 127, 63],// 'B'
  [9, 0, 9, 11, 62, 127, 3, 3, 3, 3, 3, 3, 3, 127, 62],// 'C'
  [9, 0, 9, 11, 63, 127, 99, 99, 99, 99, 99, 99, 99, 127, 63],// 'D'
  [9, 0, 9, 11, 127, 127, 3, 3, 31, 31, 3, 3, 3, 127, 127],// 'E'
  [9, 0, 9, 11, 127, 127, 3, 3, 31, 31, 3, 3, 3, 3, 3],// 'F'
  [9, 0, 9, 11, 62, 127, 3, 3, 115, 115, 99, 99, 99, 127, 126],// 'G'
  [9, 0, 9, 11, 99, 99, 99, 99, 127, 127, 99, 99, 99, 99, 99],// 'H'
  [4, 0, 4, 11, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],// 'I'
  [7, 0, 7, 11, 24, 24, 24, 24, 24, 24, 24, 24, 24, 31, 15],// 'J'
  [9, 0, 9, 11, 99, 115, 59, 31, 15, 7, 15, 31, 59, 115, 99],// 'K'
  [8, 0, 8, 11, 3, 3, 3, 3, 3, 3, 3, 3, 3, 63, 63],// 'L'
  [11, 0, 11, 11, 257, 387, 455, 495, 511, 443, 403, 387, 387, 387, 387],// 'M'
  [9, 0, 9, 11, 99, 99, 103, 103, 111, 111, 123, 123, 115, 115, 99],// 'N'
  [9, 0, 9, 11, 62, 127, 99, 99, 99, 99, 99, 99, 99, 127, 62],// 'O'
  [9, 0, 9, 11, 63, 127, 99, 99, 99, 127, 63, 3, 3, 3, 3],// 'P'
  [9, 0, 9, 12, 62, 127, 99, 99, 99, 99, 99, 99, 123, 127, 62, 96],// 'Q'
  [9, 0, 9, 11, 63, 127, 99, 99, 99, 63, 127, 99, 99, 99, 99],// 'R'
  [9, 0, 9, 11, 62, 127, 3, 3, 63, 126, 96, 96, 96, 127, 62],// 'S'
  [8, 0, 8, 11, 63, 63, 12, 12, 12, 12, 12, 12, 12, 12, 12],// 'T'
  [9, 0, 9, 11, 99, 99, 99, 99, 99, 99, 99, 99, 99, 127, 62],// 'U'
  [9, 0, 9, 11, 99, 99, 99, 99, 99, 99, 119, 54, 62, 28, 8],// 'V'
  [12, 0, 12, 11, 771, 771, 771, 771, 951, 438, 510, 510, 204, 204, 204],// 'W'
  [9, 0, 9, 11, 99, 99, 99, 54, 62, 28, 62, 54, 99, 99, 99],// 'X'
  [10, 0, 10, 11, 195, 195, 231, 102, 126, 60, 60, 24, 24, 24, 24],// 'Y'
  [9, 0, 9, 11, 127, 127, 96, 112, 56, 28, 14, 7, 3, 127, 127],// 'Z'
  [5, 0, 5, 13, 7, 7, 3, 3, 3, 3, 3, 3, 3, 3, 3, 7, 7],// '['
  [6, 0, 6, 11, 3, 3, 3, 7, 6, 6, 6, 14, 12, 12, 12],// '\\'
  [5, 0, 5, 13, 7, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7],// ']'
  [5, 0, 5, 2, 2, 5],// '^'
  [9, 11, 9, 1, 127],// '_'
  [4, 0, 4, 2, 1, 2],// '`'
  [9, 3, 9, 8, 126, 127, 99, 99, 99, 99, 127, 126],// 'a'
  [9, 0, 9, 11, 3, 3, 3, 63, 127, 99, 99, 99, 99, 127, 63],// 'b'
  [8, 3, 8, 8, 30, 63, 3, 3, 3, 3, 63, 30],// 'c'
  [9, 0, 9, 11, 96, 96, 96, 126, 127, 99, 99, 99, 99, 127, 126],// 'd'
  [9, 3, 9, 8, 62, 127, 99, 127, 63, 3, 127, 62],// 'e'
  [7, 0, 7, 11, 28, 30, 6, 15, 15, 6, 6, 6, 6, 6, 6],// 'f'
  [9, 3, 9, 10, 126, 127, 99, 99, 99, 127, 126, 96, 126, 60],// 'g'
  [9, 0, 9, 11, 3, 3, 3, 63, 127, 99, 99, 99, 99, 99, 99],// 'h'
  [4, 0, 4, 11, 3, 3, 0, 3, 3, 3, 3, 3, 3, 3, 3],// 'i'
  [6, 0, 6, 13, 12, 12, 0, 12, 12, 12, 12, 12, 12, 12, 12, 15, 7],// 'j'
  [9, 0, 9, 11, 3, 3, 3, 99, 115, 63, 31, 51, 51, 99, 99],// 'k'
  [4, 0, 4, 11, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],// 'l'
  [12, 3, 12, 8, 511, 1023, 819, 819, 819, 819, 819, 819],// 'm'
  [9, 3, 9, 8, 63, 127, 99, 99, 99, 99, 99, 99],// 'n'
  [9, 3, 9, 8, 62, 127, 99, 99, 99, 99, 127, 62],// 'o'
  [9, 3, 9, 10, 63, 127, 99, 99, 99, 99, 127, 63, 3, 3],// 'p'
  [9, 3, 9, 10, 126, 127, 99, 99, 99, 99, 127, 126, 96, 96],// 'q'
  [7, 3, 7, 8, 27, 31, 7, 3, 3, 3, 3, 3],// 'r'
  [8, 3, 8, 8, 62, 63, 3, 15, 60, 48, 63, 31],// 's'
  [6, 0, 6, 11, 6, 6, 6, 15, 15, 6, 6, 6, 6, 14, 12],// 't'
  [9, 3, 9, 8, 99, 99, 99, 99, 99, 99, 127, 126],// 'u'
  [9, 3, 9, 8, 99, 99, 99, 99, 119, 62, 28, 8],// 'v'
  [10, 3, 10, 8, 195, 195, 195, 219, 219, 255, 126, 102],// 'w'
  [9, 3, 9, 8, 99, 119, 62, 28, 28, 62, 119, 99],// 'x'
  [9, 3, 9, 10, 99, 99, 99, 99, 99, 127, 126, 96, 126, 60],// 'y'
  [9, 3, 9, 8, 127, 127, 56, 28, 14, 7, 127, 127],// 'z'
  [6, 0, 6, 13, 12, 6, 6, 6, 6, 6, 3, 6, 6, 6, 6, 6, 12],// '{'
  [4, 0, 4, 13, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],// '|'
  [6, 0, 6, 13, 3, 6, 6, 6, 6, 6, 12, 6, 6, 6, 6, 6, 3],// '}'
  [8, 6, 8, 3, 38, 63, 25],// '~'
];
function bigGlyph(cp) { return (cp < 0x20 || cp > 0x7E) ? null : BIG_G[cp - 0x20]; }

/* Tight punctuation. The source font gives '.' the same ~4px advance a letter
 * gets, so a decimal ate most of a digit's worth of a 32px cell and pushed
 * values like "0.25" over the fallback threshold. These advance by their INK
 * width instead, and tuck up against the character on their LEFT — which is
 * free, because every digit already carries ~2px of right side bearing.
 * The gap on their RIGHT is kept: the next character starts at its own left
 * edge with no bearing, so without it a "0.25" reads as "0.2 5".
 * Keyed by codepoint; the value is the advance. */
const BIG_TIGHT = { 0x2E: 2, 0x3A: 2, 0x2C: 3, 0x3B: 3, 0x2F: 5 };   /* . : , ; / */

/* Ink bounds per glyph, measured once: [leftmostCol, inkWidth]. Drives the
 * CONDENSED variant below. */
const BIG_INK = BIG_G.map((g) => {
    const w = g[2], h = g[3];
    let lo = 99, hi = -1;
    for (let r = 0; r < h; r++) {
        const bits = g[4 + r];
        for (let c = 0; c < w; c++) if (bits & (1 << c)) { if (c < lo) lo = c; if (c > hi) hi = c; }
    }
    return hi < 0 ? [0, 0] : [lo, hi - lo + 1];
});

/* CONDENSED: same glyphs, same 11px height, advances trimmed to ink width + 1
 * and the glyph shifted left onto its own ink. The source font is generously
 * spaced (a digit is 9px advance for 7px of ink), so this buys ~15% width with
 * no loss of legibility — enough for a 4-character value like "1/16" or a
 * 5-character "1/16T" in a 32px cell, which the normal spacing can't hold.
 * It is NOT a smaller font: mixing the two on a page reads as tracking, not
 * as two type sizes. */
const bigAdv = (cp, g, cond) => {
    const ink = BIG_INK[cp - 0x20][1];
    if (!cond) return BIG_TIGHT[cp] ?? g[0];
    if (!ink) return g[0];                      /* space */
    /* punctuation advances by its exact ink — it already gets a zero gap on
     * the left, and this is what lets "1/16T" hold a 32px cell */
    return BIG_TIGHT[cp] ? ink : ink + 1;
};
const bigGapAt = (a, b) => BIG_TIGHT[b] ? 0 : BIG_GAP;

/* Width of `text` in the big font (no trailing gap). `cond` = condensed. */
export function bigWidth(text, cond) {
    const s = String(text);
    let w = 0;
    for (let i = 0; i < s.length; i++) {
        const cp = s.charCodeAt(i);
        const g = bigGlyph(cp);
        w += g ? bigAdv(cp, g, cond) : 7;
        if (i < s.length - 1) w += bigGapAt(cp, s.charCodeAt(i + 1));
    }
    return w;
}

export function bigPrint(x, y, text, color, cond) {
    const s = String(text);
    let cx = Math.round(x);
    const oy = Math.round(y), v = color ? 1 : 0;
    for (let i = 0; i < s.length; i++) {
        const cp = s.charCodeAt(i);
        const g = bigGlyph(cp);
        if (!g) { cx += 7; continue; }
        const yOff = g[1], w = g[2], h = g[3];
        const shift = cond ? BIG_INK[cp - 0x20][0] : 0;   /* sit on the ink */
        for (let r = 0; r < h; r++) {
            const bits = g[4 + r];
            let c = 0;
            while (c < w) {
                if (bits & (1 << c)) {
                    const st = c;
                    while (c < w && (bits & (1 << c))) c++;
                    fill_rect(cx + st - shift, oy + yOff + r, c - st, 1, v);
                } else c++;
            }
        }
        cx += bigAdv(cp, g, cond);
        if (i < s.length - 1) cx += bigGapAt(cp, s.charCodeAt(i + 1));
    }
}

/* Largest form of `text` that fits `maxW`: normal spacing, else condensed,
 * else null (caller drops to the label font). Returns { w, cond }. */
export function bigFit(text, maxW) {
    const n = bigWidth(text, false);
    if (n <= maxW) return { w: n, cond: false };
    const c = bigWidth(text, true);
    if (c <= maxW) return { w: c, cond: true };
    return null;
}

/* ---- primitive helpers ---- */

export function plotLine(x1, y1, x2, y2, fg) {
    const dx = x2 - x1, dy = y2 - y1;
    const steps = Math.max(1, Math.round(Math.max(Math.abs(dx), Math.abs(dy))));
    for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        set_pixel(Math.round(x1 + dx * t), Math.round(y1 + dy * t), fg);
    }
}

export function rectOutline(x, y, w, h, fg) {
    fill_rect(x, y, w, 1, fg);
    fill_rect(x, y + h - 1, w, 1, fg);
    fill_rect(x, y, 1, h, fg);
    fill_rect(x + w - 1, y, 1, h, fg);
}

/* ---- widgets (movy language, kit v27 metrics: 16px tall in 32px cells) ---- */

function drawCircleBorder(cx, cy, r) {
    let x = r, y = 0, err = 0;
    while (x >= y) {
        if (y === 0) {
            /* cardinal extremes tucked to r-1 so the circle sits flush */
            set_pixel(cx + x - 1, cy, 1); set_pixel(cx - x + 1, cy, 1);
            set_pixel(cx, cy + x - 1, 1); set_pixel(cx, cy - x + 1, 1);
        } else {
            set_pixel(cx + x, cy + y, 1); set_pixel(cx + y, cy + x, 1);
            set_pixel(cx - y, cy + x, 1); set_pixel(cx - x, cy + y, 1);
            set_pixel(cx - x, cy - y, 1); set_pixel(cx - y, cy - x, 1);
            set_pixel(cx + y, cy - x, 1); set_pixel(cx + x, cy - y, 1);
        }
        y++;
        if (err <= 0) err += 2 * y + 1;
        if (err > 0) { x--; err -= 2 * x + 1; }
    }
}

/* Arc knob at an explicit center + radius (the zoom overlay reuses this to draw
 * the exact same shape, just larger). */
export function drawArcKnobAt(cx, cy, r, norm, bipolar) {
    drawCircleBorder(cx, cy, r);
    if (bipolar) fill_rect(cx, cy - r + 1, 1, Math.max(2, Math.round(r / 3.5)), 1);
    const rad = (210 + norm * 300) * Math.PI / 180;
    const ex = Math.round(cx + (r - 1) * Math.sin(rad));
    const ey = Math.round(cy - (r - 1) * Math.cos(rad));
    plotLine(cx, cy, ex, ey, 1);
}

/* Arc knob: circle + pointer sweeping 300 degrees; bipolar adds a center tick. */
export function drawArcKnob(kx, ky, norm, bipolar) {
    drawArcKnobAt(kx + 10, ky + 7, 7, norm, bipolar);
}

/* Horizontal bar filling left->right (toggles / 2-state enums). */
export function drawHBar(kx, ky, norm) {
    fill_rect(kx + 1, ky + 4, 18, 1, 1);
    fill_rect(kx + 1, ky + 10, 18, 1, 1);
    fill_rect(kx + 1, ky + 4, 1, 7, 1);
    fill_rect(kx + 18, ky + 4, 1, 7, 1);
    const fillW = Math.round(norm * 16);
    if (fillW > 0) fill_rect(kx + 2, ky + 5, fillW, 5, 1);
}

/* Two <=3-char 5x3 lines for the enum square. Single line when it fits;
 * musical rates split after the "n/m" group ("1/16T" -> "1/16" + "T"). */
function sqLines(text) {
    const t = String(text).toUpperCase();
    if (pf3Width(t) <= MV_KW - 2) return [t, ''];
    const m = t.match(/^(\d+\/\d+)(.+)$/);
    if (m && pf3Width(m[1]) <= MV_KW - 2 && pf3Width(m[2]) <= MV_KW - 2) return [m[1], m[2]];
    const parts = t.replace(/[_\-]/g, ' ').trim().split(/\s+/);
    if (parts.length >= 2) return [parts[0].substring(0, 4), parts[1].substring(0, 4)];
    return [t.substring(0, 4), t.substring(4, 8)];
}

/* Framed square with the enum value (1-2 micro-font lines, or `sq` label). */
export function drawEnumSquare(kx, ky, text, sq) {
    rectOutline(kx, ky, MV_KW, MV_KH, 1);
    const lines = sq != null ? [String(sq), ''] : sqLines(text);
    const inner = MV_KW - 2;
    const totalH = lines[1].length > 0 ? 11 : 5;
    const startY = ky + 1 + Math.floor((MV_KH - 2 - totalH) / 2);
    pf3Print(kx + 1 + Math.floor((inner - pf3Width(lines[0])) / 2), startY, lines[0], 1);
    if (lines[1].length > 0)
        pf3Print(kx + 1 + Math.floor((inner - pf3Width(lines[1])) / 2), startY + 6, lines[1], 1);
}

/* Musical length as a STACKED FRACTION — frameless, centred across the FULL
 * 32px cell: numerator, rule, denominator in the 6x6 header font. The sibling
 * of drawBigNum for values that are true fractions, and the answer for the
 * delay times, whose 5-character labels don't fit the big read-out even
 * condensed.
 *
 * A triplet/dotted suffix modifies the WHOLE fraction, not the denominator,
 * so it sits OUTSIDE the stack: the rule spans only numerator/denominator and
 * the suffix sits to its right on the denominator's line. Stacking it INTO
 * the denominator (the first cut) read as "one over sixteen-d".
 *
 * Vertical budget is the whole story: 6 + rule + 6 = 13px of ink in a 16px
 * row, so the parts sit at ky+0 and ky+9 with the rule at ky+7 — the only
 * arrangement leaving clear space on both sides of the rule. The BOXED 5x3
 * version (movy's drawLengthSquare) failed here: the frame stole 2px a side
 * and its parts touched the rule outright. */
export function drawFracStack(cellX, ky, text) {
    const t = String(text);
    const m = t.match(/^(\d+)\/(\d+)([A-Za-z]*)$/);
    /* Not an n/m fraction ("1bar", "--"): these sets are mixed, so fall back
     * to the big read-out rather than a small centred string — the two forms
     * then read as one hierarchy instead of two different widgets. */
    if (!m) return drawBigNum(cellX, ky, t);
    const num = m[1], den = m[2], sfx = m[3];
    const nw = hdrWidth(num), dw = hdrWidth(den);
    const fracW = Math.max(nw, dw) + 2;     /* rule overhangs the wider part */
    const sw = sfx ? hdrWidth(sfx) : 0;
    const total = fracW + (sfx ? SFX_GAP + sw : 0);
    const left = cellX + Math.round((MV_CELL_W - total) / 2);
    hdrPrint(left + Math.round((fracW - nw) / 2), ky, num, 1);
    fill_rect(left, ky + 7, fracW, 1, 1);
    hdrPrint(left + Math.round((fracW - dw) / 2), ky + 9, den, 1);
    /* suffix on the denominator's line, past the rule's right end — it sits
     * WITH the value rather than floating beside it, while the rule still
     * stops short of it (the mark modifies the fraction, not the denominator) */
    if (sfx) hdrPrint(left + fracW + SFX_GAP, ky + 9, sfx, 1);
}
const SFX_GAP = 2;

/* One-shot / relative action square. Resting: just "< >" ("turn either way").
 * While its knob is touched the VALUE takes over the box (mirroring the
 * label<->value swap). `oneWay` (Lgto-style destructive actions) stays "< >"
 * even while touched — there is no value to show. */
export function drawActionSquare(kx, ky, text, oneWay, touched) {
    rectOutline(kx, ky, MV_KW, MV_KH, 1);
    const t = (touched && !oneWay) ? String(text) : '< >';
    const w = pf3Width(t);
    pf3Print(kx + 1 + Math.floor((MV_KW - 2 - w) / 2), ky + 1 + Math.floor((MV_KH - 2 - 5) / 2), t, 1);
}

/* Playback-direction square: arrow glyphs per mode —
 * 0 Fwd ►, 1 Bwd ◄, 2 PPf ◄ ► (outward), 3 PPb ► ◄ (inward). */
export function drawDirSquare(kx, ky, mode) {
    rectOutline(kx, ky, MV_KW, MV_KH, 1);
    const cy = ky + Math.floor(MV_KH / 2);
    const tri = (x, dir) => {   /* 4-col solid triangle; dir 1 = points right */
        for (let c = 0; c < 4; c++) {
            const h = dir > 0 ? 7 - 2 * c : 1 + 2 * c;
            fill_rect(x + c, cy - (h >> 1), 1, h, 1);
        }
    };
    const mid = kx + Math.floor(MV_KW / 2);
    if (mode === 0)      tri(mid - 2, 1);
    else if (mode === 1) tri(mid - 2, -1);
    else if (mode === 2) { tri(mid - 7, -1); tri(mid + 3, 1); }   /* outward */
    else                 { tri(mid - 7, 1);  tri(mid + 3, -1); }  /* inward */
}

/* Big numeric readout (movy's 'preset' render style): the value in the 13pt
 * font, NO frame, centered across the FULL 32px cell — it spills into the side
 * margins the 20px widget box leaves, which is what buys the extra digits.
 * `cellX` is the cell's left edge, not the widget box's. Falls back to the
 * label font when the text is too wide (4+ digits) so it always fits. */
export function drawBigNum(cellX, ky, text) {
    const t = String(text);
    const fit = bigFit(t, MV_CELL_W);
    if (fit) {
        bigPrint(cellX + Math.round((MV_CELL_W - fit.w) / 2),
                 ky + Math.floor((MV_KH - MV_BIG_H) / 2), t, 1, fit.cond);
    } else {
        const sw = mvWidth(t);
        mvPrint(cellX + Math.round((MV_CELL_W - sw) / 2),
                ky + Math.floor((MV_KH - 5) / 2), t, 1);
    }
}

/* ---- chrome ---- */

/* Resting header (davebox flavor — colors inverted vs kit v27, Josh's call):
 * filled white bar, black text, left-aligned, ALL CAPS. `invert` = the
 * secondary-bank variant (ARP IN / AUTO): white-on-black. */
export function drawKitHeader(text, invert) {
    const t = fitHdr(text, SCREEN_W - 4);
    if (invert) {
        hdrPrint(2, 1, t, 1);
    } else {
        fill_rect(0, 0, SCREEN_W, MV_HDR_H, 1);
        hdrPrint(2, 1, t, 0);
    }
}

/* Touched header: the bar drops out and the param NAME renders centered in
 * white — the state flip is the touch feedback; the label strip below shows
 * the VALUE. No page bar in this state. */
export function drawKitTouchedHeader(name) {
    const t = fitHdr(name, SCREEN_W - 4);
    hdrPrint(Math.max(2, Math.round((SCREEN_W - hdrWidth(t)) / 2)), 1, t, 1);
    fill_rect(0, MV_BAR_Y, SCREEN_W, 1, 1);   /* same rule as the resting header */
}

/* Page-indicator bar (row 9, resting only) — kit v28 port: one segment per
 * bank split by 1px dividers; the ACTIVE segment FLASHES between solid and
 * dotted (every other px) at ~1.3Hz; the rest stay solid. Rounding remainder
 * is spread across the first segments so every segment reads the same width.
 * (Redraw cadence: pollDSP dirties the screen every few ticks, which keeps
 * the flash animating on resting views.) */
export function drawKitPageBar(idx, count) {
    if (count <= 1) { fill_rect(0, MV_BAR_Y, SCREEN_W, 1, 1); return; }
    const blinkOn = Math.floor(Date.now() / 375) % 2 === 0;
    const usable = SCREEN_W - (count - 1);
    const base = Math.floor(usable / count), rem = usable % count;
    for (let b = 0, sx = 0; b < count; b++) {
        const sw = base + (b < rem ? 1 : 0);
        if (b !== idx || blinkOn) {
            fill_rect(sx, MV_BAR_Y, sw, 1, 1);
        } else {
            for (let x = sx; x < sx + sw; x += 2) set_pixel(x, MV_BAR_Y, 1);
        }
        sx += sw + 1;
    }
}

/* ---- grid ---- */

function drawCellWidget(col, rowY, cell, touched) {
    const kx = col * MV_CELL_W + Math.floor((MV_CELL_W - MV_KW) / 2);
    switch (cell.kind) {
        case 'arc':    return drawArcKnob(kx, rowY, cell.norm || 0, false);
        case 'arcbip': return drawArcKnob(kx, rowY, 0.5 + (cell.signed || 0) / 2, true);
        case 'hbar':   return drawHBar(kx, rowY, cell.norm || 0);
        case 'enumsq': return drawEnumSquare(kx, rowY, cell.text, cell.sq);
        case 'frac':   return drawFracStack(col * MV_CELL_W, rowY, cell.text);
        case 'valsq':  return drawBigNum(col * MV_CELL_W, rowY,
                                         cell.sq != null ? cell.sq : cell.text);
        case 'action': return drawActionSquare(kx, rowY, cell.text, cell.oneWay, touched);
        case 'dirsq':  return drawDirSquare(kx, rowY, cell.sel | 0);
        default:       return; /* blank */
    }
}

/* Label strip cell: the short NAME normally; while touched the cell inverts
 * and shows the live VALUE (movy's signature swap). */
function drawCellLabel(col, lblY, cell, touched) {
    let text = String(touched && cell.text != null ? cell.text : (cell.label || ''));
    if (!text) return;
    while (text.length > 0 && mvWidth(text) > MV_CELL_W - 2) text = text.slice(0, -1);
    const tw = mvWidth(text);
    const tx = Math.round(col * MV_CELL_W + MV_CELL_W / 2 - tw / 2);
    if (touched) {
        fill_rect(col * MV_CELL_W, lblY, MV_CELL_W, MV_LBL_H, 1);
        mvPrint(tx, lblY + 1, text, 0);
    } else {
        mvPrint(tx, lblY + 1, text, 1);
    }
}

/* The 8-cell grid: two 16px widget rows, each with its label strip beneath. */
export function drawKitCells(cells, touchedIdx) {
    for (let k = 0; k < 8; k++) {
        const cell = cells[k];
        if (!cell) continue;
        const col = k % 4;
        const rowY = k < 4 ? MV_ROW0_Y : MV_ROW1_Y;
        const lblY = k < 4 ? MV_LBL0_Y : MV_LBL1_Y;
        drawCellWidget(col, rowY, cell, k === touchedIdx);
        drawCellLabel(col, lblY, cell, k === touchedIdx);
    }
}

/* Picker overlay: the option list, revealed while a >2-option enum/dir cell is
 * turned. Centered in the shared zoom box (same footprint as the value zoom),
 * standard system font, with a scrollbar whenever the options don't all fit. */
export function drawKitEnumOverlay(cells, touchedIdx) {
    const cell = touchedIdx >= 0 ? cells[touchedIdx] : null;
    /* Any cell carrying a discrete option list (named enum, direction, OR a
     * numeric value-box) uses the picker — they're the same thing, limited
     * values vs limited enums. */
    if (!cell || !cell.options || cell.options.length <= 2) return;
    const sel = cell.sel | 0;
    if (sel < 0) return; /* unset value ("--") — nothing to browse */

    const X = MV_ZOOM_X, Y = MV_ZOOM_Y, W = MV_ZOOM_W, H = MV_ZOOM_H;
    fill_rect(X, Y, W, H, 0);
    rectOutline(X, Y, W, H, 1);

    const n = cell.options.length;
    const ROW_H = 9;                                  /* standard-font line */
    const VISIBLE = Math.max(1, Math.min(n, Math.floor((H - 4) / ROW_H)));
    const hasScroll = n > VISIBLE;
    const half = Math.floor(VISIBLE / 2);
    const start = Math.max(0, Math.min(sel - half, n - VISIBLE));
    const listTop = Y + Math.floor((H - VISIBLE * ROW_H) / 2);
    const rowX = X + 2, rowW = W - 4 - (hasScroll ? 4 : 0);
    const availW = rowW - 4;
    for (let i = 0; i < VISIBLE; i++) {
        const idx = start + i;
        if (idx >= n) break;
        const y = listTop + i * ROW_H;
        let label = String(cell.options[idx]);
        while (label.length > 1 && hdrWidth(label) > availW) label = label.slice(0, -1);
        if (idx === sel) {
            fill_rect(rowX, y, rowW, ROW_H, 1);
            hdrPrint(rowX + 3, y + 1, label, 0);
        } else {
            hdrPrint(rowX + 3, y + 1, label, 1);
        }
    }
    /* Scroll indicator: right-edge track + thumb, only when there's overflow. */
    if (hasScroll) {
        const trackH = VISIBLE * ROW_H;
        const thumbH = Math.max(3, Math.round(trackH * VISIBLE / n));
        const thumbY = listTop + Math.round((trackH - thumbH) * start / Math.max(1, n - VISIBLE));
        fill_rect(X + W - 2, listTop, 1, trackH, 1);
        fill_rect(X + W - 3, thumbY, 2, thumbH, 1);
    }
}

/* ---- full page ----
 * opts: { headerText, headerInvert, pageIdx, pageCount (bar; omit to skip),
 *         touchedIdx, altArrowShow, altArrowOn, altArrowHidden (blink phase) }
 * Touched non-blank cell with a `name` swaps the header to the inverted
 * centered param name and suppresses the page bar. */
export function drawKitBankPage(cells, opts) {
    const t = opts.touchedIdx != null ? opts.touchedIdx : -1;
    const touched = t >= 0 && cells[t] && cells[t].name ? cells[t] : null;
    if (touched) {
        drawKitTouchedHeader(touched.name);
    } else {
        drawKitHeader(opts.headerText, opts.headerInvert);
        if (opts.pageCount > 0) drawKitPageBar(opts.pageIdx | 0, opts.pageCount);
        if (opts.altArrowShow) drawKitAltArrow(SCREEN_W - 7, !opts.headerInvert, !!opts.altArrowOn, opts.altArrowHidden);
    }
    drawKitCells(cells, t);
    drawKitEnumOverlay(cells, t);
}

/* Down-arrow affordance for banks with alt params, in the header's top-right.
 * `onFill` = header background is filled white (arrow draws black). */
export function drawKitAltArrow(x, onFill, on, blinkHidden) {
    if (on && blinkHidden) return;
    const fg = onFill ? 0 : 1;
    fill_rect(x,     2, 5, 1, fg);
    fill_rect(x + 1, 3, 3, 1, fg);
    fill_rect(x + 2, 4, 1, 1, fg);
}

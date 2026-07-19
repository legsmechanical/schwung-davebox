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
 *   { kind:  'blank' | 'arc' | 'arcbip' | 'hbar' | 'enumsq' | 'valsq',
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
const SCREEN_W = 128;

/* ---- header font: "6x6 Pixel Font" by asciimario (CC BY-NC 3.0) ----
 * Glyph: [advance, ...6 rowBits], bit0 = leftmost; [n] alone = blank;
 * null = unmapped. Uppercase-only (lowercase rows repeat caps). */
const HDR_G = [
  [7], [7,12,12,12,12,0,12], null, null, null, [7,51,48,12,12,3,51], null, null,
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

/* Arc knob: circle + pointer sweeping 300 degrees; bipolar adds a center tick. */
export function drawArcKnob(kx, ky, norm, bipolar) {
    const cx = kx + 10, cy = ky + 7, r = 7;
    drawCircleBorder(cx, cy, r);
    if (bipolar) fill_rect(cx, cy - r + 1, 1, 2, 1);
    const rad = (210 + norm * 300) * Math.PI / 180;
    const ex = Math.round(cx + (r - 1) * Math.sin(rad));
    const ey = Math.round(cy - (r - 1) * Math.cos(rad));
    plotLine(cx, cy, ex, ey, 1);
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

/* Framed square with a single centered micro-font value ("+2", "16"). */
export function drawValSquare(kx, ky, text) {
    rectOutline(kx, ky, MV_KW, MV_KH, 1);
    const w = pf3Width(text);
    pf3Print(kx + 1 + Math.floor((MV_KW - 2 - w) / 2), ky + 1 + Math.floor((MV_KH - 2 - 5) / 2), text, 1);
}

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
        case 'valsq':  return drawValSquare(kx, rowY, cell.sq != null ? cell.sq : cell.text);
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

/* Scrolling option-list overlay while a >2-option enum cell is touched:
 * covers the 3 columns away from the touched knob, selection inverted. */
export function drawKitEnumOverlay(cells, touchedIdx) {
    const cell = touchedIdx >= 0 ? cells[touchedIdx] : null;
    if (!cell || (cell.kind !== 'enumsq' && cell.kind !== 'dirsq') ||
        !cell.options || cell.options.length <= 2) return;
    const sel = cell.sel | 0;
    if (sel < 0) return; /* unset value ("--") — nothing to browse */
    const ovX = (touchedIdx % 4) < 2 ? SCREEN_W - 3 * MV_CELL_W : 0;
    const ovW = 3 * MV_CELL_W, ovY = MV_ROW0_Y, ovH = MV_LBL1_Y + MV_LBL_H - MV_ROW0_Y;
    fill_rect(ovX, ovY, ovW, ovH, 0);
    rectOutline(ovX, ovY, ovW, ovH, 1);
    const ROW_H = 8, n = cell.options.length;
    const VISIBLE = Math.min(n, Math.floor((ovH - 2) / ROW_H));
    const half = Math.floor(VISIBLE / 2);
    const start = Math.max(0, Math.min(sel - half, n - VISIBLE));
    const listTop = ovY + Math.floor((ovH - VISIBLE * ROW_H) / 2);
    for (let i = 0; i < VISIBLE; i++) {
        const idx = start + i;
        if (idx >= n) break;
        const y = listTop + i * ROW_H;
        if (idx === sel) {
            fill_rect(ovX + 2, y, ovW - 4, ROW_H, 1);
            mvPrint(ovX + 4, y + 1, cell.options[idx], 0);
        } else {
            mvPrint(ovX + 4, y + 1, cell.options[idx], 1);
        }
    }
    if (n > VISIBLE) {
        const trackH = VISIBLE * ROW_H;
        const thumbH = Math.max(3, Math.round(trackH * VISIBLE / n));
        const thumbY = listTop + Math.round((trackH - thumbH) * start / Math.max(1, n - VISIBLE));
        fill_rect(ovX + ovW - 2, listTop, 1, trackH, 1);
        fill_rect(ovX + ovW - 3, thumbY, 2, thumbH, 1);
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

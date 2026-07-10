/* ui_xpose.mjs
 * Transpose-preview (browsing the global Key/Scale menu arms a live preview;
 * the knob-click commits behind a confirm) + scene-bake (folding a scene's
 * clips, optionally applying the Conductor's responder routing).
 * Extracted from ui.js (Phase 5b prep, increment 3 of the modularity refactor).
 */

import { NUM_TRACKS, NUM_CLIPS, PAD_MODE_DRUM, PAD_MODE_MELODIC_SCALE } from './ui_constants.mjs';
import { S, conductorTrackIdx } from './ui_state.mjs';
import { showActionPopup } from './ui_persistence.mjs';
import { computePadNoteMap } from './ui_drummodel.mjs';
import { forceRedraw } from './ui_leds.mjs';

/* True when scene-baking at clipIdx should offer "Apply Conductor?":
 * a Conductor exists and its clip at clipIdx has at least one responder On for a
 * non-conductor melodic track (something there is to fold). */
/* conductorTrackIdx moved to ui_state.mjs so ui_export.mjs can import it
 * without an import cycle (it was an unbound global there — audit
 * js-modules-1). Imported at the top of this file. */

export function sceneBakeHasConductor(clipIdx) {
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
export function commitSceneBake(clipIdx, loops, wrap, apply) {
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

/* ---- Transpose all melodic clips on global Key/Scale change ----------
 * Browsing the Key/Scale menu item arms a live preview (pads relayout +
 * DSP plays clips transposed); the knob-click commits behind a confirm.
 * Committed key/scale stay in S.padKey/S.padScale until commit; the
 * candidate lives in S.xposePrev* while previewing. */

/* Any melodic (non-drum) clip on any track with notes? */
export function anyMelodicClipHasContent() {
    for (let t = 0; t < NUM_TRACKS; t++) {
        if (S.trackPadMode[t] === PAD_MODE_DRUM) continue;
        for (let c = 0; c < NUM_CLIPS; c++) if (S.clipNonEmpty[t][c]) return true;
    }
    return false;
}

/* Arm/refresh preview for candidate (candK,candS). Candidate == committed
 * cancels instead (no-op change). Runs from the menu-edit tick driver. */
export function xposePreviewSet(candK, candS) {
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
export function xposeCancelPreview() {
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
export function xposeCommit(candK, candS) {
    S.pendingDefaultSetParams.push({ key: 't0_xpose_apply',
        val: S.padKey + ' ' + S.padScale + ' ' + candK + ' ' + candS + ' 1' });
    S.padKey = candK; S.padScale = candS;
    S.xposePrevKey = null; S.xposePrevScale = null;
    computePadNoteMap();
    forceRedraw();
    S.screenDirty = true;
}

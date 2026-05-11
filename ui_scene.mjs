import { S } from '/data/UserData/schwung/modules/tools/davebox/ui_state.mjs';
import { NUM_TRACKS, LED_OFF, LED_STEP_CURSOR, PAD_MODE_DRUM } from '/data/UserData/schwung/modules/tools/davebox/ui_constants.mjs';
import { White, VividYellow, DarkGrey } from '/data/UserData/schwung/shared/constants.mjs';
import { setLED } from '/data/UserData/schwung/shared/input_filter.mjs';

export function trackClipHasContent(t, sceneIdx) {
    return S.trackPadMode[t] === PAD_MODE_DRUM
        ? S.drumClipNonEmpty[t][sceneIdx]
        : S.clipNonEmpty[t][sceneIdx];
}

function groupHasContent(group) {
    for (let row = 0; row < 4; row++) {
        const sceneIdx = group * 4 + row;
        for (let t = 0; t < NUM_TRACKS; t++)
            if (trackClipHasContent(t, sceneIdx)) return true;
    }
    return false;
}

function sceneNonEmpty(sceneIdx) {
    for (let t = 0; t < NUM_TRACKS; t++)
        if (trackClipHasContent(t, sceneIdx)) return true;
    return false;
}

export function sceneAllQueued(sceneIdx) {
    let hasAny = false;
    for (let t = 0; t < NUM_TRACKS; t++) {
        if (!trackClipHasContent(t, sceneIdx)) continue;
        hasAny = true;
        const isQueued = (S.trackQueuedClip[t] === sceneIdx) ||
                         (S.trackPendingPageStop[t] && S.trackActiveClip[t] === sceneIdx);
        if (!isQueued) return false;
    }
    return hasAny;
}

export function updateSceneMapLEDs() {
    if (!S.ledInitComplete) return;
    for (let i = 0; i < 16; i++) {
        let color;
        if (S.muteHeld && S.sessionView) {
            color = S.snapshots[i] !== null ? VividYellow : DarkGrey;
        } else {
            const inView     = i >= S.sceneRow && i < S.sceneRow + 4;
            const anyPlaying = S.cachedSceneAnyPlaying[i];
            if (inView && anyPlaying) {
                color = S.flashEighth ? LED_STEP_CURSOR : LED_OFF;
            } else if (inView) {
                color = LED_STEP_CURSOR;
            } else if (anyPlaying) {
                color = S.flashEighth ? White : LED_OFF;
            } else if (sceneNonEmpty(i)) {
                color = White;
            } else {
                color = LED_OFF;
            }
        }
        setLED(16 + i, color);
    }
}

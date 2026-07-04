/* seq8_tonality.c — key/scale tonality: eff key/scale, transpose remap LUT,
 * scale-degree conversion + scale_transpose/note_abs_degree.
 * #include'd verbatim into seq8.c's single translation unit at the original
 * block position. Not compiled standalone — relies on seq8.c's prior context. */
/* ------------------------------------------------------------------ */
/* Effective tonality — committed key/scale, or the candidate while a    */
/* transpose preview is active (so scale-aware harmonies/arps track it).  */
/* Live note-generation reads these; serialization/get_param/load read    */
/* the committed pad_key/pad_scale directly.                              */
/* ------------------------------------------------------------------ */
static inline int eff_pad_key(seq8_instance_t *inst) {
    return inst->xpose_preview_active ? (int)inst->xpose_preview_key : (int)inst->pad_key;
}
static inline int eff_pad_scale(seq8_instance_t *inst) {
    return inst->xpose_preview_active ? (int)inst->xpose_preview_scale : (int)inst->pad_scale;
}

/* ------------------------------------------------------------------ */
/* Transpose remap — build per-pitch LUT for (oldK,oldS)->(newK,newS).   */
/* Root shift by shortest signed distance, then reshape: degree-for-      */
/* degree when both scales have the same interval count, else snap to the */
/* nearest in-scale pitch (also used for off-scale source notes).         */
/* ------------------------------------------------------------------ */
static int xpose_pc_in_scale(int pitch, int root, int scale) {
    int pc = (pitch - root) % 12; if (pc < 0) pc += 12;
    int n = (int)SCALE_SIZES[scale];
    const uint8_t *iv = SCALE_IVLS[scale];
    int d; for (d = 0; d < n; d++) if ((int)iv[d] == pc) return 1;
    return 0;
}
static int xpose_snap(int pitch, int root, int scale) {
    int d;
    for (d = 0; d <= 12; d++) {
        if (pitch + d <= 127 && xpose_pc_in_scale(pitch + d, root, scale)) return pitch + d;
        if (pitch - d >= 0   && xpose_pc_in_scale(pitch - d, root, scale)) return pitch - d;
    }
    return clamp_i(pitch, 0, 127);
}
static int xpose_remap_pitch(int p, int oldK, int oldS, int newK, int newS) {
    /* shortest signed root distance, wrapped to (-6,+6] */
    int kd = (newK - oldK) % 12; if (kd < 0) kd += 12; if (kd > 6) kd -= 12;
    int p1 = p + kd;
    int oldN = (int)SCALE_SIZES[oldS];
    int newN = (int)SCALE_SIZES[newS];
    const uint8_t *oldIv = SCALE_IVLS[oldS];
    const uint8_t *newIv = SCALE_IVLS[newS];
    /* decompose p1 relative to the new root (interval-from-root is preserved
     * by the root shift, so the old-scale degree is the note's original degree) */
    int rel = p1 - newK;
    int oct = rel / 12, within = rel % 12;
    if (within < 0) { within += 12; oct--; }
    int deg = -1, d;
    for (d = 0; d < oldN; d++) if ((int)oldIv[d] == within) { deg = d; break; }
    if (deg < 0 || oldN != newN)           /* off-scale source, or size mismatch */
        return clamp_i(xpose_snap(p1, newK, newS), 0, 127);
    return clamp_i(newK + oct * 12 + (int)newIv[deg], 0, 127);
}
static void build_xpose_lut(seq8_instance_t *inst, int oldK, int oldS, int newK, int newS) {
    int p;
    for (p = 0; p < 128; p++)
        inst->xpose_lut[p] = (uint8_t)xpose_remap_pitch(p, oldK, oldS, newK, newS);
}

/* Commit: rewrite every melodic clip's notes through xpose_lut and rebuild
 * step arrays. Drum tracks and empty clips skipped. Mirrors the per-clip
 * rescale pattern in tN_clip_resolution. */
static void xpose_commit_all_clips(seq8_instance_t *inst) {
    int t, c;
    for (t = 0; t < NUM_TRACKS; t++) {
        seq8_track_t *tr = &inst->tracks[t];
        if (tr->pad_mode == PAD_MODE_DRUM) continue;
        for (c = 0; c < NUM_CLIPS; c++) {
            clip_t *cl = &tr->clips[c];
            if (cl->note_count == 0) continue;
            uint16_t ni;
            for (ni = 0; ni < cl->note_count; ni++) {
                note_t *n = &cl->notes[ni];
                if (!n->active) continue;
                n->pitch = inst->xpose_lut[n->pitch];
            }
            clip_build_steps_from_notes(cl);
        }
    }
}

/* ------------------------------------------------------------------ */
/* Scale-degree to semitone conversion                                  */
/* ------------------------------------------------------------------ */

static int deg_to_semitones(seq8_instance_t *inst, int deg) {
    int s = eff_pad_scale(inst);
    if (s < 0 || s >= 14) s = 0;
    int n = (int)SCALE_SIZES[s];
    const uint8_t *ivals = SCALE_IVLS[s];
    int quot = deg / n;
    int rem  = deg % n;
    if (rem < 0) { rem += n; quot--; }
    return quot * 12 + (int)ivals[rem];
}

/* Transpose note by deg_offset scale degrees, anchored to note's own scale position.
 * Finds the note's nearest scale degree, adds the offset, returns the result.
 * Correct for any starting note — not just the tonic. */
static int scale_transpose(seq8_instance_t *inst, int note, int deg_offset) {
    if (deg_offset == 0) return clamp_i(note, 0, 127);
    int s = eff_pad_scale(inst);
    if (s < 0 || s >= 14) s = 0;
    int n = (int)SCALE_SIZES[s];
    const uint8_t *ivals = SCALE_IVLS[s];
    int key = eff_pad_key(inst);
    /* note's octave and pitch class relative to key */
    int rel = note - key;
    int oct = rel / 12;
    int pc  = rel % 12;
    if (pc < 0) { pc += 12; oct--; }
    /* nearest scale degree for this pitch class */
    int deg = 0, d, best_dist = 13;
    for (d = 0; d < n; d++) {
        int dist = (int)ivals[d] - pc;
        if (dist < 0) dist = -dist;
        if (dist < best_dist) { best_dist = dist; deg = d; }
    }
    /* apply offset in degree space and convert back */
    int abs_deg = oct * n + deg + deg_offset;
    int t_oct   = abs_deg / n;
    int t_rem   = abs_deg % n;
    if (t_rem < 0) { t_rem += n; t_oct--; }
    return clamp_i(key + t_oct * 12 + (int)ivals[t_rem], 0, 127);
}

/* Absolute scale-degree index of a note relative to eff key/scale: oct*n + nearest-degree.
 * Mirrors the degree-finding logic inside scale_transpose. */
static int note_abs_degree(seq8_instance_t *inst, int note) {
    int s = eff_pad_scale(inst); if (s < 0 || s >= 14) s = 0;
    int n = (int)SCALE_SIZES[s];
    const uint8_t *ivals = SCALE_IVLS[s];
    int key = eff_pad_key(inst);
    int rel = note - key, oct = rel / 12, pc = rel % 12;
    if (pc < 0) { pc += 12; oct--; }
    int deg = 0, best = 13;
    for (int d = 0; d < n; d++) { int dist = (int)ivals[d] - pc; if (dist < 0) dist = -dist; if (dist < best) { best = dist; deg = d; } }
    return oct * n + deg;
}

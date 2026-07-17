/* seq8_state.c — state persistence: JSON parse helpers + serialize + load/migration.
 * #include'd verbatim into seq8.c's single translation unit at the original block
 * position (declaration order and static visibility identical). Not compiled
 * standalone — relies on seq8.c's prior type/decl context. */
/* --- State persistence (Option C: cold-boot recovery) ------------------- */

static int json_get_int(const char *buf, const char *key, int def) {
    char search[64];
    snprintf(search, sizeof(search), "\"%s\":", key);
    const char *p = strstr(buf, search);
    if (!p) return def;
    p += strlen(search);
    while (*p == ' ') p++;
    return my_atoi(p);
}

static uint32_t json_get_uint(const char *buf, const char *key, uint32_t def) {
    char search[64];
    snprintf(search, sizeof(search), "\"%s\":", key);
    const char *p = strstr(buf, search);
    if (!p) return def;
    p += strlen(search);
    while (*p == ' ') p++;
    uint32_t v = 0;
    while (*p >= '0' && *p <= '9') { v = v * 10u + (uint32_t)(*p++ - '0'); }
    return v;
}

static void json_get_steps(const char *buf, const char *key,
                            uint8_t *steps, int n) {
    char search[64];
    snprintf(search, sizeof(search), "\"%s\":\"", key);
    const char *p = strstr(buf, search);
    if (!p) return;
    p += strlen(search);
    int i;
    for (i = 0; i < n && *p && *p != '"'; i++, p++)
        steps[i] = (*p == '1') ? 1 : 0;
}

/* Parse "key":"S:V;S2:V2;..." (V may be signed) into int[count].
 * Entries not present in the sparse string are left unchanged. */
static void json_get_sparse_int(const char *buf, const char *key,
                                int *out, int count) {
    char search[64];
    snprintf(search, sizeof(search), "\"%s\":\"", key);
    const char *p = strstr(buf, search);
    if (!p) return;
    p += strlen(search);
    while (*p && *p != '"') {
        int sidx = 0;
        while (*p >= '0' && *p <= '9') sidx = sidx * 10 + (*p++ - '0');
        if (*p != ':') break;
        p++;
        int sign = 1;
        if (*p == '-') { sign = -1; p++; }
        int val = 0;
        while (*p >= '0' && *p <= '9') val = val * 10 + (*p++ - '0');
        if (sidx >= 0 && sidx < count) out[sidx] = val * sign;
        if (*p == ';') p++;
    }
}

static void ensure_parent_dir(const char *path) {
    char tmp[256];
    char *p;
    snprintf(tmp, sizeof(tmp), "%s", path);
    for (p = tmp + 1; *p; p++) {
        if (*p == '/') {
            *p = '\0';
            mkdir(tmp, 0755);
            *p = '/';
        }
    }
}

/* v=34 per-step trig-condition serialization (iter/random/ratchet).
 * Hex blob, 2 chars per step, exactly cl->length steps. Sparse at the
 * array level — emitted only when any element is non-zero. */
static void write_step_hex_arr(FILE *fp, const char *key,
                               const uint8_t *arr, uint16_t len) {
    int i, any = 0;
    for (i = 0; i < (int)len; i++) if (arr[i]) { any = 1; break; }
    if (!any) return;
    fprintf(fp, ",\"%s\":\"", key);
    for (i = 0; i < (int)len; i++) fprintf(fp, "%02x", (unsigned)arr[i]);
    fputc('"', fp);
}

static void parse_step_hex_arr(const char *buf, const char *key,
                               uint8_t *arr, uint16_t len, int max_val) {
    char search[48];
    snprintf(search, sizeof(search), "\"%s\":\"", key);
    const char *p = strstr(buf, search);
    if (!p) return;
    p += strlen(search);
    int i;
    for (i = 0; i < (int)len && *p && *p != '"'; i++) {
        int hi = -1, lo = -1;
        if (*p >= '0' && *p <= '9') hi = *p - '0';
        else if (*p >= 'a' && *p <= 'f') hi = *p - 'a' + 10;
        else if (*p >= 'A' && *p <= 'F') hi = *p - 'A' + 10;
        if (hi < 0) break;
        p++;
        if (*p >= '0' && *p <= '9') lo = *p - '0';
        else if (*p >= 'a' && *p <= 'f') lo = *p - 'a' + 10;
        else if (*p >= 'A' && *p <= 'F') lo = *p - 'A' + 10;
        if (lo < 0) break;
        p++;
        int v = (hi << 4) | lo;
        if (v > max_val) v = max_val;
        arr[i] = (uint8_t)v;
    }
}

/* Validate iter encoding post-load: 0 OR ((1..8)<<4 | (1..cycle_len)). */
static void sanitize_step_iter_arr(uint8_t *arr, uint16_t len) {
    int i;
    for (i = 0; i < (int)len; i++) {
        uint8_t v = arr[i];
        if (!v) continue;
        int cl = (v >> 4) & 0xF, ci = v & 0xF;
        if (cl < 1 || cl > 8 || ci < 1 || ci > cl) arr[i] = 0;
    }
}

/* Forward declarations for playback-direction helpers defined further down. */
static void advance_clip_step(uint16_t cur, uint16_t ls, uint16_t length,
                              uint8_t mode, uint8_t audio_reverse, int8_t pp_dir,
                              uint16_t *out_ns, int8_t *out_pp_dir,
                              uint8_t *out_wrapped);
static uint16_t initial_clip_step(uint16_t ls, uint16_t length, uint8_t dir);
static int8_t initial_pp_dir(uint8_t dir);
static inline int clip_in_reverse_motion(const clip_t *cl);
static inline uint32_t note_audio_reverse_cmp_tick(const note_t *n, const clip_t *cl, int quantize);
static inline uint32_t playback_audible_cct(const clip_t *cl, uint16_t current_step, uint16_t tick_in_step);
static inline uint16_t playback_cycle_steps(uint8_t pdir, uint8_t audio_reverse, uint16_t length);
static int compute_bake_emit_positions(uint8_t pdir, uint8_t audio_reverse,
                                       uint16_t length, uint16_t tps,
                                       uint32_t rel_tick, uint32_t gate,
                                       uint32_t positions_out[2]);

static void seq8_do_serialize(seq8_instance_t *inst, FILE *fp) {
    int t, c;
    fprintf(fp, "{\"v\":36,\"playing\":%d", inst->playing);
    for (t = 0; t < NUM_TRACKS; t++)
        fprintf(fp, ",\"t%d_ac\":%d", t, inst->tracks[t].active_clip);
    for (t = 0; t < NUM_TRACKS; t++)
        fprintf(fp, ",\"t%d_wr\":%d", t,
                (inst->tracks[t].will_relaunch || inst->tracks[t].clip_playing) ? 1 : 0);
    for (t = 0; t < NUM_TRACKS; t++)
        fprintf(fp, ",\"t%d_ch\":%d,\"t%d_rt\":%d",
                t, (int)inst->tracks[t].channel,
                t, (int)inst->tracks[t].pfx.route);
    for (t = 0; t < NUM_TRACKS; t++)
        if (inst->tracks[t].pfx.looper_on != 1)
            fprintf(fp, ",\"t%d_lp\":%d", t, (int)inst->tracks[t].pfx.looper_on);
    /* TRACK ARP — per-track, sparse (only non-default values) */
    for (t = 0; t < NUM_TRACKS; t++) {
        const seq8_track_t *tr2 = &inst->tracks[t];
        if (tr2->tarp_on)                              fprintf(fp, ",\"t%d_taon\":1",     t);
        if (tr2->tarp.style != 0)                      fprintf(fp, ",\"t%d_tast\":%d",    t, (int)tr2->tarp.style);
        if (tr2->tarp.rate_idx != ARP_RATE_DEFAULT)    fprintf(fp, ",\"t%d_tart\":%d",    t, (int)tr2->tarp.rate_idx);
        if (tr2->tarp.octaves != 0)                    fprintf(fp, ",\"t%d_taoc\":%d",    t, (int)tr2->tarp.octaves);
        if (tr2->tarp.gate_pct != 100)                 fprintf(fp, ",\"t%d_tagt\":%d",    t, (int)tr2->tarp.gate_pct);
        if (tr2->tarp.steps_mode != 1)                 fprintf(fp, ",\"t%d_tasm\":%d",    t, (int)tr2->tarp.steps_mode);
        if (!tr2->tarp_sync)                           fprintf(fp, ",\"t%d_tasy\":0",     t);
        if (tr2->tarp.retrigger)                       fprintf(fp, ",\"t%d_targ\":1",     t);
        {
            int _i;
            for (_i = 0; _i < 8; _i++)
                if (tr2->tarp.step_vel[_i] != 100)
                    fprintf(fp, ",\"t%d_tasv%d\":%d", t, _i, (int)tr2->tarp.step_vel[_i]);
            for (_i = 0; _i < 8; _i++)
                if (tr2->tarp.step_int[_i] != 0)
                    fprintf(fp, ",\"t%d_tasi%d\":%d", t, _i, (int)tr2->tarp.step_int[_i]);
        }
        if (tr2->tarp.step_loop_len != 8 && tr2->tarp.step_loop_len != 0)
            fprintf(fp, ",\"t%d_tasll\":%d", t, (int)tr2->tarp.step_loop_len);
    }
    /* Vel Override — per-track, sparse */
    for (t = 0; t < NUM_TRACKS; t++)
        if (inst->tracks[t].track_vel_override != 0)
            fprintf(fp, ",\"t%d_tvo\":%d", t, (int)inst->tracks[t].track_vel_override);
    for (t = 0; t < NUM_TRACKS; t++) {
        for (c = 0; c < NUM_CLIPS; c++) {
            clip_t *cl = &inst->tracks[t].clips[c];
            fprintf(fp, ",\"t%dc%d_len\":%d", t, c, (int)cl->length);
            if (cl->loop_start != 0)
                fprintf(fp, ",\"t%dc%d_ls\":%d", t, c, (int)cl->loop_start);
            /* Playback direction (v=35); sparse: 0=Forward = default, omitted. */
            if (cl->playback_dir != 0)
                fprintf(fp, ",\"t%dc%d_pd\":%d", t, c, (int)cl->playback_dir);
            /* Playback style: 0=Step (default, omitted), 1=Audio. */
            if (cl->playback_audio_reverse != 0)
                fprintf(fp, ",\"t%dc%d_par\":%d", t, c, (int)cl->playback_audio_reverse);
            if (cl->stretch_exp != 0)
                fprintf(fp, ",\"t%dc%d_se\":%d", t, c, (int)cl->stretch_exp);
            if (cl->clock_shift_pos != 0)
                fprintf(fp, ",\"t%dc%d_cs\":%d", t, c, (int)cl->clock_shift_pos);
            if (cl->ticks_per_step != TICKS_PER_STEP)
                fprintf(fp, ",\"t%dc%d_tps\":%d", t, c, (int)cl->ticks_per_step);
            /* Conductor per-clip control banks — only this track's clips, sparse:
             * responder mask (default all-1), octave (default 0), when (default 0). */
            if (t == inst->conductor_track) {
                int ci, any;
                any = 0;
                for (ci = 0; ci < NUM_TRACKS; ci++) if (cl->cond_resp[ci] != 1) { any = 1; break; }
                if (any) {
                    fprintf(fp, ",\"t%dc%d_crsp\":\"", t, c);
                    for (ci = 0; ci < NUM_TRACKS; ci++) fputc(cl->cond_resp[ci] ? '1' : '0', fp);
                    fputc('"', fp);
                }
                any = 0;
                for (ci = 0; ci < NUM_TRACKS; ci++) if (cl->cond_oct[ci] != 0) { any = 1; break; }
                if (any) {
                    fprintf(fp, ",\"t%dc%d_coct\":\"", t, c);
                    for (ci = 0; ci < NUM_TRACKS; ci++)
                        fprintf(fp, "%s%d", ci ? " " : "", (int)cl->cond_oct[ci]);
                    fputc('"', fp);
                }
                any = 0;
                for (ci = 0; ci < NUM_TRACKS; ci++) if (cl->cond_when[ci] != 0) { any = 1; break; }
                if (any) {
                    fprintf(fp, ",\"t%dc%d_cwhn\":\"", t, c);
                    for (ci = 0; ci < NUM_TRACKS; ci++) fputc(cl->cond_when[ci] ? '1' : '0', fp);
                    fputc('"', fp);
                }
                /* CdLk lock: single 0/1, sparse (omit when Off). */
                if (cl->cond_lock)
                    fprintf(fp, ",\"t%dc%d_clk\":1", t, c);
            }
            /* Per-clip play-effect params (sparse — only non-default) */
            {
                const clip_pfx_params_t *p2 = &cl->pfx_params;
                if (p2->octave_shift    != 0)   fprintf(fp, ",\"t%dc%d_nfo\":%d",  t, c, p2->octave_shift);
                if (p2->note_offset     != 0)   fprintf(fp, ",\"t%dc%d_nfof\":%d", t, c, p2->note_offset);
                if (p2->gate_time       != 100) fprintf(fp, ",\"t%dc%d_nfg\":%d",  t, c, p2->gate_time);
                if (p2->velocity_offset != 0)   fprintf(fp, ",\"t%dc%d_nfv\":%d",  t, c, p2->velocity_offset);
                if (p2->quantize        != 0)   fprintf(fp, ",\"t%dc%d_qnt\":%d",  t, c, p2->quantize);
                if (p2->octaver         != 0)   fprintf(fp, ",\"t%dc%d_ho\":%d",   t, c, p2->octaver);
                if (p2->harmonize_1     != 0)   fprintf(fp, ",\"t%dc%d_h1\":%d",   t, c, p2->harmonize_1);
                if (p2->harmonize_2     != 0)   fprintf(fp, ",\"t%dc%d_h2\":%d",   t, c, p2->harmonize_2);
                if (p2->harmonize_3     != 0)   fprintf(fp, ",\"t%dc%d_h3\":%d",   t, c, p2->harmonize_3);
                if (p2->delay_time_idx  != DEFAULT_DELAY_TIME_IDX) fprintf(fp, ",\"t%dc%d_dt\":%d", t, c, p2->delay_time_idx);
                if (p2->delay_level     != 0)   fprintf(fp, ",\"t%dc%d_dl\":%d",   t, c, p2->delay_level);
                if (p2->repeat_times    != 0)   fprintf(fp, ",\"t%dc%d_dr\":%d",   t, c, p2->repeat_times);
                if (p2->fb_velocity     != 0)   fprintf(fp, ",\"t%dc%d_dvf\":%d",  t, c, p2->fb_velocity);
                if (p2->fb_note         != 0)   fprintf(fp, ",\"t%dc%d_dpf\":%d",  t, c, p2->fb_note);
                if (p2->fb_note_random  != 0)   fprintf(fp, ",\"t%dc%d_dpr\":%d",  t, c, p2->fb_note_random);
                if (p2->fb_note_random_mode != 2) fprintf(fp, ",\"t%dc%d_dpnm\":%d", t, c, p2->fb_note_random_mode);
                if (p2->fb_gate_time    != 0)    fprintf(fp, ",\"t%dc%d_dgf\":%d",  t, c, p2->fb_gate_time);
                if (p2->fb_clock        != 0)   fprintf(fp, ",\"t%dc%d_dcf\":%d",  t, c, p2->fb_clock);
                if (p2->delay_retrig    != 1)   fprintf(fp, ",\"t%dc%d_drt\":%d",  t, c, p2->delay_retrig);
                if (p2->note_random     != 0)   fprintf(fp, ",\"t%dc%d_nfrnd\":%d", t, c, p2->note_random);
                if (p2->note_random_mode != 2)  fprintf(fp, ",\"t%dc%d_nfrnm\":%d", t, c, p2->note_random_mode);
                /* SEQ ARP — sparse, only emit if non-default */
                if (p2->seq_arp_style     != 0)             fprintf(fp, ",\"t%dc%d_arst\":%d", t, c, p2->seq_arp_style);
                if (p2->seq_arp_rate      != ARP_RATE_DEFAULT) fprintf(fp, ",\"t%dc%d_arrt\":%d", t, c, p2->seq_arp_rate);
                if (p2->seq_arp_octaves   != 0)             fprintf(fp, ",\"t%dc%d_aroc\":%d", t, c, p2->seq_arp_octaves);
                if (p2->seq_arp_gate      != 100)           fprintf(fp, ",\"t%dc%d_argt\":%d", t, c, p2->seq_arp_gate);
                if (p2->seq_arp_steps_mode != 1)            fprintf(fp, ",\"t%dc%d_arsm\":%d", t, c, p2->seq_arp_steps_mode);
                if (p2->seq_arp_retrigger != 1)             fprintf(fp, ",\"t%dc%d_artg\":%d", t, c, p2->seq_arp_retrigger);
                if (p2->seq_arp_sync     != 1)              fprintf(fp, ",\"t%dc%d_arsy\":%d", t, c, p2->seq_arp_sync);
                {
                    int _i;
                    for (_i = 0; _i < 8; _i++) {
                        if (p2->seq_arp_step_vel[_i] != 100)
                            fprintf(fp, ",\"t%dc%d_arsv%d\":%d", t, c, _i, (int)p2->seq_arp_step_vel[_i]);
                    }
                    for (_i = 0; _i < 8; _i++) {
                        if (p2->seq_arp_step_int[_i] != 0)
                            fprintf(fp, ",\"t%dc%d_arsi%d\":%d", t, c, _i, (int)p2->seq_arp_step_int[_i]);
                    }
                }
                if (p2->seq_arp_step_loop_len != 8 && p2->seq_arp_step_loop_len != 0)
                    fprintf(fp, ",\"t%dc%d_arsll\":%d", t, c, (int)p2->seq_arp_step_loop_len);
                if (p2->note_length_mode != 0)
                    fprintf(fp, ",\"t%dc%d_nlen\":%d", t, c, (int)p2->note_length_mode);
            }
            /* note list: "tick:pitch:vel:gate;" for each active note */
            if (cl->note_count > 0) {
                uint16_t ni;
                int wrote = 0;
                for (ni = 0; ni < cl->note_count; ni++) {
                    note_t *n = &cl->notes[ni];
                    if (!n->active) continue;
                    if (!wrote) {
                        fprintf(fp, ",\"t%dc%d_n\":\"", t, c);
                        wrote = 1;
                    }
                    fprintf(fp, "%u:%d:%d:%d;",
                            (unsigned)n->tick, (int)n->pitch,
                            (int)n->vel, (int)n->gate);
                }
                if (wrote) fputc('"', fp);
                /* v=34 per-step trig conditions (sparse at array level) */
                {
                    char k[24];
                    snprintf(k, sizeof(k), "t%dc%d_si", t, c);
                    write_step_hex_arr(fp, k, cl->step_iter,    cl->length);
                    snprintf(k, sizeof(k), "t%dc%d_sr", t, c);
                    write_step_hex_arr(fp, k, cl->step_random,  cl->length);
                    snprintf(k, sizeof(k), "t%dc%d_sx", t, c);
                    write_step_hex_arr(fp, k, cl->step_ratchet, cl->length);
                }
            }
        }
    }
    /* Drum lane data (sparse — only drum-mode tracks, only lanes with notes) */
    for (t = 0; t < NUM_TRACKS; t++) {
        if (inst->tracks[t].pad_mode != PAD_MODE_DRUM) continue;
        for (c = 0; c < NUM_CLIPS; c++) {
            int l;
            /* drum_clips[c] is legitimately NULL for empty slots even on a
             * drum-mode track (cleared/freed at runtime). Serializing such a
             * slot must skip it — dereferencing NULL here crashed the host
             * (SIGSEGV) on the next state_full poll after a clip clear. */
            if (!inst->tracks[t].drum_clips[c]) continue;
            for (l = 0; l < DRUM_LANES; l++) {
                drum_lane_t *dl = &inst->tracks[t].drum_clips[c]->lanes[l];
                clip_t *dlc = &dl->clip;
                uint16_t ni;
                int has_active = 0;
                for (ni = 0; ni < dlc->note_count; ni++)
                    if (dlc->notes[ni].active) { has_active = 1; break; }
                if (!has_active) continue;
                if (dl->midi_note != (uint8_t)(DRUM_BASE_NOTE + l))
                    fprintf(fp, ",\"t%dc%dl%d_mn\":%d", t, c, l, (int)dl->midi_note);
                if (dlc->length != SEQ_STEPS_DEFAULT)
                    fprintf(fp, ",\"t%dc%dl%d_len\":%d", t, c, l, (int)dlc->length);
                if (dlc->loop_start != 0)
                    fprintf(fp, ",\"t%dc%dl%d_ls\":%d", t, c, l, (int)dlc->loop_start);
                /* Playback direction (v=35); sparse: 0=Forward = default, omitted. */
                if (dlc->playback_dir != 0)
                    fprintf(fp, ",\"t%dc%dl%d_pd\":%d", t, c, l, (int)dlc->playback_dir);
                if (dlc->playback_audio_reverse != 0)
                    fprintf(fp, ",\"t%dc%dl%d_par\":%d", t, c, l, (int)dlc->playback_audio_reverse);
                if (dlc->ticks_per_step != TICKS_PER_STEP)
                    fprintf(fp, ",\"t%dc%dl%d_tps\":%d", t, c, l, (int)dlc->ticks_per_step);
                int wrote = 0;
                for (ni = 0; ni < dlc->note_count; ni++) {
                    note_t *n = &dlc->notes[ni];
                    if (!n->active) continue;
                    if (!wrote) { fprintf(fp, ",\"t%dc%dl%d_n\":\"", t, c, l); wrote = 1; }
                    fprintf(fp, "%u:%d:%d:%d;",
                            (unsigned)n->tick, (int)n->pitch,
                            (int)n->vel, (int)n->gate);
                }
                if (wrote) fputc('"', fp);
                /* v=34 per-step trig conditions (sparse at array level) */
                {
                    char k[28];
                    snprintf(k, sizeof(k), "t%dc%dl%d_si", t, c, l);
                    write_step_hex_arr(fp, k, dlc->step_iter,    dlc->length);
                    snprintf(k, sizeof(k), "t%dc%dl%d_sr", t, c, l);
                    write_step_hex_arr(fp, k, dlc->step_random,  dlc->length);
                    snprintf(k, sizeof(k), "t%dc%dl%d_sx", t, c, l);
                    write_step_hex_arr(fp, k, dlc->step_ratchet, dlc->length);
                }
                /* Per-lane drum pfx params (sparse — only non-default) */
                {
                    const drum_pfx_params_t *dp = &dl->pfx_params;
                    if (dp->gate_time       != 100) fprintf(fp, ",\"t%dc%dl%d_dpg\":%d",   t, c, l, dp->gate_time);
                    if (dp->velocity_offset != 0)   fprintf(fp, ",\"t%dc%dl%d_dpvo\":%d",  t, c, l, dp->velocity_offset);
                    if (dp->quantize        != 0)   fprintf(fp, ",\"t%dc%dl%d_dpq\":%d",   t, c, l, dp->quantize);
                    if (dp->delay_time_idx  != DEFAULT_DRUM_DELAY_TIME_IDX) fprintf(fp, ",\"t%dc%dl%d_dpdt\":%d", t, c, l, dp->delay_time_idx);
                    if (dp->delay_level     != 0)   fprintf(fp, ",\"t%dc%dl%d_dpdl\":%d",  t, c, l, dp->delay_level);
                    if (dp->repeat_times    != 0)   fprintf(fp, ",\"t%dc%dl%d_dpdr\":%d",  t, c, l, dp->repeat_times);
                    if (dp->fb_velocity     != 0)   fprintf(fp, ",\"t%dc%dl%d_dpfbv\":%d", t, c, l, dp->fb_velocity);
                    if (dp->fb_gate_time    != 0)   fprintf(fp, ",\"t%dc%dl%d_dpfbg\":%d", t, c, l, dp->fb_gate_time);
                    if (dp->fb_clock        != 0)   fprintf(fp, ",\"t%dc%dl%d_dpfbc\":%d", t, c, l, dp->fb_clock);
                    if (dp->delay_retrig    != 1)   fprintf(fp, ",\"t%dc%dl%d_dpdrt\":%d", t, c, l, dp->delay_retrig);
                    if (dp->note_length_mode != 0)  fprintf(fp, ",\"t%dc%dl%d_dpnl\":%d",  t, c, l, (int)dp->note_length_mode);
                }
            }
        }
    }
    /* Mute/solo state */
    fprintf(fp, ",\"mute\":\"");
    for (t = 0; t < NUM_TRACKS; t++) fputc(inst->mute[t] ? '1' : '0', fp);
    fputc('"', fp);
    fprintf(fp, ",\"solo\":\"");
    for (t = 0; t < NUM_TRACKS; t++) fputc(inst->solo[t] ? '1' : '0', fp);
    fputc('"', fp);
    /* Conductor role (sparse — only when a Conductor exists) */
    if (inst->conductor_track >= 0)
        fprintf(fp, ",\"cndt\":%d", inst->conductor_track);
    /* Snapshots — only emit occupied slots */
    {
        int n;
        for (n = 0; n < 16; n++) {
            if (!inst->snap_valid[n]) continue;
            fprintf(fp, ",\"sn%d_m\":\"", n);
            for (t = 0; t < NUM_TRACKS; t++) fputc(inst->snap_mute[n][t] ? '1' : '0', fp);
            fputc('"', fp);
            fprintf(fp, ",\"sn%d_s\":\"", n);
            for (t = 0; t < NUM_TRACKS; t++) fputc(inst->snap_solo[n][t] ? '1' : '0', fp);
            fputc('"', fp);
            for (t = 0; t < NUM_TRACKS; t++) {
                if (inst->snap_drum_eff_mute[n][t])
                    fprintf(fp, ",\"sn%dde%d\":%u", n, t, inst->snap_drum_eff_mute[n][t]);
            }
        }
    }
    /* Per-track: pad_mode (route saved above with channel) */
    for (t = 0; t < NUM_TRACKS; t++)
        fprintf(fp, ",\"t%d_pm\":%d", t, (int)inst->tracks[t].pad_mode);
    /* Per-track: drum lane mute/solo bitmasks (sparse; omit if zero) */
    for (t = 0; t < NUM_TRACKS; t++) {
        if (inst->tracks[t].drum_lane_mute)
            fprintf(fp, ",\"t%ddlm\":%u", t, inst->tracks[t].drum_lane_mute);
        if (inst->tracks[t].drum_lane_solo)
            fprintf(fp, ",\"t%ddls\":%u", t, inst->tracks[t].drum_lane_solo);
    }
    /* Per-track: drum input quantize (sparse; omit if Off) */
    for (t = 0; t < NUM_TRACKS; t++) {
        if (inst->tracks[t].drum_inp_quant)
            fprintf(fp, ",\"t%ddiq\":%d", t, (int)inst->tracks[t].drum_inp_quant);
    }
    /* Per-track: drum repeat sync. Non-sparse — must persist explicit OFF
     * state, otherwise default (1) overrides the user's choice on reload. */
    for (t = 0; t < NUM_TRACKS; t++) {
        fprintf(fp, ",\"t%ddsy\":%d", t, (int)inst->tracks[t].drum_repeat_sync);
    }
    /* Per-track: drum repeat gate/vel_scale/nudge (sparse — only non-default) */
    { int l, s;
      for (t = 0; t < NUM_TRACKS; t++) {
          const seq8_track_t *tr_r = &inst->tracks[t];
          /* Rpt1 last-selected rate (per-track, sparse; default 2 = 1/8) */
          if (tr_r->drum_repeat_rate_idx != 2)
              fprintf(fp, ",\"t%d_drrt\":%d", t, (int)tr_r->drum_repeat_rate_idx);
          for (l = 0; l < DRUM_LANES; l++) {
              if (tr_r->drum_repeat_gate[l] != 0xFF)
                  fprintf(fp, ",\"t%dl%drg\":%d", t, l, (int)tr_r->drum_repeat_gate[l]);
              if (tr_r->drum_repeat_gate_len[l] != 8)
                  fprintf(fp, ",\"t%dl%drgl\":%d", t, l, (int)tr_r->drum_repeat_gate_len[l]);
              /* Rpt2 per-lane rate (sparse; default 2 = 1/8) */
              if (tr_r->drum_repeat2_rate_idx[l] != 2)
                  fprintf(fp, ",\"t%dl%dr2rt\":%d", t, l, (int)tr_r->drum_repeat2_rate_idx[l]);
              for (s = 0; s < 8; s++) {
                  if (tr_r->drum_repeat_vel_scale[l][s] != 100)
                      fprintf(fp, ",\"t%dl%drvs%d\":%d", t, l, s, (int)tr_r->drum_repeat_vel_scale[l][s]);
                  if (tr_r->drum_repeat_nudge[l][s] != 0)
                      fprintf(fp, ",\"t%dl%drn%d\":%d", t, l, s, (int)(int8_t)tr_r->drum_repeat_nudge[l][s]);
              }
          }
      }
    }
    /* Per-track CC PARAM bank: CC assignments + per-knob type (sparse) */
    { int _t2, _k;
      for (_t2 = 0; _t2 < NUM_TRACKS; _t2++)
          for (_k = 0; _k < 8; _k++) {
              if (inst->tracks[_t2].cc_assign[_k] != CC_ASSIGN_DEFAULT[_k])
                  fprintf(fp, ",\"t%dcca%d\":%d", _t2, _k, (int)inst->tracks[_t2].cc_assign[_k]);
              if (inst->tracks[_t2].cc_type[_k] != 0)
                  fprintf(fp, ",\"t%dcct%d\":%d", _t2, _k, (int)inst->tracks[_t2].cc_type[_k]);
          }
    }
    /* CC automation (melodic clips, sparse per track/clip/knob) + resting value */
    { int _ta, _ca2, _ka, _ia;
      for (_ta = 0; _ta < NUM_TRACKS; _ta++)
          for (_ca2 = 0; _ca2 < NUM_CLIPS; _ca2++) {
              const cc_auto_t *_cca = &inst->tracks[_ta].clip_cc_auto[_ca2];
              for (_ka = 0; _ka < 8; _ka++) {
                  if (_cca->rest_val[_ka] != 0xFF)
                      fprintf(fp, ",\"t%dc%dcr%d\":%d", _ta, _ca2, _ka,
                              (int)_cca->rest_val[_ka]);
                  if (_cca->count[_ka] == 0) continue;
                  fprintf(fp, ",\"t%dc%dck%d\":\"", _ta, _ca2, _ka);
                  for (_ia = 0; _ia < (int)_cca->count[_ka]; _ia++)
                      fprintf(fp, "%d:%d;",
                              (int)_cca->ticks[_ka][_ia], (int)_cca->vals[_ka][_ia]);
                  fputc('"', fp);
              }
              for (_ka = 0; _ka < 8; _ka++) {
                  if (_cca->lane_length[_ka] > 0)
                      fprintf(fp, ",\"t%dc%dccl%d\":%d", _ta, _ca2, _ka,
                              (int)(((uint32_t)_cca->lane_loop_start[_ka] << 16)
                                    | _cca->lane_length[_ka]));
                  if (_cca->lane_tps[_ka] > 0)
                      fprintf(fp, ",\"t%dc%dcct%d\":%d", _ta, _ca2, _ka,
                              (int)_cca->lane_tps[_ka]);
                  if (_cca->lane_res_tps[_ka] > 0)
                      fprintf(fp, ",\"t%dc%dccrt%d\":%d", _ta, _ca2, _ka,
                              (int)_cca->lane_res_tps[_ka]);
              }
          }
    }
    /* Pad-pressure aftertouch automation (melodic clips, sparse per track/clip/lane).
     * Value = "<pitch>|<tick>:<val>;..." — pitch 0-127 poly, 255 channel-wide. */
    { int _ta, _ca2, _la, _ia;
      for (_ta = 0; _ta < NUM_TRACKS; _ta++)
          for (_ca2 = 0; _ca2 < NUM_CLIPS; _ca2++) {
              const at_auto_t *_ata = &inst->tracks[_ta].clip_at_auto[_ca2];
              for (_la = 0; _la < AT_MAX_LANES; _la++) {
                  if (_ata->pitch[_la] == AT_LANE_FREE || _ata->count[_la] == 0) continue;
                  fprintf(fp, ",\"t%dc%dat%d\":\"%d|", _ta, _ca2, _la, (int)_ata->pitch[_la]);
                  for (_ia = 0; _ia < (int)_ata->count[_la]; _ia++)
                      fprintf(fp, "%d:%d;",
                              (int)_ata->ticks[_la][_ia], (int)_ata->vals[_la][_ia]);
                  fputc('"', fp);
              }
          }
    }
    /* Global settings */
    fprintf(fp, ",\"key\":%d,\"scale\":%d,\"lq\":%d",
            (int)inst->pad_key, (int)inst->pad_scale, (int)inst->launch_quant);
    fprintf(fp, ",\"bpm\":%.0f", inst->tracks[0].pfx.cached_bpm > 0
            ? inst->tracks[0].pfx.cached_bpm : (double)BPM_DEFAULT);
    fprintf(fp, ",\"saw\":%d", (int)inst->scale_aware);
    fprintf(fp, ",\"iq\":%d",  (int)inst->inp_quant);
    fprintf(fp, ",\"mic\":%d", (int)inst->midi_in_channel);
    if (inst->metro_on != 1)   fprintf(fp, ",\"metro_on\":%d", (int)inst->metro_on);
    if (inst->metro_vol != 80) fprintf(fp, ",\"metro_vol\":%d", (int)inst->metro_vol);
    if (inst->swing_amt != 0)  fprintf(fp, ",\"_swa\":%d", (int)inst->swing_amt);
    if (inst->swing_res != 0)  fprintf(fp, ",\"_swr\":%d", (int)inst->swing_res);
    if (inst->clock_follow_on)  fprintf(fp, ",\"_cf\":%d", (int)inst->clock_follow_on);
    if (inst->clock_send_on)    fprintf(fp, ",\"_cs\":%d", (int)inst->clock_send_on);
    fprintf(fp, "}");
}

static void seq8_save_state(seq8_instance_t *inst) {
    ensure_parent_dir(inst->state_path);
    FILE *fp = fopen(inst->state_path, "w");
    if (!fp) return;
    seq8_do_serialize(inst, fp);
    fclose(fp);
}

static void seq8_load_state(seq8_instance_t *inst) {
    FILE *fp = fopen(inst->state_path, "r");
    if (!fp) return;
    fseek(fp, 0, SEEK_END);
    long fsz = ftell(fp);
    fseek(fp, 0, SEEK_SET);
    if (fsz <= 0) { fclose(fp); remove(inst->state_path); return; }
    char *buf = (char *)malloc((size_t)fsz + 1);
    if (!buf) { fclose(fp); return; }
    size_t n = fread(buf, 1, (size_t)fsz, fp);
    fclose(fp);
    if (!n) { free(buf); remove(inst->state_path); return; }
    buf[n] = '\0';

    /* Version gate: only v=36 accepted. Clear Session sentinel (v=0) is silently
     * wiped. Genuine old-format files (v>0 && v!=36) defer deletion behind a JS
     * confirm dialog — flag is set on first encounter, consumed on re-entry. */
    {
        int sv = json_get_int(buf, "v", -1);
        if (sv != 36) {
            free(buf);
            if (sv > 0 && !inst->state_version_mismatch) {
                inst->state_version_mismatch = 1;
                seq8_ilog(inst, "SEQ8 state: version mismatch, awaiting JS confirm");
                return;
            }
            inst->state_version_mismatch = 0;
            remove(inst->state_path);
            seq8_ilog(inst, "SEQ8 state: wrong version, deleted");
            return;
        }
    }
    inst->state_version_mismatch = 0;

    /* AT automation: clear all lanes before the sparse parse below (frees lanes
     * to 254 and prevents append-on-reload). */
    { int _rt, _rc;
      for (_rt = 0; _rt < NUM_TRACKS; _rt++)
          for (_rc = 0; _rc < NUM_CLIPS; _rc++)
              at_auto_reset(&inst->tracks[_rt].clip_at_auto[_rc]);
    }

    int t, c;
    char key[32];
    for (t = 0; t < NUM_TRACKS; t++) {
        snprintf(key, sizeof(key), "t%d_ac", t);
        inst->tracks[t].active_clip = (uint8_t)clamp_i(
            json_get_int(buf, key, 0), 0, NUM_CLIPS - 1);

        snprintf(key, sizeof(key), "t%d_wr", t);
        inst->tracks[t].will_relaunch = (uint8_t)clamp_i(
            json_get_int(buf, key, 0), 0, 1);

        snprintf(key, sizeof(key), "t%d_ch", t);
        /* Fallback when the key is absent (older v=36 sets): track N → ch N
         * (tracks 1-4 → ch 1-4 for Move, tracks 5-8 → ch 5-8 for Schwung). */
        inst->tracks[t].channel = (uint8_t)clamp_i(
            json_get_int(buf, key, t), 0, 15);

        snprintf(key, sizeof(key), "t%d_rt", t);
        inst->tracks[t].pfx.route = (uint8_t)clamp_i(
            json_get_int(buf, key, ROUTE_SCHWUNG), ROUTE_SCHWUNG, ROUTE_EXTERNAL);

        snprintf(key, sizeof(key), "t%d_lp", t);
        inst->tracks[t].pfx.looper_on = (uint8_t)(json_get_int(buf, key, 1) ? 1 : 0);

        for (c = 0; c < NUM_CLIPS; c++) {
            clip_t *cl = &inst->tracks[t].clips[c];

            snprintf(key, sizeof(key), "t%dc%d_len", t, c);
            cl->length = (uint16_t)clamp_i(
                json_get_int(buf, key, SEQ_STEPS_DEFAULT), 1, SEQ_STEPS);

            snprintf(key, sizeof(key), "t%dc%d_ls", t, c);
            cl->loop_start = (uint16_t)clamp_i(
                json_get_int(buf, key, 0), 0, SEQ_STEPS - (int)cl->length);

            /* Playback direction (v=35); default 0=Forward when sparse-absent. */
            snprintf(key, sizeof(key), "t%dc%d_pd", t, c);
            cl->playback_dir = (uint8_t)clamp_i(json_get_int(buf, key, 0), 0, 3);
            cl->pp_dir_state = initial_pp_dir(cl->playback_dir);
            snprintf(key, sizeof(key), "t%dc%d_par", t, c);
            cl->playback_audio_reverse = (uint8_t)clamp_i(json_get_int(buf, key, 0), 0, 1);

            snprintf(key, sizeof(key), "t%dc%d_se", t, c);
            cl->stretch_exp = (int8_t)clamp_i(json_get_int(buf, key, 0), -8, 8);

            snprintf(key, sizeof(key), "t%dc%d_cs", t, c);
            cl->clock_shift_pos = (uint16_t)clamp_i(
                json_get_int(buf, key, 0), 0, (int)cl->length - 1);

            snprintf(key, sizeof(key), "t%dc%d_tps", t, c);
            {
                int raw_tps = json_get_int(buf, key, (int)TICKS_PER_STEP);
                /* Validate: must be one of the six allowed values */
                int vi, valid = 0;
                for (vi = 0; vi < 6; vi++)
                    if (raw_tps == (int)TPS_VALUES[vi]) { valid = 1; break; }
                cl->ticks_per_step = valid ? (uint16_t)raw_tps : TICKS_PER_STEP;
            }

            /* note list: "tick:pitch:vel:gate;" */
            {
                char search[40];
                snprintf(search, sizeof(search), "\"t%dc%d_n\":\"", t, c);
                const char *p = strstr(buf, search);
                if (p) {
                    p += strlen(search);
                    /* Accept any tick within storage capacity. Notes outside the
                     * loop window are preserved; clip_len bound would drop them. */
                    uint32_t max_tick = (uint32_t)SEQ_STEPS * cl->ticks_per_step;
                    while (*p && *p != '"') {
                        unsigned long tick_val = 0;
                        while (*p >= '0' && *p <= '9')
                            tick_val = tick_val * 10 + (unsigned long)(*p++ - '0');
                        if (*p != ':') { while (*p && *p != ';' && *p != '"') p++; if (*p==';') p++; continue; }
                        p++;
                        int pitch_val = 0;
                        while (*p >= '0' && *p <= '9') pitch_val = pitch_val*10 + (*p++ - '0');
                        if (*p != ':') { while (*p && *p != ';' && *p != '"') p++; if (*p==';') p++; continue; }
                        p++;
                        int vel_val = 0;
                        while (*p >= '0' && *p <= '9') vel_val = vel_val*10 + (*p++ - '0');
                        if (*p != ':') { while (*p && *p != ';' && *p != '"') p++; if (*p==';') p++; continue; }
                        p++;
                        int gate_val = 0;
                        while (*p >= '0' && *p <= '9') gate_val = gate_val*10 + (*p++ - '0');
                        if (*p == ';') p++;
                        if ((uint32_t)tick_val < max_tick) {
                            int gmax_ld = SEQ_STEPS * cl->ticks_per_step; if (gmax_ld > 65535) gmax_ld = 65535;
                            clip_insert_note(cl, (uint32_t)tick_val,
                                             (uint16_t)clamp_i(gate_val, 1, gmax_ld),
                                             (uint8_t)clamp_i(pitch_val, 0, 127),
                                             (uint8_t)clamp_i(vel_val, 0, 127));
                        }
                    }
                }
            }
        }
    }
    /* Mute/solo state */
    json_get_steps(buf, "mute", inst->mute, NUM_TRACKS);
    json_get_steps(buf, "solo", inst->solo, NUM_TRACKS);
    /* Snapshots */
    {
        int n;
        char search[32], skey[12];
        for (n = 0; n < 16; n++) {
            snprintf(search, sizeof(search), "\"sn%d_m\":\"", n);
            if (!strstr(buf, search)) continue;
            snprintf(skey, sizeof(skey), "sn%d_m", n);
            json_get_steps(buf, skey, inst->snap_mute[n], NUM_TRACKS);
            snprintf(skey, sizeof(skey), "sn%d_s", n);
            json_get_steps(buf, skey, inst->snap_solo[n], NUM_TRACKS);
            for (t = 0; t < NUM_TRACKS; t++) {
                snprintf(key, sizeof(key), "sn%dde%d", n, t);
                inst->snap_drum_eff_mute[n][t] = json_get_uint(buf, key, 0);
            }
            inst->snap_valid[n] = 1;
        }
    }
    /* Per-track: pad_mode (route/channel already loaded above) */
    for (t = 0; t < NUM_TRACKS; t++) {
        snprintf(key, sizeof(key), "t%d_pm", t);
        /* clamp 0..2 so PAD_MODE_CONDUCT (2) survives a reload; clamping to 0..1
         * silently turned a saved Conductor into a Drum track. */
        inst->tracks[t].pad_mode = (uint8_t)clamp_i(json_get_int(buf, key, 0), 0, 2);
        if (inst->tracks[t].pad_mode == PAD_MODE_DRUM)
            drum_clips_alloc(inst, &inst->tracks[t]);
    }
    /* Per-track: drum lane mute/solo bitmasks */
    for (t = 0; t < NUM_TRACKS; t++) {
        snprintf(key, sizeof(key), "t%ddlm", t);
        inst->tracks[t].drum_lane_mute = json_get_uint(buf, key, 0);
        snprintf(key, sizeof(key), "t%ddls", t);
        inst->tracks[t].drum_lane_solo = json_get_uint(buf, key, 0);
    }
    /* Per-track: drum input quantize */
    for (t = 0; t < NUM_TRACKS; t++) {
        snprintf(key, sizeof(key), "t%ddiq", t);
        inst->tracks[t].drum_inp_quant = (uint8_t)clamp_i(json_get_int(buf, key, 0), 0, 8);
    }
    /* Per-track: drum repeat sync */
    for (t = 0; t < NUM_TRACKS; t++) {
        snprintf(key, sizeof(key), "t%ddsy", t);
        inst->tracks[t].drum_repeat_sync = (uint8_t)clamp_i(json_get_int(buf, key, 1), 0, 1);
    }
    /* Drum repeat gate/vel_scale/nudge + Rpt1/Rpt2 rates (sparse; missing = defaults set by drum_repeat_init_defaults) */
    { int l, s;
      for (t = 0; t < NUM_TRACKS; t++) {
          seq8_track_t *tr_r = &inst->tracks[t];
          snprintf(key, sizeof(key), "t%d_drrt", t);
          tr_r->drum_repeat_rate_idx = (uint8_t)clamp_i(json_get_int(buf, key, 2), 0, 7);
          for (l = 0; l < DRUM_LANES; l++) {
              snprintf(key, sizeof(key), "t%dl%drg", t, l);
              tr_r->drum_repeat_gate[l] = (uint8_t)(json_get_int(buf, key, 255) & 0xFF);
              snprintf(key, sizeof(key), "t%dl%drgl", t, l);
              tr_r->drum_repeat_gate_len[l] = (uint8_t)clamp_i(json_get_int(buf, key, 8), 1, 8);
              snprintf(key, sizeof(key), "t%dl%dr2rt", t, l);
              tr_r->drum_repeat2_rate_idx[l] = (uint8_t)clamp_i(json_get_int(buf, key, 2), 0, 7);
              for (s = 0; s < 8; s++) {
                  snprintf(key, sizeof(key), "t%dl%drvs%d", t, l, s);
                  tr_r->drum_repeat_vel_scale[l][s] = (uint8_t)clamp_i(json_get_int(buf, key, 100), 1, 127);
                  snprintf(key, sizeof(key), "t%dl%drn%d", t, l, s);
                  tr_r->drum_repeat_nudge[l][s] = (int8_t)clamp_i(json_get_int(buf, key, 0), -50, 50);
              }
          }
      }
    }
    /* TRACK ARP — per-track params (sparse; missing = defaults) */
    for (t = 0; t < NUM_TRACKS; t++) {
        seq8_track_t *tr2 = &inst->tracks[t];
        snprintf(key, sizeof(key), "t%d_tast", t);
        tr2->tarp.style = (uint8_t)clamp_i(json_get_int(buf, key, 0), 0, 9);
        tr2->tarp_on    = tr2->tarp.style != 0 ? 1 : 0;
        snprintf(key, sizeof(key), "t%d_tart", t);
        tr2->tarp.rate_idx = (uint8_t)clamp_i(json_get_int(buf, key, ARP_RATE_DEFAULT), 0, 9);
        snprintf(key, sizeof(key), "t%d_taoc", t);
        tr2->tarp.octaves = (int8_t)clamp_i(json_get_int(buf, key, 0), -ARP_MAX_OCTAVES, ARP_MAX_OCTAVES);
        snprintf(key, sizeof(key), "t%d_tagt", t);
        tr2->tarp.gate_pct = (uint16_t)clamp_i(json_get_int(buf, key, 100), 1, 200);
        snprintf(key, sizeof(key), "t%d_tasm", t);
        tr2->tarp.steps_mode = (uint8_t)clamp_i(json_get_int(buf, key, 1), 1, 2);
        snprintf(key, sizeof(key), "t%d_tasy", t);
        tr2->tarp_sync = (uint8_t)(json_get_int(buf, key, 1) ? 1 : 0);
        snprintf(key, sizeof(key), "t%d_targ", t);
        tr2->tarp.retrigger = (uint8_t)(json_get_int(buf, key, 0) ? 1 : 0);
        {
            int _i;
            for (_i = 0; _i < 8; _i++) {
                snprintf(key, sizeof(key), "t%d_tasv%d", t, _i);
                /* Absolute velocity 0..127; legacy saves stored 5-state levels
                 * 0..4 — map them to the canonical pad values (values <=4 are
                 * unreachable by the new UI, so this is unambiguous). */
                {
                    int _lv = clamp_i(json_get_int(buf, key, 100), 0, 127);
                    if (_lv <= 4) _lv = _lv == 0 ? 0 : _lv == 1 ? 32 : _lv == 2 ? 64 : _lv == 3 ? 96 : 127;
                    tr2->tarp.step_vel[_i] = (uint8_t)_lv;
                }
                snprintf(key, sizeof(key), "t%d_tasi%d", t, _i);
                tr2->tarp.step_int[_i] = (int8_t)clamp_i(json_get_int(buf, key, 0), -24, 24);
            }
        }
        snprintf(key, sizeof(key), "t%d_tasll", t);
        tr2->tarp.step_loop_len = (uint8_t)clamp_i(json_get_int(buf, key, 8), 1, 8);
    }
    /* Vel Override — per-track, sparse (missing = 0 = Global) */
    for (t = 0; t < NUM_TRACKS; t++) {
        snprintf(key, sizeof(key), "t%d_tvo", t);
        { int _v = clamp_i(json_get_int(buf, key, 0), 0, 128);
          inst->tracks[t].track_vel_override = (uint8_t)(_v == 128 ? 0 : _v); }
    }
    /* CC PARAM bank: CC assignments + per-knob type (sparse; missing = default) */
    { int _k;
      for (t = 0; t < NUM_TRACKS; t++)
          for (_k = 0; _k < 8; _k++) {
              snprintf(key, sizeof(key), "t%dcca%d", t, _k);
              inst->tracks[t].cc_assign[_k] = (uint8_t)clamp_i(
                  json_get_int(buf, key, CC_ASSIGN_DEFAULT[_k]), 0, 127);
              snprintf(key, sizeof(key), "t%dcct%d", t, _k);
              inst->tracks[t].cc_type[_k] = (uint8_t)clamp_i(
                  json_get_int(buf, key, 0), 0, 2);
          }
    }
    /* CC automation (melodic clips, sparse) + per-clip resting value */
    { int _ta, _ca2, _ka;
      char _srch[48];
      for (_ta = 0; _ta < NUM_TRACKS; _ta++)
          for (_ca2 = 0; _ca2 < NUM_CLIPS; _ca2++) {
              cc_auto_t *_cca = &inst->tracks[_ta].clip_cc_auto[_ca2];
              for (_ka = 0; _ka < 8; _ka++) {
                  { char _rk[24];
                    snprintf(_rk, sizeof(_rk), "t%dc%dcr%d", _ta, _ca2, _ka);
                    _cca->rest_val[_ka] = (uint8_t)clamp_i(
                        json_get_int(buf, _rk, 0xFF), 0, 0xFF); }
                  snprintf(_srch, sizeof(_srch), "\"t%dc%dck%d\":\"", _ta, _ca2, _ka);
                  const char *_qp = strstr(buf, _srch);
                  if (!_qp) continue;
                  _qp += strlen(_srch);
                  while (*_qp && *_qp != '"'
                         && _cca->count[_ka] < CC_AUTO_MAX_POINTS) {
                      int _tv = 0, _vv = 0;
                      while (*_qp >= '0' && *_qp <= '9')
                          _tv = _tv * 10 + (*_qp++ - '0');
                      if (*_qp != ':') {
                          while (*_qp && *_qp != ';' && *_qp != '"') _qp++;
                          if (*_qp == ';') _qp++;
                          continue;
                      }
                      _qp++;
                      while (*_qp >= '0' && *_qp <= '9')
                          _vv = _vv * 10 + (*_qp++ - '0');
                      if (*_qp == ';') _qp++;
                      uint16_t _idx = _cca->count[_ka]++;
                      _cca->ticks[_ka][_idx] = (uint16_t)clamp_i(_tv, 0, 65535);
                      _cca->vals[_ka][_idx]  = (uint8_t)clamp_i(_vv, 0, 127);
                  }
              }
              for (_ka = 0; _ka < 8; _ka++) {
                  char _lk[24];
                  snprintf(_lk, sizeof(_lk), "t%dc%dccl%d", _ta, _ca2, _ka);
                  int _lv = json_get_int(buf, _lk, 0);
                  if (_lv > 0) {
                      _cca->lane_loop_start[_ka] = (uint16_t)(((uint32_t)_lv >> 16) & 0xFFFF);
                      _cca->lane_length[_ka] = (uint16_t)(_lv & 0xFFFF);
                  }
                  snprintf(_lk, sizeof(_lk), "t%dc%dcct%d", _ta, _ca2, _ka);
                  int _tv = json_get_int(buf, _lk, 0);
                  if (_tv > 0) {
                      int vi, valid = 0;
                      for (vi = 0; vi < 6; vi++)
                          if (_tv == (int)TPS_VALUES[vi]) { valid = 1; break; }
                      _cca->lane_tps[_ka] = valid ? (uint16_t)_tv : 0;
                  }
                  snprintf(_lk, sizeof(_lk), "t%dc%dccrt%d", _ta, _ca2, _ka);
                  int _rtv = json_get_int(buf, _lk, 0);
                  if (_rtv > 0) {
                      int vi, valid = 0;
                      for (vi = 0; vi < 6; vi++)
                          if (_rtv == (int)TPS_VALUES[vi]) { valid = 1; break; }
                      _cca->lane_res_tps[_ka] = valid ? (uint16_t)_rtv : 0;
                  }
              }
          }
    }
    /* Pad-pressure aftertouch automation (melodic clips, sparse per lane slot).
     * Value = "<pitch>|<tick>:<val>;...". Lanes were cleared above. */
    { int _ta, _ca2, _la;
      char _ats[40];
      for (_ta = 0; _ta < NUM_TRACKS; _ta++)
          for (_ca2 = 0; _ca2 < NUM_CLIPS; _ca2++) {
              at_auto_t *_ata = &inst->tracks[_ta].clip_at_auto[_ca2];
              for (_la = 0; _la < AT_MAX_LANES; _la++) {
                  snprintf(_ats, sizeof(_ats), "\"t%dc%dat%d\":\"", _ta, _ca2, _la);
                  const char *_qp = strstr(buf, _ats);
                  if (!_qp) continue;
                  _qp += strlen(_ats);
                  int _pp = 0;
                  while (*_qp >= '0' && *_qp <= '9') _pp = _pp * 10 + (*_qp++ - '0');
                  if (*_qp != '|') continue;
                  _qp++;
                  _ata->pitch[_la] = (uint8_t)clamp_i(_pp, 0, 255);
                  _ata->count[_la] = 0;
                  while (*_qp && *_qp != '"' && _ata->count[_la] < AT_MAX_POINTS) {
                      int _tv = 0, _vv = 0;
                      while (*_qp >= '0' && *_qp <= '9') _tv = _tv * 10 + (*_qp++ - '0');
                      if (*_qp != ':') {
                          while (*_qp && *_qp != ';' && *_qp != '"') _qp++;
                          if (*_qp == ';') _qp++;
                          continue;
                      }
                      _qp++;
                      while (*_qp >= '0' && *_qp <= '9') _vv = _vv * 10 + (*_qp++ - '0');
                      if (*_qp == ';') _qp++;
                      uint16_t _idx = _ata->count[_la]++;
                      _ata->ticks[_la][_idx] = (uint16_t)clamp_i(_tv, 0, 65535);
                      _ata->vals[_la][_idx]  = (uint8_t)clamp_i(_vv, 0, 127);
                  }
              }
          }
    }
    /* Per-clip play-effect params (sparse — missing keys default to neutral) */
    for (t = 0; t < NUM_TRACKS; t++) {
        for (c = 0; c < NUM_CLIPS; c++) {
            clip_pfx_params_t *p2 = &inst->tracks[t].clips[c].pfx_params;
            snprintf(key, sizeof(key), "t%dc%d_nfo",  t, c);
            p2->octave_shift    = clamp_i(json_get_int(buf, key,   0),    -4,  4);
            snprintf(key, sizeof(key), "t%dc%d_nfof", t, c);
            p2->note_offset     = clamp_i(json_get_int(buf, key,   0),   -24, 24);
            snprintf(key, sizeof(key), "t%dc%d_nfg",  t, c);
            p2->gate_time       = clamp_i(json_get_int(buf, key, 100),     0, 400);
            snprintf(key, sizeof(key), "t%dc%d_nfv",  t, c);
            p2->velocity_offset = clamp_i(json_get_int(buf, key,   0),  -127, 127);
            snprintf(key, sizeof(key), "t%dc%d_qnt",  t, c);
            p2->quantize        = clamp_i(json_get_int(buf, key,   0),     0, 100);
            snprintf(key, sizeof(key), "t%dc%d_ho",   t, c);
            p2->octaver         = clamp_i(json_get_int(buf, key,   0),    -4,   4);
            snprintf(key, sizeof(key), "t%dc%d_h1",   t, c);
            p2->harmonize_1     = clamp_i(json_get_int(buf, key,   0),   -24,  24);
            snprintf(key, sizeof(key), "t%dc%d_h2",   t, c);
            p2->harmonize_2     = clamp_i(json_get_int(buf, key,   0),   -24,  24);
            snprintf(key, sizeof(key), "t%dc%d_h3",   t, c);
            p2->harmonize_3     = clamp_i(json_get_int(buf, key,   0),   -24,  24);
            snprintf(key, sizeof(key), "t%dc%d_dt",   t, c);
            p2->delay_time_idx  = clamp_i(json_get_int(buf, key, DEFAULT_DELAY_TIME_IDX), 0, NUM_CLOCK_VALUES - 1);
            snprintf(key, sizeof(key), "t%dc%d_dl",   t, c);
            p2->delay_level     = clamp_i(json_get_int(buf, key,   0),     0, 127);
            snprintf(key, sizeof(key), "t%dc%d_dr",   t, c);
            p2->repeat_times    = clamp_i(json_get_int(buf, key,   0),     0, MAX_REPEATS);
            snprintf(key, sizeof(key), "t%dc%d_dvf",  t, c);
            p2->fb_velocity     = clamp_i(json_get_int(buf, key,   0),  -127, 127);
            snprintf(key, sizeof(key), "t%dc%d_dpf",  t, c);
            p2->fb_note         = clamp_i(json_get_int(buf, key,   0),   -24,  24);
            snprintf(key, sizeof(key), "t%dc%d_dpr",  t, c);
            p2->fb_note_random  = clamp_i(json_get_int(buf, key, 0), 0, 24);
            snprintf(key, sizeof(key), "t%dc%d_dpnm", t, c);
            p2->fb_note_random_mode = clamp_i(json_get_int(buf, key, 2), 0, 2);
            snprintf(key, sizeof(key), "t%dc%d_dgf",  t, c);
            p2->fb_gate_time    = clamp_i(json_get_int(buf, key,   0),     0,  10);
            snprintf(key, sizeof(key), "t%dc%d_dcf",  t, c);
            p2->fb_clock        = clamp_i(json_get_int(buf, key,   0),  -100, 100);
            snprintf(key, sizeof(key), "t%dc%d_drt",  t, c);
            p2->delay_retrig    = clamp_i(json_get_int(buf, key,   1),     0,   1);
            snprintf(key, sizeof(key), "t%dc%d_nfrnd", t, c);
            p2->note_random     = clamp_i(json_get_int(buf, key,   0),     0,  24);
            snprintf(key, sizeof(key), "t%dc%d_nfrnm", t, c);
            p2->note_random_mode = clamp_i(json_get_int(buf, key,  2),     0,   2);
            /* SEQ ARP */
            snprintf(key, sizeof(key), "t%dc%d_arst", t, c);
            p2->seq_arp_style     = clamp_i(json_get_int(buf, key, 0), 0, 9);
            snprintf(key, sizeof(key), "t%dc%d_arrt", t, c);
            p2->seq_arp_rate      = clamp_i(json_get_int(buf, key, ARP_RATE_DEFAULT), 0, 9);
            snprintf(key, sizeof(key), "t%dc%d_aroc", t, c);
            p2->seq_arp_octaves = clamp_i(json_get_int(buf, key, 0), -ARP_MAX_OCTAVES, ARP_MAX_OCTAVES);
            snprintf(key, sizeof(key), "t%dc%d_argt", t, c);
            p2->seq_arp_gate      = clamp_i(json_get_int(buf, key, 100), 1, 200);
            snprintf(key, sizeof(key), "t%dc%d_arsm", t, c);
            p2->seq_arp_steps_mode = clamp_i(json_get_int(buf, key, 1), 1, 2);
            snprintf(key, sizeof(key), "t%dc%d_artg", t, c);
            p2->seq_arp_retrigger = json_get_int(buf, key, 1) ? 1 : 0;
            snprintf(key, sizeof(key), "t%dc%d_arsy", t, c);
            p2->seq_arp_sync = json_get_int(buf, key, 1) ? 1 : 0;
            {
                int _i;
                for (_i = 0; _i < 8; _i++) {
                    snprintf(key, sizeof(key), "t%dc%d_arsv%d", t, c, _i);
                    /* Absolute velocity; legacy 5-state levels map up (see tasv). */
                    {
                        int _lv = clamp_i(json_get_int(buf, key, 100), 0, 127);
                        if (_lv <= 4) _lv = _lv == 0 ? 0 : _lv == 1 ? 32 : _lv == 2 ? 64 : _lv == 3 ? 96 : 127;
                        p2->seq_arp_step_vel[_i] = (uint8_t)_lv;
                    }
                    snprintf(key, sizeof(key), "t%dc%d_arsi%d", t, c, _i);
                    p2->seq_arp_step_int[_i] = (int8_t)clamp_i(json_get_int(buf, key, 0), -24, 24);
                }
            }
            snprintf(key, sizeof(key), "t%dc%d_arsll", t, c);
            p2->seq_arp_step_loop_len = (uint8_t)clamp_i(json_get_int(buf, key, 8), 1, 8);
            snprintf(key, sizeof(key), "t%dc%d_nlen", t, c);
            p2->note_length_mode = (uint8_t)clamp_i(json_get_int(buf, key, 0), 0, 8);
            /* v=34 per-step trig conditions (iter/random/ratchet hex blobs) */
            {
                clip_t *_cl = &inst->tracks[t].clips[c];
                char k[24];
                snprintf(k, sizeof(k), "t%dc%d_si", t, c);
                parse_step_hex_arr(buf, k, _cl->step_iter,    _cl->length, 255);
                sanitize_step_iter_arr(_cl->step_iter, _cl->length);
                snprintf(k, sizeof(k), "t%dc%d_sr", t, c);
                parse_step_hex_arr(buf, k, _cl->step_random,  _cl->length, 100);
                snprintf(k, sizeof(k), "t%dc%d_sx", t, c);
                parse_step_hex_arr(buf, k, _cl->step_ratchet, _cl->length, 4);
            }
        }
    }
    /* Drum lane data (v=14 only; v=13 files have no drum keys, loops are no-ops) */
    for (t = 0; t < NUM_TRACKS; t++) {
        if (inst->tracks[t].pad_mode != PAD_MODE_DRUM) continue;
        for (c = 0; c < NUM_CLIPS; c++) {
            int l;
            if (!inst->tracks[t].drum_clips[c]) continue;  /* empty slot — nullable */
            for (l = 0; l < DRUM_LANES; l++) {
                drum_lane_t *dl = &inst->tracks[t].drum_clips[c]->lanes[l];
                clip_t *dlc = &dl->clip;
                char search[48];
                snprintf(search, sizeof(search), "\"t%dc%dl%d_n\":\"", t, c, l);
                if (!strstr(buf, search)) continue;
                snprintf(key, sizeof(key), "t%dc%dl%d_mn", t, c, l);
                dl->midi_note = (uint8_t)clamp_i(
                    json_get_int(buf, key, DRUM_BASE_NOTE + l), 0, 127);
                snprintf(key, sizeof(key), "t%dc%dl%d_len", t, c, l);
                dlc->length = (uint16_t)clamp_i(
                    json_get_int(buf, key, SEQ_STEPS_DEFAULT), 1, SEQ_STEPS);
                snprintf(key, sizeof(key), "t%dc%dl%d_ls", t, c, l);
                dlc->loop_start = (uint16_t)clamp_i(
                    json_get_int(buf, key, 0), 0, SEQ_STEPS - (int)dlc->length);
                /* Playback direction (v=35); default 0=Forward when sparse-absent. */
                snprintf(key, sizeof(key), "t%dc%dl%d_pd", t, c, l);
                dlc->playback_dir = (uint8_t)clamp_i(json_get_int(buf, key, 0), 0, 3);
                dlc->pp_dir_state = initial_pp_dir(dlc->playback_dir);
                snprintf(key, sizeof(key), "t%dc%dl%d_par", t, c, l);
                dlc->playback_audio_reverse = (uint8_t)clamp_i(json_get_int(buf, key, 0), 0, 1);
                snprintf(key, sizeof(key), "t%dc%dl%d_tps", t, c, l);
                {
                    int raw_tps = json_get_int(buf, key, (int)TICKS_PER_STEP);
                    int vi, valid = 0;
                    for (vi = 0; vi < 6; vi++)
                        if (raw_tps == (int)TPS_VALUES[vi]) { valid = 1; break; }
                    dlc->ticks_per_step = valid ? (uint16_t)raw_tps : TICKS_PER_STEP;
                }
                {
                    const char *p = strstr(buf, search);
                    p += strlen(search);
                    /* Accept any tick within storage capacity. Notes outside the
                     * loop window are preserved; length bound would drop them. */
                    uint32_t max_tick = (uint32_t)SEQ_STEPS * dlc->ticks_per_step;
                    while (*p && *p != '"') {
                        unsigned long tick_val = 0;
                        while (*p >= '0' && *p <= '9')
                            tick_val = tick_val * 10 + (unsigned long)(*p++ - '0');
                        if (*p != ':') { while (*p && *p != ';' && *p != '"') p++; if (*p==';') p++; continue; }
                        p++;
                        int pitch_val = 0;
                        while (*p >= '0' && *p <= '9') pitch_val = pitch_val*10 + (*p++ - '0');
                        if (*p != ':') { while (*p && *p != ';' && *p != '"') p++; if (*p==';') p++; continue; }
                        p++;
                        int vel_val = 0;
                        while (*p >= '0' && *p <= '9') vel_val = vel_val*10 + (*p++ - '0');
                        if (*p != ':') { while (*p && *p != ';' && *p != '"') p++; if (*p==';') p++; continue; }
                        p++;
                        int gate_val = 0;
                        while (*p >= '0' && *p <= '9') gate_val = gate_val*10 + (*p++ - '0');
                        if (*p == ';') p++;
                        if ((uint32_t)tick_val < max_tick) {
                            int gmax_ld = SEQ_STEPS * dlc->ticks_per_step;
                            if (gmax_ld > 65535) gmax_ld = 65535;
                            clip_insert_note(dlc, (uint32_t)tick_val,
                                             (uint16_t)clamp_i(gate_val, 1, gmax_ld),
                                             (uint8_t)clamp_i(pitch_val, 0, 127),
                                             (uint8_t)clamp_i(vel_val, 0, 127));
                        }
                    }
                }
                /* Per-lane drum pfx params (sparse — missing = default) */
                {
                    drum_pfx_params_t *dp = &dl->pfx_params;
                    snprintf(key, sizeof(key), "t%dc%dl%d_dpg",   t, c, l);
                    dp->gate_time       = clamp_i(json_get_int(buf, key, 100), 0, 400);
                    snprintf(key, sizeof(key), "t%dc%dl%d_dpvo",  t, c, l);
                    dp->velocity_offset = clamp_i(json_get_int(buf, key, 0), -127, 127);
                    snprintf(key, sizeof(key), "t%dc%dl%d_dpq",   t, c, l);
                    dp->quantize        = clamp_i(json_get_int(buf, key, 0), 0, 100);
                    snprintf(key, sizeof(key), "t%dc%dl%d_dpdt",  t, c, l);
                    dp->delay_time_idx  = clamp_i(json_get_int(buf, key, DEFAULT_DRUM_DELAY_TIME_IDX), 0, NUM_CLOCK_VALUES - 1);
                    snprintf(key, sizeof(key), "t%dc%dl%d_dpdl",  t, c, l);
                    dp->delay_level     = clamp_i(json_get_int(buf, key, 0), 0, 127);
                    snprintf(key, sizeof(key), "t%dc%dl%d_dpdr",  t, c, l);
                    dp->repeat_times    = clamp_i(json_get_int(buf, key, 0), 0, MAX_REPEATS);
                    snprintf(key, sizeof(key), "t%dc%dl%d_dpfbv", t, c, l);
                    dp->fb_velocity     = clamp_i(json_get_int(buf, key, 0), -127, 127);
                    snprintf(key, sizeof(key), "t%dc%dl%d_dpfbg", t, c, l);
                    dp->fb_gate_time    = clamp_i(json_get_int(buf, key, 0), 0, 10);
                    snprintf(key, sizeof(key), "t%dc%dl%d_dpfbc", t, c, l);
                    dp->fb_clock        = clamp_i(json_get_int(buf, key, 0), -100, 100);
                    snprintf(key, sizeof(key), "t%dc%dl%d_dpdrt", t, c, l);
                    dp->delay_retrig    = clamp_i(json_get_int(buf, key, 1), 0, 1);
                    snprintf(key, sizeof(key), "t%dc%dl%d_dpnl",  t, c, l);
                    dp->note_length_mode = (uint8_t)clamp_i(json_get_int(buf, key, 0), 0, 8);
                    drum_pfx_apply_params(&inst->tracks[t].drum_lane_pfx[l], dp);
                }
                /* v=34 per-step trig conditions (drum lane) */
                {
                    char k[28];
                    snprintf(k, sizeof(k), "t%dc%dl%d_si", t, c, l);
                    parse_step_hex_arr(buf, k, dlc->step_iter,    dlc->length, 255);
                    sanitize_step_iter_arr(dlc->step_iter, dlc->length);
                    snprintf(k, sizeof(k), "t%dc%dl%d_sr", t, c, l);
                    parse_step_hex_arr(buf, k, dlc->step_random,  dlc->length, 100);
                    snprintf(k, sizeof(k), "t%dc%dl%d_sx", t, c, l);
                    parse_step_hex_arr(buf, k, dlc->step_ratchet, dlc->length, 4);
                }
            }
        }
    }
    /* Global settings */
    inst->pad_key      = (uint8_t)clamp_i(json_get_int(buf, "key",   9), 0, 11);
    inst->pad_scale    = (uint8_t)clamp_i(json_get_int(buf, "scale", 1), 0, 13);
    /* Conductor role (sparse; default -1 = none). Validate range; out-of-range → none. */
    inst->conductor_track = -1;
    {
        int cndt = json_get_int(buf, "cndt", -1);
        if (cndt >= 0 && cndt < NUM_TRACKS)
            inst->conductor_track = (int8_t)cndt;
    }
    /* Reconcile: conductor_track is authoritative for the role. If pad_mode and
     * cndt disagree (e.g. a file saved by a build that clamped pad_mode to 0..1),
     * force the Conductor track to PAD_MODE_CONDUCT and drop any drum clips that
     * an erroneous Drum load allocated for it. */
    if (inst->conductor_track >= 0) {
        seq8_track_t *_ctr = &inst->tracks[inst->conductor_track];
        if (_ctr->pad_mode != PAD_MODE_CONDUCT) {
            if (_ctr->pad_mode == PAD_MODE_DRUM) drum_clips_free(_ctr);
            _ctr->pad_mode = PAD_MODE_CONDUCT;
        }
        /* Conductor per-clip control banks (sparse; absent keys keep clip_init
         * defaults: resp=1, oct=0, when=0). Validate ranges on load. */
        {
            int t = inst->conductor_track, c, ci;
            for (c = 0; c < NUM_CLIPS; c++) {
                clip_t *_cl = &_ctr->clips[c];
                char k[24];
                /* responder mask: 8 chars '0'/'1' */
                snprintf(k, sizeof(k), "t%dc%d_crsp", t, c);
                json_get_steps(buf, k, _cl->cond_resp, NUM_TRACKS);
                /* when: 8 chars '0'/'1' */
                snprintf(k, sizeof(k), "t%dc%d_cwhn", t, c);
                json_get_steps(buf, k, _cl->cond_when, NUM_TRACKS);
                /* octave: 8 space-separated signed ints, clamp -4..+4 */
                snprintf(k, sizeof(k), "\"t%dc%d_coct\":\"", t, c);
                {
                    const char *p = strstr(buf, k);
                    if (p) {
                        p += strlen(k);
                        for (ci = 0; ci < NUM_TRACKS && *p && *p != '"'; ci++) {
                            while (*p == ' ') p++;
                            int sign = 1;
                            if (*p == '-') { sign = -1; p++; }
                            int val = 0;
                            while (*p >= '0' && *p <= '9') val = val * 10 + (*p++ - '0');
                            _cl->cond_oct[ci] = (int8_t)clamp_i(val * sign, -4, 4);
                        }
                    }
                }
                /* CdLk lock: single 0/1, default Off. */
                snprintf(k, sizeof(k), "t%dc%d_clk", t, c);
                _cl->cond_lock = json_get_int(buf, k, 0) ? 1 : 0;
            }
        }
    }
    inst->xpose_preview_active = 0;  /* transient — never persisted; clear on (re)load */
    inst->launch_quant = (uint8_t)clamp_i(json_get_int(buf, "lq",    0), 0,  5);
    {
        int saved_bpm = json_get_int(buf, "bpm", BPM_DEFAULT);
        if (saved_bpm >= 40 && saved_bpm <= 250) {
            double bpm = (double)saved_bpm;
            int _bl;
            inst->tick_delta = (uint32_t)((double)MOVE_FRAMES_PER_BLOCK * bpm * (double)PPQN);
            for (t = 0; t < NUM_TRACKS; t++) {
                inst->tracks[t].pfx.cached_bpm = bpm;
                for (_bl = 0; _bl < DRUM_LANES; _bl++)
                    inst->tracks[t].drum_lane_pfx[_bl].cached_bpm = bpm;
            }
        }
    }
    inst->scale_aware = (uint8_t)(json_get_int(buf, "saw", 0) != 0);
    inst->inp_quant      = (uint8_t)(json_get_int(buf, "iq", 0) != 0);
    inst->midi_in_channel = (uint8_t)clamp_i(json_get_int(buf, "mic", 0), 0, 16);
    inst->metro_on  = (uint8_t)clamp_i(json_get_int(buf, "metro_on", 1), 0, 3);
    inst->metro_vol = (uint8_t)clamp_i(json_get_int(buf, "metro_vol", 80), 0, 150);
    inst->swing_amt = (uint8_t)clamp_i(json_get_int(buf, "_swa", 0), 0, 100);
    inst->swing_res = (uint8_t)clamp_i(json_get_int(buf, "_swr", 0), 0, 1);
    /* Clock-follow persists, but never auto-drives Move on load: ext_transport_*
     * stay zero (cleared at create), so nothing injects until transport runs.
     * Fall back to the legacy "_csl" key for sets saved during early dev. */
    inst->clock_follow_on = (uint8_t)(
        (json_get_int(buf, "_cf", 0) || json_get_int(buf, "_csl", 0)) ? 1 : 0);
    /* Clock OUT toggle persists; emission is suppressed while following and never
     * auto-starts on load (gated on transport actually running in render). */
    inst->clock_send_on = (uint8_t)(json_get_int(buf, "_cs", 0) ? 1 : 0);
    free(buf);
    /* Build step arrays from loaded notes[] for display/edit compat */
    for (t = 0; t < NUM_TRACKS; t++)
        for (c = 0; c < NUM_CLIPS; c++)
            clip_build_steps_from_notes(&inst->tracks[t].clips[c]);
    for (t = 0; t < NUM_TRACKS; t++) {
        if (inst->tracks[t].pad_mode != PAD_MODE_DRUM) continue;
        for (c = 0; c < NUM_CLIPS; c++) {
            int l;
            if (!inst->tracks[t].drum_clips[c]) continue;  /* empty slot — nullable */
            for (l = 0; l < DRUM_LANES; l++)
                clip_build_steps_from_notes(
                    &inst->tracks[t].drum_clips[c]->lanes[l].clip);
        }
    }
    /* Sync each track's tr->pfx params from its active clip's pfx_params */
    for (t = 0; t < NUM_TRACKS; t++)
        pfx_sync_from_clip(&inst->tracks[t]);
    seq8_ilog(inst, "SEQ8 state restored from file");
}

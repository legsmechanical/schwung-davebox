/*
 * SEQ8 — RS7000-inspired 8-track MIDI sequencer for Ableton Move.
 * Phase 5: 8 tracks, 256 steps per clip. Tracks 0-3 route to native Move tracks
 *          via ROUTE_MOVE (fallback: SCHWUNG). Tracks 4-7 route to Schwung chains.
 *
 * Param namespace:
 *   tN_cM_step_S     — track N, clip M, step S on/off (S: 0..255)
 *   tN_cM_steps      — bulk get: 256-char '0'/'1' string for all steps
 *   tN_cM_length     — clip length (1..256)
 *   tN_launch_clip   — queue clip M on track N
 *   launch_scene     — queue clip M on all tracks
 *   tN_route         — "schwung" or "move"
 *   tN_<pfx_key>     — play effects (same as Phase 3)
 *
 * GLIBC SAFE: no C23 calls, no complex static initializers,
 * inline my_atoi() in place of atoi().
 */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <time.h>
#include <sys/stat.h>

#include "host/plugin_api_v1.h"

/* ------------------------------------------------------------------ */
/* Build constants                                                      */
/* ------------------------------------------------------------------ */

#define SEQ8_LOG_PATH           "/data/UserData/schwung/seq8.log"
#define SEQ8_STATE_PATH_FALLBACK "/data/UserData/schwung/seq8-state.json"

#define NUM_TRACKS          8
#define NUM_CLIPS           16

/* MIDI routing: where track output is delivered */
#define ROUTE_SCHWUNG  0   /* host->midi_send_internal → Schwung active chain */
#define ROUTE_MOVE     1   /* JS-side external send via move_midi_external_send */

/* External MIDI queue: DSP buffers ROUTE_MOVE events; JS drains via get_param("ext_queue") */
#define EXT_QUEUE_SIZE 64
typedef struct { uint8_t s; uint8_t d1; uint8_t d2; } ext_msg_t;

/* Pad input modes */
#define PAD_MODE_MELODIC_SCALE  0   /* isomorphic 4ths diatonic layout */

/* Scale-aware play effects: interval tables matching JS SCALE_INTERVALS order */
static const uint8_t SCALE_IVLS[14][8] = {
    {0, 2, 4, 5, 7, 9,11, 0},  /* 0  Major           */
    {0, 2, 3, 5, 7, 8,10, 0},  /* 1  Minor           */
    {0, 2, 3, 5, 7, 9,10, 0},  /* 2  Dorian          */
    {0, 1, 3, 5, 7, 8,10, 0},  /* 3  Phrygian        */
    {0, 2, 4, 6, 7, 9,11, 0},  /* 4  Lydian          */
    {0, 2, 4, 5, 7, 9,10, 0},  /* 5  Mixolydian      */
    {0, 1, 3, 5, 6, 8,10, 0},  /* 6  Locrian         */
    {0, 2, 3, 5, 7, 8,11, 0},  /* 7  Harmonic Minor  */
    {0, 2, 3, 5, 7, 9,11, 0},  /* 8  Melodic Minor   */
    {0, 2, 4, 7, 9, 0, 0, 0},  /* 9  Pent Major      */
    {0, 3, 5, 7,10, 0, 0, 0},  /* 10 Pent Minor      */
    {0, 3, 5, 6, 7,10, 0, 0},  /* 11 Blues           */
    {0, 2, 4, 6, 8,10, 0, 0},  /* 12 Whole Tone      */
    {0, 2, 3, 5, 6, 8, 9,11},  /* 13 Diminished      */
};
static const uint8_t SCALE_SIZES[14] = {7,7,7,7,7,7,7,7,7,5,5,6,6,8};

/* Sequencer engine */
#define BPM_DEFAULT         140
#define PPQN                96
#define TICKS_PER_STEP      24
#define GATE_TICKS          12
#define SEQ_STEPS           256   /* max steps per clip (array size) */
#define SEQ_STEPS_DEFAULT   16    /* default clip length on init     */
#define SEQ_NOTE            60
#define SEQ_VEL             100

/* Play effects (ported from NoteTwist) */
#define MAX_PFX_EVENTS      256
#define MAX_GEN_NOTES       6
#define MAX_REPEATS         16
#define UNISON_STAGGER      220          /* ~5 ms at 44100 Hz */
#define NUM_CLOCK_VALUES    11
#define MAX_DELAY_SAMPLES   (30ULL * 44100)

/* 1 SEQ8 tick = 480/96 = 5 clocks at 480 PPQN (NoteTwist's resolution) */
#define TICKS_TO_480PPQN    5

/* CLOCK_VALUES: delay intervals in 480 PPQN clocks (from NoteTwist) */
static const int CLOCK_VALUES[NUM_CLOCK_VALUES] = {
    0, 30, 60, 80, 120, 160, 240, 320, 480, 960, 1920
};

/* QUANT_STEPS: launch quantization in steps. 0=Now(1), 1=1/16(1), 2=1/8(2), 3=1/4(4), 4=1/2(8), 5=1-bar(16) */
static const uint32_t QUANT_STEPS[6] = {1, 1, 2, 4, 8, 16};


/* ------------------------------------------------------------------ */
/* Play effects structs (direct port from NoteTwist)                   */
/* ------------------------------------------------------------------ */

typedef struct {
    uint64_t fire_at;
    uint8_t  msg[3];
    uint8_t  len;
} pfx_event_t;

typedef struct {
    uint8_t  active;
    uint8_t  channel;
    uint64_t on_time;
    uint8_t  orig_velocity;
    uint8_t  gen_notes[MAX_GEN_NOTES];
    int      gen_count;
    int      stored_unison;
    double   spc;
    int      stored_repeat_count;
    struct {
        uint64_t cumul_delay;
        int8_t   pitch_offset;
        uint8_t  velocity;
        double   gate_factor;
    } reps[MAX_REPEATS];
} pfx_active_t;

typedef struct {
    /* Note FX (stages 1+3 from NoteTwist: octave + note page) */
    int octave_shift;       /* -4..+4 */
    int note_offset;        /* -24..+24 */
    int gate_time;          /* 0..400 percent */
    int velocity_offset;    /* -127..+127 */
    /* Input quantize: 100=fully quantized (tick_offset ignored), 0=raw */
    int quantize;           /* 0..100 */
    /* Harmonize (stage 2 from NoteTwist) */
    int unison;             /* 0=off, 1=x2, 2=x3 */
    int octaver;            /* -4..+4, 0=off */
    int harmonize_1;        /* -24..+24, 0=off */
    int harmonize_2;        /* -24..+24, 0=off */
    /* MIDI Delay (stage 5 from NoteTwist) */
    int delay_time_idx;     /* 0..10, index into CLOCK_VALUES */
    int delay_level;        /* 0..127 */
    int repeat_times;       /* 0..16 */
    int fb_velocity;        /* -127..+127 */
    int fb_note;            /* -24..+24 */
    int fb_note_random;     /* 0 or 1 */
    int fb_gate_time;       /* -100..+100 */
    int fb_clock;           /* -100..+100 */
    /* Runtime */
    uint64_t    sample_counter;
    double      cached_bpm;
    uint32_t    rng;
    pfx_event_t  events[MAX_PFX_EVENTS];
    int          event_count;
    pfx_active_t active_notes[128];
    /* Routing */
    uint8_t      route;     /* ROUTE_SCHWUNG or ROUTE_MOVE */
} play_fx_t;

/* ------------------------------------------------------------------ */
/* Note-centric model (v10+)                                           */
/* ------------------------------------------------------------------ */

#define MAX_NOTES_PER_CLIP  512

typedef struct {
    uint32_t tick;               /* absolute clip tick 0..clip_len*TPS-1 */
    uint16_t gate;               /* gate duration in ticks */
    uint8_t  pitch;              /* MIDI note 0..127 */
    uint8_t  vel;                /* velocity 0..127 */
    uint8_t  active;             /* 1=in use, 0=tombstoned */
    uint8_t  suppress_until_wrap; /* 1=skip playback until clip wraps (recording suppressor) */
    uint8_t  step_muted;         /* 1=from an inactive step; present in notes[] but suppressed from MIDI */
    uint8_t  pad[1];
} note_t; /* 12 bytes */

/* ------------------------------------------------------------------ */
/* Clip and track structs                                               */
/* ------------------------------------------------------------------ */

typedef struct {
    uint8_t  steps[SEQ_STEPS];            /* 0=off, 1=on */
    uint8_t  step_notes[SEQ_STEPS][8];    /* up to 8 notes per step (chord); [0] = primary */
    uint8_t  step_note_count[SEQ_STEPS];  /* 0..8; 0 = step deactivated */
    uint8_t  step_vel[SEQ_STEPS];         /* default SEQ_VEL */
    uint16_t step_gate[SEQ_STEPS];        /* gate ticks 1..clip_len*TICKS_PER_STEP; raw, scaled at render */
    int16_t  note_tick_offset[SEQ_STEPS][8]; /* per-note ±23 within-step offset; 0=quantized */
    uint16_t length;                      /* 1..256, default 16 */
    uint8_t  active;                      /* 1 if any step is on */
    /* Per-clip: cumulative rotation offset for display. Destructive — step
     * data is actually rotated; this counter tracks how far from "origin".
     * Range 0..length-1. Reset to 0 on transport stop (active clip only). */
    uint16_t clock_shift_pos;
    /* Stretch exponent: 0=1x, +1=x2, +2=x4, -1=/2, -2=/4. Not persisted. */
    int8_t   stretch_exp;
    /* Note-centric model (Stage B+): note list derived from step arrays at init */
    note_t   notes[MAX_NOTES_PER_CLIP];
    uint16_t note_count;         /* slots used (active+tombstoned); updated by set_param, not render */
    uint8_t  occ_cache[32];      /* 256-bit occupancy: bit S=1 if any active note in step S */
    uint8_t  occ_dirty;          /* 1 = occ_cache needs recomputation */
} clip_t;

typedef struct {
    uint8_t   channel;              /* MIDI channel 0-3 */
    clip_t    clips[NUM_CLIPS];
    uint8_t   active_clip;          /* clip currently active */
    int8_t    queued_clip;          /* next clip to launch at bar boundary (-1 = none) */
    uint16_t  current_step;
    uint8_t   note_active;
    /* Per-note deferred dispatch: notes with positive tick_offset fired mid-step */
    uint8_t   step_dispatch_mask;       /* bit N set = note index N not yet fired this step */
    uint8_t   step_dispatch_tick[8];    /* tick_in_step to fire each pending note */
    /* Lookahead: notes of the NEXT step already fired early (negative offset) */
    uint8_t   next_early_mask;          /* bit N set = note N of next step fired early */
    uint16_t  pending_gate;             /* effective gate stored at note-on */
    uint16_t  gate_ticks_remaining;     /* countdown to note-off; decrements every tick */
    uint8_t   pending_notes[8];         /* notes fired at note-on; matched at note-off */
    uint8_t   pending_note_count;       /* how many entries in pending_notes are valid */
    play_fx_t pfx;
    uint8_t   pad_octave;           /* live pad root octave (0-8, default 3) */
    uint8_t   pad_mode;             /* PAD_MODE_MELODIC_SCALE = 0 */
    uint8_t   stretch_blocked;      /* 1 if last compress was blocked by collision */
    uint8_t   recording;            /* 1 = actively recording (overdub) into active clip */
    uint8_t   clip_playing;         /* 1 = clip is actively running */
    uint8_t   will_relaunch;        /* 1 = was playing; restarts when transport plays */
    uint8_t   pending_page_stop;    /* 1 = stop at next main clock bar boundary (global_tick%16==0) */
    uint8_t   record_armed;         /* 1 = set recording=1 atomically when queued clip launches */
    /* Steps recorded in the current recording pass; cleared on clip wrap so they play
     * back starting from the next loop (not the pass they were recorded on). */
    uint8_t   live_recorded_steps[32]; /* 256-bit mask: 1 bit per step */
    /* Note-centric recording: in-flight note-ons awaiting note-off for gate capture */
    struct { uint8_t pitch; uint32_t tick_at_on; } rec_pending[10];
    uint8_t  rec_pending_count;
    /* Note-centric playback: per-note gate countdown (render state, not persisted) */
    struct { uint8_t pitch; uint16_t ticks_remaining; } play_pending[32];
    uint8_t  play_pending_count;
    /* Atomic render-state snapshot for set_param timing reads */
    uint32_t current_clip_tick;     /* current_step * TPS + tick_in_step; written each render tick */
} seq8_track_t;
#define LRS_SET(tr, s)  ((tr)->live_recorded_steps[(s)>>3] |=  (uint8_t)(1u<<((s)&7)))
#define LRS_TEST(tr, s) ((tr)->live_recorded_steps[(s)>>3] &   (1u<<((s)&7)))

typedef struct {
    float        sample_rate;
    uint32_t     block_count;
    FILE        *log_fp;

    seq8_track_t tracks[NUM_TRACKS];
    uint8_t      active_track;

    /* Shared transport — all tracks run on the same timing grid */
    uint8_t  playing;
    uint32_t tick_accum;
    uint32_t tick_threshold;        /* sample_rate * 60 */
    uint32_t tick_delta;            /* MOVE_FRAMES_PER_BLOCK * BPM * PPQN */
    uint32_t tick_in_step;
    uint32_t global_tick;             /* steps elapsed since transport play; bar boundary = global_tick % 16 == 0 */

    /* DSP-side count-in: counts down in DSP ticks; fires transport+recording when done */
    int32_t  count_in_ticks;        /* remaining ticks; 0 = inactive */
    uint8_t  count_in_track;        /* track to arm for recording on fire */

    /* Print mode: bake chain output into step data */
    uint8_t  printing;

    /* Live pad input: global key/scale stored for state persistence */
    uint8_t  pad_key;               /* root key 0-11, default 9 (A) */
    uint8_t  pad_scale;             /* 0=Major (matches JS SCALE_NAMES index) */
    uint8_t  launch_quant;          /* 0=Now,1=1/16,2=1/8,3=1/4,4=1/2,5=1-bar; default 5 */

    /* External MIDI queue: ROUTE_MOVE note events buffered here; JS drains each tick */
    ext_msg_t ext_queue[EXT_QUEUE_SIZE];
    int       ext_head;             /* next write index */
    int       ext_tail;             /* next read index */

    /* State file path — set by JS via set_param("state_path") before first load/save */
    char state_path[256];

    /* Monotonic nonce: unique per create_instance call; JS polls to detect DSP hot-reload */
    uint32_t instance_nonce;

    /* Mute/solo per track: 0=off, 1=on */
    uint8_t mute[NUM_TRACKS];
    uint8_t solo[NUM_TRACKS];

    /* Mute/solo snapshots: 16 slots */
    uint8_t snap_mute[16][NUM_TRACKS];
    uint8_t snap_solo[16][NUM_TRACKS];
    uint8_t snap_valid[16];

    /* Scale-aware play effects: interpret Ofs/Hrm/delay-pitch in scale degrees */
    uint8_t scale_aware;
    /* Input velocity: 0=live (pass-through), 1-127=fixed */
    uint8_t input_vel;
    /* Input quantize: 1=snap live recording to step grid (zero offset), 0=unquantized */
    uint8_t inp_quant;
} seq8_instance_t;

static const host_api_v1_t *g_host = NULL;
static seq8_instance_t     *g_inst = NULL;


/* ------------------------------------------------------------------ */
/* Mute/solo                                                            */
/* ------------------------------------------------------------------ */

static int effective_mute(seq8_instance_t *inst, int t) {
    int i, any_solo = 0;
    for (i = 0; i < NUM_TRACKS; i++)
        if (inst->solo[i]) { any_solo = 1; break; }
    return inst->mute[t] || (any_solo && !inst->solo[t]);
}

/* silence_muted_tracks defined after pfx_note_off below */

/* Forward declarations for note-centric helpers (defined after clip_init) */
static int  clip_insert_note(clip_t *cl, uint32_t tick, uint16_t gate, uint8_t pitch, uint8_t vel);
static void clip_migrate_to_notes(clip_t *cl);
static void clip_build_steps_from_notes(clip_t *cl);
static void silence_track_notes_v2(seq8_instance_t *inst, seq8_track_t *tr);

/* ------------------------------------------------------------------ */
/* Utility                                                              */
/* ------------------------------------------------------------------ */

static int my_atoi(const char *s) {
    int sign = 1, v = 0;
    if (!s) return 0;
    while (*s == ' ' || *s == '\t') s++;
    if      (*s == '-') { sign = -1; s++; }
    else if (*s == '+') { s++; }
    while (*s >= '0' && *s <= '9') { v = v * 10 + (*s++ - '0'); }
    return v * sign;
}

static int clamp_i(int v, int lo, int hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

static int pfx_rand(play_fx_t *fx, int lo, int hi) {
    uint32_t x = fx->rng;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    fx->rng = x;
    return lo + (int)(x % (uint32_t)(hi - lo + 1));
}

static void seq8_ilog(seq8_instance_t *inst, const char *msg) {
    if (!inst || !inst->log_fp) return;
    fprintf(inst->log_fp, "%s\n", msg);
    fflush(inst->log_fp);
}

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

static void seq8_save_state(seq8_instance_t *inst) {
    ensure_parent_dir(inst->state_path);
    FILE *fp = fopen(inst->state_path, "w");
    if (!fp) return;
    int t, c;
    fprintf(fp, "{\"v\":11,\"playing\":%d", inst->playing);
    for (t = 0; t < NUM_TRACKS; t++)
        fprintf(fp, ",\"t%d_ac\":%d", t, inst->tracks[t].active_clip);
    for (t = 0; t < NUM_TRACKS; t++)
        fprintf(fp, ",\"t%d_wr\":%d", t, inst->tracks[t].will_relaunch);
    for (t = 0; t < NUM_TRACKS; t++)
        fprintf(fp, ",\"t%d_ch\":%d,\"t%d_rt\":%d",
                t, (int)inst->tracks[t].channel,
                t, (int)inst->tracks[t].pfx.route);
    for (t = 0; t < NUM_TRACKS; t++) {
        for (c = 0; c < NUM_CLIPS; c++) {
            clip_t *cl = &inst->tracks[t].clips[c];
            fprintf(fp, ",\"t%dc%d_len\":%d", t, c, (int)cl->length);
            if (cl->stretch_exp != 0)
                fprintf(fp, ",\"t%dc%d_se\":%d", t, c, (int)cl->stretch_exp);
            if (cl->clock_shift_pos != 0)
                fprintf(fp, ",\"t%dc%d_cs\":%d", t, c, (int)cl->clock_shift_pos);
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
                    fprintf(fp, "%u:%d:%d:%d:%d;",
                            (unsigned)n->tick, (int)n->pitch,
                            (int)n->vel, (int)n->gate,
                            (int)n->step_muted);
                }
                if (wrote) fputc('"', fp);
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
        }
    }
    /* Per-track play effects and mode */
    for (t = 0; t < NUM_TRACKS; t++) {
        play_fx_t *fx = &inst->tracks[t].pfx;
        fprintf(fp, ",\"t%d_pm\":%d", t, (int)inst->tracks[t].pad_mode);
        fprintf(fp, ",\"t%d_nfo\":%d,\"t%d_nfof\":%d,\"t%d_nfg\":%d,\"t%d_nfv\":%d",
                t, fx->octave_shift, t, fx->note_offset, t, fx->gate_time, t, fx->velocity_offset);
        fprintf(fp, ",\"t%d_hu\":%d,\"t%d_ho\":%d,\"t%d_h1\":%d,\"t%d_h2\":%d",
                t, fx->unison, t, fx->octaver, t, fx->harmonize_1, t, fx->harmonize_2);
        fprintf(fp, ",\"t%d_dt\":%d,\"t%d_dl\":%d,\"t%d_dr\":%d,\"t%d_dvf\":%d",
                t, fx->delay_time_idx, t, fx->delay_level, t, fx->repeat_times, t, fx->fb_velocity);
        fprintf(fp, ",\"t%d_dpf\":%d,\"t%d_dgf\":%d,\"t%d_dcf\":%d,\"t%d_dpr\":%d",
                t, fx->fb_note, t, fx->fb_gate_time, t, fx->fb_clock, t, fx->fb_note_random);
        fprintf(fp, ",\"t%d_qnt\":%d", t, fx->quantize);
    }
    /* Global settings */
    fprintf(fp, ",\"key\":%d,\"scale\":%d,\"lq\":%d",
            (int)inst->pad_key, (int)inst->pad_scale, (int)inst->launch_quant);
    fprintf(fp, ",\"bpm\":%.0f", inst->tracks[0].pfx.cached_bpm > 0
            ? inst->tracks[0].pfx.cached_bpm : (double)BPM_DEFAULT);
    fprintf(fp, ",\"saw\":%d", (int)inst->scale_aware);
    fprintf(fp, ",\"iv\":%d",  (int)inst->input_vel);
    fprintf(fp, ",\"iq\":%d",  (int)inst->inp_quant);
    fprintf(fp, "}");
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

    /* Version gate: delete and ignore any state file that isn't v=11. */
    if (json_get_int(buf, "v", -1) != 11) {
        free(buf);
        remove(inst->state_path);
        seq8_ilog(inst, "SEQ8 state: wrong version, deleted");
        return;
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
        inst->tracks[t].channel = (uint8_t)clamp_i(
            json_get_int(buf, key, t), 0, 15);

        snprintf(key, sizeof(key), "t%d_rt", t);
        inst->tracks[t].pfx.route = (uint8_t)clamp_i(
            json_get_int(buf, key, ROUTE_SCHWUNG), ROUTE_SCHWUNG, ROUTE_MOVE);

        for (c = 0; c < NUM_CLIPS; c++) {
            clip_t *cl = &inst->tracks[t].clips[c];

            snprintf(key, sizeof(key), "t%dc%d_len", t, c);
            cl->length = (uint16_t)clamp_i(
                json_get_int(buf, key, SEQ_STEPS_DEFAULT), 1, SEQ_STEPS);

            snprintf(key, sizeof(key), "t%dc%d_se", t, c);
            cl->stretch_exp = (int8_t)clamp_i(json_get_int(buf, key, 0), -8, 8);

            snprintf(key, sizeof(key), "t%dc%d_cs", t, c);
            cl->clock_shift_pos = (uint16_t)clamp_i(
                json_get_int(buf, key, 0), 0, (int)cl->length - 1);

            /* note list: "tick:pitch:vel:gate;" */
            {
                char search[40];
                snprintf(search, sizeof(search), "\"t%dc%d_n\":\"", t, c);
                const char *p = strstr(buf, search);
                if (p) {
                    p += strlen(search);
                    uint32_t max_tick = (uint32_t)cl->length * TICKS_PER_STEP;
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
                        int sm_val = 0;
                        if (*p == ':') {
                            p++;
                            while (*p >= '0' && *p <= '9') sm_val = sm_val*10 + (*p++ - '0');
                        }
                        if (*p == ';') p++;
                        if ((uint32_t)tick_val < max_tick) {
                            int ni_idx = clip_insert_note(cl, (uint32_t)tick_val,
                                             (uint16_t)clamp_i(gate_val, 1, SEQ_STEPS * TICKS_PER_STEP),
                                             (uint8_t)clamp_i(pitch_val, 0, 127),
                                             (uint8_t)clamp_i(vel_val, 0, 127));
                            if (ni_idx >= 0 && sm_val)
                                cl->notes[ni_idx].step_muted = 1;
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
            inst->snap_valid[n] = 1;
        }
    }
    /* Per-track play effects and mode */
    for (t = 0; t < NUM_TRACKS; t++) {
        play_fx_t *fx = &inst->tracks[t].pfx;
        snprintf(key, sizeof(key), "t%d_pm", t);
        inst->tracks[t].pad_mode = (uint8_t)clamp_i(json_get_int(buf, key, 0), 0, 0);
        snprintf(key, sizeof(key), "t%d_nfo", t);
        fx->octave_shift   = clamp_i(json_get_int(buf, key, 0),    -4,  4);
        snprintf(key, sizeof(key), "t%d_nfof", t);
        fx->note_offset    = clamp_i(json_get_int(buf, key, 0),   -24, 24);
        snprintf(key, sizeof(key), "t%d_nfg", t);
        fx->gate_time      = clamp_i(json_get_int(buf, key, 100),   0, 400);
        snprintf(key, sizeof(key), "t%d_nfv", t);
        fx->velocity_offset = clamp_i(json_get_int(buf, key, 0), -127, 127);
        snprintf(key, sizeof(key), "t%d_hu", t);
        fx->unison         = clamp_i(json_get_int(buf, key, 0),     0,   2);
        snprintf(key, sizeof(key), "t%d_ho", t);
        fx->octaver        = clamp_i(json_get_int(buf, key, 0),    -4,   4);
        snprintf(key, sizeof(key), "t%d_h1", t);
        fx->harmonize_1    = clamp_i(json_get_int(buf, key, 0),   -24,  24);
        snprintf(key, sizeof(key), "t%d_h2", t);
        fx->harmonize_2    = clamp_i(json_get_int(buf, key, 0),   -24,  24);
        snprintf(key, sizeof(key), "t%d_dt", t);
        fx->delay_time_idx = clamp_i(json_get_int(buf, key, 0),     0, NUM_CLOCK_VALUES - 1);
        snprintf(key, sizeof(key), "t%d_dl", t);
        fx->delay_level    = clamp_i(json_get_int(buf, key, 0),     0, 127);
        snprintf(key, sizeof(key), "t%d_dr", t);
        fx->repeat_times   = clamp_i(json_get_int(buf, key, 0),     0, MAX_REPEATS);
        snprintf(key, sizeof(key), "t%d_dvf", t);
        fx->fb_velocity    = clamp_i(json_get_int(buf, key, 0),  -127, 127);
        snprintf(key, sizeof(key), "t%d_dpf", t);
        fx->fb_note        = clamp_i(json_get_int(buf, key, 0),   -24,  24);
        snprintf(key, sizeof(key), "t%d_dgf", t);
        fx->fb_gate_time   = clamp_i(json_get_int(buf, key, 0),  -100, 100);
        snprintf(key, sizeof(key), "t%d_dcf", t);
        fx->fb_clock       = clamp_i(json_get_int(buf, key, 0),  -100, 100);
        snprintf(key, sizeof(key), "t%d_dpr", t);
        fx->fb_note_random = json_get_int(buf, key, 0) ? 1 : 0;
        snprintf(key, sizeof(key), "t%d_qnt", t);
        fx->quantize       = clamp_i(json_get_int(buf, key, 0), 0, 100);
    }
    /* Global settings */
    inst->pad_key      = (uint8_t)clamp_i(json_get_int(buf, "key",   9), 0, 11);
    inst->pad_scale    = (uint8_t)clamp_i(json_get_int(buf, "scale", 1), 0, 13);
    inst->launch_quant = (uint8_t)clamp_i(json_get_int(buf, "lq",    0), 0,  5);
    {
        int saved_bpm = json_get_int(buf, "bpm", BPM_DEFAULT);
        if (saved_bpm >= 40 && saved_bpm <= 250) {
            double bpm = (double)saved_bpm;
            inst->tick_delta = (uint32_t)((double)MOVE_FRAMES_PER_BLOCK * bpm * (double)PPQN);
            for (t = 0; t < NUM_TRACKS; t++)
                inst->tracks[t].pfx.cached_bpm = bpm;
        }
    }
    inst->scale_aware = (uint8_t)(json_get_int(buf, "saw", 0) != 0);
    inst->input_vel   = (uint8_t)clamp_i(json_get_int(buf, "iv", 0), 0, 127);
    inst->inp_quant   = (uint8_t)(json_get_int(buf, "iq", 0) != 0);
    free(buf);
    /* Build step arrays from loaded notes[] for display/edit compat */
    for (t = 0; t < NUM_TRACKS; t++)
        for (c = 0; c < NUM_CLIPS; c++)
            clip_build_steps_from_notes(&inst->tracks[t].clips[c]);
    seq8_ilog(inst, "SEQ8 state restored from file");
}

/* ------------------------------------------------------------------ */
/* MIDI output helpers                                                  */
/* ------------------------------------------------------------------ */

/* Send 3-byte MIDI message. Routes on fx->route:
 *   ROUTE_SCHWUNG → midi_send_internal (Schwung chain, immediate)
 *   ROUTE_MOVE    → enqueue in g_inst->ext_queue; JS drains each tick via
 *                   get_param("ext_queue") and sends with move_midi_external_send.
 *                   midi_send_external is never called from the render path. */
static void pfx_send(play_fx_t *fx, uint8_t status, uint8_t d1, uint8_t d2) {
    if (!g_host) return;
    if (fx->route == ROUTE_MOVE) {
        if (g_inst) {
            int next = (g_inst->ext_head + 1) % EXT_QUEUE_SIZE;
            if (next != g_inst->ext_tail) {
                g_inst->ext_queue[g_inst->ext_head].s  = status;
                g_inst->ext_queue[g_inst->ext_head].d1 = d1;
                g_inst->ext_queue[g_inst->ext_head].d2 = d2;
                g_inst->ext_head = next;
            }
        }
        return;
    }
    const uint8_t msg[4] = { (uint8_t)(status >> 4), status, d1, d2 };
    if (g_host->midi_send_internal) g_host->midi_send_internal(msg, 4);
}

/* Brute-force note-off for all 128 notes on all active channels.
 * Routes through pfx_send so ROUTE_MOVE tracks panic on the correct bus. */
static void send_panic(seq8_instance_t *inst) {
    int t, n;
    for (t = 0; t < NUM_TRACKS; t++) {
        for (n = 0; n < 128; n++)
            pfx_send(&inst->tracks[t].pfx,
                     (uint8_t)(0x80 | inst->tracks[t].channel), (uint8_t)n, 0);
    }
}

/* ------------------------------------------------------------------ */
/* BPM and timing                                                       */
/* ------------------------------------------------------------------ */

/* Samples per clock at 480 PPQN — used for MIDI delay time values. */
static double pfx_spc(seq8_instance_t *inst, seq8_track_t *tr) {
    double bpm = tr->pfx.cached_bpm > 0 ? tr->pfx.cached_bpm : (double)BPM_DEFAULT;
    return ((double)inst->sample_rate * 60.0) / (bpm * 480.0);
}

/* Gate duration in samples for the current step, scaled by gate_time%. */
static uint64_t pfx_gate_smp(seq8_instance_t *inst, seq8_track_t *tr) {
    double sp  = pfx_spc(inst, tr);
    double raw = (double)(GATE_TICKS * TICKS_TO_480PPQN) * sp;
    double g   = raw * (double)tr->pfx.gate_time / 100.0;
    if (g < 1.0 && tr->pfx.gate_time > 0) g = 1.0;
    return (uint64_t)(g + 0.5);
}

/* ------------------------------------------------------------------ */
/* Event queue (direct port from NoteTwist)                            */
/* ------------------------------------------------------------------ */

static void pfx_q_insert(play_fx_t *fx, uint64_t fire_at,
                         uint8_t s, uint8_t d1, uint8_t d2) {
    if (fx->event_count >= MAX_PFX_EVENTS) return;
    int lo = 0, hi = fx->event_count;
    while (lo < hi) {
        int mid = (lo + hi) >> 1;
        if (fx->events[mid].fire_at <= fire_at) lo = mid + 1;
        else hi = mid;
    }
    if (lo < fx->event_count)
        memmove(&fx->events[lo + 1], &fx->events[lo],
                (size_t)(fx->event_count - lo) * sizeof(pfx_event_t));
    fx->events[lo].fire_at  = fire_at;
    fx->events[lo].msg[0]   = s;
    fx->events[lo].msg[1]   = d1;
    fx->events[lo].msg[2]   = d2;
    fx->events[lo].len      = 3;
    fx->event_count++;
}

static void pfx_q_fire(play_fx_t *fx, uint64_t now) {
    int f = 0;
    while (f < fx->event_count && fx->events[f].fire_at <= now) {
        pfx_send(fx, fx->events[f].msg[0], fx->events[f].msg[1], fx->events[f].msg[2]);
        f++;
    }
    if (f > 0) {
        fx->event_count -= f;
        if (fx->event_count > 0)
            memmove(&fx->events[0], &fx->events[f],
                    (size_t)fx->event_count * sizeof(pfx_event_t));
    }
}

/* ------------------------------------------------------------------ */
/* Scale-degree to semitone conversion                                  */
/* ------------------------------------------------------------------ */

static int deg_to_semitones(seq8_instance_t *inst, int deg) {
    int s = (int)inst->pad_scale;
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
    int s = (int)inst->pad_scale;
    if (s < 0 || s >= 14) s = 0;
    int n = (int)SCALE_SIZES[s];
    const uint8_t *ivals = SCALE_IVLS[s];
    int key = (int)inst->pad_key;
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

/* ------------------------------------------------------------------ */
/* Generated-note list (direct port from NoteTwist)                    */
/* ------------------------------------------------------------------ */

static int pfx_build_gen_notes(seq8_instance_t *inst, int scale_aware,
                               play_fx_t *fx, int orig_note, uint8_t *out) {
    int cnt = 0;
    int base = orig_note + fx->octave_shift * 12;
    int n = scale_aware ? scale_transpose(inst, clamp_i(base, 0, 127), fx->note_offset)
                        : clamp_i(base + fx->note_offset, 0, 127);
    out[cnt++] = (uint8_t)n;

    if (fx->octaver != 0) {
        int o = n + fx->octaver * 12;
        if (o >= 0 && o <= 127 && cnt < MAX_GEN_NOTES) out[cnt++] = (uint8_t)o;
    }
    if (fx->harmonize_1 != 0) {
        int h = scale_aware ? scale_transpose(inst, n, fx->harmonize_1) : n + fx->harmonize_1;
        if (h >= 0 && h <= 127 && cnt < MAX_GEN_NOTES) out[cnt++] = (uint8_t)h;
    }
    if (fx->harmonize_2 != 0) {
        int h = scale_aware ? scale_transpose(inst, n, fx->harmonize_2) : n + fx->harmonize_2;
        if (h >= 0 && h <= 127 && cnt < MAX_GEN_NOTES) out[cnt++] = (uint8_t)h;
    }
    return cnt;
}

/* ------------------------------------------------------------------ */
/* Delay repeat scheduling (direct port from NoteTwist)                */
/* ------------------------------------------------------------------ */

static void pfx_sched_delay_ons(seq8_instance_t *inst, int scale_aware,
                                play_fx_t *fx, pfx_active_t *an,
                                uint64_t base_time, double sp) {
    if (fx->repeat_times == 0 || fx->delay_level == 0) return;
    int dclk = CLOCK_VALUES[fx->delay_time_idx];
    if (dclk == 0) return;

    an->spc = sp;
    int reps = clamp_i(fx->repeat_times, 0, MAX_REPEATS);
    an->stored_repeat_count = reps;

    double cumul     = 0.0;
    double cur_delay = (double)dclk * sp;
    int    cumul_pitch = 0;
    int    cumul_deg   = 0;
    int    rep_vel   = (int)an->orig_velocity * fx->delay_level / 127;

    int i;
    for (i = 0; i < reps; i++) {
        cumul += cur_delay;
        if ((uint64_t)(cumul + 0.5) > MAX_DELAY_SAMPLES) {
            an->stored_repeat_count = i;
            break;
        }

        {
            if (fx->fb_note_random) {
                if (scale_aware) {
                    int lim = (int)SCALE_SIZES[inst->pad_scale < 14 ? inst->pad_scale : 0];
                    cumul_deg = pfx_rand(fx, -lim, lim);
                } else {
                    cumul_pitch = pfx_rand(fx, -12, 12);
                }
            } else {
                if (scale_aware) cumul_deg   += fx->fb_note;
                else             cumul_pitch += fx->fb_note;
            }
        }
        {
            int pitch = (scale_aware && an->gen_count > 0)
                ? scale_transpose(inst, (int)an->gen_notes[0], cumul_deg) - (int)an->gen_notes[0]
                : cumul_pitch;
            an->reps[i].pitch_offset = (int8_t)clamp_i(pitch, -127, 127);
        }

        if (i > 0) rep_vel += fx->fb_velocity;
        rep_vel = clamp_i(rep_vel, 1, 127);
        an->reps[i].velocity = (uint8_t)rep_vel;

        double gf = 1.0;
        int k;
        for (k = 0; k <= i; k++)
            gf *= (1.0 + fx->fb_gate_time / 100.0);
        an->reps[i].gate_factor = gf;

        an->reps[i].cumul_delay = (uint64_t)(cumul + 0.5);

        uint64_t ft   = base_time + an->reps[i].cumul_delay;
        uint8_t  on_s = (uint8_t)(0x90 | an->channel);
        int j;
        for (j = 0; j < an->gen_count; j++) {
            int note = (int)an->gen_notes[j] + an->reps[i].pitch_offset;
            note = clamp_i(note, 0, 127);
            pfx_q_insert(fx, ft, on_s, (uint8_t)note, an->reps[i].velocity);
        }

        cur_delay *= (1.0 + fx->fb_clock / 100.0);
        if (cur_delay < 1.0) cur_delay = 1.0;
    }
}

/* Schedule note-offs for all delay repeats. Called when original note-off
 * arrives. base_time is the note-on time plus unison extension. */
static void pfx_sched_delay_offs(play_fx_t *fx, pfx_active_t *an,
                                 uint64_t base_time, uint64_t gate_smp) {
    uint8_t off_s = (uint8_t)(0x80 | an->channel);
    int i;
    for (i = 0; i < an->stored_repeat_count; i++) {
        double rg = (double)gate_smp * an->reps[i].gate_factor;
        if (rg < 1.0) rg = 1.0;
        uint64_t off = base_time + an->reps[i].cumul_delay + (uint64_t)(rg + 0.5);
        int j;
        for (j = 0; j < an->gen_count; j++) {
            int note = (int)an->gen_notes[j] + an->reps[i].pitch_offset;
            note = clamp_i(note, 0, 127);
            pfx_q_insert(fx, off, off_s, (uint8_t)note, 0);
        }
    }
}

/* ------------------------------------------------------------------ */
/* Core play effects processing                                         */
/* ------------------------------------------------------------------ */

/* Set all play effects parameters to neutral / passthrough. */
static void pfx_reset(play_fx_t *fx) {
    fx->octave_shift    = 0;
    fx->note_offset     = 0;
    fx->gate_time       = 100;
    fx->velocity_offset = 0;
    fx->unison          = 0;
    fx->octaver         = 0;
    fx->harmonize_1     = 0;
    fx->harmonize_2     = 0;
    fx->delay_time_idx  = 0;
    fx->delay_level     = 0;
    fx->repeat_times    = 0;
    fx->fb_velocity     = 0;
    fx->fb_note         = 0;
    fx->fb_note_random  = 0;
    fx->fb_gate_time    = 0;
    fx->fb_clock        = 0;
    fx->quantize        = 0;
}

/* Process a note-on through the chain. Sends immediate output via
 * pfx_send; queues unison stagger copies and delay repeats. */
static void pfx_note_on(seq8_instance_t *inst, seq8_track_t *tr,
                        uint8_t orig_note, uint8_t vel) {
    play_fx_t   *fx  = &tr->pfx;
    uint8_t      ch  = tr->channel;
    uint64_t     now = fx->sample_counter;
    pfx_active_t *an = &fx->active_notes[orig_note];

    int v = clamp_i((int)vel + fx->velocity_offset, 1, 127);

    int is_scale_aware = inst->scale_aware && (tr->pad_mode == PAD_MODE_MELODIC_SCALE);
    uint8_t gen[MAX_GEN_NOTES];
    int gc = pfx_build_gen_notes(inst, is_scale_aware, fx, (int)orig_note, gen);

    /* Retrigger guard: if this note is already active, clean up first. */
    if (an->active) {
        uint8_t off_s = (uint8_t)(0x80 | an->channel);
        int i;
        for (i = 0; i < an->gen_count; i++)
            pfx_send(fx, off_s, an->gen_notes[i], 0);
    }

    /* Store active-note record. */
    memset(an, 0, sizeof(pfx_active_t));
    an->active        = 1;
    an->channel       = ch;
    an->on_time       = now;
    an->orig_velocity = (uint8_t)v;
    an->gen_count     = gc;
    memcpy(an->gen_notes, gen, (size_t)gc);
    an->stored_unison = fx->unison;

    double sp    = pfx_spc(inst, tr);
    uint8_t on_s = (uint8_t)(0x90 | ch);

    /* Immediate note-ons. */
    int i;
    for (i = 0; i < gc; i++)
        pfx_send(fx, on_s, gen[i], (uint8_t)v);

    /* Unison stagger copies (queued). */
    int c;
    for (c = 0; c < fx->unison; c++) {
        uint64_t stagger = now + (uint64_t)(UNISON_STAGGER * (c + 1));
        for (i = 0; i < gc; i++)
            pfx_q_insert(fx, stagger, on_s, gen[i], (uint8_t)v);
    }

    /* Delay repeats (note-ons only; note-offs scheduled at note-off time). */
    pfx_sched_delay_ons(inst, is_scale_aware, fx, an, now, sp);

    /* Print mode: capture primary output note and velocity into active clip. */
    if (inst->printing) {
        clip_t *cl = &tr->clips[tr->active_clip];
        cl->step_notes[tr->current_step][0] = gen[0];
        cl->step_note_count[tr->current_step] = 1;
        cl->step_vel[tr->current_step]  = (uint8_t)v;
    }
}

/* Process a note-off. Sends/queues note-offs for harmony copies and all
 * delay repeat echoes. Echoes never re-enter the chain. */
static void pfx_note_off(seq8_instance_t *inst, seq8_track_t *tr,
                         uint8_t orig_note) {
    play_fx_t   *fx  = &tr->pfx;
    pfx_active_t *an = &fx->active_notes[orig_note];
    if (!an->active) return;

    uint64_t now      = fx->sample_counter;
    uint64_t gate_smp = pfx_gate_smp(inst, tr);
    uint64_t uni_ext  = (uint64_t)(UNISON_STAGGER * an->stored_unison);
    uint64_t off_time = an->on_time + gate_smp + uni_ext;
    uint8_t  off_s    = (uint8_t)(0x80 | an->channel);

    int i;
    for (i = 0; i < an->gen_count; i++) {
        if (off_time <= now)
            pfx_send(fx, off_s, an->gen_notes[i], 0);
        else
            pfx_q_insert(fx, off_time, off_s, an->gen_notes[i], 0);
    }

    pfx_sched_delay_offs(fx, an, an->on_time + uni_ext, gate_smp);
    an->active = 0;
}

/* Immediate note-off for live pad releases — bypasses gate_smp minimum.
 * gate_smp is a sequencer concept (note rings for its step duration); pads
 * should stop the moment the finger lifts regardless of how long gate_time is. */
static void pfx_note_off_imm(seq8_instance_t *inst, seq8_track_t *tr,
                              uint8_t orig_note) {
    play_fx_t   *fx  = &tr->pfx;
    pfx_active_t *an = &fx->active_notes[orig_note];
    if (!an->active) return;

    uint64_t now     = fx->sample_counter;
    uint64_t uni_ext = (uint64_t)(UNISON_STAGGER * an->stored_unison);
    uint8_t  off_s   = (uint8_t)(0x80 | an->channel);

    int i;
    for (i = 0; i < an->gen_count; i++)
        pfx_send(fx, off_s, an->gen_notes[i], 0);

    pfx_sched_delay_offs(fx, an, an->on_time + uni_ext, pfx_gate_smp(inst, tr));
    an->active = 0;
    (void)now;
}

static void silence_muted_tracks(seq8_instance_t *inst) {
    int t;
    for (t = 0; t < NUM_TRACKS; t++) {
        seq8_track_t *tr = &inst->tracks[t];
        if (effective_mute(inst, t)) {
            silence_track_notes_v2(inst, tr);
            tr->step_dispatch_mask = 0;
        }
    }
}

/* ------------------------------------------------------------------ */
/* Plugin lifecycle                                                     */
/* ------------------------------------------------------------------ */

static void pfx_init_defaults(play_fx_t *fx) {
    pfx_reset(fx);                     /* explicit zero of all stages */
    fx->cached_bpm = (double)BPM_DEFAULT;
    fx->rng        = 12345;
    fx->route      = ROUTE_SCHWUNG;    /* default: Schwung chains */
}

static void clip_init(clip_t *cl) {
    int s;
    cl->length         = SEQ_STEPS_DEFAULT;
    cl->active         = 0;
    cl->clock_shift_pos = 0;
    cl->stretch_exp     = 0;
    for (s = 0; s < SEQ_STEPS; s++) {
        cl->steps[s]           = 0;
        memset(cl->step_notes[s], 0, 8);
        cl->step_note_count[s] = 0;
        cl->step_vel[s]        = SEQ_VEL;
        cl->step_gate[s]       = GATE_TICKS;
        memset(cl->note_tick_offset[s], 0, 8 * sizeof(int16_t));
    }
    cl->note_count = 0;
    memset(cl->notes, 0, sizeof(cl->notes));
    memset(cl->occ_cache, 0, sizeof(cl->occ_cache));
    cl->occ_dirty = 0;
}

/* ------------------------------------------------------------------ */
/* Note-centric helpers (Stage B+)                                     */
/* ------------------------------------------------------------------ */

/* Logical step for an absolute clip tick using midpoint assignment. */
static uint16_t note_step(uint32_t tick, uint16_t clip_len) {
    uint32_t shifted = tick + (uint32_t)(TICKS_PER_STEP / 2);
    return (uint16_t)((shifted / (uint32_t)TICKS_PER_STEP) % (uint32_t)clip_len);
}

/* Find all active note indices in step S; returns count. */
static int notes_in_step(clip_t *cl, uint16_t s, uint16_t *idxs, int max_out) {
    int count = 0;
    uint16_t i;
    for (i = 0; i < cl->note_count && count < max_out; i++) {
        if (!cl->notes[i].active) continue;
        if (note_step(cl->notes[i].tick, cl->length) == s)
            idxs[count++] = i;
    }
    return count;
}

/* Rebuild the 256-bit occupancy cache from notes[]. */
static void clip_occ_update(clip_t *cl) {
    memset(cl->occ_cache, 0, sizeof(cl->occ_cache));
    uint16_t i;
    for (i = 0; i < cl->note_count; i++) {
        if (!cl->notes[i].active || cl->notes[i].step_muted) continue;
        uint16_t s = note_step(cl->notes[i].tick, cl->length);
        cl->occ_cache[s >> 3] |= (uint8_t)(1u << (s & 7));
    }
    cl->occ_dirty = 0;
}

static void clip_clear_suppress(clip_t *cl) {
    uint16_t i;
    for (i = 0; i < cl->note_count; i++)
        cl->notes[i].suppress_until_wrap = 0;
}

/* Finalize gates for notes still held in rec_pending at disarm time.
 * Must be called BEFORE clip_clear_suppress so suppress_until_wrap is still set. */
static void finalize_pending_notes(clip_t *cl, seq8_track_t *tr) {
    uint32_t clip_ticks = (uint32_t)cl->length * TICKS_PER_STEP;
    if (clip_ticks == 0) { tr->rec_pending_count = 0; return; }
    uint32_t off_tick = tr->current_clip_tick % clip_ticks;
    int ri;
    for (ri = 0; ri < (int)tr->rec_pending_count; ri++) {
        uint32_t on_tick = tr->rec_pending[ri].tick_at_on;
        uint32_t gate_ticks = (off_tick >= on_tick) ? off_tick - on_tick
                                                     : clip_ticks - on_tick + off_tick;
        if (gate_ticks < 1) gate_ticks = 1;
        if (gate_ticks > (uint32_t)SEQ_STEPS * TICKS_PER_STEP)
            gate_ticks = (uint32_t)SEQ_STEPS * TICKS_PER_STEP;
        /* Update matching note in notes[] — scan newest first */
        uint16_t ni;
        for (ni = (cl->note_count > 0 ? cl->note_count - 1 : 0);
             ni < cl->note_count; ni--) {
            note_t *n = &cl->notes[ni];
            if (n->active && n->suppress_until_wrap
                    && n->pitch == tr->rec_pending[ri].pitch
                    && n->tick  == on_tick) {
                n->gate = (uint16_t)gate_ticks;
                uint16_t sidx = (uint16_t)(on_tick / TICKS_PER_STEP);
                if (sidx < SEQ_STEPS && cl->steps[sidx])
                    cl->step_gate[sidx] = (uint16_t)gate_ticks;
                break;
            }
            if (ni == 0) break;
        }
    }
    tr->rec_pending_count = 0;
}

/* Insert a note; write all fields before incrementing note_count (render-thread safe). */
static int clip_insert_note(clip_t *cl, uint32_t tick, uint16_t gate,
                             uint8_t pitch, uint8_t vel) {
    if (cl->note_count >= MAX_NOTES_PER_CLIP) return -1;
    int idx = (int)cl->note_count;
    cl->notes[idx].tick              = tick;
    cl->notes[idx].gate              = gate;
    cl->notes[idx].pitch             = pitch;
    cl->notes[idx].vel               = vel;
    cl->notes[idx].suppress_until_wrap = 0;
    cl->notes[idx].step_muted        = 0;
    cl->notes[idx].pad[0]            = 0;
    cl->notes[idx].active            = 1;   /* activate last */
    cl->note_count++;
    cl->occ_dirty = 1;
    return idx;
}

/* Rebuild step arrays from notes[] — used after v=11 state load. */
static void clip_build_steps_from_notes(clip_t *cl) {
    int s;
    for (s = 0; s < SEQ_STEPS; s++) {
        cl->steps[s] = 0;
        memset(cl->step_notes[s], 0, 8);
        cl->step_note_count[s] = 0;
        cl->step_vel[s]  = (uint8_t)SEQ_VEL;
        cl->step_gate[s] = (uint16_t)GATE_TICKS;
        memset(cl->note_tick_offset[s], 0, 8 * sizeof(int16_t));
    }
    cl->active = 0;
    cl->occ_dirty = 1;
    uint16_t ni;
    for (ni = 0; ni < cl->note_count; ni++) {
        note_t *n = &cl->notes[ni];
        if (!n->active) continue;
        uint16_t sidx = note_step(n->tick, cl->length);
        if (sidx >= SEQ_STEPS || cl->step_note_count[sidx] >= 8) continue;
        int idx = (int)cl->step_note_count[sidx];
        if (idx == 0) {
            cl->step_vel[sidx]  = n->vel;
            cl->step_gate[sidx] = n->gate;
        }
        cl->step_notes[sidx][idx] = n->pitch;
        cl->note_tick_offset[sidx][idx] =
            (int16_t)((int32_t)n->tick - (int32_t)sidx * TICKS_PER_STEP);
        cl->step_note_count[sidx]++;
        if (!n->step_muted) {
            cl->steps[sidx] = 1;
            cl->active = 1;
        }
    }
}

/* Derive notes[] from step arrays. Called after state load so both representations exist. */
static void clip_migrate_to_notes(clip_t *cl) {
    int s, ni;
    cl->note_count = 0;
    memset(cl->notes, 0, sizeof(cl->notes));
    cl->occ_dirty = 1;
    int clip_ticks = (int)cl->length * TICKS_PER_STEP;
    for (s = 0; s < (int)cl->length; s++) {
        if (cl->step_note_count[s] == 0) continue;
        uint8_t muted = cl->steps[s] ? 0 : 1;
        for (ni = 0; ni < (int)cl->step_note_count[s]; ni++) {
            int32_t abs_tick = (int32_t)s * TICKS_PER_STEP
                               + (int32_t)cl->note_tick_offset[s][ni];
            if (abs_tick < 0) abs_tick += clip_ticks;
            if (abs_tick >= clip_ticks) abs_tick = clip_ticks - 1;
            int idx = clip_insert_note(cl, (uint32_t)abs_tick, cl->step_gate[s],
                                       cl->step_notes[s][ni], cl->step_vel[s]);
            if (idx >= 0) cl->notes[idx].step_muted = muted;
            if (cl->note_count >= MAX_NOTES_PER_CLIP) return;
        }
    }
}

static void seq8_clear_state(seq8_instance_t *inst) {
    int t, c;
    send_panic(inst);
    inst->playing        = 0;
    inst->count_in_ticks = 0;
    for (t = 0; t < NUM_TRACKS; t++) {
        seq8_track_t *tr = &inst->tracks[t];
        tr->note_active         = 0;
        tr->pending_note_count  = 0;
        tr->play_pending_count  = 0;
        tr->rec_pending_count   = 0;
        tr->pfx.event_count     = 0;
        memset(tr->pfx.active_notes, 0, sizeof(tr->pfx.active_notes));
        tr->clip_playing        = 0;
        tr->will_relaunch       = 0;
        tr->pending_page_stop   = 0;
        tr->record_armed        = 0;
        tr->recording           = 0;
        tr->queued_clip         = -1;
        tr->active_clip         = 0;
        tr->current_step        = 0;
        tr->step_dispatch_mask  = 0;
        tr->next_early_mask     = 0;
        tr->current_clip_tick   = 0;
        for (c = 0; c < NUM_CLIPS; c++)
            clip_init(&tr->clips[c]);
    }
}

static void *create_instance(const char *module_dir, const char *json_defaults) {
    (void)module_dir; (void)json_defaults;

    seq8_instance_t *inst = (seq8_instance_t *)calloc(1, sizeof(seq8_instance_t));
    if (!inst) return NULL;
    g_inst = inst;

    inst->sample_rate    = (g_host && g_host->sample_rate > 0)
                           ? (float)g_host->sample_rate : 44100.0f;
    inst->log_fp         = fopen(SEQ8_LOG_PATH, "a");

    inst->pad_key      = 9;   /* A */
    inst->pad_scale    = 1;   /* Minor */
    inst->launch_quant = 0;   /* Now */
    strncpy(inst->state_path, SEQ8_STATE_PATH_FALLBACK, sizeof(inst->state_path) - 1);

    /* Resolve per-set state path from active_set.txt */
    {
        char uuid[128] = {0};
        FILE *uf = fopen("/data/UserData/schwung/active_set.txt", "r");
        if (uf) {
            if (fgets(uuid, sizeof(uuid), uf)) {
                int i = (int)strlen(uuid) - 1;
                while (i >= 0 && (uuid[i] == '\n' || uuid[i] == '\r' || uuid[i] == ' '))
                    uuid[i--] = '\0';
            }
            fclose(uf);
        }
        if (uuid[0])
            snprintf(inst->state_path, sizeof(inst->state_path),
                     "/data/UserData/schwung/set_state/%s/seq8-state.json", uuid);
    }

    /* Unique nonce: JS polls this to detect DSP hot-reload */
    inst->instance_nonce = (uint32_t)time(NULL) ^ (uint32_t)((uintptr_t)inst >> 3);

    int t, c;
    for (t = 0; t < NUM_TRACKS; t++) {
        inst->tracks[t].channel     = (uint8_t)t;
        inst->tracks[t].queued_clip = -1;
        inst->tracks[t].pad_octave  = 3;
        inst->tracks[t].pad_mode    = PAD_MODE_MELODIC_SCALE;
        for (c = 0; c < NUM_CLIPS; c++)
            clip_init(&inst->tracks[t].clips[c]);
        pfx_init_defaults(&inst->tracks[t].pfx);
    }

    inst->tick_threshold = (uint32_t)(inst->sample_rate * 60.0f);
    {
        double init_bpm = (g_host && g_host->get_bpm)
            ? (double)g_host->get_bpm() : (double)BPM_DEFAULT;
        if (init_bpm < 20.0 || init_bpm > 300.0) init_bpm = (double)BPM_DEFAULT;
        for (t = 0; t < NUM_TRACKS; t++)
            inst->tracks[t].pfx.cached_bpm = init_bpm;
        inst->tick_delta = (uint32_t)((double)MOVE_FRAMES_PER_BLOCK * init_bpm * (double)PPQN);
    }

    seq8_load_state(inst);

    {
        char szlog[128];
        snprintf(szlog, sizeof(szlog),
                 "SEQ8 Phase 5 init: sizeof=%zu get_bpm=%s get_clock_status=%s bpm=%.1f",
                 sizeof(seq8_instance_t),
                 (g_host && g_host->get_bpm) ? "ok" : "null",
                 (g_host && g_host->get_clock_status) ? "ok" : "null",
                 inst->tracks[0].pfx.cached_bpm);
        seq8_ilog(inst, szlog);
    }
    return inst;
}

static void destroy_instance(void *instance) {
    seq8_instance_t *inst = (seq8_instance_t *)instance;
    if (!inst) return;
    seq8_save_state(inst);  /* Option C: persist state before teardown */
    int t;
    for (t = 0; t < NUM_TRACKS; t++) {
        inst->tracks[t].pfx.event_count = 0;
        memset(inst->tracks[t].pfx.active_notes, 0,
               sizeof(inst->tracks[t].pfx.active_notes));
    }
    send_panic(inst);
    g_inst = NULL;
    seq8_ilog(inst, "SEQ8 instance destroyed");
    if (inst->log_fp) fclose(inst->log_fp);
    free(inst);
}

/* ------------------------------------------------------------------ */
/* on_midi                                                              */
/* ------------------------------------------------------------------ */

static void on_midi(void *instance, const uint8_t *msg, int len, int source) {
    (void)instance; (void)msg; (void)len; (void)source;
}

/* ------------------------------------------------------------------ */
/* set_param helpers                                                    */
/* ------------------------------------------------------------------ */

/* Apply a play-effects key/value to a specific track's pfx. */
static void pfx_set(seq8_instance_t *inst, seq8_track_t *tr,
                    const char *key, const char *val) {
    play_fx_t *fx = &tr->pfx;

    if (!strcmp(key, "noteFX_octave"))
        { fx->octave_shift    = clamp_i(my_atoi(val), -4, 4);    return; }
    if (!strcmp(key, "noteFX_offset"))
        { fx->note_offset     = clamp_i(my_atoi(val), -24, 24);  return; }
    if (!strcmp(key, "noteFX_gate")) {
        fx->gate_time = clamp_i(my_atoi(val), 0, 400);
        return;
    }
    if (!strcmp(key, "noteFX_velocity"))
        { fx->velocity_offset = clamp_i(my_atoi(val), -127, 127); return; }

    if (!strcmp(key, "harm_unison")) {
        if      (!strcmp(val, "OFF") || !strcmp(val, "0")) fx->unison = 0;
        else if (!strcmp(val, "x2")  || !strcmp(val, "1")) fx->unison = 1;
        else if (!strcmp(val, "x3")  || !strcmp(val, "2")) fx->unison = 2;
        else fx->unison = clamp_i(my_atoi(val), 0, 2);
        return;
    }
    if (!strcmp(key, "harm_octaver"))
        { fx->octaver     = clamp_i(my_atoi(val), -4, 4);   return; }
    if (!strcmp(key, "harm_interval1"))
        { fx->harmonize_1 = clamp_i(my_atoi(val), -24, 24); return; }
    if (!strcmp(key, "harm_interval2"))
        { fx->harmonize_2 = clamp_i(my_atoi(val), -24, 24); return; }

    if (!strcmp(key, "delay_time"))
        { fx->delay_time_idx = clamp_i(my_atoi(val), 0, NUM_CLOCK_VALUES - 1); return; }
    if (!strcmp(key, "delay_level"))
        { fx->delay_level    = clamp_i(my_atoi(val), 0, 127);    return; }
    if (!strcmp(key, "delay_repeats"))
        { fx->repeat_times   = clamp_i(my_atoi(val), 0, MAX_REPEATS); return; }
    if (!strcmp(key, "delay_vel_fb"))
        { fx->fb_velocity    = clamp_i(my_atoi(val), -127, 127); return; }
    if (!strcmp(key, "delay_pitch_fb"))
        { fx->fb_note        = clamp_i(my_atoi(val), -24, 24);   return; }
    if (!strcmp(key, "delay_pitch_random")) {
        fx->fb_note_random = (!strcmp(val, "on") || !strcmp(val, "1")) ? 1 : 0;
        return;
    }
    if (!strcmp(key, "delay_gate_fb"))
        { fx->fb_gate_time   = clamp_i(my_atoi(val), -100, 100); return; }
    if (!strcmp(key, "delay_clock_fb"))
        { fx->fb_clock       = clamp_i(my_atoi(val), -100, 100); return; }

    if (!strcmp(key, "quantize")) {
        fx->quantize = clamp_i(my_atoi(val), 0, 100);
        return;
    }

    if (!strcmp(key, "pfx_reset")) {
        pfx_reset(fx);
        return;
    }

    if (!strcmp(key, "print")) {
        if (!strcmp(val, "1") && !inst->printing) {
            inst->printing = 1;
            seq8_ilog(inst, "SEQ8 print: started");
        } else if (!strcmp(val, "0") && inst->printing) {
            inst->printing = 0;
            pfx_reset(fx);
            seq8_ilog(inst, "SEQ8 print: done, chain reset to neutral");
        }
        return;
    }
}

/* ------------------------------------------------------------------ */
/* set_param                                                            */
/* ------------------------------------------------------------------ */

static void set_param(void *instance, const char *key, const char *val) {
    seq8_instance_t *inst = (seq8_instance_t *)instance;
    if (!inst || !key || !val) return;

    /* --- Transport (global) --- */
    if (!strcmp(key, "transport")) {
        if (!strcmp(val, "play")) {
            if (!inst->playing) {
                int t;
                inst->global_tick  = 0;
                inst->tick_accum   = 0;
                inst->tick_in_step = 0;
                for (t = 0; t < NUM_TRACKS; t++) {
                    inst->tracks[t].current_step      = 0;
                    inst->tracks[t].note_active        = 0;
                    inst->tracks[t].pfx.sample_counter = 0;
                    if (inst->tracks[t].will_relaunch) {
                        inst->tracks[t].clip_playing      = 1;
                        inst->tracks[t].will_relaunch     = 0;
                        inst->tracks[t].pending_page_stop = 0;
                    }
                }
                inst->playing = 1;
            }
        } else if (!strcmp(val, "stop")) {
            if (inst->playing) {
                int t;
                for (t = 0; t < NUM_TRACKS; t++) {
                    inst->tracks[t].note_active         = 0;
                    inst->tracks[t].pending_note_count  = 0;
                    inst->tracks[t].pfx.event_count     = 0;
                    memset(inst->tracks[t].pfx.active_notes, 0,
                           sizeof(inst->tracks[t].pfx.active_notes));
                    inst->tracks[t].clips[inst->tracks[t].active_clip].clock_shift_pos = 0;
                    if (inst->tracks[t].clip_playing) {
                        inst->tracks[t].will_relaunch = 1;
                        inst->tracks[t].clip_playing  = 0;
                    }
                    inst->tracks[t].pending_page_stop = 0;
                    inst->tracks[t].record_armed      = 0;
                    if (inst->tracks[t].recording) {
                        finalize_pending_notes(&inst->tracks[t].clips[inst->tracks[t].active_clip],
                                               &inst->tracks[t]);
                        clip_clear_suppress(&inst->tracks[t].clips[inst->tracks[t].active_clip]);
                    }
                    inst->tracks[t].recording         = 0;
                    inst->tracks[t].queued_clip       = -1;
                }
                inst->playing        = 0;
                inst->count_in_ticks = 0;
                send_panic(inst);
                seq8_ilog(inst, "SEQ8 transport: stop");
            }
        } else if (!strcmp(val, "panic")) {
            int t;
            for (t = 0; t < NUM_TRACKS; t++) {
                inst->tracks[t].note_active         = 0;
                inst->tracks[t].pending_note_count  = 0;
                inst->tracks[t].pfx.event_count     = 0;
                memset(inst->tracks[t].pfx.active_notes, 0,
                       sizeof(inst->tracks[t].pfx.active_notes));
                inst->tracks[t].clips[inst->tracks[t].active_clip].clock_shift_pos = 0;
                inst->tracks[t].clip_playing      = 0;
                inst->tracks[t].will_relaunch     = 0;
                inst->tracks[t].pending_page_stop = 0;
                inst->tracks[t].record_armed      = 0;
                if (inst->tracks[t].recording) {
                    finalize_pending_notes(&inst->tracks[t].clips[inst->tracks[t].active_clip],
                                           &inst->tracks[t]);
                    clip_clear_suppress(&inst->tracks[t].clips[inst->tracks[t].active_clip]);
                }
                inst->tracks[t].recording         = 0;
                inst->tracks[t].queued_clip       = -1;
            }
            inst->playing        = 0;
            inst->count_in_ticks = 0;
            send_panic(inst);
            seq8_ilog(inst, "SEQ8 transport: panic");
        } else if (!strcmp(val, "deactivate_all")) {
            int t;
            for (t = 0; t < NUM_TRACKS; t++) {
                if (inst->tracks[t].clip_playing)
                    inst->tracks[t].pending_page_stop = 1;
                inst->tracks[t].queued_clip  = -1;
                inst->tracks[t].record_armed = 0;
            }
            seq8_ilog(inst, "SEQ8 transport: deactivate_all");
        }
        return;
    }

    /* --- DSP-side count-in --- */
    if (!strcmp(key, "record_count_in")) {
        int track = clamp_i(my_atoi(val), 0, NUM_TRACKS - 1);
        inst->count_in_track = (uint8_t)track;
        inst->count_in_ticks = 4 * PPQN;  /* 1 bar; tick_delta already tracks actual BPM */
        return;
    }
    if (!strcmp(key, "record_count_in_cancel")) {
        inst->count_in_ticks = 0;
        return;
    }

    /* --- Active track --- */
    if (!strcmp(key, "active_track")) {
        inst->active_track = (uint8_t)clamp_i(my_atoi(val), 0, NUM_TRACKS - 1);
        return;
    }

    if (!strcmp(key, "bpm")) {
        double bpm = (double)my_atoi(val);
        if (bpm < 40.0 || bpm > 250.0) return;
        inst->tick_delta = (uint32_t)((double)MOVE_FRAMES_PER_BLOCK * bpm * (double)PPQN);
        int tb;
        for (tb = 0; tb < NUM_TRACKS; tb++)
            inst->tracks[tb].pfx.cached_bpm = bpm;
        return;
    }

    /* --- Global pad tonality --- */
    if (!strcmp(key, "key")) {
        inst->pad_key = (uint8_t)clamp_i(my_atoi(val), 0, 11);
        return;
    }
    if (!strcmp(key, "scale")) {
        inst->pad_scale = (uint8_t)clamp_i(my_atoi(val), 0, 13);
        return;
    }
    if (!strcmp(key, "scale_aware")) {
        inst->scale_aware = my_atoi(val) ? 1 : 0;
        return;
    }
    if (!strcmp(key, "inp_quant")) {
        inst->inp_quant = my_atoi(val) ? 1 : 0;
        return;
    }
    if (!strcmp(key, "input_vel")) {
        inst->input_vel = (uint8_t)clamp_i(my_atoi(val), 0, 127);
        return;
    }
    if (!strcmp(key, "launch_quant")) {
        uint8_t old_q = inst->launch_quant;
        uint8_t new_q = (uint8_t)clamp_i(my_atoi(val), 0, 5);
        inst->launch_quant = new_q;
        /* Switching to Now while transport running: fire all queued clips immediately */
        if (new_q == 0 && old_q != 0 && inst->playing) {
            int t;
            for (t = 0; t < NUM_TRACKS; t++) {
                seq8_track_t *tr2 = &inst->tracks[t];
                if (tr2->queued_clip >= 0) {
                    uint16_t newlen = tr2->clips[tr2->queued_clip].length;
                    tr2->current_step     = tr2->clip_playing
                                           ? (uint16_t)(tr2->current_step % newlen)
                                           : (uint16_t)(inst->global_tick % newlen);
                    tr2->active_clip      = (uint8_t)tr2->queued_clip;
                    tr2->clip_playing     = 1;
                    tr2->queued_clip      = -1;
                    tr2->pending_page_stop = 0;
                }
            }
        }
        return;
    }
    if (!strcmp(key, "debug_log")) {
        seq8_ilog(inst, val);
        return;
    }

    if (!strcmp(key, "save")) {
        seq8_save_state(inst);
        return;
    }

    if (!strcmp(key, "state_path")) {
        strncpy(inst->state_path, val, sizeof(inst->state_path) - 1);
        inst->state_path[sizeof(inst->state_path) - 1] = '\0';
        seq8_ilog(inst, inst->state_path);
        return;
    }

    if (!strcmp(key, "state_load")) {
        /* val is the UUID from JS (36 chars); construct path from it. Fallback if empty. */
        if (val && val[0])
            snprintf(inst->state_path, sizeof(inst->state_path),
                     "/data/UserData/schwung/set_state/%s/seq8-state.json", val);
        else
            strncpy(inst->state_path, SEQ8_STATE_PATH_FALLBACK,
                    sizeof(inst->state_path) - 1);
        seq8_ilog(inst, inst->state_path);
        /* Reset internal state without MIDI panic to avoid flooding the MIDI buffer. */
        {
            int t2, c2;
            inst->playing        = 0;
            inst->count_in_ticks = 0;
            for (t2 = 0; t2 < NUM_TRACKS; t2++) {
                seq8_track_t *tr2 = &inst->tracks[t2];
                tr2->note_active         = 0;
                tr2->pending_note_count  = 0;
                tr2->pfx.event_count     = 0;
                memset(tr2->pfx.active_notes, 0, sizeof(tr2->pfx.active_notes));
                tr2->clip_playing        = 0;
                tr2->will_relaunch       = 0;
                tr2->pending_page_stop   = 0;
                tr2->record_armed        = 0;
                tr2->recording           = 0;
                tr2->queued_clip         = -1;
                tr2->active_clip         = 0;
                tr2->current_step        = 0;
                tr2->step_dispatch_mask  = 0;
                tr2->next_early_mask     = 0;
                for (c2 = 0; c2 < NUM_CLIPS; c2++)
                    clip_init(&tr2->clips[c2]);
            }
        }
        seq8_load_state(inst);
        return;
    }

    /* --- Scene launch (global): all tracks to clip M --- */
    if (!strcmp(key, "launch_scene")) {
        int cidx = clamp_i(my_atoi(val), 0, NUM_CLIPS - 1);
        int t;
        if (inst->launch_quant == 0 && inst->playing) {
            /* Now + transport running: fire per-track immediately */
            for (t = 0; t < NUM_TRACKS; t++) {
                seq8_track_t *tr2 = &inst->tracks[t];
                uint16_t newlen = tr2->clips[cidx].length;
                tr2->current_step     = tr2->clip_playing
                                       ? (uint16_t)(tr2->current_step % newlen)
                                       : (uint16_t)(inst->global_tick % newlen);
                tr2->active_clip      = (uint8_t)cidx;
                tr2->clip_playing     = 1;
                tr2->queued_clip      = -1;
                tr2->pending_page_stop = 0;
                tr2->will_relaunch    = 0;
            }
        } else {
            /* Quantized or stopped: queue at next boundary */
            for (t = 0; t < NUM_TRACKS; t++) {
                if (inst->tracks[t].clip_playing)
                    inst->tracks[t].pending_page_stop = 1;
                inst->tracks[t].queued_clip   = (int8_t)cidx;
                inst->tracks[t].will_relaunch = 0;
            }
        }
        seq8_ilog(inst, "SEQ8 launch_scene");
        return;
    }

    if (!strcmp(key, "mute_all_clear")) {
        int t;
        for (t = 0; t < NUM_TRACKS; t++) {
            inst->mute[t] = 0;
            inst->solo[t] = 0;
        }
        return;
    }

    if (!strcmp(key, "snap_save")) {
        /* Format: "N m0..m7 s0..s7" (space-separated 0/1 values) */
        const char *p = val;
        int n = 0, t, v;
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') n = n * 10 + (*p++ - '0');
        if (n < 0 || n >= 16) return;
        for (t = 0; t < NUM_TRACKS; t++) {
            while (*p == ' ') p++;
            v = 0;
            while (*p >= '0' && *p <= '9') v = v * 10 + (*p++ - '0');
            inst->snap_mute[n][t] = v ? 1 : 0;
        }
        for (t = 0; t < NUM_TRACKS; t++) {
            while (*p == ' ') p++;
            v = 0;
            while (*p >= '0' && *p <= '9') v = v * 10 + (*p++ - '0');
            inst->snap_solo[n][t] = v ? 1 : 0;
        }
        inst->snap_valid[n] = 1;
        return;
    }

    if (!strcmp(key, "snap_load")) {
        int n = my_atoi(val), t;
        if (n < 0 || n >= 16 || !inst->snap_valid[n]) return;
        for (t = 0; t < NUM_TRACKS; t++) {
            inst->mute[t] = inst->snap_mute[n][t];
            inst->solo[t] = inst->snap_solo[n][t];
        }
        silence_muted_tracks(inst);
        return;
    }

    if (!strcmp(key, "clip_copy")) {
        const char *p = val;
        int nums[4], i;
        for (i = 0; i < 4; i++) {
            while (*p == ' ') p++;
            nums[i] = 0;
            while (*p >= '0' && *p <= '9') nums[i] = nums[i]*10 + (*p++ - '0');
        }
        {
            int srcT = clamp_i(nums[0], 0, NUM_TRACKS-1);
            int srcC = clamp_i(nums[1], 0, NUM_CLIPS-1);
            int dstT = clamp_i(nums[2], 0, NUM_TRACKS-1);
            int dstC = clamp_i(nums[3], 0, NUM_CLIPS-1);
            clip_t *src = &inst->tracks[srcT].clips[srcC];
            clip_t *dst = &inst->tracks[dstT].clips[dstC];
            if (srcT == dstT && srcC == dstC) return;
            dst->length = src->length;
            memcpy(dst->steps, src->steps, SEQ_STEPS);
            memcpy(dst->step_notes, src->step_notes, SEQ_STEPS * 8);
            memcpy(dst->step_note_count, src->step_note_count, SEQ_STEPS);
            memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
            dst->active = src->active;
        }
        return;
    }

    if (!strcmp(key, "row_copy")) {
        const char *p = val;
        int srcRow = 0, dstRow = 0, t;
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') srcRow = srcRow*10 + (*p++ - '0');
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') dstRow = dstRow*10 + (*p++ - '0');
        srcRow = clamp_i(srcRow, 0, NUM_CLIPS-1);
        dstRow = clamp_i(dstRow, 0, NUM_CLIPS-1);
        if (srcRow == dstRow) return;
        for (t = 0; t < NUM_TRACKS; t++) {
            clip_t *src = &inst->tracks[t].clips[srcRow];
            clip_t *dst = &inst->tracks[t].clips[dstRow];
            dst->length = src->length;
            memcpy(dst->steps, src->steps, SEQ_STEPS);
            memcpy(dst->step_notes, src->step_notes, SEQ_STEPS * 8);
            memcpy(dst->step_note_count, src->step_note_count, SEQ_STEPS);
            memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
            dst->active = src->active;
        }
        return;
    }

    if (!strcmp(key, "row_clear")) {
        int rowIdx = clamp_i(my_atoi(val), 0, NUM_CLIPS-1);
        int t, i;
        for (t = 0; t < NUM_TRACKS; t++) {
            clip_t *cl = &inst->tracks[t].clips[rowIdx];
            for (i = 0; i < SEQ_STEPS; i++) {
                cl->steps[i] = 0;
                memset(cl->step_notes[i], 0, 8);
                cl->step_note_count[i] = 0;
                memset(cl->note_tick_offset[i], 0, 8 * sizeof(int16_t));
            }
            cl->active = 0;
        }
        return;
    }

    /* --- Track-prefixed params: tN_<subkey> --- */
    if (key[0] == 't' && key[1] >= '0' && key[1] <= '7' && key[2] == '_') {
        int tidx = key[1] - '0';
        const char *sub = key + 3;
        seq8_track_t *tr = &inst->tracks[tidx];

        /* tN_launch_clip: Now=immediate, quantized=queue at next boundary */
        if (!strcmp(sub, "launch_clip")) {
            int new_cidx = clamp_i(my_atoi(val), 0, NUM_CLIPS - 1);
            if (inst->launch_quant == 0 && (tr->clip_playing || inst->playing)) {
                /* Now + transport active: fire immediately */
                uint16_t newlen = tr->clips[new_cidx].length;
                tr->current_step     = tr->clip_playing
                                       ? (uint16_t)(tr->current_step % newlen)
                                       : (uint16_t)(inst->global_tick % newlen);
                tr->active_clip      = (uint8_t)new_cidx;
                tr->clip_playing     = 1;
                tr->queued_clip      = -1;
                tr->pending_page_stop = 0;
                tr->will_relaunch    = 0;
            } else {
                /* Quantized or stopped: queue for next boundary */
                tr->queued_clip   = (int8_t)new_cidx;
                tr->will_relaunch = 0;
            }
            return;
        }

        /* tN_stop_at_end: arm track to stop at next 16-step page boundary */
        if (!strcmp(sub, "stop_at_end")) {
            tr->pending_page_stop = 1;
            return;
        }

        /* tN_deactivate: cancel all pending/playing state immediately */
        if (!strcmp(sub, "deactivate")) {
            tr->clip_playing        = 0;
            tr->will_relaunch       = 0;
            tr->queued_clip         = -1;
            tr->pending_page_stop   = 0;
            tr->record_armed        = 0;
            tr->step_dispatch_mask  = 0;
            tr->next_early_mask     = 0;
            return;
        }

        /* tN_mute: set mute state; setting mute clears solo on same track */
        if (!strcmp(sub, "mute")) {
            inst->mute[tidx] = (val[0] == '1') ? 1 : 0;
            if (inst->mute[tidx]) inst->solo[tidx] = 0;
            silence_muted_tracks(inst);
            return;
        }

        /* tN_solo: set solo state; setting solo clears mute on same track */
        if (!strcmp(sub, "solo")) {
            inst->solo[tidx] = (val[0] == '1') ? 1 : 0;
            if (inst->solo[tidx]) inst->mute[tidx] = 0;
            silence_muted_tracks(inst);
            return;
        }

        /* tN_channel: set MIDI channel for this track (1-indexed in, 0-indexed stored) */
        if (!strcmp(sub, "channel")) {
            tr->channel = (uint8_t)clamp_i(my_atoi(val) - 1, 0, 15);
            return;
        }

        /* tN_route: set MIDI routing for this track */
        if (!strcmp(sub, "route")) {
            if (!strcmp(val, "schwung"))
                tr->pfx.route = ROUTE_SCHWUNG;
            else if (!strcmp(val, "move"))
                tr->pfx.route = ROUTE_MOVE;
            return;
        }

        /* tN_cM_step_S or tN_cM_length: clip data */
        if (sub[0] == 'c' && sub[1] >= '0' && sub[1] <= '9') {
            int cidx = 0;
            const char *p = sub + 1;
            while (*p >= '0' && *p <= '9') { cidx = cidx * 10 + (*p - '0'); p++; }
            if (cidx >= NUM_CLIPS) return;
            clip_t *cl = &tr->clips[cidx];

            if (!strncmp(p, "_step_", 6)) {
                const char *q = p + 6;
                int sidx = 0;
                while (*q >= '0' && *q <= '9') { sidx = sidx * 10 + (*q++ - '0'); }
                if (sidx < 0 || sidx >= SEQ_STEPS) return;

                if (*q == '\0') {
                    /* tN_cC_step_S — legacy on/off: reactivate/deactivate without touching notes.
                     * Safety: deny activation if step has no notes (prevents invariant violation). */
                    if (val[0] == '1') {
                        if (cl->step_note_count[sidx] > 0) cl->steps[sidx] = 1;
                    } else {
                        cl->steps[sidx] = 0;
                    }
                    {
                        int i, any = 0;
                        for (i = 0; i < SEQ_STEPS; i++) if (cl->steps[i]) { any = 1; break; }
                        cl->active = (uint8_t)any;
                    }
                    clip_migrate_to_notes(cl);
                    return;
                }

                if (!strcmp(q, "_toggle")) {
                    /* tN_cC_step_S_toggle val="note [velocity [0..127]]"
                     * If note present: remove it. If absent and room: add it.
                     * Activates/deactivates step as count crosses 0.
                     * On first note added to empty step: sets step_vel from optional field. */
                    const char *tp = val;
                    int note = clamp_i(my_atoi(tp), 0, 127);
                    while (*tp && *tp != ' ') tp++;
                    int tvel = (*tp == ' ') ? clamp_i(my_atoi(tp + 1), 0, 127) : SEQ_VEL;
                    int has_tvel = (*tp == ' ');
                    int n, found = -1;
                    for (n = 0; n < (int)cl->step_note_count[sidx]; n++) {
                        if (cl->step_notes[sidx][n] == (uint8_t)note) { found = n; break; }
                    }
                    if (found >= 0) {
                        /* remove: shift remaining notes and offsets down */
                        for (n = found; n < (int)cl->step_note_count[sidx] - 1; n++) {
                            cl->step_notes[sidx][n] = cl->step_notes[sidx][n + 1];
                            cl->note_tick_offset[sidx][n] = cl->note_tick_offset[sidx][n + 1];
                        }
                        cl->step_notes[sidx][cl->step_note_count[sidx] - 1] = 0;
                        cl->note_tick_offset[sidx][cl->step_note_count[sidx] - 1] = 0;
                        cl->step_note_count[sidx]--;
                        if (cl->step_note_count[sidx] == 0)
                            cl->steps[sidx] = 0;
                    } else if (cl->step_note_count[sidx] < 8) {
                        int was_empty = (cl->step_note_count[sidx] == 0);
                        int ni2 = (int)cl->step_note_count[sidx];
                        cl->step_notes[sidx][ni2] = (uint8_t)note;
                        cl->note_tick_offset[sidx][ni2] = 0;
                        cl->step_note_count[sidx]++;
                        if (cl->step_note_count[sidx] == 1)
                            cl->steps[sidx] = 1;
                        if (was_empty && has_tvel)
                            cl->step_vel[sidx] = (uint8_t)tvel;
                    }
                    /* else: 8-note limit reached — silent no-op */
                    {
                        int i, any = 0;
                        for (i = 0; i < SEQ_STEPS; i++) if (cl->steps[i]) { any = 1; break; }
                        cl->active = (uint8_t)any;
                    }
                    clip_migrate_to_notes(cl);
                    return;
                }

                if (!strcmp(q, "_add")) {
                    /* tN_cC_step_S_add val="p1 o1 v1 [p2 o2 v2 ...]"
                     * One or more space-separated note triplets (pitch offset velocity).
                     * Add-only per note; vel on first note of empty step sets step_vel. */
                    const char *p = val;
                    int any_added = 0;
                    while (*p) {
                        while (*p == ' ') p++;
                        if (!*p) break;
                        int note = clamp_i(my_atoi(p), 0, 127);
                        while (*p && *p != ' ') p++;
                        int offset_val = 0, vel_val = SEQ_VEL, has_vel = 0;
                        if (*p == ' ') {
                            p++;
                            offset_val = clamp_i(my_atoi(p), -(TICKS_PER_STEP-1), (TICKS_PER_STEP-1));
                            while (*p && *p != ' ') p++;
                            if (*p == ' ') {
                                p++;
                                vel_val = clamp_i(my_atoi(p), 0, 127);
                                has_vel = 1;
                                while (*p && *p != ' ') p++;
                            }
                        }
                        int n, found = 0;
                        for (n = 0; n < (int)cl->step_note_count[sidx]; n++) {
                            if (cl->step_notes[sidx][n] == (uint8_t)note) { found = 1; break; }
                        }
                        if (!found && cl->step_note_count[sidx] < 8) {
                            int ni2 = (int)cl->step_note_count[sidx];
                            int was_empty = (ni2 == 0);
                            cl->step_notes[sidx][ni2] = (uint8_t)note;
                            cl->note_tick_offset[sidx][ni2] = (int16_t)offset_val;
                            cl->step_note_count[sidx]++;
                            if (cl->step_note_count[sidx] == 1) cl->steps[sidx] = 1;
                            if (was_empty && has_vel) cl->step_vel[sidx] = (uint8_t)vel_val;
                            any_added = 1;
                        }
                    }
                    if (any_added) {
                        int i, any = 0;
                        for (i = 0; i < SEQ_STEPS; i++) if (cl->steps[i]) { any = 1; break; }
                        cl->active = (uint8_t)any;
                        if (tr->recording) LRS_SET(tr, sidx);
                        clip_migrate_to_notes(cl);
                    }
                    return;
                }

                if (!strcmp(q, "_clear")) {
                    /* tN_cC_step_S_clear — atomically deactivate step and wipe all step data */
                    cl->steps[sidx] = 0;
                    memset(cl->step_notes[sidx], 0, 8);
                    cl->step_note_count[sidx] = 0;
                    cl->step_vel[sidx]        = (uint8_t)SEQ_VEL;
                    cl->step_gate[sidx]       = (uint16_t)GATE_TICKS;
                    memset(cl->note_tick_offset[sidx], 0, 8 * sizeof(int16_t));
                    {
                        int i, any = 0;
                        for (i = 0; i < SEQ_STEPS; i++) if (cl->steps[i]) { any = 1; break; }
                        cl->active = (uint8_t)any;
                    }
                    clip_migrate_to_notes(cl);
                    return;
                }
                if (!strcmp(q, "_vel")) {
                    if (!cl->steps[sidx]) return;
                    cl->step_vel[sidx] = (uint8_t)clamp_i(my_atoi(val), 0, 127);
                    clip_migrate_to_notes(cl);
                    if (!tr->recording) seq8_save_state(inst);
                    return;
                }
                if (!strcmp(q, "_gate")) {
                    if (!cl->steps[sidx]) return;
                    cl->step_gate[sidx] = (uint16_t)clamp_i(my_atoi(val), 1, SEQ_STEPS * TICKS_PER_STEP);
                    clip_migrate_to_notes(cl);
                    if (!tr->recording) seq8_save_state(inst);
                    return;
                }
                if (!strcmp(q, "_nudge")) {
                    if (!cl->steps[sidx] || cl->step_note_count[sidx] == 0) return;
                    int new_val = clamp_i(my_atoi(val), -(TICKS_PER_STEP-1), (TICKS_PER_STEP-1));
                    int delta = new_val - (int)cl->note_tick_offset[sidx][0];
                    int ni;
                    for (ni = 0; ni < (int)cl->step_note_count[sidx]; ni++) {
                        int o = (int)cl->note_tick_offset[sidx][ni] + delta;
                        cl->note_tick_offset[sidx][ni] = (int16_t)clamp_i(o, -(TICKS_PER_STEP-1), (TICKS_PER_STEP-1));
                    }
                    clip_migrate_to_notes(cl);
                    if (!tr->recording) seq8_save_state(inst);
                    return;
                }
                if (!strcmp(q, "_pitch")) {
                    if (!cl->steps[sidx]) return;
                    int delta = my_atoi(val), n;
                    for (n = 0; n < (int)cl->step_note_count[sidx]; n++)
                        cl->step_notes[sidx][n] = (uint8_t)clamp_i(
                            (int)cl->step_notes[sidx][n] + delta, 0, 127);
                    clip_migrate_to_notes(cl);
                    if (!tr->recording) seq8_save_state(inst);
                    return;
                }
                if (!strcmp(q, "_set_notes")) {
                    if (!cl->steps[sidx]) return;
                    int notes[8], cnt = 0;
                    const char *np = val;
                    while (*np && cnt < 8) {
                        while (*np == ' ') np++;
                        if (!*np) break;
                        int note = 0;
                        while (*np >= '0' && *np <= '9') note = note * 10 + (*np++ - '0');
                        notes[cnt++] = clamp_i(note, 0, 127);
                    }
                    if (cnt > 0) {
                        int i;
                        cl->step_note_count[sidx] = (uint8_t)cnt;
                        for (i = 0; i < cnt; i++) cl->step_notes[sidx][i] = (uint8_t)notes[i];
                        for (i = cnt; i < 8; i++) {
                            cl->step_notes[sidx][i] = 0;
                            cl->note_tick_offset[sidx][i] = 0;
                        }
                        clip_migrate_to_notes(cl);
                        if (!tr->recording) seq8_save_state(inst);
                    }
                    return;
                }
                return;
            }
            if (!strncmp(p, "_length", 7)) {
                cl->length = (uint16_t)clamp_i(my_atoi(val), 1, SEQ_STEPS);
                clip_migrate_to_notes(cl);
                return;
            }
            if (!strncmp(p, "_clear", 6) && p[6] == '\0') {
                /* tN_cC_clear — atomically wipe all steps in clip */
                int i;
                for (i = 0; i < SEQ_STEPS; i++) {
                    cl->steps[i] = 0;
                    memset(cl->step_notes[i], 0, 8);
                    cl->step_note_count[i] = 0;
                    memset(cl->note_tick_offset[i], 0, 8 * sizeof(int16_t));
                }
                cl->active = 0;
                cl->note_count = 0;
                memset(cl->notes, 0, sizeof(cl->notes));
                cl->occ_dirty = 1;
                /* Deactivate track if the cleared clip is active or queued */
                if ((int)tr->active_clip == cidx) {
                    silence_track_notes_v2(inst, tr);
                    tr->clip_playing      = 0;
                    tr->will_relaunch     = 0;
                    tr->queued_clip       = -1;
                    tr->pending_page_stop = 0;
                    tr->record_armed      = 0;
                    tr->recording         = 0;
                } else if (tr->queued_clip == cidx) {
                    tr->queued_clip = -1;
                }
                seq8_save_state(inst);
                return;
            }
            return;
        }

        /* tN_pad_octave / tN_pad_mode */
        if (!strcmp(sub, "pad_octave")) {
            tr->pad_octave = (uint8_t)clamp_i(my_atoi(val), 0, 8);
            return;
        }
        if (!strcmp(sub, "pad_mode")) {
            tr->pad_mode = (uint8_t)clamp_i(my_atoi(val), 0, 0);
            return;
        }

        if (!strcmp(sub, "recording")) {
            int rv = my_atoi(val);
            if (rv) {
                /* Fresh recording session: clear pass mask so existing notes play back */
                memset(tr->live_recorded_steps, 0, 32);
                if (tr->clip_playing) {
                    tr->recording = 1;
                } else if (tr->queued_clip >= 0) {
                    tr->record_armed = 1;
                } else {
                    tr->recording = 1;
                }
            } else {
                finalize_pending_notes(&tr->clips[tr->active_clip], tr);
                clip_clear_suppress(&tr->clips[tr->active_clip]);
                tr->recording    = 0;
                tr->record_armed = 0;
            }
            return;
        }

        if (!strcmp(sub, "record_note_on")) {
            /* tN_record_note_on "p1 v1 [p2 v2 ...]"
             * JS batches all chord note-ons into one call to survive set_param coalescing.
             * DSP snapshots current_clip_tick once and inserts all notes at the same tick. */
            if (!tr->recording) return;
            clip_t *cl = &tr->clips[tr->active_clip];

            /* Snapshot tick once for the whole chord */
            uint32_t abs_tick = tr->current_clip_tick;
            uint32_t clip_ticks = (uint32_t)cl->length * TICKS_PER_STEP;
            if (clip_ticks == 0) return;
            abs_tick = abs_tick % clip_ticks;
            if (inst->inp_quant)
                abs_tick = (abs_tick / TICKS_PER_STEP) * TICKS_PER_STEP;

            const char *sp = val;
            while (*sp) {
                while (*sp == ' ') sp++;
                if (!*sp) break;

                int pitch = 0;
                while (*sp >= '0' && *sp <= '9') { pitch = pitch * 10 + (*sp++ - '0'); }
                pitch = clamp_i(pitch, 0, 127);

                while (*sp == ' ') sp++;
                int vel = SEQ_VEL;
                if (*sp >= '0' && *sp <= '9') {
                    vel = 0;
                    while (*sp >= '0' && *sp <= '9') { vel = vel * 10 + (*sp++ - '0'); }
                    vel = clamp_i(vel, 0, 127);
                }
                if (inst->input_vel > 0) vel = (int)inst->input_vel;

                int ni = clip_insert_note(cl, abs_tick, (uint16_t)GATE_TICKS,
                                          (uint8_t)pitch, (uint8_t)vel);
                if (ni >= 0) {
                    cl->notes[ni].suppress_until_wrap = 1;
                    if (tr->rec_pending_count < 10) {
                        int ri = (int)tr->rec_pending_count;
                        tr->rec_pending[ri].pitch      = (uint8_t)pitch;
                        tr->rec_pending[ri].tick_at_on = abs_tick;
                        tr->rec_pending_count++;
                    }
                }

                /* Mirror to step arrays */
                {
                    uint16_t sidx = (uint16_t)(abs_tick / TICKS_PER_STEP);
                    int16_t  off  = (int16_t)((int32_t)abs_tick
                                              - (int32_t)sidx * TICKS_PER_STEP);
                    if (sidx < SEQ_STEPS) {
                        if (!cl->steps[sidx] && cl->step_note_count[sidx] > 0) {
                            int si;
                            for (si = 0; si < 8; si++) {
                                cl->step_notes[sidx][si] = 0;
                                cl->note_tick_offset[sidx][si] = 0;
                            }
                            cl->step_note_count[sidx] = 0;
                            cl->step_vel[sidx]  = (uint8_t)SEQ_VEL;
                            cl->step_gate[sidx] = (uint16_t)GATE_TICKS;
                        }
                        if (cl->step_note_count[sidx] < 8) {
                            int ni2 = (int)cl->step_note_count[sidx];
                            if (ni2 == 0) {
                                cl->step_vel[sidx]  = (uint8_t)vel;
                                cl->step_gate[sidx] = (uint16_t)GATE_TICKS;
                            }
                            cl->step_notes[sidx][ni2]          = (uint8_t)pitch;
                            cl->note_tick_offset[sidx][ni2]    = off;
                            cl->step_note_count[sidx]++;
                            cl->steps[sidx] = 1;
                            cl->active      = 1;
                            LRS_SET(tr, sidx);
                        }
                    }
                }
            }
            return;
        }

        if (!strcmp(sub, "record_note_off")) {
            /* tN_record_note_off "p1 [p2 ...]"
             * JS batches simultaneous chord releases into one call.
             * DSP snapshots off_tick once and updates gate for each pitch. */
            if (!tr->recording) return;
            clip_t *cl = &tr->clips[tr->active_clip];

            uint32_t off_tick = tr->current_clip_tick;
            uint32_t clip_ticks = (uint32_t)cl->length * TICKS_PER_STEP;
            if (clip_ticks == 0) return;
            off_tick = off_tick % clip_ticks;

            const char *sp = val;
            while (*sp) {
                while (*sp == ' ') sp++;
                if (!*sp) break;

                int pitch = 0;
                while (*sp >= '0' && *sp <= '9') { pitch = pitch * 10 + (*sp++ - '0'); }
                pitch = clamp_i(pitch, 0, 127);

                /* Find matching rec_pending entry */
                int ri;
                for (ri = 0; ri < (int)tr->rec_pending_count; ri++) {
                    if (tr->rec_pending[ri].pitch == (uint8_t)pitch) break;
                }
                if (ri >= (int)tr->rec_pending_count) continue;

                uint32_t on_tick = tr->rec_pending[ri].tick_at_on;

                uint32_t gate_ticks;
                if (off_tick >= on_tick)
                    gate_ticks = off_tick - on_tick;
                else
                    gate_ticks = clip_ticks - on_tick + off_tick;
                if (gate_ticks < 1) gate_ticks = 1;
                if (gate_ticks > (uint32_t)SEQ_STEPS * TICKS_PER_STEP)
                    gate_ticks = (uint32_t)SEQ_STEPS * TICKS_PER_STEP;

                /* Update matching note_t gate (scan from newest) */
                {
                    uint16_t ni2;
                    for (ni2 = (uint16_t)(cl->note_count > 0 ? cl->note_count - 1 : 0);
                         ni2 < cl->note_count; ni2--) {
                        note_t *n = &cl->notes[ni2];
                        if (n->active && n->pitch == (uint8_t)pitch
                                && n->suppress_until_wrap && n->tick == on_tick) {
                            n->gate = (uint16_t)gate_ticks;
                            break;
                        }
                        if (ni2 == 0) break;
                    }
                }

                /* Mirror gate to step arrays */
                {
                    uint16_t sidx = (uint16_t)(on_tick / TICKS_PER_STEP);
                    if (sidx < SEQ_STEPS && cl->steps[sidx])
                        cl->step_gate[sidx] = (uint16_t)gate_ticks;
                }

                /* Remove rec_pending slot */
                tr->rec_pending[ri] = tr->rec_pending[tr->rec_pending_count - 1];
                tr->rec_pending_count--;
            }
            return;
        }

        if (!strcmp(sub, "clip_length")) {
            clip_t *cl = &tr->clips[tr->active_clip];
            cl->length = (uint16_t)clamp_i(my_atoi(val), 1, SEQ_STEPS);
            if (tr->current_step >= cl->length)
                tr->current_step = (uint16_t)(cl->length - 1);
            return;
        }

        if (!strcmp(sub, "clock_shift")) {
            int dir = my_atoi(val);
            clip_t *cl = &tr->clips[tr->active_clip];
            int len = (int)cl->length;
            if (len < 2) return;
            uint8_t tmp_s, tmp_nc, tmp_ns[8], tmp_v;
            uint16_t tmp_g;
            int16_t tmp_toff[8];
            if (dir == 1) {
                tmp_s    = cl->steps[len-1];
                memcpy(tmp_ns, cl->step_notes[len-1], 8);
                tmp_nc   = cl->step_note_count[len-1];
                tmp_v    = cl->step_vel[len-1];
                tmp_g    = cl->step_gate[len-1];
                memcpy(tmp_toff, cl->note_tick_offset[len-1], 8 * sizeof(int16_t));
                memmove(&cl->steps[1],              &cl->steps[0],              (size_t)(len-1));
                memmove(&cl->step_notes[1][0],      &cl->step_notes[0][0],      (size_t)(len-1) * 8);
                memmove(&cl->step_note_count[1],    &cl->step_note_count[0],    (size_t)(len-1));
                memmove(&cl->step_vel[1],           &cl->step_vel[0],           (size_t)(len-1));
                memmove(&cl->step_gate[1],          &cl->step_gate[0],          (size_t)(len-1) * 2);
                memmove(&cl->note_tick_offset[1][0], &cl->note_tick_offset[0][0], (size_t)(len-1) * 8 * sizeof(int16_t));
                cl->steps[0]           = tmp_s;
                memcpy(cl->step_notes[0], tmp_ns, 8);
                cl->step_note_count[0] = tmp_nc;
                cl->step_vel[0]        = tmp_v;
                cl->step_gate[0]       = tmp_g;
                memcpy(cl->note_tick_offset[0], tmp_toff, 8 * sizeof(int16_t));
                cl->clock_shift_pos = (uint16_t)((cl->clock_shift_pos + 1) % (uint16_t)len);
            } else {
                tmp_s    = cl->steps[0];
                memcpy(tmp_ns, cl->step_notes[0], 8);
                tmp_nc   = cl->step_note_count[0];
                tmp_v    = cl->step_vel[0];
                tmp_g    = cl->step_gate[0];
                memcpy(tmp_toff, cl->note_tick_offset[0], 8 * sizeof(int16_t));
                memmove(&cl->steps[0],              &cl->steps[1],              (size_t)(len-1));
                memmove(&cl->step_notes[0][0],      &cl->step_notes[1][0],      (size_t)(len-1) * 8);
                memmove(&cl->step_note_count[0],    &cl->step_note_count[1],    (size_t)(len-1));
                memmove(&cl->step_vel[0],           &cl->step_vel[1],           (size_t)(len-1));
                memmove(&cl->step_gate[0],          &cl->step_gate[1],          (size_t)(len-1) * 2);
                memmove(&cl->note_tick_offset[0][0], &cl->note_tick_offset[1][0], (size_t)(len-1) * 8 * sizeof(int16_t));
                cl->steps[len-1]           = tmp_s;
                memcpy(cl->step_notes[len-1], tmp_ns, 8);
                cl->step_note_count[len-1] = tmp_nc;
                cl->step_vel[len-1]        = tmp_v;
                cl->step_gate[len-1]       = tmp_g;
                memcpy(cl->note_tick_offset[len-1], tmp_toff, 8 * sizeof(int16_t));
                cl->clock_shift_pos = (uint16_t)((cl->clock_shift_pos + (uint16_t)(len-1)) % (uint16_t)len);
            }
            int i, any = 0;
            for (i = 0; i < len; i++) if (cl->steps[i]) { any = 1; break; }
            cl->active = (uint8_t)any;
            clip_migrate_to_notes(cl);
            return;
        }

        if (!strcmp(sub, "beat_stretch")) {
            int dir = my_atoi(val);
            clip_t *cl = &tr->clips[tr->active_clip];
            int len = (int)cl->length;
            int i, ni2, new_len, any;
            uint8_t  tmp_steps[SEQ_STEPS];
            uint8_t  tmp_notes[SEQ_STEPS][8];
            uint8_t  tmp_nc[SEQ_STEPS];
            uint8_t  tmp_vel[SEQ_STEPS];
            uint16_t tmp_gate[SEQ_STEPS];
            int16_t  tmp_tick_offset[SEQ_STEPS][8];
            /* gate cap: clip_length_steps * TICKS_PER_STEP (max uint16_t, no overflow risk) */
#define GATE_MAX (SEQ_STEPS * TICKS_PER_STEP)

            if (dir == 1) {
                /* EXPAND x2: clamp if doubling would exceed 256 steps */
                if (len * 2 > SEQ_STEPS) return;
                new_len = len * 2;
                for (i = len - 1; i >= 1; i--) {
                    int ng = (int)cl->step_gate[i] * 2;
                    if (ng > GATE_MAX) ng = GATE_MAX;
                    cl->steps[i*2]           = cl->steps[i];
                    memcpy(cl->step_notes[i*2], cl->step_notes[i], 8);
                    cl->step_note_count[i*2] = cl->step_note_count[i];
                    cl->step_vel[i*2]        = cl->step_vel[i];
                    cl->step_gate[i*2]       = (uint16_t)ng;
                    for (ni2 = 0; ni2 < 8; ni2++) {
                        int nt = (int)cl->note_tick_offset[i][ni2] * 2;
                        if (nt > 23) nt = 23; else if (nt < -23) nt = -23;
                        cl->note_tick_offset[i*2][ni2] = (int16_t)nt;
                    }
                    cl->steps[i] = 0;
                }
                /* step 0 stays, scale its gate and offsets too */
                {
                    int ng = (int)cl->step_gate[0] * 2;
                    if (ng > GATE_MAX) ng = GATE_MAX;
                    cl->step_gate[0] = (uint16_t)ng;
                    for (ni2 = 0; ni2 < 8; ni2++) {
                        int nt = (int)cl->note_tick_offset[0][ni2] * 2;
                        if (nt > 23) nt = 23; else if (nt < -23) nt = -23;
                        cl->note_tick_offset[0][ni2] = (int16_t)nt;
                    }
                }
                for (i = 1; i < new_len; i += 2) {
                    cl->steps[i]           = 0;
                    memset(cl->step_notes[i], 0, 8);
                    cl->step_note_count[i] = 0;
                    cl->step_vel[i]        = SEQ_VEL;
                    cl->step_gate[i]       = GATE_TICKS;
                    memset(cl->note_tick_offset[i], 0, 8 * sizeof(int16_t));
                }
                cl->length = (uint16_t)new_len;
                cl->stretch_exp++;
                tr->stretch_blocked = 0;
            } else {
                /* COMPRESS /2: dry-run collision check — abort entirely if any two
                 * active steps would map to the same destination position. */
                if (len < 2) return;
                {
                    uint8_t seen[SEQ_STEPS];
                    memset(seen, 0, sizeof(seen));
                    for (i = 0; i < len; i++) {
                        if (cl->steps[i]) {
                            int dst = i / 2;
                            if (seen[dst]) {
                                tr->stretch_blocked = 1;
                                return;
                            }
                            seen[dst] = 1;
                        }
                    }
                }
                tr->stretch_blocked = 0;
                new_len = len / 2;
                memset(tmp_steps, 0, sizeof(tmp_steps));
                for (i = 0; i < SEQ_STEPS; i++) {
                    memset(tmp_notes[i], 0, 8);
                    tmp_nc[i]   = 0;
                    tmp_vel[i]  = SEQ_VEL;
                    tmp_gate[i] = GATE_TICKS;
                    memset(tmp_tick_offset[i], 0, 8 * sizeof(int16_t));
                }
                for (i = 0; i < len; i++) {
                    if (cl->steps[i]) {
                        int dst = i / 2;
                        if (!tmp_steps[dst]) {
                            int ng = ((int)cl->step_gate[i] + 1) / 2;
                            if (ng < 1) ng = 1;
                            tmp_steps[dst] = 1;
                            memcpy(tmp_notes[dst], cl->step_notes[i], 8);
                            tmp_nc[dst]   = cl->step_note_count[i];
                            tmp_vel[dst]  = cl->step_vel[i];
                            tmp_gate[dst] = (uint16_t)ng;
                            for (ni2 = 0; ni2 < 8; ni2++) {
                                int nt = (int)cl->note_tick_offset[i][ni2] / 2;
                                tmp_tick_offset[dst][ni2] = (int16_t)nt;
                            }
                        }
                    }
                }
                memcpy(cl->steps,           tmp_steps,       sizeof(tmp_steps));
                memcpy(cl->step_notes,      tmp_notes,       sizeof(tmp_notes));
                memcpy(cl->step_note_count, tmp_nc,          sizeof(tmp_nc));
                memcpy(cl->step_vel,        tmp_vel,         sizeof(tmp_vel));
                memcpy(cl->step_gate,       tmp_gate,        sizeof(tmp_gate));
                memcpy(cl->note_tick_offset, tmp_tick_offset, sizeof(tmp_tick_offset));
                cl->length = (uint16_t)new_len;
                cl->stretch_exp--;
            }
#undef GATE_MAX

            if (tr->current_step >= cl->length)
                tr->current_step = (uint16_t)(cl->length - 1);

            any = 0;
            for (i = 0; i < (int)cl->length; i++)
                if (cl->steps[i]) { any = 1; break; }
            cl->active = (uint8_t)any;
            clip_migrate_to_notes(cl);

            return;
        }

        /* All play effects params */
        pfx_set(inst, tr, sub, val);
        return;
    }
}

/* ------------------------------------------------------------------ */
/* get_param helpers                                                    */
/* ------------------------------------------------------------------ */

static int pfx_get(seq8_track_t *tr, const char *key, char *out, int out_len) {
    play_fx_t *fx = &tr->pfx;

    if (!strcmp(key, "channel"))
        return snprintf(out, out_len, "%d", (int)tr->channel + 1);

    if (!strcmp(key, "route"))
        return snprintf(out, out_len, "%s",
                        fx->route == ROUTE_MOVE ? "move" : "schwung");

    if (!strcmp(key, "noteFX_octave"))    return snprintf(out, out_len, "%d", fx->octave_shift);
    if (!strcmp(key, "noteFX_offset"))    return snprintf(out, out_len, "%d", fx->note_offset);
    if (!strcmp(key, "noteFX_gate"))      return snprintf(out, out_len, "%d", fx->gate_time);
    if (!strcmp(key, "noteFX_velocity"))  return snprintf(out, out_len, "%d", fx->velocity_offset);
    if (!strcmp(key, "quantize"))         return snprintf(out, out_len, "%d", fx->quantize);

    if (!strcmp(key, "harm_unison")) {
        static const char *ul[3] = { "OFF", "x2", "x3" };
        return snprintf(out, out_len, "%s", ul[fx->unison]);
    }
    if (!strcmp(key, "harm_octaver"))     return snprintf(out, out_len, "%d", fx->octaver);
    if (!strcmp(key, "harm_interval1"))   return snprintf(out, out_len, "%d", fx->harmonize_1);
    if (!strcmp(key, "harm_interval2"))   return snprintf(out, out_len, "%d", fx->harmonize_2);

    if (!strcmp(key, "delay_time"))         return snprintf(out, out_len, "%d", fx->delay_time_idx);
    if (!strcmp(key, "delay_level"))        return snprintf(out, out_len, "%d", fx->delay_level);
    if (!strcmp(key, "delay_repeats"))      return snprintf(out, out_len, "%d", fx->repeat_times);
    if (!strcmp(key, "delay_vel_fb"))       return snprintf(out, out_len, "%d", fx->fb_velocity);
    if (!strcmp(key, "delay_pitch_fb"))     return snprintf(out, out_len, "%d", fx->fb_note);
    if (!strcmp(key, "delay_pitch_random")) return snprintf(out, out_len, "%s",
                                                fx->fb_note_random ? "on" : "off");
    if (!strcmp(key, "delay_gate_fb"))      return snprintf(out, out_len, "%d", fx->fb_gate_time);
    if (!strcmp(key, "delay_clock_fb"))     return snprintf(out, out_len, "%d", fx->fb_clock);

    return -1;
}

/* ------------------------------------------------------------------ */
/* get_param                                                            */
/* ------------------------------------------------------------------ */

static int get_param(void *instance, const char *key, char *out, int out_len) {
    seq8_instance_t *inst = (seq8_instance_t *)instance;
    if (!key || !out || out_len <= 0) return -1;

    if (!strcmp(key, "playing"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->playing : 0);
    if (!strcmp(key, "active_track"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->active_track : 0);
    if (!strcmp(key, "key"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->pad_key : 9);
    if (!strcmp(key, "scale"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->pad_scale : 0);
    if (!strcmp(key, "scale_aware"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->scale_aware : 0);
    if (!strcmp(key, "inp_quant"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->inp_quant : 0);
    if (!strcmp(key, "input_vel"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->input_vel : 0);
    if (!strcmp(key, "launch_quant"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->launch_quant : 0);
    if (!strcmp(key, "version"))
        return snprintf(out, out_len, "6");
    if (!strcmp(key, "instance_id"))
        return snprintf(out, out_len, "%u", inst ? inst->instance_nonce : 0);
    if (!strcmp(key, "state_uuid")) {
        /* Extract UUID from state_path: .../set_state/<UUID>/seq8-state.json */
        if (!inst) return snprintf(out, out_len, "");
        const char *p = strstr(inst->state_path, "/set_state/");
        if (p) {
            p += 11; /* strlen("/set_state/") */
            const char *end = strchr(p, '/');
            if (end && (end - p) > 0 && (end - p) < out_len) {
                int len = (int)(end - p);
                memcpy(out, p, (size_t)len);
                out[len] = '\0';
                return len;
            }
        }
        return snprintf(out, out_len, "");
    }
    if (!strcmp(key, "bpm")) {
        double b = (inst && inst->tracks[0].pfx.cached_bpm > 0)
                   ? inst->tracks[0].pfx.cached_bpm : (double)BPM_DEFAULT;
        return snprintf(out, out_len, "%.0f", b);
    }

    /* ext_queue: drain ROUTE_MOVE events buffered by DSP render path.
     * Returns "S D1 D2;S D1 D2;..." or "" if empty. Clears queue on read. */
    if (!strcmp(key, "ext_queue")) {
        if (!inst || inst->ext_head == inst->ext_tail)
            return snprintf(out, out_len, "");
        int pos = 0;
        while (inst->ext_tail != inst->ext_head) {
            ext_msg_t *m = &inst->ext_queue[inst->ext_tail];
            if (pos > 0) {
                if (pos < out_len - 1) out[pos++] = ';';
                else break;
            }
            int n = snprintf(out + pos, (size_t)(out_len - pos),
                             "%d %d %d", (int)m->s, (int)m->d1, (int)m->d2);
            if (n < 0 || pos + n >= out_len) break;
            pos += n;
            inst->ext_tail = (inst->ext_tail + 1) % EXT_QUEUE_SIZE;
        }
        return pos;
    }

    /* state_snapshot: single call returning all poll-loop values.
     * Format: "playing cs0..cs7 ac0..ac7 qc0..qc7 count_in cp0..cp7 wr0..wr7 ps0..ps7 flash_eighth flash_sixteenth"
     * 52 values total. Replaces individual get_param calls in pollDSP(). */
    if (!strcmp(key, "state_snapshot")) {
        if (!inst) return snprintf(out, out_len,
            "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1 -1 -1 -1 -1 -1 -1 -1 0"
            " 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0");
        int t;
        int pos = 0;
        pos += snprintf(out + pos, (size_t)(out_len - pos), "%d", (int)inst->playing);
        for (t = 0; t < NUM_TRACKS; t++)
            pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)inst->tracks[t].current_step);
        for (t = 0; t < NUM_TRACKS; t++)
            pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)inst->tracks[t].active_clip);
        for (t = 0; t < NUM_TRACKS; t++)
            pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)inst->tracks[t].queued_clip);
        pos += snprintf(out + pos, (size_t)(out_len - pos), " %d",
                        (int)(inst->count_in_ticks > 0 ? 1 : 0));
        for (t = 0; t < NUM_TRACKS; t++)
            pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)inst->tracks[t].clip_playing);
        for (t = 0; t < NUM_TRACKS; t++)
            pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)inst->tracks[t].will_relaunch);
        for (t = 0; t < NUM_TRACKS; t++)
            pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)inst->tracks[t].pending_page_stop);
        pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)((inst->global_tick / 2) % 2));
        pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)(inst->global_tick % 2));
        return pos;
    }

    if (!inst) return -1;

    /* Track-prefixed params: tN_<subkey> */
    if (key[0] == 't' && key[1] >= '0' && key[1] <= '7' && key[2] == '_') {
        int tidx = key[1] - '0';
        const char *sub = key + 3;
        seq8_track_t *tr = &inst->tracks[tidx];

        if (!strcmp(sub, "current_step"))
            return snprintf(out, out_len, "%d", (int)tr->current_step);
        if (!strcmp(sub, "active_clip"))
            return snprintf(out, out_len, "%d", (int)tr->active_clip);
        if (!strcmp(sub, "queued_clip"))
            return snprintf(out, out_len, "%d", (int)tr->queued_clip);
        if (!strcmp(sub, "pad_octave"))
            return snprintf(out, out_len, "%d", (int)tr->pad_octave);
        if (!strcmp(sub, "pad_mode"))
            return snprintf(out, out_len, "%d", (int)tr->pad_mode);
        if (!strcmp(sub, "clock_shift_pos"))
            return snprintf(out, out_len, "%d",
                            (int)tr->clips[tr->active_clip].clock_shift_pos);
        if (!strcmp(sub, "beat_stretch_factor")) {
            int exp = (int)tr->clips[tr->active_clip].stretch_exp;
            if (exp == 0) return snprintf(out, out_len, "1x");
            if (exp > 0)  return snprintf(out, out_len, "x%d", 1 << exp);
            return snprintf(out, out_len, "/%d", 1 << (-exp));
        }
        if (!strcmp(sub, "beat_stretch_blocked"))
            return snprintf(out, out_len, "%d", (int)tr->stretch_blocked);
        if (!strcmp(sub, "recording"))
            return snprintf(out, out_len, "%d", (int)tr->recording);
        if (!strcmp(sub, "clip_length"))
            return snprintf(out, out_len, "%d",
                            (int)tr->clips[tr->active_clip].length);
        if (!strcmp(sub, "note_count"))
            return snprintf(out, out_len, "%d",
                            (int)tr->clips[tr->active_clip].note_count);
        if (!strcmp(sub, "current_clip_tick"))
            return snprintf(out, out_len, "%u", (unsigned)tr->current_clip_tick);

        /* tN_cM_step_S / tN_cM_length / tN_cM_active */
        if (sub[0] == 'c' && sub[1] >= '0' && sub[1] <= '9') {
            int cidx = 0;
            const char *p = sub + 1;
            while (*p >= '0' && *p <= '9') { cidx = cidx * 10 + (*p - '0'); p++; }
            if (cidx >= NUM_CLIPS) return -1;
            clip_t *cl = &tr->clips[cidx];

            if (!strncmp(p, "_step_", 6)) {
                const char *q = p + 6;
                int sidx = 0;
                while (*q >= '0' && *q <= '9') { sidx = sidx * 10 + (*q++ - '0'); }
                if (sidx < 0 || sidx >= SEQ_STEPS) return -1;

                if (*q == '\0')
                    return snprintf(out, out_len, "%d", (int)cl->steps[sidx]);

                if (!strcmp(q, "_notes")) {
                    /* tN_cC_step_S_notes — space-separated MIDI note numbers */
                    int cnt = (int)cl->step_note_count[sidx];
                    if (cnt == 0) { out[0] = '\0'; return 0; }
                    int pos = 0, n;
                    for (n = 0; n < cnt; n++) {
                        if (n > 0 && pos < out_len - 1) out[pos++] = ' ';
                        pos += snprintf(out + pos, (size_t)(out_len - pos),
                                        "%d", (int)cl->step_notes[sidx][n]);
                    }
                    return pos;
                }
                if (!strcmp(q, "_vel"))
                    return snprintf(out, out_len, "%d", (int)cl->step_vel[sidx]);
                if (!strcmp(q, "_gate"))
                    return snprintf(out, out_len, "%d", (int)cl->step_gate[sidx]);
                if (!strcmp(q, "_nudge"))
                    return snprintf(out, out_len, "%d",
                        cl->step_note_count[sidx] > 0 ? (int)cl->note_tick_offset[sidx][0] : 0);
                return -1;
            }
            if (!strncmp(p, "_steps", 6) && p[6] == '\0') {
                if (out_len < SEQ_STEPS + 1) return -1;
                int s;
                for (s = 0; s < SEQ_STEPS; s++) out[s] = '0';
                uint16_t ni3;
                for (ni3 = 0; ni3 < cl->note_count; ni3++) {
                    note_t *n = &cl->notes[ni3];
                    if (!n->active) continue;
                    uint16_t sn = note_step(n->tick, cl->length);
                    if (sn >= SEQ_STEPS) continue;
                    if (!n->step_muted)
                        out[sn] = '1';
                    else if (out[sn] == '0')
                        out[sn] = '2';
                }
                out[SEQ_STEPS] = '\0';
                return SEQ_STEPS;
            }
            if (!strncmp(p, "_length", 7))
                return snprintf(out, out_len, "%d", (int)cl->length);
            if (!strncmp(p, "_active", 7))
                return snprintf(out, out_len, "%d", (int)cl->active);
            return -1;
        }

        return pfx_get(tr, sub, out, out_len);
    }

    /* mute_state / solo_state: 8-char binary strings */
    if (!strcmp(key, "mute_state")) {
        int t;
        for (t = 0; t < NUM_TRACKS && t < out_len - 1; t++)
            out[t] = inst->mute[t] ? '1' : '0';
        out[NUM_TRACKS] = '\0';
        return NUM_TRACKS;
    }
    if (!strcmp(key, "solo_state")) {
        int t;
        for (t = 0; t < NUM_TRACKS && t < out_len - 1; t++)
            out[t] = inst->solo[t] ? '1' : '0';
        out[NUM_TRACKS] = '\0';
        return NUM_TRACKS;
    }
    /* snap_N: "m0..m7 s0..s7" (17 chars) if valid, else "" */
    if (!strncmp(key, "snap_", 5)) {
        int n = my_atoi(key + 5), t, pos = 0;
        if (n >= 0 && n < 16) {
            if (!inst->snap_valid[n]) { out[0] = '\0'; return 0; }
            for (t = 0; t < NUM_TRACKS && pos < out_len - 1; t++)
                out[pos++] = inst->snap_mute[n][t] ? '1' : '0';
            if (pos < out_len - 1) out[pos++] = ' ';
            for (t = 0; t < NUM_TRACKS && pos < out_len - 1; t++)
                out[pos++] = inst->snap_solo[n][t] ? '1' : '0';
            out[pos] = '\0';
            return pos;
        }
    }

    return -1;
}

/* ------------------------------------------------------------------ */
/* get_error                                                            */
/* ------------------------------------------------------------------ */

static int get_error(void *instance, char *out, int out_len) {
    (void)instance; (void)out; (void)out_len;
    return 0;
}

/* ------------------------------------------------------------------ */
/* render_block helpers                                                 */
/* ------------------------------------------------------------------ */

/* Apply per-track quantize to a per-note raw tick_offset.
 * quantize=100 → always 0 (fully snapped); quantize=0 → raw offset unchanged. */
static int effective_note_offset(clip_t *cl, seq8_track_t *tr, uint16_t s, int ni) {
    int raw = (int)cl->note_tick_offset[s][ni];
    if (raw == 0 || tr->pfx.quantize >= 100) return 0;
    if (tr->pfx.quantize <= 0) return raw;
    return raw * (100 - tr->pfx.quantize) / 100;
}

/* Compute effective fire tick for a note_t in the note-centric model.
 * Quantize pulls tick toward step grid: q=100 → step grid, q=0 → raw tick. */
static uint32_t effective_note_tick(const note_t *n, const clip_t *cl, int quantize) {
    uint16_t sn = note_step(n->tick, cl->length);
    int32_t step_grid = (int32_t)sn * TICKS_PER_STEP;
    int32_t delta = (int32_t)n->tick - step_grid;
    int32_t eff_delta = (quantize >= 100) ? 0 : delta * (100 - quantize) / 100;
    int32_t eff_tick = step_grid + eff_delta;
    int32_t clip_ticks = (int32_t)cl->length * TICKS_PER_STEP;
    if (eff_tick < 0) eff_tick += clip_ticks;
    if (eff_tick >= clip_ticks) eff_tick -= clip_ticks;
    return (uint32_t)eff_tick;
}

/* Cut off all sounding notes and reset note state (legacy step-based path). */
static void silence_track_notes(seq8_instance_t *inst, seq8_track_t *tr) {
    if (tr->note_active) {
        int n;
        for (n = 0; n < (int)tr->pending_note_count; n++)
            pfx_note_off(inst, tr, tr->pending_notes[n]);
        tr->note_active        = 0;
        tr->pending_note_count = 0;
    }
}

/* Cut off all sounding notes via note-centric play_pending. */
static void silence_track_notes_v2(seq8_instance_t *inst, seq8_track_t *tr) {
    int pp;
    for (pp = 0; pp < (int)tr->play_pending_count; pp++)
        pfx_note_off(inst, tr, tr->play_pending[pp].pitch);
    tr->play_pending_count = 0;
    tr->note_active = 0;
    tr->pending_note_count = 0;
}

/* Start gate for step s and fire a single note ni immediately.
 * Assumes previous notes already silenced if needed.
 * Gate starts from when the FIRST note of the step fires (early-fired notes
 * carry their gate forward; later notes in the same step share the running gate).
 * This means early-fired notes sound from their fire tick through the full gate
 * duration, while positive-offset notes are slightly shorter. */
static void begin_step_note(seq8_instance_t *inst, seq8_track_t *tr,
                            clip_t *cl, uint16_t s, int ni) {
    if (!tr->note_active) {
        int eff = (int)cl->step_gate[s] * tr->pfx.gate_time / 100;
        if (eff < 1) eff = 1;
        tr->pending_gate         = (uint16_t)eff;
        tr->gate_ticks_remaining = tr->pending_gate;
        tr->note_active          = 1;
    }
    if (tr->pending_note_count < 8) {
        int pi = (int)tr->pending_note_count;
        tr->pending_notes[pi] = cl->step_notes[s][ni];
        tr->pending_note_count++;
        pfx_note_on(inst, tr, tr->pending_notes[pi], cl->step_vel[s]);
    }
}

/* ------------------------------------------------------------------ */
/* render_block                                                         */
/* ------------------------------------------------------------------ */

static void render_block(void *instance, int16_t *out_lr, int frames) {
    seq8_instance_t *inst = (seq8_instance_t *)instance;
    if (!inst) return;

    if (out_lr && frames > 0)
        memset(out_lr, 0, (size_t)frames * 2 * sizeof(int16_t));

    inst->block_count++;

    /* Advance sample counters and fire queued events for all tracks. */
    int t;
    for (t = 0; t < NUM_TRACKS; t++)
        inst->tracks[t].pfx.sample_counter += (uint64_t)frames;


    for (t = 0; t < NUM_TRACKS; t++)
        pfx_q_fire(&inst->tracks[t].pfx, inst->tracks[t].pfx.sample_counter);

    /* DSP-side count-in: tick down using same accumulator; fire transport+rec when done */
    if (inst->count_in_ticks > 0) {
        if (inst->tick_threshold > 0) {
            inst->tick_accum += inst->tick_delta;
            while (inst->tick_accum >= inst->tick_threshold && inst->count_in_ticks > 0) {
                inst->tick_accum -= inst->tick_threshold;
                inst->count_in_ticks--;
            }
            if (inst->count_in_ticks == 0) {
                inst->tick_accum   = 0;
                inst->tick_in_step = 0;
                inst->global_tick  = 0;
                for (t = 0; t < NUM_TRACKS; t++) {
                    inst->tracks[t].current_step      = 0;
                    inst->tracks[t].note_active        = 0;
                    inst->tracks[t].pfx.sample_counter = 0;
                    if (inst->tracks[t].will_relaunch) {
                        inst->tracks[t].clip_playing      = 1;
                        inst->tracks[t].will_relaunch     = 0;
                        inst->tracks[t].pending_page_stop = 0;
                    }
                }
                inst->playing = 1;
                inst->tracks[inst->count_in_track].recording   = 1;
                inst->tracks[inst->count_in_track].clip_playing = 1;
            }
        }
        return; /* skip main sequencer while counting in (or this block after fire) */
    }

    if (!inst->playing || inst->tick_threshold == 0) return;

    inst->tick_accum += inst->tick_delta;
    while (inst->tick_accum >= inst->tick_threshold) {
        inst->tick_accum -= inst->tick_threshold;

        for (t = 0; t < NUM_TRACKS; t++) {
            seq8_track_t *tr = &inst->tracks[t];
            clip_t *cl = &tr->clips[tr->active_clip];

            /* Gate countdown: decrement each play_pending slot; fire note-off at 0.
             * Runs before note-on so a gate expiring at step boundary doesn't double-fire. */
            {
                int pp;
                for (pp = 0; pp < (int)tr->play_pending_count; ) {
                    if (tr->play_pending[pp].ticks_remaining > 0)
                        tr->play_pending[pp].ticks_remaining--;
                    if (tr->play_pending[pp].ticks_remaining == 0) {
                        pfx_note_off(inst, tr, tr->play_pending[pp].pitch);
                        tr->play_pending[pp] = tr->play_pending[tr->play_pending_count - 1];
                        tr->play_pending_count--;
                    } else {
                        pp++;
                    }
                }
                tr->note_active = (tr->play_pending_count > 0) ? 1 : 0;
            }

            if (inst->tick_in_step == 0) {
                /* Quantized boundary: launch queued clip (only if not waiting for page stop) */
                if (tr->queued_clip >= 0 && !tr->pending_page_stop &&
                    inst->global_tick % QUANT_STEPS[inst->launch_quant] == 0) {
                    silence_track_notes_v2(inst, tr);
                    tr->active_clip  = (uint8_t)tr->queued_clip;
                    tr->queued_clip  = -1;
                    tr->current_step = 0;
                    tr->clip_playing = 1;
                    if (tr->record_armed) {
                        tr->recording    = 1;
                        tr->record_armed = 0;
                    }
                    cl = &tr->clips[tr->active_clip];
                }

                /* Page stop: silence at next main clock bar boundary (global_tick % 16).
                 * Anchored to main clock, not track step page. */
                if (tr->pending_page_stop && inst->global_tick % 16 == 0) {
                    tr->pending_page_stop = 0;
                    tr->clip_playing      = 0;
                    silence_track_notes_v2(inst, tr);
                    if (tr->queued_clip >= 0) {
                        tr->active_clip  = (uint8_t)tr->queued_clip;
                        tr->queued_clip  = -1;
                        tr->current_step = 0;
                        tr->clip_playing = 1;
                        if (tr->record_armed) {
                            tr->recording    = 1;
                            tr->record_armed = 0;
                        }
                        cl = &tr->clips[tr->active_clip];
                    }
                }
            }

            /* Note-centric note-on: scan notes[] for any note whose effective tick
             * matches current clip tick. Fires at the exact tick regardless of step
             * boundary — handles both positive offsets (deferred) and negative offsets
             * (early fire) without a dispatch mask or lookahead. */
            if (tr->clip_playing && !effective_mute(inst, t)) {
                uint32_t cct = (uint32_t)tr->current_step * TICKS_PER_STEP + inst->tick_in_step;
                uint16_t ni2;
                for (ni2 = 0; ni2 < cl->note_count; ni2++) {
                    note_t *n = &cl->notes[ni2];
                    if (!n->active || n->suppress_until_wrap || n->step_muted) continue;
                    if (effective_note_tick(n, cl, tr->pfx.quantize) != cct) continue;
                    /* Note stealing: if this pitch is already in play_pending, cut it now */
                    {
                        int pp;
                        for (pp = 0; pp < (int)tr->play_pending_count; pp++) {
                            if (tr->play_pending[pp].pitch == n->pitch) {
                                pfx_note_off(inst, tr, n->pitch);
                                tr->play_pending[pp] = tr->play_pending[tr->play_pending_count - 1];
                                tr->play_pending_count--;
                                break;
                            }
                        }
                    }
                    /* Gate */
                    int eff_gate = (int)n->gate * tr->pfx.gate_time / 100;
                    if (eff_gate < 1) eff_gate = 1;
                    if (tr->play_pending_count < 32) {
                        int pp_idx = (int)tr->play_pending_count;
                        tr->play_pending[pp_idx].pitch          = n->pitch;
                        tr->play_pending[pp_idx].ticks_remaining = (uint16_t)eff_gate;
                        tr->play_pending_count++;
                        tr->note_active = 1;
                    }
                    pfx_note_on(inst, tr, n->pitch, n->vel);
                }
            }
        }

        inst->tick_in_step++;
        if (inst->tick_in_step >= TICKS_PER_STEP) {
            inst->tick_in_step = 0;
            for (t = 0; t < NUM_TRACKS; t++) {
                seq8_track_t *tr = &inst->tracks[t];
                clip_t *cl = &tr->clips[tr->active_clip];
                if (tr->clip_playing) {
                    uint16_t ns2 = (uint16_t)((tr->current_step + 1) % cl->length);
                    if (ns2 == 0) {
                        /* Clip wrapped: clear suppress_until_wrap on all notes */
                        uint16_t ni2;
                        for (ni2 = 0; ni2 < cl->note_count; ni2++)
                            cl->notes[ni2].suppress_until_wrap = 0;
                        /* Also clear legacy LRS mask */
                        memset(tr->live_recorded_steps, 0, 32);
                    }
                    tr->current_step = ns2;
                }
            }
            inst->global_tick++;
        }
        /* Update per-track atomic tick snapshot for set_param timing reads */
        for (t = 0; t < NUM_TRACKS; t++) {
            seq8_track_t *tr = &inst->tracks[t];
            tr->current_clip_tick = (uint32_t)tr->current_step * TICKS_PER_STEP
                                    + inst->tick_in_step;
        }
    }
}

/* ------------------------------------------------------------------ */
/* API table                                                            */
/* ------------------------------------------------------------------ */

static plugin_api_v2_t g_api = {
    .api_version      = MOVE_PLUGIN_API_VERSION_2,
    .create_instance  = create_instance,
    .destroy_instance = destroy_instance,
    .on_midi          = on_midi,
    .set_param        = set_param,
    .get_param        = get_param,
    .get_error        = get_error,
    .render_block     = render_block,
};

plugin_api_v2_t *move_plugin_init_v2(const host_api_v1_t *host) {
    g_host = host;
    return &g_api;
}

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

#include "host/plugin_api_v1.h"

/* ------------------------------------------------------------------ */
/* Build constants                                                      */
/* ------------------------------------------------------------------ */

#define SEQ8_LOG_PATH      "/data/UserData/schwung/seq8.log"
#define SEQ8_STATE_PATH    "/data/UserData/schwung/seq8-state.json"

#define NUM_TRACKS          8
#define NUM_CLIPS           16

/* MIDI routing: where track output is delivered */
#define ROUTE_SCHWUNG  0   /* host->midi_send_internal → Schwung active chain */
#define ROUTE_MOVE     1   /* reserved — no confirmed multi-chain path exists */

/* Pad input modes */
#define PAD_MODE_MELODIC_SCALE  0   /* isomorphic 4ths diatonic layout */

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
#define BPM_CACHE_INTERVAL  512

/* 1 SEQ8 tick = 480/96 = 5 clocks at 480 PPQN (NoteTwist's resolution) */
#define TICKS_TO_480PPQN    5

/* CLOCK_VALUES: delay intervals in 480 PPQN clocks (from NoteTwist) */
static const int CLOCK_VALUES[NUM_CLOCK_VALUES] = {
    0, 30, 60, 80, 120, 160, 240, 320, 480, 960, 1920
};


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
    int gate_time;          /* 0..200 percent */
    int velocity_offset;    /* -127..+127 */
    /* Harmonize (stage 2 from NoteTwist) */
    int unison;             /* 0=off, 1=x2, 2=x3 */
    int octaver;            /* -4..+4, 0=off */
    int harmonize_1;        /* -24..+24, 0=off */
    int harmonize_2;        /* -24..+24, 0=off */
    /* MIDI Delay (stage 5 from NoteTwist) */
    int delay_time_idx;     /* 0..10, index into CLOCK_VALUES */
    int delay_level;        /* 0..127 */
    int repeat_times;       /* 0..64 */
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
/* Clip and track structs                                               */
/* ------------------------------------------------------------------ */

typedef struct {
    uint8_t  steps[SEQ_STEPS];          /* 0=off, 1=on */
    uint8_t  step_notes[SEQ_STEPS][4]; /* up to 4 notes per step (chord); [0] = primary */
    uint8_t  step_note_count[SEQ_STEPS]; /* 0..4; 0 = step deactivated */
    uint8_t  step_vel[SEQ_STEPS];       /* default SEQ_VEL */
    uint8_t  step_gate[SEQ_STEPS];      /* gate ticks 1..GATE_TICKS (capped), applied at render */
    uint8_t  step_gate_orig[SEQ_STEPS]; /* original gate ticks before noteFX_gate scaling */
    uint16_t length;                    /* 1..256, default 16 */
    uint8_t  active;                    /* 1 if any step is on */
    /* Per-clip: cumulative rotation offset for display. Destructive — step
     * data is actually rotated; this counter tracks how far from "origin".
     * Range 0..length-1. Reset to 0 on transport stop (active clip only). */
    uint16_t clock_shift_pos;
    /* Stretch exponent: 0=1x, +1=x2, +2=x4, -1=/2, -2=/4. Not persisted. */
    int8_t   stretch_exp;
} clip_t;

typedef struct {
    uint8_t   channel;              /* MIDI channel 0-3 */
    clip_t    clips[NUM_CLIPS];
    uint8_t   active_clip;          /* clip currently playing */
    int8_t    queued_clip;          /* next clip (-1 = none) */
    uint16_t  current_step;
    uint8_t   note_active;
    uint8_t   pending_notes[4];     /* notes fired at note-on; matched at note-off */
    uint8_t   pending_note_count;   /* how many entries in pending_notes are valid */
    play_fx_t pfx;
    uint8_t   pad_octave;           /* live pad root octave (0-8, default 3) */
    uint8_t   pad_mode;             /* PAD_MODE_MELODIC_SCALE = 0 */
    uint8_t   stretch_blocked;      /* 1 if last compress was blocked by collision */
    uint8_t   recording;            /* 1 = actively recording (overdub) into active clip */
} seq8_track_t;

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

    /* DSP-side count-in: counts down in DSP ticks; fires transport+recording when done */
    int32_t  count_in_ticks;        /* remaining ticks; 0 = inactive */
    uint8_t  count_in_track;        /* track to arm for recording on fire */

    /* Print mode: bake chain output into step data */
    uint8_t  printing;

    /* Live pad input: global key/scale stored for state persistence */
    uint8_t  pad_key;               /* root key 0-11, default 9 (A) */
    uint8_t  pad_scale;             /* 0=minor, 1=major */
} seq8_instance_t;

static const host_api_v1_t *g_host = NULL;


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

static void seq8_save_state(seq8_instance_t *inst) {
    FILE *fp = fopen(SEQ8_STATE_PATH, "w");
    if (!fp) return;
    int t, c, s;
    fprintf(fp, "{\"v\":2,\"playing\":%d", inst->playing);
    for (t = 0; t < NUM_TRACKS; t++)
        fprintf(fp, ",\"t%d_ac\":%d", t, inst->tracks[t].active_clip);
    for (t = 0; t < NUM_TRACKS; t++) {
        for (c = 0; c < NUM_CLIPS; c++) {
            clip_t *cl = &inst->tracks[t].clips[c];
            /* steps[] on/off string */
            fprintf(fp, ",\"t%dc%d\":\"", t, c);
            for (s = 0; s < SEQ_STEPS; s++)
                fputc(cl->steps[s] ? '1' : '0', fp);
            fputc('"', fp);
            fprintf(fp, ",\"t%dc%d_len\":%d", t, c, (int)cl->length);
            /* sparse step notes — emit any step with count > 0 (count=0 is default) */
            int has_nondefault = 0;
            for (s = 0; s < SEQ_STEPS; s++) {
                if (cl->step_note_count[s] != 0) { has_nondefault = 1; break; }
            }
            if (has_nondefault) {
                int n;
                fprintf(fp, ",\"t%dc%d_sn\":\"", t, c);
                for (s = 0; s < SEQ_STEPS; s++) {
                    if (cl->step_note_count[s] == 0)
                        continue;
                    fprintf(fp, "%d:", s);
                    for (n = 0; n < (int)cl->step_note_count[s]; n++) {
                        if (n > 0) fputc(',', fp);
                        fprintf(fp, "%d", (int)cl->step_notes[s][n]);
                    }
                    fputc(';', fp);
                }
                fputc('"', fp);
            }
        }
    }
    fprintf(fp, "}");
    fclose(fp);
}

static void seq8_load_state(seq8_instance_t *inst) {
    FILE *fp = fopen(SEQ8_STATE_PATH, "r");
    if (!fp) return;
    fseek(fp, 0, SEEK_END);
    long fsz = ftell(fp);
    fseek(fp, 0, SEEK_SET);
    if (fsz <= 0) { fclose(fp); remove(SEQ8_STATE_PATH); return; }
    char *buf = (char *)malloc((size_t)fsz + 1);
    if (!buf) { fclose(fp); return; }
    size_t n = fread(buf, 1, (size_t)fsz, fp);
    fclose(fp);
    if (!n) { free(buf); remove(SEQ8_STATE_PATH); return; }
    buf[n] = '\0';

    /* Version gate: delete and ignore any state file that isn't v=2. */
    if (json_get_int(buf, "v", -1) != 2) {
        free(buf);
        remove(SEQ8_STATE_PATH);
        seq8_ilog(inst, "SEQ8 state: wrong version, deleted");
        return;
    }

    int t, c, i;
    char key[32];
    for (t = 0; t < NUM_TRACKS; t++) {
        snprintf(key, sizeof(key), "t%d_ac", t);
        inst->tracks[t].active_clip = (uint8_t)clamp_i(
            json_get_int(buf, key, 0), 0, NUM_CLIPS - 1);

        for (c = 0; c < NUM_CLIPS; c++) {
            snprintf(key, sizeof(key), "t%dc%d", t, c);
            json_get_steps(buf, key, inst->tracks[t].clips[c].steps, SEQ_STEPS);

            snprintf(key, sizeof(key), "t%dc%d_len", t, c);
            inst->tracks[t].clips[c].length = (uint16_t)clamp_i(
                json_get_int(buf, key, SEQ_STEPS_DEFAULT), 1, SEQ_STEPS);

            int any = 0;
            for (i = 0; i < SEQ_STEPS; i++)
                if (inst->tracks[t].clips[c].steps[i]) { any = 1; break; }
            inst->tracks[t].clips[c].active = (uint8_t)any;

            /* sparse step notes — absent key means all steps use clip_init defaults */
            {
                char search[40];
                snprintf(search, sizeof(search), "\"t%dc%d_sn\":\"", t, c);
                const char *p = strstr(buf, search);
                if (p) {
                    p += strlen(search);
                    clip_t *cl = &inst->tracks[t].clips[c];
                    while (*p && *p != '"') {
                        int sidx = 0;
                        while (*p >= '0' && *p <= '9')
                            sidx = sidx * 10 + (*p++ - '0');
                        if (*p != ':') break;
                        p++;
                        if (sidx < 0 || sidx >= SEQ_STEPS) {
                            while (*p && *p != ';' && *p != '"') p++;
                            if (*p == ';') p++;
                            continue;
                        }
                        int cnt = 0;
                        while (*p && *p != ';' && *p != '"') {
                            int note = 0;
                            while (*p >= '0' && *p <= '9')
                                note = note * 10 + (*p++ - '0');
                            if (cnt < 4)
                                cl->step_notes[sidx][cnt++] =
                                    (uint8_t)clamp_i(note, 0, 127);
                            if (*p == ',') p++;
                        }
                        cl->step_note_count[sidx] = (uint8_t)cnt;
                        for (i = cnt; i < 4; i++)
                            cl->step_notes[sidx][i] = 0;
                        if (*p == ';') p++;
                    }
                }
            }
        }
    }
    free(buf);
    seq8_ilog(inst, "SEQ8 state restored from file");
}

/* ------------------------------------------------------------------ */
/* MIDI output helpers                                                  */
/* ------------------------------------------------------------------ */

/* Send 3-byte MIDI message to the active Schwung chain.
 * All routes (SCHWUNG and MOVE) use midi_send_internal — no confirmed API
 * exists to route to multiple chains independently. ROUTE_MOVE is reserved.
 *
 * CRITICAL: never call midi_send_external from this path. pfx_send is
 * invoked from render_block (audio thread); SPI I/O is blocking and will
 * cause audio cracking and deadlock suspend_overtake on shutdown. */
static void pfx_send(play_fx_t *fx, uint8_t status, uint8_t d1, uint8_t d2) {
    (void)fx;
    if (!g_host || !g_host->midi_send_internal) return;
    const uint8_t msg[4] = { (uint8_t)(status >> 4), status, d1, d2 };
    g_host->midi_send_internal(msg, 4);
}

/* Brute-force note-off for all 128 notes on all active channels.
 * Routes through pfx_send so ROUTE_MOVE tracks panic on the correct bus. */
static void send_panic(seq8_instance_t *inst) {
    int t, n;
    for (t = 0; t < NUM_TRACKS; t++) {
        for (n = 0; n < 128; n++)
            pfx_send(&inst->tracks[t].pfx, (uint8_t)(0x80 | t), (uint8_t)n, 0);
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
/* Generated-note list (direct port from NoteTwist)                    */
/* ------------------------------------------------------------------ */

static int pfx_build_gen_notes(play_fx_t *fx, int orig_note, uint8_t *out) {
    int cnt = 0;
    int n = orig_note + fx->octave_shift * 12 + fx->note_offset;
    n = clamp_i(n, 0, 127);
    out[cnt++] = (uint8_t)n;

    if (fx->octaver != 0) {
        int o = n + fx->octaver * 12;
        if (o >= 0 && o <= 127 && cnt < MAX_GEN_NOTES) out[cnt++] = (uint8_t)o;
    }
    if (fx->harmonize_1 != 0) {
        int h = n + fx->harmonize_1;
        if (h >= 0 && h <= 127 && cnt < MAX_GEN_NOTES) out[cnt++] = (uint8_t)h;
    }
    if (fx->harmonize_2 != 0) {
        int h = n + fx->harmonize_2;
        if (h >= 0 && h <= 127 && cnt < MAX_GEN_NOTES) out[cnt++] = (uint8_t)h;
    }
    return cnt;
}

/* ------------------------------------------------------------------ */
/* Delay repeat scheduling (direct port from NoteTwist)                */
/* ------------------------------------------------------------------ */

static void pfx_sched_delay_ons(play_fx_t *fx, pfx_active_t *an,
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
    int    rep_vel   = (int)an->orig_velocity * fx->delay_level / 127;

    int i;
    for (i = 0; i < reps; i++) {
        cumul += cur_delay;
        if ((uint64_t)(cumul + 0.5) > MAX_DELAY_SAMPLES) {
            an->stored_repeat_count = i;
            break;
        }

        if (fx->fb_note_random)
            cumul_pitch += pfx_rand(fx, -12, 12);
        else
            cumul_pitch += fx->fb_note;
        an->reps[i].pitch_offset = (int8_t)clamp_i(cumul_pitch, -127, 127);

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

    uint8_t gen[MAX_GEN_NOTES];
    int gc = pfx_build_gen_notes(fx, (int)orig_note, gen);

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
    pfx_sched_delay_ons(fx, an, now, sp);

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
        cl->steps[s]             = 0;
        cl->step_notes[s][0]     = 0;
        cl->step_notes[s][1]     = 0;
        cl->step_notes[s][2]     = 0;
        cl->step_notes[s][3]     = 0;
        cl->step_note_count[s]   = 0;
        cl->step_vel[s]          = SEQ_VEL;
        cl->step_gate[s]         = GATE_TICKS;
        cl->step_gate_orig[s]    = GATE_TICKS;
    }
}

static void *create_instance(const char *module_dir, const char *json_defaults) {
    (void)module_dir; (void)json_defaults;

    seq8_instance_t *inst = (seq8_instance_t *)calloc(1, sizeof(seq8_instance_t));
    if (!inst) return NULL;

    inst->sample_rate    = (g_host && g_host->sample_rate > 0)
                           ? (float)g_host->sample_rate : 44100.0f;
    inst->log_fp         = fopen(SEQ8_LOG_PATH, "a");

    inst->pad_key   = 9;   /* A */
    inst->pad_scale = 0;   /* minor */

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
    inst->tick_delta     = (uint32_t)MOVE_FRAMES_PER_BLOCK
                           * (uint32_t)BPM_DEFAULT
                           * (uint32_t)PPQN;

    seq8_load_state(inst);  /* Option C: restore clips/active_clip from file if present */

    char szlog[80];
    snprintf(szlog, sizeof(szlog),
             "SEQ8 Phase 5 init: sizeof(seq8_instance_t)=%zu",
             sizeof(seq8_instance_t));
    seq8_ilog(inst, szlog);
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
    seq8_ilog(inst, "SEQ8 instance destroyed");
    if (inst->log_fp) fclose(inst->log_fp);
    free(inst);
}

/* ------------------------------------------------------------------ */
/* on_midi (external MIDI input — log only)                            */
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
        int pct = clamp_i(my_atoi(val), 0, 400);
        fx->gate_time = pct;
        {
            clip_t *cl = &tr->clips[tr->active_clip];
            int s;
            for (s = 0; s < (int)cl->length; s++) {
                if (cl->steps[s]) {
                    int g = (int)cl->step_gate_orig[s] * pct / 100;
                    if (g < 1) g = 1;
                    if (g > GATE_TICKS) g = GATE_TICKS;
                    cl->step_gate[s] = (uint8_t)g;
                }
            }
        }
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
        { fx->repeat_times   = clamp_i(my_atoi(val), 0, 64);     return; }
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
                for (t = 0; t < NUM_TRACKS; t++) {
                    inst->tracks[t].current_step = 0;
                    inst->tracks[t].note_active   = 0;
                    inst->tracks[t].pfx.sample_counter = 0;
                }
                inst->playing      = 1;
                inst->tick_accum   = 0;
                inst->tick_in_step = 0;
            }
        } else if (!strcmp(val, "stop")) {
            if (inst->playing) {
                int t;
                for (t = 0; t < NUM_TRACKS; t++) {
                    inst->tracks[t].note_active         = 0;
                    inst->tracks[t].pending_note_count  = 0;
                    inst->tracks[t].queued_clip         = -1;
                    inst->tracks[t].pfx.event_count     = 0;
                    memset(inst->tracks[t].pfx.active_notes, 0,
                           sizeof(inst->tracks[t].pfx.active_notes));
                    inst->tracks[t].clips[inst->tracks[t].active_clip].clock_shift_pos = 0;
                    inst->tracks[t].recording           = 0;
                }
                inst->playing        = 0;
                inst->count_in_ticks = 0;
                send_panic(inst);
                seq8_ilog(inst, "SEQ8 transport: stop");
                seq8_save_state(inst);
            }
        } else if (!strcmp(val, "panic")) {
            int t;
            for (t = 0; t < NUM_TRACKS; t++) {
                inst->tracks[t].note_active         = 0;
                inst->tracks[t].pending_note_count  = 0;
                inst->tracks[t].queued_clip         = -1;
                inst->tracks[t].pfx.event_count     = 0;
                memset(inst->tracks[t].pfx.active_notes, 0,
                       sizeof(inst->tracks[t].pfx.active_notes));
                inst->tracks[t].clips[inst->tracks[t].active_clip].clock_shift_pos = 0;
                inst->tracks[t].recording           = 0;
            }
            inst->playing        = 0;
            inst->count_in_ticks = 0;
            send_panic(inst);
            seq8_ilog(inst, "SEQ8 transport: panic");
            seq8_save_state(inst);
        }
        return;
    }

    /* --- DSP-side count-in --- */
    if (!strcmp(key, "record_count_in")) {
        int track = clamp_i(my_atoi(val), 0, NUM_TRACKS - 1);
        double bpm = inst->tracks[0].pfx.cached_bpm > 0
                     ? inst->tracks[0].pfx.cached_bpm : (double)BPM_DEFAULT;
        /* tick_delta is fixed at BPM_DEFAULT; scale bar duration to actual BPM */
        inst->count_in_track = (uint8_t)track;
        inst->count_in_ticks = (int32_t)((double)(4 * PPQN * BPM_DEFAULT) / bpm + 0.5);
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

    /* --- Global pad tonality --- */
    if (!strcmp(key, "key")) {
        inst->pad_key = (uint8_t)clamp_i(my_atoi(val), 0, 11);
        return;
    }
    if (!strcmp(key, "scale")) {
        inst->pad_scale = (uint8_t)clamp_i(my_atoi(val), 0, 1);
        return;
    }
    if (!strcmp(key, "debug_log")) {
        seq8_ilog(inst, val);
        return;
    }

    /* --- Scene launch (global): switch all tracks to clip M immediately --- */
    if (!strcmp(key, "launch_scene")) {
        int cidx = clamp_i(my_atoi(val), 0, NUM_CLIPS - 1);
        int t;
        for (t = 0; t < NUM_TRACKS; t++) {
            uint16_t newlen = inst->tracks[t].clips[cidx].length;
            inst->tracks[t].current_step = (uint16_t)(inst->tracks[t].current_step % newlen);
            inst->tracks[t].active_clip  = (uint8_t)cidx;
            inst->tracks[t].queued_clip  = -1;
        }
        seq8_ilog(inst, "SEQ8 launch_scene");
        seq8_save_state(inst);
        return;
    }

    /* --- Track-prefixed params: tN_<subkey> --- */
    if (key[0] == 't' && key[1] >= '0' && key[1] <= '7' && key[2] == '_') {
        int tidx = key[1] - '0';
        const char *sub = key + 3;
        seq8_track_t *tr = &inst->tracks[tidx];

        /* tN_launch_clip: switch to clip immediately, inheriting playback position */
        if (!strcmp(sub, "launch_clip")) {
            int new_cidx      = clamp_i(my_atoi(val), 0, NUM_CLIPS - 1);
            uint16_t newlen   = tr->clips[new_cidx].length;
            tr->current_step  = (uint16_t)(tr->current_step % newlen);
            tr->active_clip  = (uint8_t)new_cidx;
            tr->queued_clip  = -1;
            seq8_save_state(inst);
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
                    /* tN_cC_step_S — legacy on/off toggle */
                    cl->steps[sidx] = (val[0] == '1') ? 1 : 0;
                    if (cl->steps[sidx]) {
                        int g = (int)GATE_TICKS * tr->pfx.gate_time / 100;
                        if (g < 1) g = 1;
                        if (g > GATE_TICKS) g = GATE_TICKS;
                        cl->step_gate_orig[sidx] = GATE_TICKS;
                        cl->step_gate[sidx]      = (uint8_t)g;
                    }
                    int i, any = 0;
                    for (i = 0; i < SEQ_STEPS; i++) if (cl->steps[i]) { any = 1; break; }
                    cl->active = (uint8_t)any;
                    seq8_save_state(inst);
                    return;
                }

                if (!strcmp(q, "_toggle")) {
                    /* tN_cC_step_S_toggle val=<note 0-127>
                     * If note present: remove it. If absent and room: add it.
                     * Activates/deactivates step as count crosses 0. */
                    int note = clamp_i(my_atoi(val), 0, 127);
                    int n, found = -1;
                    for (n = 0; n < (int)cl->step_note_count[sidx]; n++) {
                        if (cl->step_notes[sidx][n] == (uint8_t)note) { found = n; break; }
                    }
                    if (found >= 0) {
                        /* remove: shift remaining notes down */
                        for (n = found; n < (int)cl->step_note_count[sidx] - 1; n++)
                            cl->step_notes[sidx][n] = cl->step_notes[sidx][n + 1];
                        cl->step_notes[sidx][cl->step_note_count[sidx] - 1] = 0;
                        cl->step_note_count[sidx]--;
                        if (cl->step_note_count[sidx] == 0)
                            cl->steps[sidx] = 0;
                    } else if (cl->step_note_count[sidx] < 4) {
                        /* add: write note+count BEFORE activating step to avoid render-thread race */
                        cl->step_notes[sidx][cl->step_note_count[sidx]] = (uint8_t)note;
                        cl->step_note_count[sidx]++;
                        if (cl->step_note_count[sidx] == 1)
                            cl->steps[sidx] = 1;
                    }
                    /* else: 4-note limit reached — silent no-op */
                    {
                        int i, any = 0;
                        for (i = 0; i < SEQ_STEPS; i++) if (cl->steps[i]) { any = 1; break; }
                        cl->active = (uint8_t)any;
                    }
                    seq8_save_state(inst);
                    return;
                }

                if (!strcmp(q, "_add")) {
                    /* tN_cC_step_S_add val=<note 0-127>
                     * Add-only: no-op if note already present or step has 4 notes.
                     * Used for overdub recording — never removes existing notes.
                     * Skips seq8_save_state when track is recording (deferred to disarm). */
                    int note = clamp_i(my_atoi(val), 0, 127);
                    int n, found = 0;
                    for (n = 0; n < (int)cl->step_note_count[sidx]; n++) {
                        if (cl->step_notes[sidx][n] == (uint8_t)note) { found = 1; break; }
                    }
                    if (!found && cl->step_note_count[sidx] < 4) {
                        /* write note+count BEFORE activating step to avoid render-thread race */
                        cl->step_notes[sidx][cl->step_note_count[sidx]] = (uint8_t)note;
                        cl->step_note_count[sidx]++;
                        if (cl->step_note_count[sidx] == 1)
                            cl->steps[sidx] = 1;
                        {
                            int i, any = 0;
                            for (i = 0; i < SEQ_STEPS; i++) if (cl->steps[i]) { any = 1; break; }
                            cl->active = (uint8_t)any;
                        }
                        if (!tr->recording)
                            seq8_save_state(inst);
                    }
                    return;
                }

                if (!strcmp(q, "_clear")) {
                    /* tN_cC_step_S_clear — atomically deactivate step and wipe all note data */
                    cl->steps[sidx] = 0;
                    cl->step_notes[sidx][0] = 0;
                    cl->step_notes[sidx][1] = 0;
                    cl->step_notes[sidx][2] = 0;
                    cl->step_notes[sidx][3] = 0;
                    cl->step_note_count[sidx] = 0;
                    {
                        int i, any = 0;
                        for (i = 0; i < SEQ_STEPS; i++) if (cl->steps[i]) { any = 1; break; }
                        cl->active = (uint8_t)any;
                    }
                    seq8_save_state(inst);
                    return;
                }
                return;
            }
            if (!strncmp(p, "_length", 7)) {
                cl->length = (uint16_t)clamp_i(my_atoi(val), 1, SEQ_STEPS);
                return;
            }
            if (!strncmp(p, "_clear", 6) && p[6] == '\0') {
                /* tN_cC_clear — atomically wipe all steps in clip */
                int i;
                for (i = 0; i < SEQ_STEPS; i++) {
                    cl->steps[i] = 0;
                    cl->step_notes[i][0] = 0;
                    cl->step_notes[i][1] = 0;
                    cl->step_notes[i][2] = 0;
                    cl->step_notes[i][3] = 0;
                    cl->step_note_count[i] = 0;
                }
                cl->active = 0;
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
            int v = my_atoi(val);
            tr->recording = (uint8_t)(v ? 1 : 0);
            if (!tr->recording)
                seq8_save_state(inst); /* flush deferred writes on disarm */
            return;
        }

        if (!strcmp(sub, "clip_length")) {
            clip_t *cl = &tr->clips[tr->active_clip];
            cl->length = (uint16_t)clamp_i(my_atoi(val), 1, SEQ_STEPS);
            if (tr->current_step >= cl->length)
                tr->current_step = (uint16_t)(cl->length - 1);
            seq8_save_state(inst);
            return;
        }

        if (!strcmp(sub, "clock_shift")) {
            int dir = my_atoi(val);
            clip_t *cl = &tr->clips[tr->active_clip];
            int len = (int)cl->length;
            if (len < 2) return;
            uint8_t tmp_s, tmp_nc, tmp_ns[4], tmp_v, tmp_g, tmp_go;
            if (dir == 1) {
                tmp_s  = cl->steps[len-1];
                memcpy(tmp_ns, cl->step_notes[len-1], 4);
                tmp_nc = cl->step_note_count[len-1];
                tmp_v  = cl->step_vel[len-1];
                tmp_g  = cl->step_gate[len-1];
                tmp_go = cl->step_gate_orig[len-1];
                memmove(&cl->steps[1],            &cl->steps[0],            (size_t)(len-1));
                memmove(&cl->step_notes[1][0],    &cl->step_notes[0][0],    (size_t)(len-1) * 4);
                memmove(&cl->step_note_count[1],  &cl->step_note_count[0],  (size_t)(len-1));
                memmove(&cl->step_vel[1],         &cl->step_vel[0],         (size_t)(len-1));
                memmove(&cl->step_gate[1],        &cl->step_gate[0],        (size_t)(len-1));
                memmove(&cl->step_gate_orig[1],   &cl->step_gate_orig[0],   (size_t)(len-1));
                cl->steps[0]             = tmp_s;
                memcpy(cl->step_notes[0], tmp_ns, 4);
                cl->step_note_count[0]   = tmp_nc;
                cl->step_vel[0]          = tmp_v;
                cl->step_gate[0]         = tmp_g;
                cl->step_gate_orig[0]    = tmp_go;
                cl->clock_shift_pos = (uint16_t)((cl->clock_shift_pos + 1) % (uint16_t)len);
            } else {
                tmp_s  = cl->steps[0];
                memcpy(tmp_ns, cl->step_notes[0], 4);
                tmp_nc = cl->step_note_count[0];
                tmp_v  = cl->step_vel[0];
                tmp_g  = cl->step_gate[0];
                tmp_go = cl->step_gate_orig[0];
                memmove(&cl->steps[0],            &cl->steps[1],            (size_t)(len-1));
                memmove(&cl->step_notes[0][0],    &cl->step_notes[1][0],    (size_t)(len-1) * 4);
                memmove(&cl->step_note_count[0],  &cl->step_note_count[1],  (size_t)(len-1));
                memmove(&cl->step_vel[0],         &cl->step_vel[1],         (size_t)(len-1));
                memmove(&cl->step_gate[0],        &cl->step_gate[1],        (size_t)(len-1));
                memmove(&cl->step_gate_orig[0],   &cl->step_gate_orig[1],   (size_t)(len-1));
                cl->steps[len-1]           = tmp_s;
                memcpy(cl->step_notes[len-1], tmp_ns, 4);
                cl->step_note_count[len-1] = tmp_nc;
                cl->step_vel[len-1]        = tmp_v;
                cl->step_gate[len-1]       = tmp_g;
                cl->step_gate_orig[len-1]  = tmp_go;
                cl->clock_shift_pos = (uint16_t)((cl->clock_shift_pos + (uint16_t)(len-1)) % (uint16_t)len);
            }
            int i, any = 0;
            for (i = 0; i < len; i++) if (cl->steps[i]) { any = 1; break; }
            cl->active = (uint8_t)any;
            seq8_save_state(inst);
            return;
        }

        if (!strcmp(sub, "beat_stretch")) {
            int dir = my_atoi(val);
            clip_t *cl = &tr->clips[tr->active_clip];
            int len = (int)cl->length;
            int i, new_len, any;
            uint8_t tmp_steps[SEQ_STEPS];
            uint8_t tmp_notes[SEQ_STEPS][4];
            uint8_t tmp_nc[SEQ_STEPS];
            uint8_t tmp_vel[SEQ_STEPS];
            uint8_t tmp_gate[SEQ_STEPS];
            uint8_t tmp_gate_orig[SEQ_STEPS];

            if (dir == 1) {
                /* EXPAND x2: clamp if doubling would exceed 256 steps */
                if (len * 2 > SEQ_STEPS) return;
                new_len = len * 2;
                for (i = len - 1; i >= 1; i--) {
                    cl->steps[i*2]   = cl->steps[i];
                    memcpy(cl->step_notes[i*2], cl->step_notes[i], 4);
                    cl->step_note_count[i*2] = cl->step_note_count[i];
                    cl->step_vel[i*2]        = cl->step_vel[i];
                    cl->step_gate[i*2]       = cl->step_gate[i];
                    cl->step_gate_orig[i*2]  = cl->step_gate_orig[i];
                    cl->steps[i] = 0;
                }
                for (i = 1; i < new_len; i += 2) {
                    cl->steps[i]             = 0;
                    cl->step_notes[i][0]     = 0;
                    cl->step_notes[i][1]     = 0;
                    cl->step_notes[i][2]     = 0;
                    cl->step_notes[i][3]     = 0;
                    cl->step_note_count[i]   = 0;
                    cl->step_vel[i]          = SEQ_VEL;
                    cl->step_gate[i]         = GATE_TICKS;
                    cl->step_gate_orig[i]    = GATE_TICKS;
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
                    tmp_notes[i][0]  = 0;
                    tmp_notes[i][1]  = 0;
                    tmp_notes[i][2]  = 0;
                    tmp_notes[i][3]  = 0;
                    tmp_nc[i]        = 0;
                    tmp_vel[i]       = SEQ_VEL;
                    tmp_gate[i]      = GATE_TICKS;
                    tmp_gate_orig[i] = GATE_TICKS;
                }
                for (i = 0; i < len; i++) {
                    if (cl->steps[i]) {
                        int dst = i / 2;
                        if (!tmp_steps[dst]) {
                            tmp_steps[dst] = 1;
                            memcpy(tmp_notes[dst], cl->step_notes[i], 4);
                            tmp_nc[dst]        = cl->step_note_count[i];
                            tmp_vel[dst]       = cl->step_vel[i];
                            tmp_gate[dst]      = cl->step_gate[i];
                            tmp_gate_orig[dst] = cl->step_gate_orig[i];
                        }
                    }
                }
                memcpy(cl->steps,           tmp_steps,       sizeof(tmp_steps));
                memcpy(cl->step_notes,      tmp_notes,       sizeof(tmp_notes));
                memcpy(cl->step_note_count, tmp_nc,          sizeof(tmp_nc));
                memcpy(cl->step_vel,        tmp_vel,         sizeof(tmp_vel));
                memcpy(cl->step_gate,       tmp_gate,        sizeof(tmp_gate));
                memcpy(cl->step_gate_orig,  tmp_gate_orig,   sizeof(tmp_gate_orig));
                cl->length = (uint16_t)new_len;
                cl->stretch_exp--;
            }

            if (tr->current_step >= cl->length)
                tr->current_step = (uint16_t)(cl->length - 1);

            any = 0;
            for (i = 0; i < (int)cl->length; i++)
                if (cl->steps[i]) { any = 1; break; }
            cl->active = (uint8_t)any;

            seq8_save_state(inst);
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

    if (!strcmp(key, "route"))
        return snprintf(out, out_len, "%s",
                        fx->route == ROUTE_MOVE ? "move" : "schwung");

    if (!strcmp(key, "noteFX_octave"))    return snprintf(out, out_len, "%d", fx->octave_shift);
    if (!strcmp(key, "noteFX_offset"))    return snprintf(out, out_len, "%d", fx->note_offset);
    if (!strcmp(key, "noteFX_gate"))      return snprintf(out, out_len, "%d", fx->gate_time);
    if (!strcmp(key, "noteFX_velocity"))  return snprintf(out, out_len, "%d", fx->velocity_offset);

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
    if (!strcmp(key, "version"))
        return snprintf(out, out_len, "4");
    if (!strcmp(key, "bpm")) {
        double b = (inst && inst->tracks[0].pfx.cached_bpm > 0)
                   ? inst->tracks[0].pfx.cached_bpm : (double)BPM_DEFAULT;
        return snprintf(out, out_len, "%.0f", b);
    }

    /* state_snapshot: single call returning all poll-loop values.
     * Format: "playing cs0 cs1..cs7 ac0 ac1..ac7 qc0 qc1..qc7" (25 ints)
     * Replaces 25 individual get_param calls in pollDSP(). */
    if (!strcmp(key, "state_snapshot")) {
        if (!inst) return snprintf(out, out_len, "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1 -1 -1 -1 -1 -1 -1 -1");
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
                return -1;
            }
            if (!strncmp(p, "_steps", 6) && p[6] == '\0') {
                if (out_len < SEQ_STEPS + 1) return -1;
                int s;
                for (s = 0; s < SEQ_STEPS; s++)
                    out[s] = cl->steps[s] ? '1' : '0';
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

    /* Cache host BPM every 512 blocks — one call, written to all tracks. */
    if ((inst->block_count % BPM_CACHE_INTERVAL) == 0) {
        double bpm = (g_host && g_host->get_bpm)
            ? (double)g_host->get_bpm() : (double)BPM_DEFAULT;
        for (t = 0; t < NUM_TRACKS; t++)
            inst->tracks[t].pfx.cached_bpm = bpm;
    }

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
                for (t = 0; t < NUM_TRACKS; t++) {
                    inst->tracks[t].current_step        = 0;
                    inst->tracks[t].note_active          = 0;
                    inst->tracks[t].pfx.sample_counter   = 0;
                }
                inst->playing = 1;
                inst->tracks[inst->count_in_track].recording = 1;
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

            if (inst->tick_in_step == 0 && cl->steps[tr->current_step]) {
                int n;
                tr->pending_note_count = cl->step_note_count[tr->current_step];
                for (n = 0; n < (int)tr->pending_note_count; n++) {
                    tr->pending_notes[n] = cl->step_notes[tr->current_step][n];
                    pfx_note_on(inst, tr, tr->pending_notes[n], cl->step_vel[tr->current_step]);
                }
                tr->note_active = 1;
            }
            if (inst->tick_in_step == cl->step_gate[tr->current_step] && tr->note_active) {
                int n;
                for (n = 0; n < (int)tr->pending_note_count; n++)
                    pfx_note_off(inst, tr, tr->pending_notes[n]);
                tr->note_active = 0;
                tr->pending_note_count = 0;
            }
        }

        inst->tick_in_step++;
        if (inst->tick_in_step >= TICKS_PER_STEP) {
            inst->tick_in_step = 0;
            for (t = 0; t < NUM_TRACKS; t++) {
                seq8_track_t *tr = &inst->tracks[t];
                clip_t *cl = &tr->clips[tr->active_clip];
                tr->current_step = (uint8_t)((tr->current_step + 1) % cl->length);
            }
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

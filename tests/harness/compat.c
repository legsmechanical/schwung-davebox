/* tests/harness/compat.c */
#include "compat.h"

#ifdef __APPLE__
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* Minimal fmemopen() for macOS (which lacks the POSIX call) built on the BSD
 * funopen() extension. Scoped to the test harness: supports the davebox usage
 * (open "w" -> fprintf -> fclose, plus read mode). The write callback silently
 * drops bytes past `size` rather than setting the stream error indicator, and
 * does not implement the buf==NULL auto-allocation variant — neither is needed
 * here. */
struct hx_fmem { char *buf; size_t size; size_t pos; };

static int hx_fmem_write(void *c, const char *data, int n) {
    struct hx_fmem *m = (struct hx_fmem *)c;
    size_t avail = (m->pos < m->size) ? (m->size - m->pos) : 0;
    size_t k = ((size_t)n < avail) ? (size_t)n : avail;
    memcpy(m->buf + m->pos, data, k);
    m->pos += k;
    if (m->pos < m->size) m->buf[m->pos] = '\0'; /* keep NUL-terminated */
    return (int)k;
}
static int hx_fmem_read(void *c, char *data, int n) {
    struct hx_fmem *m = (struct hx_fmem *)c;
    size_t avail = (m->pos < m->size) ? (m->size - m->pos) : 0;
    size_t k = ((size_t)n < avail) ? (size_t)n : avail;
    memcpy(data, m->buf + m->pos, k);
    m->pos += k;
    return (int)k;
}
static fpos_t hx_fmem_seek(void *c, fpos_t off, int whence) {
    struct hx_fmem *m = (struct hx_fmem *)c;
    int64_t base = (whence == SEEK_CUR) ? (int64_t)m->pos
                 : (whence == SEEK_END) ? (int64_t)m->size : 0;
    int64_t newpos = base + (int64_t)off;
    if (newpos < 0) newpos = 0;
    if ((size_t)newpos > m->size) newpos = (int64_t)m->size;
    m->pos = (size_t)newpos;
    return (fpos_t)m->pos;
}
static int hx_fmem_close(void *c) { free(c); return 0; }

FILE *fmemopen(void *buf, size_t size, const char *mode) {
    struct hx_fmem *m = (struct hx_fmem *)calloc(1, sizeof(*m));
    if (!m) return NULL;
    m->buf = (char *)buf; m->size = size; m->pos = 0;
    int writing = (strchr(mode, 'w') != NULL);
    if (writing && size > 0) ((char *)buf)[0] = '\0';
    return funopen(m,
                   writing ? NULL : hx_fmem_read,
                   writing ? hx_fmem_write : NULL,
                   hx_fmem_seek, hx_fmem_close);
}
#endif /* __APPLE__ */

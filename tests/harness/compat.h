/* tests/harness/compat.h — host-machine portability shims for building the
 * davebox DSP off-device. */
#ifndef HX_COMPAT_H
#define HX_COMPAT_H

#include <stdio.h>
#include <stddef.h>

#ifdef __APPLE__
/* macOS libc has no fmemopen(); provided by compat.c via funopen(). */
FILE *fmemopen(void *buf, size_t size, const char *mode);
#endif

#endif /* HX_COMPAT_H */

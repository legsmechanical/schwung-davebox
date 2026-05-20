# Move-native state readback via Sentry breadcrumbs

**Status:** investigation parked 2026-05-20. Promising but needs format work + live capture before committing to a design.

**Target: post-1.0 release.** Not in scope for 1.0.

## Origin

Schwung Discord thread (Dom + charlesv, 2026-05-19): SSH on Move surfaced lines like
`Set MainMode (new state: session)` / `Set MainMode (new state: note)` from a file
under `/data/UserData/Sentry/`. charlesv confirmed it's the Sentry analytics SDK's
breadcrumb log. If we can tail it, we get a **read-only side channel into Move-native
firmware state** — exactly the missing piece for seamless co-run handoff.

## What we confirmed on device (2026-05-20)

### File layout

Sentry Native SDK writes one `.run` directory per process that links it:

```
/data/UserData/Sentry/
  <uuid>.run/
    __sentry-event         (envelope metadata)
    __sentry-breadcrumb1   (ring buffer half A)
    __sentry-breadcrumb2   (ring buffer half B)
  <uuid>.run.lock          (held open by the owning process while alive)
  completed/               (sealed crash dumps + meta)
  pending/                 (queued for upload, empty in steady state)
  attachments/<event-uuid>/__sentry-breadcrumb{1,2}  (frozen with crash)
  last_crash               (27-byte pointer to most recent crash)
  user-consent             (2 bytes — analytics opt-in gate)
  new/  settings.dat
```

### Process → run-dir mapping

Resolved via `readlink /proc/<pid>/fd/* | grep .run.lock`:

| PID family | run.lock |
|---|---|
| MoveLauncher + display-server + schwung-manager | share `fb54a0ad...run.lock` (forked from one Sentry init) |
| MoveWebService | `aef3496c...run.lock` (stale — older boot's UUID) |
| USB MIDI subsystem (PID unidentified) | `08c3771e...run.lock` — fills `breadcrumb1` with **every USB MIDI packet** (`Received USB MIDI packet 0x04 0xf0 0x7e 0x01`). Useless volume. |
| MoveOriginal | gets its own `.run` when alive — **but it's killed while Schwung/dAVEBOx is running**, so no live MainMode breadcrumbs at all today. |

The MainMode breadcrumbs in the screenshot exist because charlesv/Dom captured them
while Move firmware was running natively. In our actual co-run scenario, MoveOriginal
restarts on Edit Synth / Edit Slot handoff, at which point its `.run` dir appears and
starts emitting breadcrumbs — which is *exactly* the window we care about.

### Vocabulary observed (one captured session — `attachments/86f4066b.../__sentry-breadcrumb1`, 11.4KB)

Breadcrumb messages, grouped by category:

- **`mode`** (the gold):
  - `Set MainMode (new state: note)` / `session` / `songOverview`
  - `Set ShiftMode (shift: true|false, lock: true|false)`
  - `Reset ShiftMode (shift: false, lock: false)`
  - `Push MomentaryMode (new state: SongVolumeMomentaryMode)` / `Pop MomentaryMode (new state: empty)`
  - `Set Notification` / `Disable Notification`
- **`transaction`** (user actions):
  - `Output Volume adjusted` (fires per knob increment — high rate)
  - `Configure audio settings`, `Enable/Disable output metering`, `Enable/Disable link audio`
  - `Set initial link state`
  - `Song opened (UUID 3908a025-...)` ⭐
- **`navigation`** — wraps the mode events above
- **`firmware`** — USB MIDI packet log (one entry per packet, throwaway)
- **`user`** — physical control events

### Format

Binary, **MessagePack** (confirmed by the leading length-prefix bytes — `&` = 0x26 = 38-char
string, `(` = 0x28 = 40 chars, etc.). String keys: `timestamp`, `type`, `message`, `category`,
`level`. `strings` extracts the readable text but loses record framing. A proper parser is
~50 lines (sentry-native is open source, format documented).

`breadcrumb1` and `breadcrumb2` together form a 2-half rotating ring buffer — one is active
while the other is the prior half. To tail, we need to read both and follow the rotation.

## What this would unlock for co-run

1. **Auto-exit detection.** When user navigates back from Note/Session inside Move-native
   during co-run, we'd see the MainMode transition immediately and could restore dAVEBOx
   UI without waiting for an explicit Note-button press.
2. **Shift-state mirror.** Without polling hardware. Bonus: includes `lock` state.
3. **Modal screen awareness.** `Push MomentaryMode` could let us know when a device-edit
   page or preset browser is open vs the base mode.
4. **Set-load sync.** `Song opened (UUID ...)` could trigger dAVEBOx state reload when
   user changes set from inside Move native.

## Caveats

- **Undocumented Ableton surface.** This is Sentry SDK internals. Any firmware update
  could change the path, rotate format, or drop the file backend. Anything we build
  on it is a soft dependency — must degrade gracefully when the file isn't there.
- **MessagePack parser needed.** Either in the shim (C) or in a JS helper that runs
  on the Move side and emits a clean text stream. `strings`-based parsing loses too
  much structure (you see "Set MainMode" but the `(new state: note)` payload only
  reliably appears at certain offsets).
- **Ring rotation handling.** Naive `tail -f breadcrumb1` will miss events that land in
  `breadcrumb2` during the active half's reset. Need to watch both + detect rotation.
- **Latency.** Sentry typically flushes every ~100ms. Fine for MainMode-level signals;
  too slow for sub-step timing (we don't need that anyway).
- **Read permissions.** The `.run` dirs are `drwx------ ableton:users`. Our shim/DSP
  runs as the same user (`ableton`) — should be fine, but confirm in the live capture.
- **Volume.** USB MIDI process spams ~one breadcrumb per packet. If we ever needed to
  watch *its* run dir we'd need server-side filtering.
- **Consent gate.** `user-consent` file controls whether Sentry is enabled at all.
  If a user opts out, the file backend may stop writing. Need to detect this.

## Next investigation steps

1. **Live capture during co-run handoff.**
   - Trigger Edit Synth from dAVEBOx → MoveOriginal restarts → new `.run` dir appears.
   - Tail both breadcrumb files via SSH while exercising:
     - Note ↔ Session toggle
     - Shift hold + release + double-tap-lock
     - Device-edit page open + close
     - Preset browser open + close
     - Pad presses, knob turns
     - Back / Shift+Back exits
   - Capture full vocabulary + timing.

2. **MessagePack format decode.**
   - Either link `msgpack-c` into the shim, or write a minimal hand-rolled decoder
     for just the breadcrumb record shape (fixed key set, no nested structures).
   - Compare against [sentry-native](https://github.com/getsentry/sentry-native) source
     for the canonical layout.

3. **Ring rotation reverse-engineering.**
   - When does Sentry switch from `breadcrumb1` to `breadcrumb2`? Size threshold,
     time threshold, or external trigger? Likely a documented Native SDK constant.

4. **Prototype an event stream.**
   - Small C process or shim worker that opens both ring files, follows rotation,
     parses each record, filters by `category` (probably just `mode`), and writes
     a clean text stream (or pushes events to dAVEBOx via the host).
   - Decide where it lives: shim worker thread? Standalone helper exec'd by
     schwung-manager? Background process spawned by dAVEBOx on co-run entry?

5. **Design the dAVEBOx consumer.**
   - Where does the parsed event arrive in JS? Probably a `host_module_set_param`
     callback shape like `mainmode_change=note`.
   - What's the behavior matrix? E.g. `Set MainMode (new state: session)` while in
     Edit Synth co-run → restore dAVEBOx UI.

6. **Capability gate.**
   - Feature only works if `/data/UserData/Sentry/` exists *and* `user-consent`
     allows it *and* MoveOriginal is the version that emits these specific
     breadcrumb messages.
   - Plan a runtime probe + graceful no-op fallback (same shape as the
     `typeof shadow_xxx === 'function'` pattern for patched-Schwung features).

## Files / paths reference

- Sentry root: `/data/UserData/Sentry/`
- Active run lookup: `readlink /proc/<pid>/fd/* | grep .run.lock`
- Native SDK source (format reference): https://github.com/getsentry/sentry-native
- Discord thread: Schwung server, 2026-05-19, Dom → charlesv → Dom

## Risk assessment

**Reward:** high — first proper readback channel from Move-native firmware. Would
turn co-run from a one-way blind handoff into a bidirectional integration.

**Risk:** medium — undocumented internal surface, firmware-update fragility, parser
work non-trivial. But: graceful-degrade is cheap (no breadcrumbs → fall back to
today's behavior), and the experiment cost is low (one SSH capture session before
any code).

**Recommendation:** worth pursuing, but **not before 1.0 ships**. This is a polish
multiplier, not a 1.0 blocker.

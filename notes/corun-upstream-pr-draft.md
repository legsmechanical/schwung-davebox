# PR draft — Co-run: let an overtake tool share the surface with a second UI

> Draft for `charlesvestal/schwung`. Target branch: `main`. Status: **design for
> review** — code generalization to follow once the API shape is agreed.
> Proving ground: dAVEBOx (8-track sequencer tool), which already runs both
> co-run modes in production on the `legsmechanical/schwung` fork.

---

## TL;DR

Today an overtake tool owns the **entire** Move surface — screen, all buttons,
all knobs, all pads. This PR adds **co-run**: a tool can keep ticking and keep a
chosen subset of controls while a *second* UI uses the rest of the surface. The
tool declares its split with a small manifest (named control groups), so the
behavior isn't hard-coded to any one tool. Two co-run "targets" ship with it:
Schwung's own chain editor, and Move's native device/preset pages.

---

## The problem

When a tool takes over the Move (overtake mode), it's all-or-nothing: the tool
gets the whole instrument and everything else is locked out until you exit. If
you're running, say, a sequencer and you want to tweak the synth on one of your
tracks, you have to leave the sequencer entirely, make your change, and come
back — losing your place and stopping the flow.

There's no way for a tool to say "keep my pads and transport live, but let me
borrow the screen and knobs to edit something else for a moment." That's a
natural thing to want for *any* performance tool, not just one.

Under the hood, `overtake_mode == 2` gives the loaded module exclusive ownership:
- The shim (`schwung_shim.c`) filters **all** cable-0 MIDI away from Move
  firmware and forwards everything to the tool's `onMidiMessageInternal`.
- `shadow_swap_display()` copies the tool's framebuffer to the OLED.

There is no supported mechanism for partial yielding. A tool that wants to expose
Schwung's chain editor or Move's device pages while staying loaded has to patch
the shim and `shadow_ui` directly with hand-curated CC/note lists — which is
exactly what the dAVEBOx fork does today, and exactly why it can't be upstreamed
as-is.

---

## Why it's useful

Any overtake tool gets a clean, supported way to share the Move:
- A sequencer can hand the screen + knobs to the synth editor while its pads keep
  playing the pattern — so you audition edits against the running groove.
- A looper or performance tool could expose effect settings without going modal.
- Tool authors stop reinventing (and mis-handling) input routing; they declare
  what they keep and Schwung does the rest.

Mechanically, co-run turns the implicit, hard-coded split into an explicit, tool-declared one.
The let-through set is derived from the tool's manifest instead of curated CC
lists baked into the shim, so the routing is correct for *any* tool and the
hardware CC map lives in exactly one place (Schwung), not copied into every tool.

---

## How it works

The tool calls one function when it wants to share, naming the control groups it
wants to **keep**. Everything it doesn't keep goes to the co-running UI. It calls
another function to stop sharing. While sharing:
- The co-running UI (the chain editor, or Move's pages) draws to the screen.
- The tool keeps running and keeps the controls it asked for.
- The **Menu** button always exits co-run, so there's a consistent way out.

**Public API (JS, available to any module):**

```js
// Start sharing. target: "chain_edit" | "move_native".
// keep: control groups the tool retains; the rest cede to the co-run UI.
shadow_corun_begin("chain_edit", ["pads", "steps", "transport"]);

// ...module keeps ticking; chain editor (or Move pages) owns the screen + the
//    ceded controls...

shadow_corun_end();   // restore full overtake ownership to the tool
```

**Control groups** (each maps to a fixed hardware set, defined once in Schwung):

| group           | hardware |
|-----------------|----------|
| `oled`          | the display |
| `pads`          | the 8×4 pad grid (note-on/off in pad range) |
| `steps`         | the 16 step buttons |
| `transport`     | play / record |
| `jog`           | jog turn (CC 14) + jog click (CC 3) |
| `track_buttons` | the 4 track buttons (CC 40–43) |
| `knobs`         | the 8 device knobs (CC 71–78) |
| `master`        | master knob (CC 79) |
| `shift`         | Shift (CC 49) |
| `back`          | Back (CC 51) |
| `touch`         | capacitive-touch notes (0–9) |

`menu` (CC 50) is reserved as the framework's exit gesture — pressing it ends
co-run and the tool resumes full overtake ownership.

**State.** `shadow_control_t` carries the active target (an int8 gate, −1 = off)
and a `keep_mask` (uint16 bitfield over the groups above). One canonical helper
maps a raw MIDI event → its group bit, used by both filter sites so the
"let-through" and "suppress-from-tool" lists can never drift apart (today they're
two hand-maintained mirrors).

**Two targets, one manifest:**

- **`chain_edit`** — Schwung's chain editor (slot settings, hierarchy editor,
  preset browser, knob param control) renders over the tool's frame and receives
  the ceded input, all in-process in `shadow_ui`. Input routing is JS-side. (The
  tool's host APIs are swapped back in around its own callbacks so its DSP keeps
  working while the editor's param shims are installed.)
- **`move_native`** — Move firmware's device-edit / preset pages take the OLED
  (via a `shadow_swap_display` bypass) and the ceded input (via the shim's
  cable-0 MIDI filter). Move firmware is a separate process reading the shadow
  mailbox directly, so this target is **entirely shim-side** — no `shadow_ui.js`
  change.

In both cases the ceded vs kept decision comes from the same `keep_mask`.

---

## Backward compatibility

- Purely additive. With no co-run target set, overtake behaves exactly as today.
- The existing dAVEBOx fork calls become thin wrappers over the new API with a
  default `keep_mask` that reproduces today's exact split
  (`pads | steps | transport`), so the shipped fork behavior is byte-for-byte
  preserved. The generalization is verified against it (see Testing).
- `shadow_control_t` gains the `keep_mask` from existing reserved bytes; layout
  stays stable.

---

## Testing

dAVEBOx is the proving ground — it runs both modes in production:
- **chain_edit** (`Edit Slot…`): chain editor co-runs while the sequencer plays;
  jog/click/track-buttons/Shift navigate it and knobs (turn + touch) drive chain
  params, while pads/steps/transport stay with the sequencer.
- **move_native** (`Edit Synth…`): Move's preset browser / device pages co-run;
  Move drives screen + knobs + nav, the sequencer keeps pads/transport.

Verification for this PR: confirm the generalized, manifest-driven routing
reproduces the fork's existing behavior on-device for both modes (no regression),
then confirm a second `keep` manifest routes differently as declared.

---

## Caveats / known limits

- **`move_native` knob stutter.** Turning Move's device-edit knobs (CC 71–78)
  during `move_native` co-run can briefly stutter the foreground tool, because
  each detent triggers a synth-param write **+ a knob-ring OLED redraw** in Move
  firmware that can overrun the per-frame SPI budget. It's a Move-firmware cost,
  not a co-run-framework bug; documented here. A per-frame detent-coalescing
  mitigation in the shim is a possible follow-up.
- **`chain_edit` deep module editors.** When a chain component has its own full
  UI module, co-run uses the simple preset-browser fallback rather than invoking
  that module's `tick()` (running a second UI module would starve the foreground
  tool). Full nested-module editing stays a non-co-run action.

---

## Out of scope / possible follow-ups

- Live pad/step LED animation during co-run (today the tool's LED state freezes
  at entry; static, not animated — fine in practice for the dAVEBOx UX).
- A shim-side LED-write filter so the co-run UI can't clobber the tool's frozen
  pad LEDs.
- The CC 71–78 coalescing mitigation noted above.

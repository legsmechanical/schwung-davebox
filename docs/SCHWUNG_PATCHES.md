# Schwung Patches

Local patches applied to `~/schwung/` that must be re-applied after any Schwung upgrade.

Current base: **v0.9.10** (`1f65169b`), branch `fix/cable2-passthrough-no-tool`.

## Re-applying after a Schwung upgrade

```sh
cd ~/schwung && git apply patches/seq8-local.patch
```

Regenerate the patch after cherry-picking onto a new base:
```sh
git diff <new-base>..HEAD -- src/ > patches/seq8-local.patch
```

Verify each commit is present before deploying:
```sh
cd ~/schwung && git log --oneline | grep <sha>
```

Build and deploy shim:
```sh
cd ~/schwung && ./scripts/build.sh
scp ~/schwung/build/schwung-shim.so root@move.local:/data/UserData/schwung/schwung-shim.so
```
Then restart Move. Deploy to `/data/UserData/schwung/schwung-shim.so` (data partition), not `/usr/lib/schwung-shim.so` (symlink recreated on every boot by `schwung-heal`).

## Patch table

| PR | Commit (on v0.9.10 branch) | File | Description |
|----|----------------------------|------|-------------|
| [#71](https://github.com/charlesvestal/schwung/pull/71) | `e70d7340` | `src/host/shadow_midi.c` | Defer cable-2 inject when cable-0 or cable-2 hardware is active — prevents SIGABRT in ROUTE_MOVE external MIDI monitoring |
| [#72](https://github.com/charlesvestal/schwung/pull/72) | `5b74e6cc` + `4a95b4d6` | `src/host/shadow_midi.c` | Hold inject drain for 2 frames (~6ms) after overtake exit — prevents SIGABRT when suspending (Back) with a ROUTE_MOVE drum pattern playing |
| (local) | `7c31d048` | `src/host/shadow_midi.c` | Defer on ANY MIDI_IN event (not just cable-0/2) — external controller + ROUTE_MOVE clip crash |
| (local) | `8f1a9d87` | `src/host/shadow_midi.c` | Bail inject if existing events must be skipped (`saw_existing`) — prevents write at non-zero offset |
| (local) | `3ae7e206` | `src/host/shadow_midi.c` | Strengthen any-cable guard — scan all MIDI_IN slots, not just slot 0 |
| (local) | `9ac557c5` + `b01a1e2e` | `src/schwung_shim.c`, `src/host/shadow_constants.h`, `src/shadow/shadow_ui.c` | EXT_MIDI_REMAP_BLOCK: suppress cable-2 note-ons from Move on non-ROUTE_MOVE tracks; patches sh_midi (not hardware) to avoid crash |
| (local) | `743bb18f` | `src/schwung_shim.c`, `src/host/shadow_midi.c`, `src/host/shadow_midi.h` | Cable-2 passthrough: inject cable-2 as cable-0 for Move native routing + dispatch to Schwung chain slots by channel when no tool active (overtake_mode==0 or suspend_overtake==1) |
| (local) | `456c0a9e` | `src/schwung_shim.c` | Remove THRU-slot gate from cable-2 remap: `any_thru_slot_active()` was silently blocking rechannelization whenever any THRU slot existed |

PRs #71/#72 are upstream patches. Local commits fix inject races and add cable-2 BLOCK support for external MIDI isolation.

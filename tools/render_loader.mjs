// tools/render_loader.mjs — Node ESM resolve/load hook so off-device tooling can
// import the real ui/*.mjs modules, which reference device-absolute specifiers
// like /data/UserData/schwung/shared/constants.mjs. Any /data/UserData/schwung
// specifier is redirected to an in-memory stub that exports every name as a
// harmless Proxy-backed value (colour constants, no-op draw helpers). Register
// with:  node --import ./tools/render_loader.mjs <script>
import { register } from 'node:module';

register('./render_loader_hooks.mjs', import.meta.url);

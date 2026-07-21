// ESM hooks (resolve + load) for render_loader.mjs. Redirects any
// /data/UserData/schwung/... import to a synthetic stub module whose every
// named export is `0` (colour palette constants) or a no-op function
// (draw helpers). The importing ui/*.mjs modules only need these to *load*;
// the render harness drives the pure fmt/BANKS/cell logic, none of which
// touches the stubbed values.
const DEVICE_PREFIX = '/data/UserData/schwung/';
const STUB_SCHEME = 'device-stub:';

export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(DEVICE_PREFIX)) {
        return { url: STUB_SCHEME + specifier, shortCircuit: true };
    }
    return nextResolve(specifier, context);
}

// ESM named imports are resolved statically, so each stub must declare the
// exact names its importer expects. The device shared modules are few and
// fixed, so we enumerate them here. Colour constants -> 0; draw helpers -> no-op.
const STUBS = {
    'constants.mjs':
        ['Red','Blue','Green','DarkBlue','Mustard','DeepGreen','BrightGreen',
         'BrightPink','RoyalBlue','DarkOlive','DeepWine']
            .map(n => `export const ${n} = 0;`).join('\n'),
    'menu_layout.mjs':
        'export function drawMenuHeader() {}\nexport const MENU_HDR_H = 12;',
};

export async function load(url, context, nextLoad) {
    if (url.startsWith(STUB_SCHEME)) {
        const file = url.split('/').pop();
        const body = STUBS[file] || '';
        // Trailing default keeps default-imports working for any un-enumerated stub.
        const src = `${body}\nexport default {};`;
        return { format: 'module', source: src, shortCircuit: true };
    }
    return nextLoad(url, context);
}

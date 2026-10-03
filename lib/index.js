// dsh-winui-skin host half.
//
// The skin is entirely browser-side: it layers a Fluent / WinUI 3 token
// override over the active palette and injects one plugin-owned stylesheet.
// The host half therefore only has to exist so the plugin package can be a
// Loader row — that row is what the client module system scans for the
// `dsh.client` declaration in package.json. Keeping it a no-op also means the
// plugin can never destabilise the host process.

/** Cordis plugin name — must match the row name in cordis.patch.yml. */
export const name = 'dsh-winui-skin'

/** This plugin needs no host service. */
export const inject = []

/** No host behaviour: the visual work happens in `./client`. */
export function apply(_ctx) {}

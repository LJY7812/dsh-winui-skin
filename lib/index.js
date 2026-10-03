// dsh-winui-skin host half.
//
// The skin itself is browser-side, but the *source* of the system accent has to
// be here. A page can reach the OS accent only through the CSS system-colour
// keyword `AccentColor`, and measured on Windows 11 that keyword does not
// follow the personalized accent at all: with the real accent set to #FFB900
// (verified through `UISettings.GetColorValue(UIColorType.Accent)`), Chromium
// still reports `AccentColor` as rgb(0, 117, 255). So the host half reads the
// registry key Windows Settings writes — `Explorer\Accent\AccentPalette`, whose
// eight RRGGBBAA entries match the WinRT accent ramp exactly — and serves it on
// a loopback route for the client half to bind to.
//
// Everything here is defensive: a missing key, a locked-down registry or a
// non-Windows host answers `{ supported: false }` and the client falls back to
// the shipped WinUI default blue.

import { execFile } from 'node:child_process'
import { join } from 'node:path'

/** Cordis plugin name — must match the row name in cordis.patch.yml. */
export const name = 'dsh-winui-skin'

/** The accent route is served through the web server. */
export const inject = ['webServer']

/** Loopback route the client half reads its accent from. */
const ROUTE = '/api/dsh-winui-accent'

/** Registry key Windows Settings writes the personalized accent into. */
const ACCENT_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent'
const ACCENT_VALUE = 'AccentPalette'

/** `reg.exe` is bounded so a hung registry read can never stall a request. */
const READ_TIMEOUT_MS = 4000
/** The palette changes only from Settings, so a short cache is plenty. */
const CACHE_MS = 5000

/**
 * The eight 4-byte entries of AccentPalette, `RRGGBBAA` each. The first seven
 * line up with `UIColorType` Light3..Dark3; the eighth is an unrelated spare.
 */
const PALETTE_SLOTS = ['light3', 'light2', 'light1', 'accent', 'dark1', 'dark2', 'dark3']

/**
 * Decode the `REG_BINARY` hex blob into hex colours.
 * @param {string} hex registry hex string, possibly whitespace-separated.
 * @returns {{accent: string, light1: string, light2: string, light3: string, dark1: string, dark2: string, dark3: string}|undefined}
 */
export function decodeAccentPalette(hex) {
  if (typeof hex !== 'string') return undefined
  const compact = hex.replace(/\s+/gu, '')
  if (compact.length < PALETTE_SLOTS.length * 8) return undefined
  const palette = {}
  for (let index = 0; index < PALETTE_SLOTS.length; index += 1) {
    const chunk = compact.slice(index * 8, index * 8 + 8)
    if (!/^[0-9a-f]{8}$/iu.test(chunk)) return undefined
    palette[PALETTE_SLOTS[index]] = '#' + chunk.slice(0, 6).toLowerCase()
  }
  // A palette whose transparent/zero entries survived is not usable.
  if (palette.accent === '#000000' && palette.dark1 === '#000000') return undefined
  return palette
}

/**
 * Read the personalized accent ramp from the registry.
 * @returns {Promise<object|undefined>} the palette, or undefined when it cannot
 * be read (non-Windows host, missing key, denied or timed-out read).
 */
function readAccentPalette() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(undefined)
      return
    }
    const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
    execFile(
      join(root, 'System32', 'reg.exe'),
      ['query', ACCENT_KEY, '/v', ACCENT_VALUE],
      { timeout: READ_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(undefined)
          return
        }
        const match = /REG_BINARY\s+([0-9a-fA-F]+)/u.exec(String(stdout))
        resolve(match === null ? undefined : decodeAccentPalette(match[1]))
      },
    )
  })
}

/**
 * Mount the accent route for exactly this plugin's lifetime.
 * @param ctx Host plugin context.
 */
export function apply(ctx) {
  const cache = { at: 0, palette: undefined }

  async function palette() {
    const now = Date.now()
    if (now - cache.at < CACHE_MS) return cache.palette
    cache.at = now
    cache.palette = await readAccentPalette()
    return cache.palette
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { allow: 'GET, HEAD' })
            res.end()
            return
          }
          const value = await palette()
          const body = JSON.stringify(
            value === undefined ? { supported: false } : { supported: true, source: 'registry', ...value },
          )
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'content-length': Buffer.byteLength(body),
            'cache-control': 'no-store',
          })
          if (req.method === 'HEAD') {
            res.end()
            return
          }
          res.end(body)
        },
      }),
    'winui-skin: system accent route',
  )
}

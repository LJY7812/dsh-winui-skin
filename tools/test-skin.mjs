// Functional + contract test for the dsh-winui-skin bundles.
//
// 1. Loads lib/client.js the way the DSH browser module system does: a
//    `window.__ModuleLoader__.load({ id, factory })` registration, then
//    `factory(require)` -> CommonJS exports with `apply` / `inject`.
// 2. Runs `apply(ctx)` against a stub context and asserts both effects install
//    and dispose, and that the accent route restacks the token layer.
// 3. Validates the accent mapping (light fill = AccentDark1, dark fill =
//    AccentLight2, accent text = Dark2 / Light3) and the WCAG contrast of the
//    resulting pairs, for a real Windows palette and for the WinUI fallback.
// 4. Validates the host half's `AccentPalette` decoding.
// 5. Validates every override token name against the shipped DSH design system,
//    frozen into design-tokens.txt by freeze-design-tokens.mjs, so a typo can
//    never silently no-op.
// 6. Validates the corner-radius ladder and the emitted CSS.
//
// Runs with plain Node and no dependencies: `node tools/test-skin.mjs`.

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const CLIENT = path.join(ROOT, 'lib', 'client.js')
const HOST = path.join(ROOT, 'lib', 'index.js')

const failures = []
const notes = []
function check(ok, message) {
  if (ok) notes.push('  ok   ' + message)
  else failures.push('  FAIL ' + message)
}

/** The accent ramp measured on Windows 11 through UISettings.GetColorValue. */
const GOLD = {
  supported: true,
  accent: '#ffb900',
  light1: '#ffc20d',
  light2: '#ffd52a',
  light3: '#ffe845',
  dark1: '#e19d00',
  dark2: '#9b5d00',
  dark3: '#5c2100',
}

// ---------------------------------------------------------------- 1. load ---
const source = fs.readFileSync(CLIENT, 'utf8')
const styles = []
let registration

/** Minimal DOM node good enough for the injected <style> tag. */
function stubElement(tag) {
  return {
    tagName: tag.toUpperCase(),
    dataset: {},
    attributes: {},
    textContent: '',
    removed: false,
    parent: undefined,
    children: [],
    style: {},
    setAttribute(name, value) {
      this.attributes[name] = value
    },
    appendChild(node) {
      node.parent = this
      this.children.push(node)
      return node
    },
    remove() {
      this.removed = true
      const host = this.parent
      if (host) host.children = host.children.filter((child) => child !== this)
    },
  }
}

let accentPayload = GOLD
let fetchCalls = 0

const sandbox = {
  console,
  window: {
    __ModuleLoader__: {
      load(entry) {
        registration = entry
      },
    },
  },
  document: {
    body: stubElement('body'),
    head: stubElement('head'),
    createElement: stubElement,
    addEventListener() {},
    removeEventListener() {},
  },
  fetch: async () => {
    fetchCalls += 1
    if (accentPayload === undefined) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => accentPayload }
  },
  addEventListener() {},
  removeEventListener() {},
  setInterval: () => 0,
  clearInterval() {},
}
sandbox.document.head.appendChild = (node) => {
  styles.push(node)
  return node
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.js' })

check(registration !== undefined, 'client.js registers with window.__ModuleLoader__.load')
check(registration?.id === 'dsh-winui-skin', 'module id equals the package name (got ' + JSON.stringify(registration?.id) + ')')

const required = []
const factory = registration?.factory
check(typeof factory === 'function', 'registration carries a factory function')
const mod = typeof factory === 'function' ? factory((name) => {
  required.push(name)
  throw new Error('unexpected require(' + name + '): this skin must stay dependency-free')
}) : {}

check(typeof mod?.apply === 'function', 'exports.apply is a function')
check(Array.isArray(mod?.inject) && mod.inject.includes('theme'), 'exports.inject waits for the `theme` service')
check(required.length === 0, 'factory requires no modules (no React / no UI package)' + (required.length ? ': ' + required.join(', ') : ''))

// --------------------------------------------------------------- 2. apply ---
const effects = []
const overrideCalls = []
let overrideCall
const disposers = []
const ctx = {
  effect(callback, label) {
    const dispose = callback()
    effects.push(label)
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  },
  theme: {
    overrideTokens(source, tokens) {
      overrideCalls.push(tokens)
      overrideCall = { source, tokens }
      return () => {
        overrideCall = undefined
      }
    },
  },
}
mod.apply(ctx)

check(effects.length === 2, 'apply installs exactly two effects (got ' + effects.length + ')')
check(overrideCall?.source === 'dsh-winui-skin', 'override layer is sourced to the plugin id')
check(styles.length === 1, 'apply appends exactly one stylesheet')
check(styles[0]?.dataset?.plugin === 'dsh-winui-skin', 'stylesheet carries data-plugin="dsh-winui-skin"')
check(styles[0]?.dataset?.pluginCss === 'dsh-winui-skin/winui.css', 'stylesheet carries data-plugin-css')
check(disposers.length === 2, 'both effects return a disposer')
check(overrideCalls.length === 1, 'the first paint uses the shipped palette before the accent arrives')
check(
  overrideCalls[0]?.['--dsw-alias-brand-primary']?.light === '#0067c0',
  'the pre-accent layer is the WinUI default blue',
)
check(sandbox.document.body.children.length === 0, 'apply injects no probe element into <body>')

// Let the accent fetch settle.
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))

check(fetchCalls >= 1, 'apply asks the host route for the system accent (' + fetchCalls + ' call)')
check(overrideCalls.length === 2, 'the accent restacks the token layer exactly once (got ' + overrideCalls.length + ')')
const tokens = overrideCalls[1] ?? {}
const defaultTokens = mod.buildTokens(undefined)
check(
  Object.keys(tokens).length > 90,
  'token layer is substantial (' + Object.keys(tokens).length + ' overrides)',
)
check(
  tokens['--dsw-alias-brand-primary']?.light === GOLD.dark1,
  'light accent fill uses the OS AccentDark1 (' + tokens['--dsw-alias-brand-primary']?.light + ')',
)
check(
  tokens['--dsw-alias-brand-primary']?.dark === GOLD.light2,
  'dark accent fill uses the OS AccentLight2 (' + tokens['--dsw-alias-brand-primary']?.dark + ')',
)
check(
  tokens['--dsw-alias-link']?.light === GOLD.dark2 && tokens['--dsw-alias-link']?.dark === GOLD.light3,
  'accent links use AccentDark2 / AccentLight3 (' + tokens['--dsw-alias-link']?.light + ' / ' + tokens['--dsw-alias-link']?.dark + ')',
)
check(
  tokens['--dsw-alias-state-business-primary']?.light === GOLD.accent,
  'the attention state uses the accent itself (' + tokens['--dsw-alias-state-business-primary']?.light + ')',
)
check(
  tokens['--dsw-alias-brand-primary'].light !== defaultTokens['--dsw-alias-brand-primary'].light,
  'a system accent overrides the shipped WinUI blue',
)
check(
  defaultTokens['--dsw-alias-brand-primary'].light === '#0067c0'
  && defaultTokens['--dsw-alias-brand-primary'].dark === '#4cc2ff',
  'without a readable system accent the WinUI default blue is restored',
)
// A payload carrying only the base accent still fills in a usable ramp.
const sparse = mod.normalizePalette({ accent: '#c42b1c' })
check(
  sparse?.dark1 !== undefined && sparse?.light3 !== undefined && marshalHex(sparse.accent) === '#c42b1c',
  'a payload with only `accent` is completed by derivation',
)
check(mod.normalizePalette({}) === undefined, 'a payload without an accent is rejected')

// ------------------------------------------------- 3. contrast of accents ---
function marshalHex(rgb) {
  return '#' + rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')
}
function rgbOf(hex) {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16))
}
function luminance(hex) {
  const channels = rgbOf(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}
function contrast(a, b) {
  const la = luminance(a) + 0.05
  const lb = luminance(b) + 0.05
  return la > lb ? la / lb : lb / la
}

for (const [label, table] of [['system accent', tokens], ['WinUI fallback', defaultTokens]]) {
  for (const mode of ['light', 'dark']) {
    const fill = table['--dsw-alias-brand-primary'][mode]
    const onFill = table['--dsw-alias-label-primary-foreground'][mode]
    const fillRatio = contrast(fill, onFill)
    check(
      fillRatio >= 4.5,
      label + ' ' + mode + ': text on the accent fill keeps 4.5:1 (' + onFill + ' on ' + fill + ' = ' + fillRatio.toFixed(2) + ':1)',
    )
    const link = table['--dsw-alias-link'][mode]
    const base = table['--dsw-alias-bg-base'][mode]
    const linkRatio = contrast(base, link)
    check(
      linkRatio >= 4.5,
      label + ' ' + mode + ': accent links keep 4.5:1 on the canvas (' + link + ' on ' + base + ' = ' + linkRatio.toFixed(2) + ':1)',
    )
  }
  // The onboarding card paints its accent behind white text in both palettes.
  const onboarding = table['--dsw-alias-onboarding-accent'].light
  const onboardingRatio = contrast(onboarding, '#ffffff')
  check(
    onboardingRatio >= 4.5,
    label + ': the onboarding accent keeps white text readable (' + onboarding + ' = ' + onboardingRatio.toFixed(2) + ':1)',
  )
}

const probeBeforeDispose = sandbox.document.body.children.length
for (const dispose of disposers) dispose()
check(styles[0]?.removed === true, 'disposing removes the stylesheet (HMR / unload safe)')
check(overrideCall === undefined, 'disposing releases the token layer')
check(probeBeforeDispose === 0, 'disposing leaves no plugin node behind')

// ------------------------------------------------ 4. host accent decoding ---
const host = await import(new URL('../lib/index.js', import.meta.url).href)
check(host.name === 'dsh-winui-skin', 'the host half exports the row name')
check(
  Array.isArray(host.inject) && host.inject.includes('webServer'),
  'the host half waits for the web server it serves the accent on',
)
const decoded = host.decodeAccentPalette('FFE84500FFD52A00FFC20D00FFB90000E19D00009B5D00005C21000000B29400')
check(
  decoded?.accent === '#ffb900' && decoded?.light3 === '#ffe845' && decoded?.dark3 === '#5c2100',
  'AccentPalette decodes to the ramp WinRT reports (' + JSON.stringify(decoded) + ')',
)
check(host.decodeAccentPalette('FFE84500') === undefined, 'a truncated AccentPalette is rejected')
check(host.decodeAccentPalette(undefined) === undefined, 'a missing AccentPalette is rejected')
check(
  host.decodeAccentPalette('0000000000000000000000000000000000000000000000000000000000000000') === undefined,
  'an all-zero AccentPalette is rejected so the fallback wins',
)

// ------------------------------------------------ 5. token-name contract ---
/**
 * Every custom property the shipped design system declares, frozen into
 * `tools/design-tokens.txt` by `tools/freeze-design-tokens.mjs` (which reads
 * ui-theme's sheets, the built frontend bundle and the UI primitives).
 */
function loadDesignTokens() {
  const frozen = path.join(HERE, 'design-tokens.txt')
  if (!fs.existsSync(frozen)) throw new Error('missing ' + frozen + ' — run tools/freeze-design-tokens.mjs')
  return new Set(fs.readFileSync(frozen, 'utf8').split('\n').filter(Boolean))
}

const designTokens = loadDesignTokens()
check(designTokens.size > 200, 'design-system token corpus loaded (' + designTokens.size + ' names)')

/**
 * Plugin-owned names plus the leaf tokens the theme contract explicitly lets a
 * composition rebind.
 */
const REBINDABLE = /^--(dsh-(scrollbar|content-font|windows|winui)-|ds-(font|ease|transition)-|dsw-(radius|focus-ring|shadow|elevation|mask|menu|font|corner)-|dsw-alias-settings-card-)/

const names = Object.keys(tokens)
const unknown = names.filter((name) => !designTokens.has(name) && !REBINDABLE.test(name))
check(unknown.length === 0, 'every override names a real design token or a documented rebindable' + (unknown.length ? ':\n         ' + unknown.join('\n         ') : ''))

// ------------------------------------------------ 6. radius ladder + CSS ---
// Issue guard: collapsing the scale onto near-duplicate values (2/4/5/7/8/8)
// made large panels read as squares and small controls look off by a pixel.
const RADIUS_ORDER = ['--dsw-radius-xs', '--dsw-radius-sm', '--dsw-radius-md', '--dsw-radius-lg', '--dsw-radius-xl', '--dsw-radius-panel']
const ladder = RADIUS_ORDER.map((name) => parseFloat(defaultTokens[name].light))
check(ladder.every((value) => Number.isFinite(value)), 'the radius ladder is all px values (' + ladder.join('/') + ')')
check(
  ladder.every((value, index) => index === 0 || value >= ladder[index - 1]),
  'the radius ladder never decreases (' + ladder.join('/') + ')',
)
check(ladder[0] === 2 && ladder[1] === 4, 'controls anchor on Fluent ControlCornerRadius 4 (' + ladder.slice(0, 2).join('/') + ')')
check(ladder[5] >= 8, 'the largest panel surface keeps room to breathe (' + ladder[5] + 'px)')

const badShape = []
const badValue = []
for (const [name, value] of Object.entries(tokens)) {
  if (typeof value !== 'object' || value === null || typeof value.light !== 'string' || typeof value.dark !== 'string') {
    badShape.push(name)
    continue
  }
  for (const mode of ['light', 'dark']) {
    const text = value[mode]
    const balanced = (text.match(/\(/g) || []).length === (text.match(/\)/g) || []).length
    if (text.trim() === '' || /undefined|null|NaN/.test(text) || !balanced || text.includes(';')) {
      badValue.push(name + '.' + mode + ' = ' + JSON.stringify(text))
    }
  }
}
check(badShape.length === 0, 'every override value is a { light, dark } string pair' + (badShape.length ? ': ' + badShape.join(', ') : ''))
check(badValue.length === 0, 'every override value is a well-formed CSS value' + (badValue.length ? ':\n         ' + badValue.join('\n         ') : ''))

const css = styles[0]?.textContent ?? ''
check((css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length, 'emitted stylesheet has balanced braces')
check(!/undefined|null/.test(css), 'emitted stylesheet contains no undefined/null')
check(css.includes('var(--dsw-font-family)'), 'stylesheet applies the Fluent font stack')
check(css.includes('::-webkit-scrollbar-thumb'), 'stylesheet ships the Windows 11 scrollbar')
check(css.includes('focus-visible'), 'stylesheet ships the Fluent focus rect')
check(css.includes('data-ds-dark-theme'), 'stylesheet handles the dark palette')
check(css.includes('data-menu-material'), 'stylesheet handles the acrylic flyout hairline')

// ------------------------------------------------------------------ report ---
console.log('design-system tokens: ' + designTokens.size + ', overrides: ' + names.length)
console.log(notes.join('\n'))
if (failures.length) {
  console.error('\nFAILURES:\n' + failures.join('\n'))
  process.exit(1)
}
console.log('\n' + notes.length + ' CHECKS PASSED')

// Functional + contract test for the dsh-winui-skin client bundle.
//
// 1. Loads lib/client.js the way the DSH browser module system does: a
//    `window.__ModuleLoader__.load({ id, factory })` registration, then
//    `factory(require)` -> CommonJS exports with `apply` / `inject`.
// 2. Runs `apply(ctx)` against a stub context and asserts the two effects
//    (token layer + stylesheet) are installed and both disposers work.
// 3. Validates every override token name against the shipped DSH design
//    system, frozen into design-tokens.txt by freeze-design-tokens.mjs, so a
//    typo can never silently no-op.
// 4. Validates the { light, dark } pair shape and the emitted CSS.
//
// Runs with plain Node and no dependencies: `node tools/test-skin.mjs`.

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const BUNDLE = path.join(ROOT, 'lib', 'client.js')

const failures = []
const notes = []
function check(ok, message) {
  if (ok) notes.push('  ok   ' + message)
  else failures.push('  FAIL ' + message)
}

// ---------------------------------------------------------------- 1. load ---
const source = fs.readFileSync(BUNDLE, 'utf8')
const styles = []
let registration

/** Minimal DOM node good enough for the accent probe and the <style> tag. */
function stubElement(tag) {
  return {
    tagName: tag.toUpperCase(),
    dataset: {},
    attributes: {},
    textContent: '',
    removed: false,
    parent: undefined,
    children: [],
    style: { cssText: '', color: '', backgroundColor: '' },
    setAttribute(name, value) {
      this.attributes[name] = value
    },
    getAttribute(name) {
      return this.attributes[name]
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

// A simulated Windows accent: the probe reads these through getComputedStyle.
let systemAccentColor = 'rgb(0, 117, 255)'
let systemAccentText = 'rgb(255, 255, 255)'
let systemColorSupported = true

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
  getComputedStyle: () => ({ color: systemAccentColor, backgroundColor: systemAccentText }),
  CSS: { supports: (property, value) => systemColorSupported && property === 'color' && (value === 'AccentColor' || value === 'AccentColorText') },
  addEventListener() {},
  removeEventListener() {},
  setInterval: () => 0,
  clearInterval() {},
}
sandbox.document.head.appendChild = (node) => {
  styles.push(node)
  return node
}
sandbox.window.document = sandbox.document
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.js' })

check(registration !== undefined, 'client.js registers with window.__ModuleLoader__.load')
check(registration?.id === 'dsh-winui-skin', 'module id equals the package name (got ' + JSON.stringify(registration?.id) + ')')

const required = []
const factory = registration?.factory
const loaded = typeof factory === 'function'
check(loaded, 'registration carries a factory function')
const mod = loaded ? factory((name) => {
  required.push(name)
  throw new Error('unexpected require(' + name + '): this skin must stay dependency-free')
}) : {}

check(typeof mod?.apply === 'function', 'exports.apply is a function')
check(Array.isArray(mod?.inject) && mod.inject.includes('theme'), 'exports.inject waits for the `theme` service')
check(required.length === 0, 'factory requires no modules (no React / no UI package)' + (required.length ? ': ' + required.join(', ') : ''))

// --------------------------------------------------------------- 2. apply ---
const effects = []
let overrideCall
const overrideCalls = []
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
      overrideCalls.push(tokens['--dsw-alias-brand-primary'].light)
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
// Snapshot the installed layer before disposal, so the contract checks below
// validate what apply() actually installed.
const installed = overrideCall
const installedCss = styles[0]?.textContent ?? ''
const probeBeforeDispose = sandbox.document.body.children.length
for (const dispose of disposers) dispose()
check(styles[0]?.removed === true, 'disposing removes the stylesheet (HMR / unload safe)')
check(overrideCall === undefined, 'disposing releases the token layer')
check(probeBeforeDispose === 1, 'apply mounts exactly one accent probe (got ' + probeBeforeDispose + ')')
check(sandbox.document.body.children.length === 0, 'disposing removes the accent probe')

// ------------------------------------------- 3. system accent binding ---
// apply() above ran against a simulated `AccentColor` of rgb(0, 117, 255), so
// the installed layer must already carry shades derived from it.
const systemAccent = { rgb: [0, 117, 255], onFill: [255, 255, 255] }
const derived = mod.buildTokens(systemAccent)
const fallback = mod.buildTokens(undefined)

check(
  installed?.tokens?.['--dsw-alias-brand-primary']?.light === derived['--dsw-alias-brand-primary'].light,
  'apply() binds the accent tokens to the system accent (' + installed?.tokens?.['--dsw-alias-brand-primary']?.light + ')',
)
check(
  derived['--dsw-alias-brand-primary'].light !== fallback['--dsw-alias-brand-primary'].light,
  'a system accent overrides the shipped WinUI blue',
)
check(
  /^#[0-9a-f]{6}$/.test(derived['--dsw-alias-brand-primary'].light)
  && /^#[0-9a-f]{6}$/.test(derived['--dsw-alias-brand-primary'].dark),
  'derived accent shades are hex colours (light ' + derived['--dsw-alias-brand-primary'].light + ', dark ' + derived['--dsw-alias-brand-primary'].dark + ')',
)
check(
  derived['--dsw-alias-label-primary-foreground'].light === '#ffffff',
  'text on the accent comes from AccentColorText (got ' + derived['--dsw-alias-label-primary-foreground'].light + ')',
)
check(
  fallback['--dsw-alias-brand-primary'].light === '#0067c0' && fallback['--dsw-alias-brand-primary'].dark === '#4cc2ff',
  'without a readable system accent the WinUI default blue is restored',
)

// Text on an accent fill must actually be readable: a mid-light accent such as
// the lightened dark-mode fill gets black text, not white.
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

for (const [label, table] of [['system accent', derived], ['WinUI fallback', fallback]]) {
  for (const mode of ['light', 'dark']) {
    const fill = table['--dsw-alias-brand-primary'][mode]
    const onFill = table['--dsw-alias-label-primary-foreground'][mode]
    const ratio = contrast(fill, onFill)
    check(
      ratio >= 4.5,
      label + ' ' + mode + ': text on the accent fill keeps 4.5:1 (' + onFill + ' on ' + fill + ' = ' + ratio.toFixed(2) + ':1)',
    )
    const link = table['--dsw-alias-link'][mode]
    const base = table['--dsw-alias-bg-base'][mode]
    const linkRatio = contrast(base, link)
    check(
      linkRatio >= 4.5,
      label + ' ' + mode + ': accent links keep 4.5:1 on the canvas (' + link + ' on ' + base + ' = ' + linkRatio.toFixed(2) + ':1)',
    )
  }
}

// ------------------------------------------------ 4. radius ladder ---
// Issue guard: collapsing the scale onto near-duplicate values (2/4/5/7/8/8)
// made large panels read as squares and small controls look off by a pixel.
const RADIUS_ORDER = ['--dsw-radius-xs', '--dsw-radius-sm', '--dsw-radius-md', '--dsw-radius-lg', '--dsw-radius-xl', '--dsw-radius-panel']
const ladder = RADIUS_ORDER.map((name) => parseFloat(fallback[name].light))
check(ladder.every((value) => Number.isFinite(value)), 'the radius ladder is all px values (' + ladder.join('/') + ')')
check(
  ladder.every((value, index) => index === 0 || value >= ladder[index - 1]),
  'the radius ladder never decreases (' + ladder.join('/') + ')',
)
check(ladder[0] === 2 && ladder[1] === 4, 'controls anchor on Fluent ControlCornerRadius 4 (' + ladder.slice(0, 2).join('/') + ')')
check(ladder[5] >= 8, 'the largest panel surface keeps room to breathe (' + ladder[5] + 'px)')

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

const tokens = installed?.tokens ?? {}
const names = Object.keys(tokens)
check(names.length > 90, 'token layer is substantial (' + names.length + ' overrides)')

const unknown = names.filter((name) => !designTokens.has(name) && !REBINDABLE.test(name))
check(unknown.length === 0, 'every override names a real design token or a documented rebindable' + (unknown.length ? ':\n         ' + unknown.join('\n         ') : ''))

// ------------------------------------------------- 4. value shape + CSS ---
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
    if (text.trim() === '' || /undefined|null|NaN/.test(text) || !balanced || /^['"]\s*;/.test(text)) {
      badValue.push(name + '.' + mode + ' = ' + JSON.stringify(text))
    }
    if (/;\s*$/.test(text) || text.includes(';')) badValue.push(name + '.' + mode + ' contains a semicolon')
  }
}
check(badShape.length === 0, 'every override value is a { light, dark } string pair' + (badShape.length ? ': ' + badShape.join(', ') : ''))
check(badValue.length === 0, 'every override value is a well-formed CSS value' + (badValue.length ? ':\n         ' + badValue.join('\n         ') : ''))

const css = installedCss
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
console.log('\nALL CHECKS PASSED')

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
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        dataset: {},
        textContent: '',
        removed: false,
        remove() {
          this.removed = true
        },
      }
    },
    head: {
      appendChild(node) {
        styles.push(node)
        return node
      },
    },
  },
}
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
for (const dispose of disposers) dispose()
check(styles[0]?.removed === true, 'disposing removes the stylesheet (HMR / unload safe)')
check(overrideCall === undefined, 'disposing releases the token layer')

// ------------------------------------------------ 3. token-name contract ---
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

// Visual + runtime verification of a running DSH web profile, driven over the
// Chrome DevTools Protocol with a headless Edge/Chrome.
//
//   node tools/verify-visual.mjs "<url-with-token>" <out-dir>
//
// Produces light / dark / unloaded screenshots and dumps the resolved design
// tokens the skin overrides, plus every console message and page exception so a
// crashing client plugin cannot pass unnoticed. Only Node built-ins are used
// (global WebSocket landed in Node 22).

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const target = process.argv[2]
const outDir = process.argv[3] ?? path.join(HERE, '..', 'docs', 'preview')
const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9333

fs.mkdirSync(outDir, { recursive: true })
const report = []
const log = (...parts) => {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')
  report.push(line)
  console.log(line)
}

/** Tokens worth printing: one per family the skin touches. */
const PROBE = [
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-specific-sidebar-fill',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l4',
  '--dsw-alias-brand-primary',
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-font-family',
  '--ds-font-family-code',
  '--dsw-radius-sm',
  '--dsw-radius-panel',
  '--dsh-scrollbar-width',
  '--dsh-scrollbar-thumb-border',
  '--dsw-menu-surface-fill',
  '--dsw-menu-backdrop-filter',
  '--dsw-elevation-stroke-color',
  '--dsw-focus-ring-color',
]

const PROBE_JS = `(() => {
  const style = getComputedStyle(document.body)
  const out = {}
  for (const name of ${JSON.stringify(PROBE)}) out[name] = style.getPropertyValue(name).trim()
  const inline = document.body.getAttribute('style') ?? ''
  out['__inline-token-count'] = inline.split(';').filter((p) => p.trim().startsWith('--')).length
  out['__skin-style-tags'] = document.querySelectorAll('style[data-plugin="dsh-winui-skin"]').length
  out['__theme-style-tags'] = document.querySelectorAll('style[data-plugin^="@deepseek-ai/dsh-client-ui-theme"]').length
  out['__dark-attribute'] = document.body.hasAttribute('data-ds-dark-theme')
  out['__body-font'] = style.fontFamily
  out['__body-bg'] = style.backgroundColor
  out['__root-children'] = document.getElementById('root')?.childElementCount ?? -1
  out['__scrollbar-rule'] = [...document.styleSheets]
    .flatMap((sheet) => { try { return [...sheet.cssRules].map((r) => r.cssText) } catch { return [] } })
    .some((text) => text.includes('scrollbar-thumb') && text.includes('border-width'))
  return out
})()`

// ------------------------------------------------------------ CDP client ---
function connect(url) {
  const socket = new WebSocket(url)
  let nextId = 1
  const pending = new Map()
  const listeners = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined) {
      const entry = pending.get(message.id)
      if (entry) {
        pending.delete(message.id)
        message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result)
      }
      return
    }
    for (const listener of listeners) listener(message)
  })
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', reject)
  })
  return {
    ready,
    on: (listener) => listeners.push(listener),
    close: () => socket.close(),
    send(method, params = {}, sessionId) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      })
    },
  }
}

async function waitForDevTools(port, deadlineMs = 30000) {
  const started = Date.now()
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return await response.json()
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > deadlineMs) throw new Error('DevTools endpoint never came up')
    await new Promise((r) => setTimeout(r, 400))
  }
}

// ------------------------------------------------------------------- run ---
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winui-skin-edge-'))
const edge = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars=false',
    'about:blank',
  ],
  { stdio: 'ignore', detached: false },
)
log('edge pid', edge.pid)

let browser
const consoleMessages = []
const exceptions = []
try {
  const version = await waitForDevTools(PORT)
  log('browser', version.Browser)
  browser = connect(version.webSocketDebuggerUrl)
  await browser.ready

  browser.on((message) => {
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = (message.params.args ?? [])
        .map((a) => (a.value !== undefined ? a.value : a.description ?? a.type))
        .join(' ')
      consoleMessages.push(message.params.type + ': ' + text)
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const d = message.params.exceptionDetails
      exceptions.push(`${d.text} ${d.exception?.description ?? ''} @ ${d.url ?? ''}:${d.lineNumber ?? '?'}`)
    }
  })

  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (method, params) => browser.send(method, params, sessionId)
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 940, deviceScaleFactor: 1, mobile: false })

  // The profile preference may be `system`, and the host machine is in dark
  // mode. Emulate `prefers-color-scheme` before navigating so the theme service
  // itself resolves each palette — editing the attribute by hand would leave the
  // token layer on the stale palette.
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  })

  await send('Page.navigate', { url: target })
  await new Promise((r) => setTimeout(r, 12000)) // SPA boot + SSE + client plugin tree

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(result.exceptionDetails.text))
    return result.result.value
  }
  async function shoot(name) {
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const file = path.join(outDir, name + '.png')
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
    const tokens = await evaluate(PROBE_JS)
    log('--- ' + name + ' -> ' + file)
    log(JSON.stringify(tokens, null, 2))
    return { file, tokens }
  }

  // Let the app's own prefers-color-scheme listener drive the palette switch.
  const light = await shoot('01-light')

  // The skin's accent source: the host route that reads the Windows accent
  // registry key. Fetched from the page so it goes through the same auth.
  const accentRoute = await evaluate(`(async () => {
    try {
      const response = await fetch('/api/dsh-winui-accent', { cache: 'no-store' })
      return response.status + ' ' + (await response.text()).slice(0, 200)
    } catch (error) {
      return 'ERR ' + error.message
    }
  })()`)
  log('accent route    : ' + accentRoute)

  // Anything drawing a ring is worth naming: the Fluent focus rect must not
  // land on elements the original skin left unringed.
  const focusDiag = await evaluate(`(() => {
    const describe = (el) => {
      const s = getComputedStyle(el)
      return {
        tag: el.tagName.toLowerCase(),
        class: typeof el.className === 'string' ? el.className.slice(0, 60) : String(el.className),
        attrs: [...el.attributes].map((a) => a.name).filter((n) => n !== 'class' && n !== 'style').slice(0, 8),
        text: (el.textContent ?? '').trim().slice(0, 24),
        outline: [s.outlineWidth, s.outlineStyle, s.outlineColor].join(' '),
        boxShadow: s.boxShadow.slice(0, 60),
        border: [s.borderTopWidth, s.borderTopStyle, s.borderTopColor].join(' '),
      }
    }
    const ringed = [...document.querySelectorAll('body *')].filter((el) => {
      const s = getComputedStyle(el)
      const width = parseFloat(s.outlineWidth)
      return s.outlineStyle !== 'none' && Number.isFinite(width) && width > 0
    })
    const visible = [...document.querySelectorAll('body *')].filter((el) => el.matches(':focus-visible'))
    return {
      activeElement: document.activeElement ? describe(document.activeElement) : null,
      ringedCount: ringed.length,
      ringed: ringed.slice(0, 6).map(describe),
      focusVisibleCount: visible.length,
      focusVisible: visible.slice(0, 6).map(describe),
    }
  })()`)
  log('--- focus / ring diagnostics')
  log(JSON.stringify(focusDiag, null, 2))

  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  })
  await new Promise((r) => setTimeout(r, 1800))
  const dark = await shoot('02-dark')

  // Dismiss the first-run notice so the shell itself (sidebar, composer,
  // transcript seat) is visible for inspection.
  const dismissed = await evaluate(`(async () => {
    const labels = ['继续', '稍后配置', '跳过', 'Continue', 'Later', 'Skip', 'OK', '知道了']
    const clicked = []
    for (let round = 0; round < 4; round++) {
      const button = [...document.querySelectorAll('button, [role=button]')]
        .find((b) => labels.some((l) => (b.textContent ?? '').trim() === l))
      if (!button) break
      clicked.push((button.textContent ?? '').trim())
      button.click()
      await new Promise((r) => setTimeout(r, 1500))
    }
    return clicked.length ? 'clicked: ' + clicked.join(' -> ') : 'no dismiss button found'
  })()`)
  log('dismiss notice  : ' + dismissed)
  await new Promise((r) => setTimeout(r, 2500))
  const appDark = await shoot('03-app-dark')

  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  })
  await new Promise((r) => setTimeout(r, 1800))
  const appLight = await shoot('04-app-light')

  // Corner-radius census: a skin that invents intermediate radii produces a
  // smear of near-duplicate values, which reads as "odd corners". Group every
  // rounded element by its computed radius so the distribution is visible.
  const radiusCensus = await evaluate(`(() => {
    const radiusTokens = {}
    const bodyStyle = getComputedStyle(document.body)
    for (const name of ['--dsw-radius-xs','--dsw-radius-sm','--dsw-radius-md','--dsw-radius-lg','--dsw-radius-xl','--dsw-radius-panel']) {
      radiusTokens[name] = bodyStyle.getPropertyValue(name).trim()
    }
    const groups = new Map()
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el)
      const radius = s.borderTopLeftRadius
      if (!radius || radius === '0px') continue
      const box = el.getBoundingClientRect()
      if (box.width < 6 || box.height < 6) continue
      const entry = groups.get(radius) ?? { count: 0, samples: [] }
      entry.count += 1
      if (entry.samples.length < 3) {
        entry.samples.push(
          el.tagName.toLowerCase()
          + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0].slice(0, 24) : '')
          + ' ' + Math.round(box.width) + 'x' + Math.round(box.height)
          + ' "' + (el.textContent ?? '').trim().slice(0, 14) + '"',
        )
      }
      groups.set(radius, entry)
    }
    return {
      radiusTokens,
      distribution: [...groups.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([radius, v]) => radius + ' x' + v.count + '  e.g. ' + v.samples.join(' | ')),
    }
  })()`)
  log('')
  log('--- corner-radius census (light)')
  log(JSON.stringify(radiusCensus, null, 2))

  // Settings is the densest surface (cards, switches, steppers), so capture it
  // too: it is where an inconsistent radius scale shows up first.
  const openedSettings = await evaluate(`(async () => {
    const candidates = [...document.querySelectorAll('button, a, [role=button], [role=menuitem], [role=tab], li, div')]
      .filter((el) => (el.textContent ?? '').trim() === '设置' || (el.textContent ?? '').trim() === 'Settings')
    const target = candidates.at(-1)
    if (!target) return 'settings entry not found'
    target.click()
    await new Promise((r) => setTimeout(r, 2500))
    return 'clicked settings'
  })()`)
  log('settings        : ' + openedSettings)
  await new Promise((r) => setTimeout(r, 1500))
  const settingsLight = await shoot('05-settings-light')

  // Attribute every rounded surface on the densest page to the exact token it
  // reads: overwrite the six radius tokens with distinct odd values, census,
  // then restore. The plain census shows the resulting px, not who asked for it.
  const attribution = await evaluate(`(() => {
    const sentinel = {
      '--dsw-radius-xs': '11px',
      '--dsw-radius-sm': '13px',
      '--dsw-radius-md': '15px',
      '--dsw-radius-lg': '17px',
      '--dsw-radius-xl': '19px',
      '--dsw-radius-panel': '21px',
    }
    const inverse = Object.fromEntries(Object.entries(sentinel).map(([k, v]) => [v, k]))
    const previous = {}
    for (const [name, value] of Object.entries(sentinel)) {
      previous[name] = document.body.style.getPropertyValue(name)
      document.body.style.setProperty(name, value)
    }
    const groups = {}
    for (const el of document.querySelectorAll('body *')) {
      const radius = getComputedStyle(el).borderTopLeftRadius
      const token = inverse[radius]
      if (!token) continue
      const box = el.getBoundingClientRect()
      if (box.width < 6 || box.height < 6) continue
      const entry = groups[token] ?? (groups[token] = { count: 0, samples: [] })
      entry.count += 1
      if (entry.samples.length < 5) {
        entry.samples.push(
          el.tagName.toLowerCase()
          + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0].slice(0, 22) : '')
          + ' ' + Math.round(box.width) + 'x' + Math.round(box.height)
          + ' "' + (el.textContent ?? '').trim().slice(0, 12) + '"',
        )
      }
    }
    for (const name of Object.keys(sentinel)) {
      if (previous[name]) document.body.style.setProperty(name, previous[name])
      else document.body.style.removeProperty(name)
    }
    return Object.fromEntries(Object.entries(groups).map(([token, v]) => [
      token,
      v.count + ' surfaces  e.g. ' + v.samples.join(' | '),
    ]))
  })()`)
  log('--- radius token attribution (settings page, light)')
  log(JSON.stringify(attribution, null, 2))

  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  })
  await new Promise((r) => setTimeout(r, 1800))
  const settingsDark = await shoot('06-settings-dark')

  // Remove exactly what the plugin installs, to prove the look came from it.
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  })
  await new Promise((r) => setTimeout(r, 1200))
  await evaluate(`(() => {
    for (const tag of document.querySelectorAll('style[data-plugin="dsh-winui-skin"]')) tag.remove()
    for (const name of ${JSON.stringify(PROBE)}) document.body.style.removeProperty(name)
    document.body.removeAttribute('data-ds-dark-theme')
    return true
  })()`)
  await new Promise((r) => setTimeout(r, 1200))
  const unloaded = await shoot('07-unloaded')

  log('')
  log('=== skin effect (light) ===')
  for (const name of ['--dsw-alias-bg-base', '--dsw-alias-brand-primary', '--dsw-font-family', '--dsw-radius-panel']) {
    log('  ' + name + ': ' + light.tokens[name] + '   -> unloaded: ' + unloaded.tokens[name])
  }
  log('inline tokens on <body>: ' + light.tokens['__inline-token-count'] + ' skin style tags: ' + light.tokens['__skin-style-tags'] + ' theme style tags: ' + light.tokens['__theme-style-tags'])
  log('scrollbar rule present: ' + light.tokens['__scrollbar-rule'])
  log('dark palette applied : ' + dark.tokens['__dark-attribute'] + ' bg=' + dark.tokens['--dsw-alias-bg-base'])
  log('body font            : ' + light.tokens['__body-font'])

  log('')
  log('=== console (' + consoleMessages.length + ' messages) ===')
  for (const message of consoleMessages.slice(-40)) log('  ' + message)
  log('=== exceptions (' + exceptions.length + ') ===')
  for (const exception of exceptions.slice(-20)) log('  ' + exception)
} catch (error) {
  log('VERIFY FAILED: ' + (error && error.stack ? error.stack : String(error)))
  process.exitCode = 1
} finally {
  fs.writeFileSync(path.join(outDir, 'verify.log'), report.join('\n') + '\n')
  try { browser?.close() } catch { /* ignore */ }
  edge.kill()
}

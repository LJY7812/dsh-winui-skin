// Capability probe: can a web page see the Windows accent colour and the
// system palette? Drives headless Edge over CDP with no dependencies.
//
//   node tools/probe-system-colors.mjs
//
// A page can read the OS accent only through the CSS system-colour keywords
// (AccentColor / AccentColorText). There is no standard media query or JS API,
// so this reports whether the keywords resolve on this engine and to what.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9334

const PROBE = `(() => {
  const keywords = [
    'AccentColor', 'AccentColorText',
    'Canvas', 'CanvasText', 'LinkText', 'VisitedText', 'ButtonText', 'ButtonFace',
    'Highlight', 'HighlightText', 'GrayText', 'Field', 'FieldText',
  ]
  const out = { keywords: {} }
  for (const keyword of keywords) {
    const probe = document.createElement('span')
    probe.style.color = keyword
    document.body.appendChild(probe)
    const resolved = getComputedStyle(probe).color
    // An unsupported keyword invalidates the declaration, leaving the inherited colour.
    out.keywords[keyword] = resolved
    probe.remove()
  }
  const supports = (property, value) => CSS.supports(property, value)
  out.supportsAccentColorProperty = supports('color', 'AccentColor')
  out.supportsAccentColorAccentProperty = supports('accent-color', 'AccentColor')
  out.supportsAccentColorText = supports('color', 'AccentColorText')
  out.prefersDark = matchMedia('(prefers-color-scheme: dark)').matches
  out.prefersContrastMore = matchMedia('(prefers-contrast: more)').matches
  out.forcedColors = matchMedia('(forced-colors: active)').matches
  out.baseline = getComputedStyle(document.documentElement).color
  return out
})()`

function connect(url) {
  const socket = new WebSocket(url)
  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = message.id !== undefined ? pending.get(message.id) : undefined
    if (!entry) return
    pending.delete(message.id)
    message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result)
  })
  return {
    ready: new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve)
      socket.addEventListener('error', reject)
    }),
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
    } catch { /* not up yet */ }
    if (Date.now() - started > deadlineMs) throw new Error('DevTools endpoint never came up')
    await new Promise((r) => setTimeout(r, 400))
  }
}

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-syscolor-'))
const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  'about:blank',
], { stdio: 'ignore' })

let browser
try {
  const version = await waitForDevTools(PORT)
  console.log('browser:', version.Browser)
  browser = connect(version.webSocketDebuggerUrl)
  await browser.ready
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
  await browser.send('Runtime.enable', {}, sessionId)
  const result = await browser.send('Runtime.evaluate', { expression: PROBE, returnByValue: true }, sessionId)
  console.log(JSON.stringify(result.result.value, null, 2))
} catch (error) {
  console.error('PROBE FAILED:', error.message)
  process.exitCode = 1
} finally {
  try { browser?.close() } catch { /* ignore */ }
  edge.kill()
}

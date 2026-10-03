// Freeze the shipped DSH design-system custom-property names into
// design-tokens.txt, the fixture the contract test validates override names
// against. Re-run it when DSH adds or renames tokens.
//
// The token names live in the built packages, not in this repo, so point the
// script at an extracted copy of the DSH app. For a Desktop install:
//
//   node tools/asar.mjs extract <dest> /dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/
//   node tools/asar.mjs extract <dest> /dsh/node_modules/@deepseek-ai/dsh-web-frontend/
//   node tools/asar.mjs extract <dest> /dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives/
//   node tools/freeze-design-tokens.mjs <dest>/dsh/node_modules/@deepseek-ai
//
// Any directory works: the script walks it and collects every `--custom-prop:`
// declaration it finds in .css / .js / .ts files.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const sources = process.argv.slice(2)
const out = path.join(HERE, 'design-tokens.txt')

if (sources.length === 0) {
  console.error('usage: node tools/freeze-design-tokens.mjs <extracted-dsh-dir> [more dirs...]')
  process.exit(2)
}

const names = new Set()
const declaration = /(^|[;{"'\s,(])(--[a-z0-9-]+)\s*:/gi
const walk = (directory) => {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(css|js|ts)$/.test(entry.name)) {
      const text = fs.readFileSync(full, 'utf8')
      let match
      while ((match = declaration.exec(text)) !== null) names.add(match[2])
    }
  }
}
for (const source of sources) walk(source)

const sorted = [...names].sort()
fs.writeFileSync(out, sorted.join('\n') + '\n')
console.log('wrote ' + sorted.length + ' token names to ' + out)

// Pull the inlined CSS string literals out of a built client.js into readable .css files.
import fs from 'node:fs'
import path from 'node:path'

const src = process.argv[2]
const outDir = process.argv[3]
const text = fs.readFileSync(src, 'utf8')
fs.mkdirSync(outDir, { recursive: true })

// var <name>_css_default = "<escaped>";
const re = /var\s+([A-Za-z0-9_$]+)_css_default\s*=\s*("(?:[^"\\]|\\.)*")/g
let m
let n = 0
while ((m = re.exec(text)) !== null) {
  const name = m[1]
  let css
  try {
    css = JSON.parse(m[2])
  } catch (e) {
    css = m[2].slice(1, -1)
  }
  fs.writeFileSync(path.join(outDir, name + '.css'), css)
  n += 1
}
console.log('wrote ' + n + ' css files to ' + outDir)

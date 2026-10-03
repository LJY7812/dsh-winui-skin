// Minimal Electron asar reader: list / extract.
import fs from 'node:fs'
import path from 'node:path'

const ASAR = process.env.ASAR || 'C:/Users/Alllllllllan/AppData/Local/Programs/DeepSeek Harness/resources/app.asar'

let headerCache = null
function header() {
  if (headerCache) return headerCache
  const fd = fs.openSync(ASAR, 'r')
  const sizeBuf = Buffer.alloc(16)
  fs.readSync(fd, sizeBuf, 0, 16, 0)
  const headerSize = sizeBuf.readUInt32LE(12)
  const jsonBuf = Buffer.alloc(headerSize)
  fs.readSync(fd, jsonBuf, 0, headerSize, 16)
  fs.closeSync(fd)
  const offset = 16 + headerSize
  headerCache = { json: JSON.parse(jsonBuf.toString('utf8')), offset }
  return headerCache
}

function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const p = prefix + '/' + name
    if (entry.files) walk(entry, p, out)
    else out.push([p, entry.size, entry.offset, entry.unpacked === true])
  }
}

export function list() {
  const out = []
  walk(header().json, '', out)
  return out
}

export function readFile(inner) {
  const { offset } = header()
  const found = list().find(([p]) => p === inner)
  if (!found) throw new Error('not found: ' + inner)
  const [, size, off, unpacked] = found
  if (unpacked) throw new Error('unpacked, read from .unpacked: ' + inner)
  const fd = fs.openSync(ASAR, 'r')
  const buf = Buffer.alloc(size)
  fs.readSync(fd, buf, 0, size, offset + Number(off))
  fs.closeSync(fd)
  return buf
}

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'list') {
  const pat = arg ? new RegExp(arg, 'i') : null
  for (const [p, size] of list()) if (!pat || pat.test(p)) console.log(size + '\t' + p)
} else if (cmd === 'cat') {
  process.stdout.write(readFile(arg))
} else if (cmd === 'extract') {
  const [dest, prefix] = [arg, process.argv[4]]
  let count = 0
  const skipped = []
  for (const [p] of list()) {
    if (prefix && !p.startsWith(prefix)) continue
    const target = path.join(dest, p.replace(/^\//, ''))
    try {
      const buf = readFile(p)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, buf)
      count += 1
    } catch (e) {
      skipped.push(p + ' :: ' + e.message)
    }
  }
  console.log('extracted ' + count + ', skipped ' + skipped.length)
  if (skipped.length) fs.writeFileSync(path.join(dest, '_skipped.txt'), skipped.join('\n'))
}

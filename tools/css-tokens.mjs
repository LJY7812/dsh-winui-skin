import fs from 'node:fs'
const file = process.argv[2]
const filter = new RegExp(process.argv[3] || '^--dsw-')
let css = fs.readFileSync(file, 'utf8')
// crude selector/decl split
const out = []
const re = /([^{}]+)\{([^{}]*)\}/g
let m
while ((m = re.exec(css)) !== null) {
  const sel = m[1].trim().replace(/\s+/g, ' ')
  if (sel.startsWith('@')) continue
  const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean)
  const kept = decls.filter((d) => filter.test(d.slice(0, d.indexOf(':'))))
  if (kept.length === 0) continue
  out.push('/* ' + sel + ' */')
  for (const d of kept) out.push('  ' + d + ';')
}
process.stdout.write(out.join('\n') + '\n')

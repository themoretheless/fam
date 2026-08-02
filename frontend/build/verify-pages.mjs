import { lstat, readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

const outputDir = resolve('dist-pages')

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Pages artifact contains a symlink: ${path}`)
    if (entry.isDirectory()) files.push(...(await listFiles(path)))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

const files = await listFiles(outputDir)
const names = files.map(path => relative(outputDir, path).split(sep).join('/'))

if (!names.includes('index.html')) throw new Error('Pages artifact has no index.html')
if (!names.includes('theme-init.js')) throw new Error('Pages artifact has no theme initializer')
if (!names.some(name => name.startsWith('assets/'))) {
  throw new Error('Pages artifact has no compiled assets')
}

const allowedRootFiles = new Set(['index.html', 'theme-init.js'])
for (const name of names) {
  const lower = name.toLowerCase()
  if (!name.includes('/') && !allowedRootFiles.has(name)) {
    throw new Error(`Unexpected root file in Pages artifact: ${name}`)
  }
  if (
    lower.endsWith('.map') ||
    lower.includes('.openai') ||
    lower.includes('drizzle') ||
    lower.includes('worker') ||
    lower.includes('server') ||
    lower.includes('.env') ||
    lower.includes('fam-data')
  ) {
    throw new Error(`Forbidden file in Pages artifact: ${name}`)
  }
}

const index = await readFile(join(outputDir, 'index.html'), 'utf8')
if (
  !index.includes('Content-Security-Policy') ||
  !/connect-src (?:'|&#39;)none(?:'|&#39;)/.test(index)
) {
  throw new Error('Pages index has no restrictive CSP')
}
if (!index.includes('/fam-pages/assets/') || !index.includes('/fam-pages/theme-init.js')) {
  throw new Error('Pages index does not use the /fam-pages/ base path')
}
if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(index)) {
  throw new Error('Pages index contains an inline script')
}

for (const name of names.filter(name => /\.(?:html|js|css)$/i.test(name))) {
  const path = join(outputDir, name)
  const stat = await lstat(path)
  if (stat.size > 5_000_000) throw new Error(`Unexpectedly large Pages file: ${name}`)
  const text = await readFile(path, 'utf8')
  if (/\/api\//.test(text)) throw new Error(`Server API reference leaked into ${name}`)
  if (/\bEventSource\b/.test(text)) throw new Error(`EventSource leaked into ${name}`)
  if (/\bfetch\s*\(/.test(text)) throw new Error(`Network fetch leaked into ${name}`)
  if (/sourceMappingURL/i.test(text)) throw new Error(`Source map reference leaked into ${name}`)
}

console.log(`Verified GitHub Pages artifact: ${names.length} files`)

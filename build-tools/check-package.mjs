import { extractFile, listPackage } from '@electron/asar'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? 'dist'
const archives = []
function walk(path) {
  for (const entry of readdirSync(path)) {
    const full = join(path, entry)
    if (entry === 'app.asar') archives.push(full)
    else if (statSync(full).isDirectory() && !entry.endsWith('.asar.unpacked')) walk(full)
  }
}
walk(root)
if (!archives.length) throw new Error('No packaged app.asar found')
for (const archive of archives) {
  const entries = listPackage(archive)
  for (const file of [
    'out/main/app.js',
    'out/preload/index.cjs',
    'out/renderer/index.html',
    'resources/icons/trayTemplate.png',
    'resources/icons/trayTemplate@2x.png',
    ...[16, 32, 64, 128, 256, 512, 1024].map((size) => `resources/icons/app/${size}x${size}.png`),
  ]) {
    if (!entries.includes('/' + file)) throw new Error(`Missing product entry: ${file}`)
  }
  const html = extractFile(archive, 'out/renderer/index.html').toString('utf8')
  const assets = [...html.matchAll(/(?:src|href)=["']\.?\/?(assets\/[^"']+)["']/g)].map(
    (match) => match[1],
  )
  if (
    !assets.some((asset) => asset.endsWith('.js')) ||
    !assets.some((asset) => asset.endsWith('.css'))
  )
    throw new Error('Missing renderer asset references')
  for (const asset of assets) {
    if (!entries.includes('/out/renderer/' + asset))
      throw new Error(`Missing bundled asset: ${asset}`)
  }
  if (!entries.some((entry) => /^\/out\/renderer\/assets\/diff\.worker-[^/]+\.js$/.test(entry)))
    throw new Error('Missing artifact comparison worker')
  for (const entry of entries) {
    const path = entry.replace(/^\//, '')
    const icon =
      /^resources\/icons\/app\/(16|32|64|128|256|512|1024)x\1\.png$/.test(path) ||
      /^resources\/icons\/trayTemplate(?:@2x)?\.png$/.test(path)
    const iconDirectory = /^resources(?:\/icons(?:\/app)?)?$/.test(path)
    if (
      !/^(out|node_modules)(\/|$)|^(package\.json|LICENSE)$/.test(path) &&
      !icon &&
      !iconDirectory
    )
      throw new Error(`Unexpected package content: ${path}`)
    if (/^(docs|assets|scripts|third-party|tests)\//.test(path) || /(^|\/)\._/.test(path))
      throw new Error(`Local material in package: ${path}`)
  }
  console.log(`${archive}: ${entries.length} entries checked; product allowlist only`)
}

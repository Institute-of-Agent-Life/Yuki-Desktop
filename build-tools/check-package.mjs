import { extractFile, listPackage, statFile, uncache } from '@electron/asar'
import { readdirSync, lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export function checkPackage(root) {
  const archives = []
  function walk(path) {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry)
      if (entry === 'app.asar') archives.push(full)
      else if (lstatSync(full).isDirectory() && !entry.endsWith('.asar.unpacked')) walk(full)
    }
  }
  walk(root)
  if (!archives.length) throw new Error('No packaged app.asar found')
  for (const archive of archives) {
    uncache(archive)
    const entries = listPackage(archive)
    for (const file of [
      'out/main/app.js',
      'out/preload/index.cjs',
      'out/renderer/index.html',
      'resources/icons/trayTemplate.png',
      'resources/icons/trayTemplate@2x.png',
      ...[
        'AUTHORS',
        'NOTICE.txt',
        'LICENSE.MPL-2.0',
        'LICENSE.BSD-2-Clause',
        'LICENSE.BSD-3-Clause',
        'LICENSE.OFL-1.1',
      ].map((name) => `resources/legal/novnc/${name}`),
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
      const legal =
        /^resources\/legal(?:\/novnc(?:\/(?:AUTHORS|NOTICE\.txt|LICENSE\.(?:MPL-2\.0|BSD-2-Clause|BSD-3-Clause|OFL-1\.1)))?)?$/.test(
          path,
        )
      if (
        !/^(out|node_modules)(\/|$)|^(package\.json|LICENSE)$/.test(path) &&
        !icon &&
        !legal &&
        !iconDirectory
      )
        throw new Error(`Unexpected package content: ${path}`)
      if (/^(docs|assets|scripts|third-party|tests)\//.test(path) || /(^|\/)\._/.test(path))
        throw new Error(`Local material in package: ${path}`)
      const info = statFile(archive, path)
      // Native unpacked prebuilts are selected in afterPack and checked for their target.
      // Packed JavaScript must match both the full-file and Electron block digests.
      if (!info.files && !info.link && !info.unpacked) {
        const content = extractFile(archive, path)
        const integrity = info.integrity
        const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
        if (
          !integrity ||
          integrity.algorithm !== 'SHA256' ||
          !/^[0-9a-f]{64}$/.test(integrity.hash) ||
          !Number.isSafeInteger(integrity.blockSize) ||
          integrity.blockSize <= 0 ||
          !Array.isArray(integrity.blocks) ||
          integrity.blocks.length !==
            Math.max(1, Math.ceil(content.length / integrity.blockSize)) ||
          !integrity.blocks.every((block) => /^[0-9a-f]{64}$/.test(block))
        )
          throw new Error(`Invalid packaged integrity: ${path}`)
        if (content.length !== info.size || digest(content) !== integrity.hash)
          throw new Error(`Corrupt packaged file: ${path}`)
        for (let block = 0; block < integrity.blocks.length; block++) {
          const start = block * integrity.blockSize
          if (
            digest(content.subarray(start, start + integrity.blockSize)) !== integrity.blocks[block]
          )
            throw new Error(`Corrupt packaged block: ${path} (${block})`)
        }
      }
    }
    console.log(
      `${archive}: ${entries.length} entries checked; product allowlist and packed-file integrity verified`,
    )
  }

  return archives.length
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  checkPackage(process.argv[2] ?? 'dist')

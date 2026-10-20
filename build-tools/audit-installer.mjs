import { mkdtemp, readdir, lstat, readlink, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute, basename } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { getPath7za } from 'app-builder-lib/out/toolsets/7zip.js'
import { checkPackage } from './check-package.mjs'

const run = promisify(execFile)
const forbidden =
  /(^|\/)(?:docs|prototype|previews|screens|scripts|third-party|AGENTS\.md|LOCAL-README\.md|INTEGRATION\.md|NOTICE\.md|實作進度\.md|修訂與拆倉紀錄[^/]*|驗證證據)(\/|$)/i
async function inspectTree(root, path = root) {
  for (const entry of await readdir(path)) {
    const full = join(path, entry),
      name = relative(root, full).replaceAll('\\', '/')
    if (forbidden.test(name)) throw Error(`Local material in installer: ${name}`)
    const stat = await lstat(full)
    if (entry === 'app.asar' && stat.isFile()) {
      for (const sibling of await readdir(path))
        if (
          ![
            'app.asar',
            'app.asar.unpacked',
            'app-update.yml',
            'icon.icns',
            'elevate.exe',
            'package-type',
            'apparmor-profile',
          ].includes(sibling) &&
          !/^[a-z]{2,3}(?:_[A-Z]{2}|_[0-9]{3})?\.lproj$/.test(sibling)
        )
          throw Error(`Unexpected application resource: ${sibling}`)
    }
    if (stat.isSymbolicLink()) {
      const destination = resolve(path, await readlink(full)),
        local = relative(root, destination).replaceAll('\\', '/')
      if (isAbsolute(local) || local === '..' || local.startsWith('..' + '/'))
        throw Error(`Escaping installer link: ${name}`)
    } else if (stat.isDirectory()) await inspectTree(root, full)
  }
}
async function extract7z(file, target) {
  const tool = await getPath7za()
  const { stdout } = await run(tool, ['l', '-slt', file], { maxBuffer: 16 * 1024 * 1024 })
  for (const match of stdout
    .split('----------')
    .slice(1)
    .join('----------')
    .matchAll(/^Path = (.+)$/gm)) {
    const path = match[1].replaceAll('\\', '/')
    if (
      path.startsWith('/') ||
      /^[A-Za-z]:/.test(path) ||
      path.split('/').includes('..') ||
      forbidden.test(path)
    )
      throw Error(`Unsafe installer entry: ${path}`)
  }
  await mkdir(target, { recursive: true })
  await run(tool, ['x', '-y', `-o${target}`, file], { maxBuffer: 1024 * 1024 })
}
async function findPayloads(root, pattern) {
  const result = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push(...(await findPayloads(path, pattern)))
    else if (pattern.test(entry.name)) result.push(path)
  }
  return result
}
/** Extract the actual distributable; file names alone are never an upload audit. */
export async function auditInstaller(input) {
  const file = resolve(input),
    root = await mkdtemp(join(tmpdir(), 'yuki-installer-audit-'))
  let mounted = false,
    content = join(root, 'content')
  try {
    if (file.endsWith('.dmg')) {
      if (process.platform !== 'darwin') throw Error('DMG audit requires macOS hdiutil')
      await mkdir(content)
      await run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', content, file])
      mounted = true
      const apps = (await readdir(content)).filter((name) => name.endsWith('.app'))
      if (apps.length !== 1) throw Error('Expected one application in DMG')
      for (const entry of await readdir(content))
        if (
          ![
            apps[0],
            'Applications',
            '.DS_Store',
            '.VolumeIcon.icns',
            '.background',
            '.background.tiff',
            '.fseventsd',
            '.Trashes',
          ].includes(entry)
        )
          throw Error(`Unexpected DMG root entry: ${entry}`)
      content = join(content, apps[0])
    } else if (/\.(zip|exe|deb|rpm)$/.test(file)) {
      await extract7z(file, content)
      await inspectTree(content)
      if (file.endsWith('.zip')) {
        const roots = await readdir(content)
        if (roots.length !== 1 || roots[0] !== 'Yuki.app')
          throw Error('Unexpected Mac zip root content')
      }
      const payloads = file.endsWith('.exe')
        ? await findPayloads(content, /^app-(?:32|64|arm64)\.7z$/)
        : file.endsWith('.deb')
          ? await findPayloads(content, /^data\.tar(?:\..+)?$/)
          : file.endsWith('.rpm')
            ? await findPayloads(content, /\.cpio(?:\..+)?$/)
            : []
      for (const [i, payload] of payloads.entries()) {
        const layer = join(root, `payload-${i}`)
        await extract7z(payload, layer)
        const nested = await findPayloads(layer, /^data\.tar$|\.cpio$/)
        if (nested.length)
          for (const [j, path] of nested.entries()) await extract7z(path, join(layer, `layer-${j}`))
        await inspectTree(layer)
        checkPackage(layer)
      }
      if (payloads.length) return { file: basename(file), payloads: payloads.length }
    } else if (file.endsWith('.AppImage')) {
      // The fixed builder tool detects SquashFS without executing the ELF runtime.
      await extract7z(file, content)
    } else throw Error('Unsupported installer format')
    await inspectTree(content)
    const archives = checkPackage(content)
    return { file: basename(file), archives }
  } finally {
    if (mounted) await run('hdiutil', ['detach', join(root, 'content')])
    await rm(root, { recursive: true, force: true })
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for (const file of process.argv.slice(2)) console.log(await auditInstaller(file))
  if (process.argv.length < 3) throw Error('Pass actual installer paths')
}

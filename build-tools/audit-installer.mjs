import {
  mkdtemp,
  readdir,
  lstat,
  readlink,
  rm,
  mkdir,
  readFile,
  realpath,
  copyFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute, basename, posix } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL, fileURLToPath, URL } from 'node:url'
import { getPath7za } from 'app-builder-lib/out/toolsets/7zip.js'
import { checkPackage } from './check-package.mjs'
import { inspectExecutable } from './native-prebuild.mjs'

const run = promisify(execFile)
const forbidden =
  /(^|\/)(?:docs|prototype|previews|screens|scripts|third-party|AGENTS\.md|LOCAL-README\.md|INTEGRATION\.md|NOTICE\.md|實作進度\.md|修訂與拆倉紀錄[^/]*|驗證證據)(\/|$)/i
// Python dependencies have their own scripts/licenses. Their exact files are
// checked against the product runtime manifest, outside the application ASAR.
const runtimeEntry = (name) => /(?:^|\/)resources\/agent-connector\//i.test(name)
async function inspectTree(root, path = root, target) {
  for (const entry of await readdir(path)) {
    const full = join(path, entry),
      name = relative(root, full).replaceAll('\\', '/')
    if (!runtimeEntry(name) && forbidden.test(name))
      throw Error(`Local material in installer: ${name}`)
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
            'agent-connector',
            'local-bot',
          ].includes(sibling) &&
          !/^[a-z]{2,3}(?:_[A-Z]{2}|_[0-9]{3})?\.lproj$/.test(sibling)
        )
          throw Error(`Unexpected application resource: ${sibling}`)
      if (target) {
        const executable =
          target.platform === 'darwin'
            ? join(path, '../MacOS/Yuki')
            : join(path, '..', target.platform === 'win32' ? 'Yuki.exe' : 'yuki-bin')
        await inspectExecutable(executable, target.platform, target.arch)
        if (target.platform === 'linux') {
          const launcher = await readFile(join(path, '../yuki'))
          const expected = await readFile(
            new URL('../resources/linux/yuki-launcher.sh', import.meta.url),
          )
          if (!launcher.equals(expected)) throw Error('Unverified Linux sandbox launcher')
        }
      }
    }
    if (stat.isSymbolicLink()) {
      const destination = resolve(path, await readlink(full)),
        local = relative(root, destination).replaceAll('\\', '/')
      if (isAbsolute(local) || local === '..' || local.startsWith('..' + '/'))
        throw Error(`Escaping installer link: ${name}`)
    } else if (stat.isDirectory()) await inspectTree(root, full, target)
  }
}
async function extract7z(file, target, tool) {
  const { stdout } = await run(tool, ['l', '-slt', file], { maxBuffer: 16 * 1024 * 1024 })
  const records = stdout
    .split('----------')
    .slice(1)
    .join('----------')
    .trim()
    .split(/\r?\n\r?\n/)
    .map((record) =>
      Object.fromEntries(
        record.split(/\r?\n/).flatMap((line) => {
          const match = /^([^=]+?) = (.*)$/.exec(line)
          return match ? [[match[1], match[2]]] : []
        }),
      ),
    )
  const buildIds = []
  for (const entry of records) {
    if (!entry.Path) continue
    const path = entry.Path.replaceAll('\\', '/')
    if (
      path.startsWith('/') ||
      /^[A-Za-z]:/.test(path) ||
      path.split('/').includes('..') ||
      (!runtimeEntry(path) && forbidden.test(path))
    )
      throw Error(`Unsafe installer entry: ${path}`)
    if (
      /^Type = Cpio$/m.test(stdout.replaceAll('\r', '')) &&
      /^usr\/lib\/\.build-id\/[a-f0-9]{2}\/[a-f0-9]{38}$/.test(posix.normalize(path)) &&
      (entry.Mode?.startsWith('l') || entry['Symbolic Link'])
    ) {
      // Older Windows 7-Zip exposes the POSIX link mode but omits its target.
      // Read only that entry to stdout; never extract an unchecked link.
      const link =
          entry['Symbolic Link'] ||
          (await run(tool, ['x', '-so', file, entry.Path], { maxBuffer: 4096 })).stdout,
        destination = posix.normalize(posix.join(posix.dirname(path), link)),
        source = records.find(
          (item) => item.Path && posix.normalize(item.Path.replaceAll('\\', '/')) === destination,
        )
      if (
        posix.isAbsolute(link) ||
        link.includes('\\') ||
        !/^opt\/Yuki\/[A-Za-z0-9_.-]+$/.test(destination) ||
        !source?.Mode?.startsWith('-') ||
        source['Symbolic Link']
      )
        throw Error(`Unsafe RPM build-id link: ${path}`)
      buildIds.push({ path: entry.Path, destination })
    }
  }
  await mkdir(target, { recursive: true })
  // RPM build-id links use parent segments that 7-Zip rejects even within the
  // payload. Validate their metadata and extracted regular-file targets without
  // materializing the links; all other entries retain 7-Zip's safe extraction.
  await run(tool, ['x', '-y', `-o${target}`, ...buildIds.map(({ path }) => `-x!${path}`), file], {
    maxBuffer: 1024 * 1024,
  })
  const canonicalRoot = await realpath(target)
  for (const { destination } of buildIds) {
    const full = join(target, destination)
    if (
      !(await lstat(full)).isFile() ||
      (await realpath(full)) !== join(canonicalRoot, destination)
    )
      throw Error(`Unsafe RPM build-id target: ${destination}`)
  }
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
  const label =
    /-(mac|win|linux)-(x64|arm64|x86_64|amd64|aarch64)\.(?:dmg|zip|exe|AppImage|deb|rpm)$/.exec(
      file,
    )
  const target = label
    ? {
        platform: { mac: 'darwin', win: 'win32', linux: 'linux' }[label[1]],
        arch: ['arm64', 'aarch64'].includes(label[2]) ? 'arm64' : 'x64',
      }
    : undefined
  let mounted = false,
    content = join(root, 'content')
  try {
    let tool
    if (process.platform === 'win32') {
      // The builder's standalone Windows 7za omits NSIS and CPIO. Reuse the
      // full tool pair already pinned by electron-winstaller in our lockfile.
      const vendor = new URL('./vendor/', import.meta.resolve('electron-winstaller/package.json')),
        tools = join(root, 'tools')
      await mkdir(tools)
      tool = join(tools, '7z.exe')
      await copyFile(fileURLToPath(new URL(`7z-${process.arch}.exe`, vendor)), tool)
      await copyFile(
        fileURLToPath(new URL(`7z-${process.arch}.dll`, vendor)),
        join(tools, '7z.dll'),
      )
    } else tool = await getPath7za()
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
      await extract7z(file, content, tool)
      await inspectTree(content, content, target)
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
        await extract7z(payload, layer, tool)
        const nested = await findPayloads(layer, /^data\.tar$|\.cpio$/)
        if (nested.length)
          for (const [j, path] of nested.entries())
            await extract7z(path, join(layer, `layer-${j}`), tool)
        await inspectTree(layer, layer, target)
        checkPackage(layer)
      }
      if (payloads.length) return { file: basename(file), payloads: payloads.length }
    } else if (file.endsWith('.AppImage')) {
      // The fixed builder tool detects SquashFS without executing the ELF runtime.
      await extract7z(file, content, tool)
    } else throw Error('Unsupported installer format')
    await inspectTree(content, content, target)
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

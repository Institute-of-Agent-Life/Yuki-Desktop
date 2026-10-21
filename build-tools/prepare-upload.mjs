import { readdir, readFile, mkdir, copyFile, writeFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { load, dump } from 'js-yaml'
import { valid, prerelease } from 'semver'
import { auditInstaller } from './audit-installer.mjs'
import { artifactName, hashFile } from './release-files.mjs'
export { artifactName, hashFile } from './release-files.mjs'

const installer =
  /^Yuki-([0-9A-Za-z.+-]+)-(mac|win|linux)-(x64|arm64|x86_64|amd64|aarch64)\.(dmg|zip|exe|AppImage|deb|rpm)$/
const feed = /^(latest|beta)(-mac|-linux(?:-arm64)?)?\.yml$/
function artifactTarget(name) {
  const value = installer.exec(name)
  if (!value) return null
  const [, version, os, label, ext] = value
  const arch = ['x64', 'x86_64', 'amd64'].includes(label) ? 'x64' : 'arm64'
  const formats = { mac: ['dmg', 'zip'], win: ['exe'], linux: ['AppImage', 'deb', 'rpm'] }
  return valid(version) === version &&
    formats[os].includes(ext) &&
    artifactName(version, os, arch, ext) === name
    ? { version, os, arch, ext }
    : null
}
/** No publishing. Only audited installers and verified feed references enter the new directory. */
export async function prepareUpload(
  sources,
  output,
  { complete = false, audit = auditInstaller, sourceMetadata = false } = {},
) {
  const files = new Map(),
    feeds = new Map(),
    audits = []
  let version
  for (const source of sources)
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (entry.isDirectory()) continue // Unpacked apps are audited through their actual installers.
      const path = join(source, entry.name)
      if (sourceMetadata && entry.name === 'SHA256SUMS') continue
      if (entry.name === 'builder-debug.yml' || entry.name === 'builder-effective-config.yaml')
        continue
      if (feed.test(entry.name)) {
        const value = load(await readFile(path, 'utf8'))
        if (!value || !valid(value.version) || !Array.isArray(value.files) || !value.files.length)
          throw Error(`Invalid feed: ${entry.name}`)
        if (version && version !== value.version) throw Error('Mixed release versions')
        version = value.version
        const beta = prerelease(version)?.[0]
        if ((beta && beta !== 'beta') || entry.name.startsWith('beta') !== !!beta)
          throw Error('Feed channel and version differ')
        const previous = feeds.get(entry.name)
        if (previous) previous.files.push(...value.files)
        else feeds.set(entry.name, globalThis.structuredClone(value))
        continue
      }
      const match =
        artifactTarget(entry.name) ||
        (entry.name.endsWith('.blockmap') && artifactTarget(entry.name.slice(0, -9)))
      if (!match) throw Error(`Unexpected upload candidate: ${entry.name}`)
      if (version && version !== match.version) throw Error('Mixed release versions')
      version = match.version
      const sha256 = await hashFile(path, 'sha256')
      const previous = files.get(entry.name)
      if (previous && previous.sha256 !== sha256) throw Error(`Conflicting artifact: ${entry.name}`)
      files.set(entry.name, { path, sha256, installer: !entry.name.endsWith('.blockmap') })
    }
  if (!version || !feeds.size || ![...files.values()].some((file) => file.installer))
    throw Error('No release installers and feeds')
  for (const [name, info] of feeds) {
    const unique = new Map()
    for (const item of info.files) {
      for (const field of Object.keys(item))
        if (!['url', 'sha512', 'size', 'blockMapSize', 'isAdminRightsRequired'].includes(field))
          throw Error(`Unexpected feed file field: ${field}`)
      if (
        typeof item.url !== 'string' ||
        basename(item.url) !== item.url ||
        !installer.test(item.url)
      )
        throw Error(`Unsafe feed reference: ${name}`)
      const file = files.get(item.url)
      const target = artifactTarget(item.url)
      const os = name.includes('-mac') ? 'mac' : name.includes('-linux') ? 'linux' : 'win'
      if (
        !target ||
        target.os !== os ||
        (os === 'linux' && target.arch !== (name.includes('-arm64') ? 'arm64' : 'x64'))
      )
        throw Error(`Feed platform mismatch: ${item.url}`)
      if (!file || item.sha512 !== (await hashFile(file.path, 'sha512', 'base64')))
        throw Error(`Feed hash mismatch or missing file: ${item.url}`)
      if (item.size !== undefined && item.size !== (await stat(file.path)).size)
        throw Error(`Feed size mismatch: ${item.url}`)
      const previous = unique.get(item.url)
      if (previous && JSON.stringify(previous) !== JSON.stringify(item))
        throw Error('Conflicting feed entries')
      unique.set(item.url, item)
    }
    info.files = [...unique.values()].sort((a, b) => a.url.localeCompare(b.url))
    const updateExtension = name.includes('-mac')
      ? '.zip'
      : name.includes('-linux')
        ? '.AppImage'
        : '.exe'
    if (!info.files.some((item) => item.url.endsWith(updateExtension)))
      throw Error(`Missing updater payload: ${name}`)
    const first = info.files[0]
    info.path = first.url
    info.sha512 = first.sha512
    if ('size' in first) info.size = first.size
    if (info.releaseName && typeof info.releaseName !== 'string')
      throw Error('Invalid release name')
    // Builder-provided notes are release content; no local paths or debug metadata are copied.
    const allowed = new Set([
      'version',
      'files',
      'path',
      'sha512',
      'size',
      'releaseDate',
      'releaseName',
      'releaseNotes',
      'minimumSystemVersion',
    ])
    for (const key of Object.keys(info))
      if (!allowed.has(key)) throw Error(`Unexpected feed field: ${key}`)
  }
  for (const [name, file] of files) {
    if (
      file.installer &&
      /\.(zip|exe|AppImage)$/.test(name) &&
      ![...feeds.values()].some((info) => info.files.some((item) => item.url === name))
    )
      throw Error(`Installer absent from update feed: ${name}`)
    if (name.endsWith('.blockmap') && !files.has(name.slice(0, -9))) throw Error('Orphan blockmap')
    if (file.installer) audits.push({ name, sha256: file.sha256, content: await audit(file.path) })
  }
  if (complete) {
    for (const [os, arch, ext] of [
      ['mac', 'arm64', 'dmg'],
      ['mac', 'arm64', 'zip'],
      ['mac', 'x64', 'dmg'],
      ['mac', 'x64', 'zip'],
      ['win', 'x64', 'exe'],
      ...['x64', 'arm64'].flatMap((arch) =>
        ['AppImage', 'deb', 'rpm'].map((ext) => ['linux', arch, ext]),
      ),
    ])
      if (!files.has(artifactName(version, os, arch, ext)))
        throw Error(`Missing release target: ${os}/${arch}/${ext}`)
    const channel = prerelease(version) ? 'beta' : 'latest'
    for (const suffix of ['', '-mac', '-linux', '-linux-arm64'])
      if (!feeds.has(`${channel}${suffix}.yml`)) throw Error(`Missing release feed: ${suffix}`)
  }
  // Refuse overwriting an earlier review directory.
  await mkdir(output)
  for (const [name, file] of files)
    await copyFile(file.path, join(output, name), constants.COPYFILE_EXCL)
  for (const [name, info] of feeds) await writeFile(join(output, name), dump(info), { flag: 'wx' })
  const manifest = { version, tag: `desktop-v${version}`, complete, contentAudits: audits }
  // Review records stay outside the public upload directory, including in CI.
  await writeFile(`${output}.local-audit.json`, JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx',
  })
  const sums = await Promise.all(
    [...files.keys(), ...feeds.keys()]
      .sort()
      .map(async (name) => `${await hashFile(join(output, name), 'sha256')}  ${name}\n`),
  )
  await writeFile(join(output, 'SHA256SUMS'), sums.join(''), { flag: 'wx' })
  return manifest
}
/** Merge reviewed native job outputs; hashes bind each audit to its original bytes. */
export async function mergeUploads(sources, output, complete = true) {
  const { verifyChecksums } = await import('./checksums.mjs')
  const records = new Map()
  for (const source of sources) {
    await verifyChecksums(source)
    const manifest = JSON.parse(await readFile(`${source}.local-audit.json`, 'utf8'))
    for (const record of manifest.contentAudits) {
      if (
        !(record.content?.archives > 0 || record.content?.payloads > 0) ||
        record.content.file !== record.name
      )
        throw Error('Missing native content audit')
      const hash = await hashFile(join(source, record.name), 'sha256')
      if (hash !== record.sha256) throw Error('Native audit hash differs')
      const previous = records.get(record.name)
      if (previous && previous.sha256 !== hash) throw Error('Conflicting native audits')
      records.set(record.name, record)
    }
  }
  return prepareUpload(sources, output, {
    complete,
    sourceMetadata: true,
    audit: async (file) => {
      const record = records.get(basename(file))
      if (!record || record.sha256 !== (await hashFile(file, 'sha256')))
        throw Error('Installer has no matching native audit')
      return record.content
    },
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2),
    merge = args[0] === '--merge'
  if (merge) args.shift()
  const complete = args[0] === '--complete'
  if (complete) args.shift()
  const [output, ...sources] = args
  if (!output || !sources.length)
    throw Error('Usage: prepare-upload.mjs [--merge] [--complete] NEW_OUTPUT SOURCE...')
  const manifest = merge
    ? await mergeUploads(sources, output, complete)
    : await prepareUpload(sources, output, { complete })
  console.log(
    `Prepared ${manifest.tag}; target set ${manifest.complete ? 'complete' : 'partial'}. Local review records are outside the upload directory. No publishing.`,
  )
}

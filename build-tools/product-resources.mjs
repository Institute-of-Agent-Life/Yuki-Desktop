import { createHash } from 'node:crypto'
import {
  readFileSync,
  readdirSync,
  lstatSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve, isAbsolute, sep } from 'node:path'

function entries(root, directory = root) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return lstatSync(path).isDirectory()
      ? entries(root, path)
      : [relative(root, path).replaceAll('\\', '/')]
  })
}
export function checkConnectorRuntime(
  runtime,
  manifest = JSON.parse(readFileSync(join(runtime, 'manifest.json'), 'utf8')),
) {
  const expected = new Set(['manifest.json', ...manifest.files.map((file) => file.path)])
  const actual = entries(runtime)
  if (actual.length !== expected.size || actual.some((path) => !expected.has(path)))
    throw new Error('Unexpected Connector runtime content')
  for (const file of manifest.files) {
    const path = resolve(runtime, file.path)
    const local = relative(runtime, path)
    if (isAbsolute(file.path) || local === '..' || local.startsWith('..' + sep))
      throw new Error('Invalid Connector runtime path')
    if (file.link !== undefined) {
      if (readlinkSync(path) !== file.link) throw new Error(`Changed Connector link: ${file.path}`)
    } else if (createHash('sha256').update(readFileSync(path)).digest('hex') !== file.sha256)
      throw new Error(`Changed Connector file: ${file.path}`)
  }
  if (
    !expected.has(manifest.executable) ||
    !expected.has('legal/Yuki-LICENSE') ||
    !expected.has('legal/dependency-lock.toml')
  )
    throw new Error('Incomplete Connector runtime')
  return manifest
}
export function refreshSignedConnectorFiles(runtime, manifest, signed) {
  const updated = {
    ...manifest,
    files: manifest.files.map((file) =>
      file.sha256 && signed.has(realpathSync(join(runtime, file.path)))
        ? {
            ...file,
            sha256: createHash('sha256')
              .update(readFileSync(join(runtime, file.path)))
              .digest('hex'),
          }
        : file,
    ),
  }
  checkConnectorRuntime(runtime, updated)
  writeFileSync(join(runtime, 'manifest.json'), JSON.stringify(updated, null, 2) + '\n')
  return updated
}
export function checkProductResources(resources) {
  const runtime = join(resources, 'agent-connector')
  const manifest = checkConnectorRuntime(runtime)
  const bot = join(resources, 'local-bot')
  const templates = [
    'manifest.json',
    '.env.example',
    'docker-compose.yml',
    'docker-compose.local.yml',
    'config/SOUL.md',
  ]
  const actualBot = entries(bot)
  if (actualBot.length !== templates.length || actualBot.some((path) => !templates.includes(path)))
    throw new Error('Unexpected local Bot resources')
  const source = JSON.parse(readFileSync(join(bot, 'manifest.json'), 'utf8'))
  if (!/^[0-9a-f]{40}$/.test(source.revision) || typeof source.image !== 'string')
    throw new Error('Missing local Bot source/image provenance')
  return { runtimeFiles: manifest.files.length + 1, botFiles: actualBot.length }
}

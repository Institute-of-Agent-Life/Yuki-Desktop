import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name) => args[args.indexOf(name) + 1]
if (!args.includes('--source'))
  throw new Error('Use --source with an explicitly checked-out compatible Yuki backend.')
const source = resolve(option('--source'))
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: source,
  encoding: 'utf8',
}).trim()
const version = (await readFile(join(source, 'pyproject.toml'), 'utf8')).match(
  /^version\s*=\s*"([^"]+)"/m,
)?.[1]
if (!version) throw new Error('Backend project version missing')
const image = args.includes('--image')
  ? option('--image')
  : `ghcr.io/yuanyeyoutao/yuki:desktop-${revision}`
const output = join(root, 'resources/local-bot')
for (const name of [
  '.env.example',
  'docker-compose.yml',
  'docker-compose.local.yml',
  'config/SOUL.md',
]) {
  await mkdir(dirname(join(output, name)), { recursive: true })
  await copyFile(join(source, name), join(output, name))
}
await writeFile(
  join(output, 'manifest.json'),
  JSON.stringify({ version, revision, image }, null, 2) + '\n',
)
console.log(`Prepared local Bot templates for ${revision} (${version})`)

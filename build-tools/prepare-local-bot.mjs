import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
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
// "Deploy to my server" uploads the same release installer and deployment package this backend
// publishes, built by the backend's own allowlist, so the server never needs to reach GitHub.
const built = await mkdtemp(join(tmpdir(), 'yuki-deploy-bundle-'))
try {
  execFileSync(
    'uv',
    [
      'run',
      '--no-project',
      '--python',
      '3.12',
      'python',
      '-m',
      'scripts.build_release_bundle',
      '--version',
      version,
      '--output-dir',
      built,
    ],
    { cwd: source, stdio: 'inherit' },
  )
  await rm(join(output, 'server'), { recursive: true, force: true })
  await mkdir(join(output, 'server'))
  for (const name of ['install.sh', `yuki-${version}-deploy.tar.gz`])
    await copyFile(join(built, name), join(output, 'server', name))
} finally {
  await rm(built, { recursive: true, force: true })
}
await writeFile(
  join(output, 'manifest.json'),
  JSON.stringify({ version, revision, image }, null, 2) + '\n',
)
console.log(`Prepared local Bot templates for ${revision} (${version})`)

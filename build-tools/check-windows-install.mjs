import { execFile } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL, URL } from 'node:url'
import { checkProductResources } from './product-resources.mjs'
import { artifactName } from './release-files.mjs'

const execute = promisify(execFile)

export async function checkInstalledWindowsRuntime(resources, dataDirectory, run = execute) {
  const checked = checkProductResources(resources)
  const runtime = join(resources, 'agent-connector')
  const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'))
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' }
  delete env.PYTHONPATH
  delete env.PYTHONHOME
  const { stdout } = await run(
    join(runtime, manifest.executable),
    [...manifest.arguments, '--data-dir', dataDirectory, 'status', '--json'],
    { env, windowsHide: true, encoding: 'utf8' },
  )
  const status = JSON.parse(stdout)
  if (
    status.version !== manifest.version ||
    status.protocol !== manifest.protocol ||
    status.paired !== false ||
    !Array.isArray(status.instances) ||
    status.instances.length !== 0 ||
    resolve(status.data_directory) !== resolve(dataDirectory)
  )
    throw Error('Installed Connector did not report the disposable unpaired installation')
  return { ...checked, version: status.version, protocol: status.protocol }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // /D isolates files, not the appId's registry, protocol or shortcuts. Use only an ephemeral OS.
  if (
    process.platform !== 'win32' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_ENVIRONMENT !== 'github-hosted'
  )
    throw Error(
      'Real NSIS installation verification requires a disposable GitHub-hosted Windows runner',
    )
  const output = resolve(process.argv[2] ?? 'dist')
  const { version } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  )
  const installer = join(output, artifactName(version, 'win', process.arch, 'exe'))
  const root = await mkdtemp(join(process.env.RUNNER_TEMP, 'yuki-nsis-install-'))
  const installation = join(root, 'Yuki')
  const dataDirectory = join(root, 'unpaired-connector')
  // NSIS requires /D last and unquoted. Assisted /S does not run the App after installation.
  await execute(installer, ['/S', '/currentuser', `/D=${installation}`], {
    windowsHide: true,
    windowsVerbatimArguments: true,
  })
  const checked = await checkInstalledWindowsRuntime(join(installation, 'resources'), dataDirectory)
  console.log(JSON.stringify({ installer, installation, installed: true, ...checked }))
  // The disposable runner owns registry/shortcuts and these files; retain them for failure inspection.
}

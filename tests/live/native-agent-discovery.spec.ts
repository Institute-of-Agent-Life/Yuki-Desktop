import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { isolatedDesktop } from '../fixtures/isolated-desktop'
import type { RuntimeManifest } from '../../src/main/connector-installation'

const enabled = process.env.YUKI_REAL_NATIVE_DISCOVERY === '1'
const expectedCommand = process.env.YUKI_NATIVE_DISCOVERY_EXPECT_COMMAND
const expectedSource = process.env.YUKI_NATIVE_DISCOVERY_EXPECT_SOURCE
const execute = promisify(execFile)
const canonical = (path: string) =>
  process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)

test('real Electron preload IPC discovers the selected installed Codex without pairing or a model turn', async () => {
  test.skip(!enabled, 'Opt in with YUKI_REAL_NATIVE_DISCOVERY=1; this never runs a model turn.')
  test.skip(
    !!process.env.CI && (!expectedCommand || !existsSync(expectedCommand)),
    'CI needs an explicitly selected installed Codex; ordinary CI has no native owner.',
  )
  expect(
    expectedCommand,
    'Set YUKI_NATIVE_DISCOVERY_EXPECT_COMMAND to the actual installed executable.',
  ).toBeTruthy()
  expect(isAbsolute(expectedCommand!)).toBe(true)
  expect(existsSync(expectedCommand!)).toBe(true)

  const root = test.info().outputPath('isolated-app')
  await mkdir(root, { recursive: true })
  const fixture = await isolatedDesktop(root)
  const profile = join(root, 'profile')
  const app = await fixture.launch('profile')
  let evidence: Record<string, unknown> = { scope: 'real Electron main/preload IPC discovery only' }
  try {
    const page = await app.firstWindow()
    const application = await app.evaluate(({ app }) => ({
      version: app.getVersion(),
      packaged: app.isPackaged,
      appPath: app.getAppPath(),
      userData: app.getPath('userData'),
      resourcesPath: process.resourcesPath,
    }))
    expect(canonical(application.userData)).toBe(canonical(profile))
    const runtime = application.packaged
      ? join(application.resourcesPath, 'agent-connector')
      : join(application.appPath, '.cache', 'connector-runtime')
    const manifestBytes = await readFile(join(runtime, 'manifest.json'))
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as RuntimeManifest
    const cli = await execute(
      resolve(runtime, manifest.executable),
      [...manifest.arguments, '--version'],
      { windowsHide: true, encoding: 'utf8', timeout: 10_000 },
    )
    expect(cli.stdout.trim()).toBe(manifest.version)
    expect(manifest.platform).toBe(process.platform)
    expect(manifest.arch).toBe(process.arch)
    const discovery = manifest.files.find((file) =>
      /yuki_agent_connector[\\/]discovery\.py$/.test(file.path),
    )
    expect(discovery).toBeDefined()
    const discoveryHash = createHash('sha256')
      .update(await readFile(join(runtime, discovery!.path)))
      .digest('hex')
    expect(discoveryHash).toBe(discovery!.sha256)

    // The expectations below are assertions only. The real preload, main process,
    // bundled CLI, Windows package lookup and PATH discovery are not replaced.
    const result = await page.evaluate(async () => window.yuki.connector.discover('codex'))
    evidence = {
      ...evidence,
      application,
      bundle: {
        version: manifest.version,
        cli_version: cli.stdout.trim(),
        protocol: manifest.protocol,
        runtime,
        manifest_sha256: createHash('sha256').update(manifestBytes).digest('hex'),
        discovery_sha256: discoveryHash,
      },
      result,
    }
    expect(result.ok).toBe(true)
    if (!result.ok) throw Error(result.code)
    const matching = result.value.filter(
      (candidate) => canonical(candidate.command) === canonical(expectedCommand!),
    )
    expect(
      matching,
      'The real installed command must be returned through the actual IPC.',
    ).toHaveLength(1)
    expect(matching[0]!.driver).toBe('codex')
    if (expectedSource)
      expect(matching[0]!.id).toBe(createHash('sha256').update(expectedSource).digest('hex'))

    const local = await app.evaluate(({ app }) => {
      const { createRequire } = process.getBuiltinModule('node:module')
      const { join } = process.getBuiltinModule('node:path')
      const { existsSync } = process.getBuiltinModule('node:fs')
      const require = createRequire(join(app.getAppPath(), 'package.json'))
      const Database = require('better-sqlite3')
      const root = app.getPath('userData')
      const db = new Database(join(root, 'desktop.sqlite3'), {
        readonly: true,
        fileMustExist: true,
      })
      try {
        const row = db
          .prepare(
            "SELECT json_array_length(value) AS count FROM preferences WHERE key='connections'",
          )
          .get()
        return {
          connections: row?.count ?? 0,
          selectedConnector: !!db
            .prepare("SELECT 1 FROM preferences WHERE key='agent-connector-installation'")
            .get(),
          installedRuntime: existsSync(join(root, 'agent-connector', 'runtimes')),
          installedNamespace: existsSync(join(root, 'agent-connector', 'installations')),
        }
      } finally {
        db.close()
      }
    })
    expect(local).toEqual({
      connections: 0,
      selectedConnector: false,
      installedRuntime: false,
      installedNamespace: false,
    })
    evidence = {
      ...evidence,
      matched: matching[0],
      expected_source_id: expectedSource
        ? createHash('sha256').update(expectedSource).digest('hex')
        : undefined,
      isolatedProfile: local,
    }
    await page.screenshot({ path: test.info().outputPath('isolated-app.png') })
  } finally {
    try {
      await writeFile(
        test.info().outputPath('discovery-result.json'),
        JSON.stringify(evidence, null, 2) + '\n',
      )
    } finally {
      await app.close()
    }
  }
})

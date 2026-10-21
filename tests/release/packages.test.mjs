import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createPackage, statFile } from '@electron/asar'
import { checkPackage } from '../../build-tools/check-package.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dump, load } from 'js-yaml'
import { getPath7za } from 'app-builder-lib/out/toolsets/7zip.js'
import { prepareUpload, mergeUploads } from '../../build-tools/prepare-upload.mjs'
import { verifyChecksums } from '../../build-tools/checksums.mjs'
import { auditInstaller } from '../../build-tools/audit-installer.mjs'
import { releaseChannel } from '../../build-tools/builder-config.mjs'
import { inspectPrebuild } from '../../build-tools/native-prebuild.mjs'
import { installLinuxLauncher } from '../../build-tools/linux-launcher.mjs'
import { getConfig, validateConfiguration } from 'app-builder-lib/out/util/config/config.js'
import { DebugLogger } from 'builder-util'

const run = promisify(execFile)
const sha512 = (body) => createHash('sha512').update(body).digest('base64')
// Feed and assembly unit tests substitute content inspection; archive rejection below uses real 7-Zip.
const audit = async (file) => ({ file: basename(file), archives: 1 })
test('stable and beta feeds are explicit and signing configurations resolve against the fixed builder schema', async () => {
  assert.equal(releaseChannel('1.0.0-beta.1'), 'beta')
  assert.equal(releaseChannel('1.0.0'), 'latest')
  assert.throws(() => releaseChannel('1.0.0-alpha.1'))
  assert.throws(() => releaseChannel('not-a-version'))
  for (const file of ['electron-builder.release-mac.yml', 'electron-builder.release-win.yml']) {
    const config = await getConfig(process.cwd(), file, null)
    await validateConfiguration(config, new DebugLogger(false))
    assert.equal(config.forceCodeSigning, true)
    assert.equal(config.publish.channel, 'beta')
    if (file.includes('mac')) {
      assert.equal(config.mac.hardenedRuntime, true)
      assert.equal(config.mac.notarize, true)
      assert.equal(config.dmg.writeUpdateInfo, false)
      assert.equal(config.dmg.sign, true)
    } else assert.ok(config.win.azureSignOptions.publisherName)
  }
})
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'yuki-release-unit-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
async function seed(root, label, arch, version = '1.0.0-beta.1') {
  const source = join(root, label)
  await mkdir(source)
  const name = `Yuki-${version}-mac-${arch}.zip`,
    body = Buffer.from(`assembly fixture ${arch}`)
  await writeFile(join(source, name), body)
  const info = {
    version,
    files: [{ url: name, sha512: sha512(body), size: body.length }],
    path: name,
    sha512: sha512(body),
    releaseDate: '2026-10-20T00:00:00Z',
  }
  const feedName = version.includes('beta') ? 'beta-mac.yml' : 'latest-mac.yml'
  await writeFile(join(source, feedName), dump(info))
  return { source, name, info, feedName }
}
test('Windows Git checkout preserves the exact frozen contract and generated type bytes', async () =>
  fixture(async (root) => {
    const source = join(root, 'source'),
      windows = join(root, 'windows'),
      contract = await readFile('contracts/client-api.openapi.json'),
      types = await readFile('src/shared/contract.gen.ts'),
      manifest = JSON.parse(await readFile('contracts/source.json', 'utf8'))
    await mkdir(source)
    await run('git', ['init', '--quiet', '--initial-branch=contract-fixture', source])
    await writeFile(join(source, '.gitattributes'), await readFile('.gitattributes'))
    await writeFile(join(source, 'contract.json'), contract)
    await writeFile(join(source, 'contract.gen.ts'), types)
    await run(
      'git',
      [
        '-c',
        'core.autocrlf=false',
        'add',
        '--',
        '.gitattributes',
        'contract.json',
        'contract.gen.ts',
      ],
      { cwd: source },
    )
    await run(
      'git',
      [
        '-c',
        'user.name=Contract fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'test fixture',
      ],
      { cwd: source },
    )
    await run('git', [
      '-c',
      'core.autocrlf=true',
      'clone',
      '--quiet',
      '--no-local',
      source,
      windows,
    ])
    assert.equal(
      createHash('sha256')
        .update(await readFile(join(windows, 'contract.json')))
        .digest('hex'),
      manifest.sha256,
    )
    assert.deepEqual(await readFile(join(windows, 'contract.gen.ts')), types)
  }))
test('fixed SQLite Node-API modules match all five shipped platform architectures and reject mismatches', async () => {
  for (const [platform, arch] of [
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['win32', 'x64'],
    ['linux', 'x64'],
    ['linux', 'arm64'],
  ]) {
    const file = join(
      process.cwd(),
      'node_modules',
      'better-sqlite3',
      'prebuilds',
      `${platform}-${arch}.node`,
    )
    await inspectPrebuild(file, platform, arch)
    await assert.rejects(
      inspectPrebuild(file, platform, arch === 'x64' ? 'arm64' : 'x64'),
      /Missing matching/,
    )
  }
})
test(
  'actual Linux launch wrapper removes the builder sandbox bypass and preserves deep links and argument boundaries',
  {
    skip:
      process.platform === 'win32' ? 'Unix product launcher; exercised on macOS and Linux.' : false,
  },
  async () =>
    fixture(async (root) => {
      const file = join(root, 'yuki'),
        output = join(root, 'arguments')
      await writeFile(file, '#!/bin/sh\nprintf \'%s\\0\' "$@" > "$YUKI_TEST_ARGUMENTS"\n', {
        mode: 0o755,
      })
      await installLinuxLauncher({ electronPlatformName: 'linux', appOutDir: root })
      const link =
        'yuki://pair?server=https%3A%2F%2Fexample.invalid%2Frole&code=DoNotExecute$(touch ignored)'
      await run(
        'bash',
        [file, '--no-sandbox', link, '--no-sandbox=true', 'value with spaces', '最後一項'],
        { env: { ...process.env, YUKI_TEST_ARGUMENTS: output } },
      )
      assert.deepEqual((await readFile(output)).toString().split('\0').slice(0, -1), [
        link,
        'value with spaces',
        '最後一項',
      ])
      await assert.rejects(access(join(root, 'ignored')))
    }),
)
test('Linux namespace profile follows the real Electron binary behind the launcher', async () => {
  const config = await getConfig(process.cwd(), 'build-tools/builder-config.mjs', null)
  await validateConfiguration(config, new DebugLogger(false))
  for (const target of ['deb', 'rpm']) {
    const template = await readFile(config[target].appArmorProfile, 'utf8')
    // Builder uses lodash templates with ${...} interpolation.
    const generated = template
      .replaceAll('${executable}', 'yuki')
      .replaceAll('${sanitizedProductName}', 'Yuki')
    assert.match(generated, /profile "yuki" "\/opt\/Yuki\/yuki-bin"/)
    assert.match(generated, /\buserns,/)
    assert.doesNotMatch(generated, /\*|\/opt\/Yuki\/yuki"/)
  }
})
test('merges matching native job hashes into one Mac feed without copying local inputs', async () =>
  fixture(async (root) => {
    const a = await seed(root, 'a', 'arm64'),
      b = await seed(root, 'b', 'x64')
    await mkdir(join(a.source, 'docs'))
    await writeFile(join(a.source, 'docs', 'private-fixture.md'), 'not a real taskbook')
    const first = join(root, 'first'),
      second = join(root, 'second'),
      merged = join(root, 'merged')
    await prepareUpload([a.source], first, { audit })
    await prepareUpload([b.source], second, { audit })
    const manifest = await mergeUploads([first, second], merged, false)
    assert.equal(manifest.complete, false)
    assert.equal(manifest.tag, 'desktop-v1.0.0-beta.1')
    assert.equal(load(await readFile(join(merged, 'beta-mac.yml'), 'utf8')).files.length, 2)
    assert.equal((await verifyChecksums(merged)).size, 3)
    const cliOutput = join(root, 'cli-merged')
    const { stdout } = await run(process.execPath, [
      'build-tools/prepare-upload.mjs',
      '--merge',
      cliOutput,
      first,
      second,
    ])
    assert.match(stdout, /Prepared desktop-v1\.0\.0-beta\.1/)
    assert.equal((await verifyChecksums(cliOutput)).size, 3)
    await assert.rejects(access(join(merged, 'content-audit.json')))
    await assert.rejects(access(join(merged, 'local-audit.json')))
    assert.equal(
      JSON.parse(await readFile(`${merged}.local-audit.json`, 'utf8')).contentAudits.length,
      2,
    )
    await assert.rejects(access(join(merged, 'docs')))
    await assert.rejects(prepareUpload([a.source], first, { audit }), { code: 'EEXIST' })
    await writeFile(join(first, a.name), 'changed after audit')
    await assert.rejects(
      mergeUploads([first, second], join(root, 'tampered'), false),
      /Checksum differs/,
    )
  }))
test('rejects stale hashes, cross-platform feeds, unknown uploads and stable feeds containing beta before output exists', async () =>
  fixture(async (root) => {
    const a = await seed(root, 'a', 'arm64'),
      output = join(root, 'out')
    await writeFile(join(a.source, a.name), 'tampered')
    await assert.rejects(prepareUpload([a.source], output, { audit }), /Feed hash mismatch/)
    await assert.rejects(access(output))
    await writeFile(join(a.source, a.name), 'assembly fixture arm64')
    await writeFile(join(a.source, 'latest-mac.yml'), dump(a.info))
    await assert.rejects(prepareUpload([a.source], output, { audit }), /channel and version differ/)
    await rm(join(a.source, 'latest-mac.yml'))
    await writeFile(join(a.source, 'beta-linux.yml'), dump(a.info))
    await assert.rejects(prepareUpload([a.source], output, { audit }), /platform mismatch/)
    await rm(join(a.source, 'beta-linux.yml'))
    await writeFile(join(a.source, 'private-fixture.md'), 'do not upload')
    await assert.rejects(
      prepareUpload([a.source], output, { audit }),
      /Unexpected upload candidate/,
    )
  }))
test('complete release rejects missing Linux and Windows instead of treating Mac packaging as complete', async () =>
  fixture(async (root) => {
    const a = await seed(root, 'a', 'arm64')
    await assert.rejects(
      prepareUpload([a.source], join(root, 'out'), { audit, complete: true }),
      /Missing release target/,
    )
  }))
test('real archive inspection rejects local material before extracting or uploading it', async () =>
  fixture(async (root) => {
    const source = join(root, 'private-source')
    await mkdir(join(source, 'docs'), { recursive: true })
    await writeFile(join(source, 'docs', 'private-fixture.md'), 'not real private documents')
    const file = join(root, 'fixture.zip')
    await run(await getPath7za(), ['a', '-tzip', file, 'docs'], { cwd: source })
    await assert.rejects(auditInstaller(file), /Unsafe installer entry/)
    await writeFile(join(source, 'state-fixture.png'), 'not a real screenshot')
    const extra = join(root, 'unexpected-image.zip')
    await run(await getPath7za(), ['a', '-tzip', extra, 'state-fixture.png'], { cwd: source })
    await assert.rejects(auditInstaller(extra), /Unexpected Mac zip root content/)
  }))
test('real archive inspection rejects an application whose CPU differs from its release label', async () =>
  fixture(async (root) => {
    const source = join(root, 'wrong-architecture')
    await mkdir(join(source, 'Yuki.app/Contents/Resources'), { recursive: true })
    await mkdir(join(source, 'Yuki.app/Contents/MacOS'), { recursive: true })
    await writeFile(join(source, 'Yuki.app/Contents/Resources/app.asar'), 'not a real app archive')
    const executable = Buffer.alloc(64)
    executable.writeUInt32LE(0xfeedfacf, 0)
    executable.writeUInt32LE(0x01000007, 4)
    await writeFile(join(source, 'Yuki.app/Contents/MacOS/Yuki'), executable)
    const file = join(root, 'Yuki-1.0.0-beta.1-mac-arm64.zip')
    await run(await getPath7za(), ['a', '-tzip', file, 'Yuki.app'], { cwd: source })
    await assert.rejects(auditInstaller(file), /Executable architecture mismatch: darwin\/arm64/)
  }))

async function packagedFixture(root) {
  const source = join(root, 'product')
  const directory = join(root, 'packaged')
  const marker = 'unique packed runtime integrity fixture'
  const files = {
    'out/main/app.js': marker + 'x'.repeat(4 * 1024 * 1024),
    'out/preload/index.cjs': '',
    'out/renderer/index.html':
      '<script src="assets/index.js"></script><link href="assets/index.css">',
    'out/renderer/assets/index.js': 'export const fixture = true',
    'out/renderer/assets/index.css': 'body { color: black }',
    'out/renderer/assets/diff.worker-fixture.js': 'onmessage = () => {}',
    'resources/icons/trayTemplate.png': 'icon fixture',
    'resources/icons/trayTemplate@2x.png': 'icon fixture',
    'package.json': '{"name":"integrity-fixture"}',
    LICENSE: 'unit fixture',
  }
  for (const size of [16, 32, 64, 128, 256, 512, 1024])
    files[`resources/icons/app/${size}x${size}.png`] = 'icon fixture'
  for (const file of [
    'AUTHORS',
    'NOTICE.txt',
    'LICENSE.MPL-2.0',
    'LICENSE.BSD-2-Clause',
    'LICENSE.BSD-3-Clause',
    'LICENSE.OFL-1.1',
  ])
    files[`resources/legal/novnc/${file}`] = 'legal fixture'
  for (const [path, content] of Object.entries(files)) {
    const destination = join(source, path)
    await mkdir(join(destination, '..'), { recursive: true })
    await writeFile(destination, content)
  }
  await mkdir(directory)
  const archive = join(directory, 'app.asar')
  await createPackage(source, archive)
  return { directory, archive, marker }
}

test('actual ASAR integrity accepts empty and multi-block files then rejects an altered payload with the original header', async () =>
  fixture(async (root) => {
    const { directory, archive, marker } = await packagedFixture(root)
    assert.equal(checkPackage(directory), 1)
    assert.equal(statFile(archive, 'out/main/app.js').integrity.blocks.length, 2)
    const bytes = await readFile(archive)
    const offset = bytes.indexOf(Buffer.from(marker))
    assert.ok(offset > 0)
    bytes[offset] ^= 1
    await writeFile(archive, bytes)
    assert.throws(() => checkPackage(directory), /Corrupt packaged file: out\/main\/app.js/)
  }))

test('actual ASAR integrity rejects a changed block digest even when the file digest and payload are intact', async () =>
  fixture(async (root) => {
    const { directory, archive } = await packagedFixture(root)
    assert.equal(checkPackage(directory), 1)
    const integrity = statFile(archive, 'out/main/app.js').integrity
    const bytes = await readFile(archive)
    const field = Buffer.from('"blocks":["' + integrity.blocks[0])
    const start = bytes.indexOf(field)
    assert.ok(start > 0)
    const offset = start + Buffer.byteLength('"blocks":["')
    bytes[offset] = bytes[offset] === 0x61 ? 0x62 : 0x61
    await writeFile(archive, bytes)
    assert.throws(() => checkPackage(directory), /Corrupt packaged block: out\/main\/app.js/)
  }))

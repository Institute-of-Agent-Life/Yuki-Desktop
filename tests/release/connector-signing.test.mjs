import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { signConnectorApp } from '../../build-tools/sign-mac.mjs'
import { checkConnectorRuntime } from '../../build-tools/product-resources.mjs'
import {
  checkConnectorSource,
  finalizeWindowsConnector,
} from '../../build-tools/connector-signing.mjs'

function fixture(runtime) {
  const contents = {
    'python/python.exe': 'original executable',
    'python/module.py': 'original source',
    'legal/Yuki-LICENSE': 'license',
    'legal/dependency-lock.toml': 'lock',
  }
  const files = Object.entries(contents).map(([path, bytes]) => {
    mkdirSync(dirname(join(runtime, path)), { recursive: true })
    writeFileSync(join(runtime, path), bytes)
    return { path, sha256: createHash('sha256').update(bytes).digest('hex') }
  })
  writeFileSync(
    join(runtime, 'manifest.json'),
    JSON.stringify({ executable: 'python/python.exe', files }),
  )
}

test('Mac original signer updates helper hashes before the outer seal and preserves signing options', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yuki-sign-mac-'))
  const app = join(root, 'Yuki.app'),
    runtime = join(app, 'Contents/Resources/agent-connector')
  fixture(runtime)
  const visited = []
  const perFile = { entitlements: 'original-entitlements', hardenedRuntime: true }
  const options = {
    app,
    identity: 'original-identity',
    keychain: 'original-keychain',
    ignore: () => false,
    optionsForFile: (path) => {
      visited.push(path)
      return perFile
    },
  }
  let sealed
  try {
    await signConnectorApp(options, async (received) => {
      assert.equal(received.identity, options.identity)
      assert.equal(received.keychain, options.keychain)
      assert.equal(received.ignore, options.ignore)
      const helper = join(runtime, 'python/python.exe')
      assert.equal(received.optionsForFile(helper), perFile)
      writeFileSync(helper, 'signed executable')
      assert.throws(() => checkConnectorRuntime(runtime), /Changed Connector file/)
      assert.equal(received.optionsForFile(app), perFile)
      checkConnectorRuntime(runtime)
      sealed = readFileSync(join(runtime, 'manifest.json'), 'utf8')
    })
    assert.deepEqual(visited, [join(runtime, 'python/python.exe'), app])
    assert.equal(readFileSync(join(runtime, 'manifest.json'), 'utf8'), sealed)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

for (const change of ['before', 'unvisited', 'extra', 'after-seal'])
  test(`Mac signing rejects ${change} tampering`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'yuki-sign-reject-'))
    const app = join(root, 'Yuki.app'),
      runtime = join(app, 'Contents/Resources/agent-connector')
    fixture(runtime)
    if (change === 'before') writeFileSync(join(runtime, 'python/module.py'), 'changed')
    let called = false
    try {
      await assert.rejects(
        signConnectorApp({ app }, async (options) => {
          called = true
          const helper = join(runtime, 'python/python.exe')
          options.optionsForFile(helper)
          writeFileSync(helper, 'signed')
          if (change === 'unvisited') writeFileSync(join(runtime, 'python/module.py'), 'changed')
          if (change === 'extra') writeFileSync(join(runtime, '.env'), 'unexpected')
          options.optionsForFile(app)
          if (change === 'after-seal') writeFileSync(helper, 'changed after seal')
        }),
        /Changed Connector file|Unexpected Connector runtime/,
      )
      assert.equal(called, change !== 'before')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

test('Windows copy-time signatures update only the original builder signable files before packaging', () => {
  const root = mkdtempSync(join(tmpdir(), 'yuki-sign-win-'))
  const source = join(root, '.cache/connector-runtime'),
    target = join(root, 'dist/resources/agent-connector')
  fixture(source)
  const context = {
    electronPlatformName: 'win32',
    appOutDir: join(root, 'dist'),
    packager: { projectDir: root, shouldSignFile: (file) => file.endsWith('.exe') },
  }
  try {
    checkConnectorSource(context)
    cpSync(source, target, { recursive: true })
    writeFileSync(join(target, 'python/python.exe'), 'copy-time signed')
    finalizeWindowsConnector(context)
    checkConnectorRuntime(target)
    assert.equal(readFileSync(join(source, 'python/python.exe'), 'utf8'), 'original executable')
    cpSync(source, target, { recursive: true })
    writeFileSync(join(target, 'python/module.py'), 'not signed, changed')
    assert.throws(() => finalizeWindowsConnector(context), /Changed Connector file/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

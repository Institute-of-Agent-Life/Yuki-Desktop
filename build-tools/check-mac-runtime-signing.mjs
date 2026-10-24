import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, URL } from 'node:url'
import sign from './sign-mac.mjs'
import { checkConnectorRuntime } from './product-resources.mjs'

// An isolated ad-hoc copy proves native signing order, not Developer ID or notarization.
if (process.platform !== 'darwin') throw Error('Requires native macOS codesign')
const output = resolve(process.argv[2] ?? 'dist')
const apps = readdirSync(output, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('mac'))
  .flatMap((entry) =>
    readdirSync(join(output, entry.name))
      .filter((name) => name.endsWith('.app'))
      .map((name) => join(output, entry.name, name)),
  )
if (!apps.length) throw Error('No packaged Mac application found')
for (const source of apps) {
  const root = mkdtempSync(join(tmpdir(), 'yuki-runtime-adhoc-'))
  const app = join(root, 'Yuki.app')
  try {
    cpSync(source, app, { recursive: true, verbatimSymlinks: true })
    await sign({
      app,
      identity: '-',
      identityValidation: false,
      platform: 'darwin',
      preAutoEntitlements: false,
      optionsForFile: () => ({
        entitlements: fileURLToPath(
          new URL('../resources/entitlements.mac.plist', import.meta.url),
        ),
        hardenedRuntime: true,
      }),
    })
    const manifest = checkConnectorRuntime(join(app, 'Contents/Resources/agent-connector'))
    console.log(
      JSON.stringify({ adHocSignatureAndManifest: true, runtimeFiles: manifest.files.length }),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

import { realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkConnectorRuntime, refreshSignedConnectorFiles } from './product-resources.mjs'

/** Keep the signed runtime manifest inside the final application seal. */
export async function signConnectorApp(options, sign) {
  const runtime = join(options.app, 'Contents', 'Resources', 'agent-connector')
  const manifest = checkConnectorRuntime(runtime)
  const files = new Map(
    manifest.files
      .filter((file) => file.sha256)
      .map((file) => [realpathSync(join(runtime, file.path)), file]),
  )
  const signed = new Set()
  await sign({
    ...options,
    optionsForFile(filePath) {
      if (resolve(filePath) === resolve(options.app)) {
        // Only byte changes from files visited by the original native signer are allowed.
        // Everything else, including paths and symlinks, still uses the original manifest.
        refreshSignedConnectorFiles(runtime, manifest, signed)
      } else {
        const actual = realpathSync(filePath)
        if (files.has(actual)) signed.add(actual)
      }
      return options.optionsForFile?.(filePath)
    },
  })
  checkConnectorRuntime(runtime)
}

export default async function sign(options) {
  const { signAsync } = await import('@electron/osx-sign')
  return signConnectorApp(options, signAsync)
}

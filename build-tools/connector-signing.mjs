import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { checkConnectorRuntime, refreshSignedConnectorFiles } from './product-resources.mjs'

export function checkConnectorSource(context) {
  return checkConnectorRuntime(join(context.packager.projectDir, '.cache', 'connector-runtime'))
}

/** Windows signs extra-resource executables while copying, before afterPack. */
export function finalizeWindowsConnector(context) {
  if (context.electronPlatformName !== 'win32') return
  const source = join(context.packager.projectDir, '.cache', 'connector-runtime')
  const target = join(context.appOutDir, 'resources', 'agent-connector')
  const manifest = checkConnectorRuntime(source)
  if (
    !readFileSync(join(source, 'manifest.json')).equals(readFileSync(join(target, 'manifest.json')))
  )
    throw Error('Connector manifest changed while packaging')
  const signed = new Set(
    manifest.files
      .filter((file) => file.sha256 && context.packager.shouldSignFile(file.path))
      .map((file) => realpathSync(join(target, file.path))),
  )
  refreshSignedConnectorFiles(target, manifest, signed)
}

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { checkConnectorRuntime, refreshSignedConnectorFiles } from './product-resources.mjs'

/**
 * The Connector a package bundles is the one prepare-connector built from the backend that
 * contracts/source.json pins; a runtime left in .cache from an earlier backend is refused.
 */
export function checkConnectorPin(projectDir) {
  const runtime = join(projectDir, '.cache', 'connector-runtime')
  const pinned = JSON.parse(readFileSync(join(projectDir, 'contracts', 'source.json'), 'utf8'))
  const record = runtime + '.source.json'
  const built = existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) : undefined
  const { version } = JSON.parse(readFileSync(join(runtime, 'manifest.json'), 'utf8'))
  if (built?.commit !== pinned.commit || built.version !== version)
    throw Error(
      `The Connector in .cache/connector-runtime (${version}, backend ${built?.commit ?? 'unknown'}) ` +
        `is not the pinned backend ${pinned.commit}'s; run node build-tools/prepare-connector.mjs ` +
        '--backend <checkout of that commit>',
    )
  return built
}
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

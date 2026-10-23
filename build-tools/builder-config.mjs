import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { prerelease, valid } from 'semver'
import { load } from 'js-yaml'
import { checkNativePrebuild } from './native-prebuild.mjs'
import { installLinuxLauncher } from './linux-launcher.mjs'
import { checkConnectorSource, finalizeWindowsConnector } from './connector-signing.mjs'

export function releaseChannel(version) {
  if (!valid(version) || (prerelease(version) && prerelease(version)[0] !== 'beta'))
    throw Error('Desktop release versions must be stable or beta semver')
  return prerelease(version) ? 'beta' : 'latest'
}
const version = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version
const base = load(readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8'))
export default {
  ...base,
  async beforePack(context) {
    checkConnectorSource(context)
    await checkNativePrebuild(context)
  },
  async afterPack(context) {
    finalizeWindowsConnector(context)
    await installLinuxLauncher(context)
  },
  directories: {
    ...base.directories,
    buildResources: fileURLToPath(new URL('../resources', import.meta.url)),
  },
  // electron-builder's GitHub provider does not infer the feed channel from prerelease versions.
  publish: { ...base.publish, channel: releaseChannel(version) },
}

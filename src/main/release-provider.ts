import { newError, parseXml, type CustomPublishOptions } from 'builder-util-runtime'
import { valid, prerelease } from 'semver'
import type { AppUpdater } from 'electron-updater'
import { GitHubProvider } from 'electron-updater/out/providers/GitHubProvider.js'
import {
  parseUpdateInfo,
  type ProviderRuntimeOptions,
} from 'electron-updater/out/providers/Provider.js'
import { DESKTOP_RELEASES } from '../shared/updates'

const releases = new URL(DESKTOP_RELEASES)
const [, owner, repo] = releases.pathname.split('/')
const tagPrefix = 'desktop-v'

/** electron-updater 6.x parses only v-prefixed prereleases; keep our release tag contract. */
export class DesktopReleaseProvider extends GitHubProvider {
  constructor(
    _options: CustomPublishOptions,
    private desktop: AppUpdater,
    runtime: ProviderRuntimeOptions,
  ) {
    super(
      { provider: 'github', owner: owner!, repo: repo!, tagNamePrefix: tagPrefix },
      desktop,
      runtime,
    )
  }
  async getLatestVersion() {
    if (!this.desktop.allowPrerelease) {
      const result = await super.getLatestVersion()
      if (
        !result.tag.startsWith(tagPrefix) ||
        result.tag.slice(tagPrefix.length) !== result.version ||
        prerelease(result.version)
      )
        throw newError('No matching desktop stable release', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS')
      return result
    }
    const atom = await this.httpRequest(new URL(`${releases.pathname}.atom`, this.baseUrl), {
      accept: 'application/atom+xml',
    })
    if (!atom) throw newError('No desktop releases', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS')
    const feed = parseXml(atom)
    for (const entry of feed.getElements('entry')) {
      const href = new URL(entry.element('link').attribute('href'), this.baseUrl)
      const prefix = `${releases.pathname}/tag/${tagPrefix}`
      if (href.origin !== this.baseUrl.origin || !href.pathname.startsWith(prefix)) continue
      const version = decodeURIComponent(href.pathname.slice(prefix.length))
      if (!valid(version)) continue
      const channel = prerelease(version)?.[0]
      if (channel !== undefined && channel !== 'beta') continue
      const tag = tagPrefix + version
      const file = `${this.getCustomChannelName(channel === 'beta' ? 'beta' : 'latest')}.yml`
      const url = new URL(
        `${releases.pathname}/download/${encodeURIComponent(tag)}/${file}`,
        this.baseUrl,
      )
      const info = parseUpdateInfo(await this.httpRequest(url), file, url)
      if (info.version !== version)
        throw newError('Desktop tag and feed differ', 'ERR_UPDATER_INVALID_RELEASE_FEED')
      return { ...info, tag, releaseName: info.releaseName ?? entry.elementValueOrEmpty('title') }
    }
    throw newError('No matching desktop beta release', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS')
  }
}

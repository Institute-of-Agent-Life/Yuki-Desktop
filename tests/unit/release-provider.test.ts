import { createServer, type IncomingHttpHeaders } from 'node:http'
import { expect, it, vi } from 'vitest'
import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor.js'
import { NodeHttpExecutor } from 'builder-util/out/nodeHttpExecutor.js'
import type { AppUpdater } from 'electron-updater'
import { DesktopReleaseProvider } from '../../src/main/release-provider'

it.each(['darwin', 'win32', 'linux'] as const)(
  'resolves desktop-v stable and beta releases over real HTTP on %s',
  async (platform) => {
    for (const key of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
    ])
      vi.stubEnv(key, undefined)
    vi.stubEnv('TEST_UPDATER_ARCH', 'arm64')
    const requests: { path: string; headers: IncomingHttpHeaders }[] = []
    const basePath = '/Institute-of-Agent-Life/Yuki-Desktop/releases'
    let base = '',
      latest = 'desktop-v1.1.0',
      onlyStable = false,
      mismatch = false
    const suffix = platform === 'darwin' ? '-mac' : platform === 'linux' ? '-linux-arm64' : ''
    const server = createServer((request, response) => {
      response.setHeader('Connection', 'close')
      const path = new URL(request.url!, 'http://fixture').pathname
      requests.push({ path, headers: request.headers })
      if (path === basePath + '.atom') {
        const tags = onlyStable
          ? ['desktop-v1.1.0']
          : ['backend-v99.0.0', 'desktop-v2.0.0-alpha.1', 'desktop-v1.2.0-beta.1', 'desktop-v1.1.0']
        response.end(
          `<feed>${tags.map((tag) => `<entry><title>${tag}</title><link href="${base}${basePath}/tag/${tag}"/><content>fixture release</content></entry>`).join('')}</feed>`,
        )
      } else if (path === basePath + '/latest') {
        response.end(JSON.stringify({ tag_name: latest }))
      } else if (path.endsWith('.yml')) {
        const version = mismatch
          ? '9.9.9'
          : path.includes('desktop-v1.2.0-beta.1')
            ? '1.2.0-beta.1'
            : '1.1.0'
        response.end(
          `version: ${version}\nfiles:\n  - url: Yuki-${version}-arm64.zip\n    sha512: fixture\npath: Yuki-${version}-arm64.zip\nsha512: fixture\nreleaseDate: '2026-10-20T00:00:00Z'\n`,
        )
      } else {
        response.writeHead(404)
        response.end()
      }
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('Missing loopback port')
    base = `http://127.0.0.1:${address.port}`
    const executor = new ElectronHttpExecutor(),
      sockets = new NodeHttpExecutor()
    Reflect.set(executor, 'createRequest', sockets.createRequest.bind(sockets))
    const updater = {
      allowPrerelease: false,
      channel: 'latest',
      fullChangelog: false,
    } as AppUpdater
    const provider = new DesktopReleaseProvider(
      { provider: 'custom', updateProvider: DesktopReleaseProvider },
      updater,
      { platform, executor, isUseMultipleRangeRequest: false },
    )
    Reflect.set(provider, 'baseUrl', new URL(base))
    provider.setRequestHeaders({ 'x-user-staging-id': '' })
    try {
      expect(await provider.getLatestVersion()).toMatchObject({
        version: '1.1.0',
        tag: 'desktop-v1.1.0',
      })
      expect(requests.at(-1)!.path).toBe(`${basePath}/download/desktop-v1.1.0/latest${suffix}.yml`)
      updater.allowPrerelease = true
      updater.channel = 'beta'
      const beta = await provider.getLatestVersion()
      expect(beta).toMatchObject({ version: '1.2.0-beta.1', tag: 'desktop-v1.2.0-beta.1' })
      expect(requests.at(-1)!.path).toBe(
        `${basePath}/download/desktop-v1.2.0-beta.1/beta${suffix}.yml`,
      )
      expect(provider.resolveFiles(beta)[0]!.url.href).toBe(
        `${base}${basePath}/download/desktop-v1.2.0-beta.1/Yuki-1.2.0-beta.1-arm64.zip`,
      )
      mismatch = true
      await expect(provider.getLatestVersion()).rejects.toMatchObject({
        code: 'ERR_UPDATER_INVALID_RELEASE_FEED',
      })
      mismatch = false
      onlyStable = true
      expect(await provider.getLatestVersion()).toMatchObject({ version: '1.1.0' })
      expect(requests.at(-1)!.path).toBe(`${basePath}/download/desktop-v1.1.0/latest${suffix}.yml`)
      updater.allowPrerelease = false
      latest = 'backend-v99.0.0'
      await expect(provider.getLatestVersion()).rejects.toMatchObject({
        code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
      })
      expect(
        requests.every(
          ({ headers }) =>
            !headers.authorization && !headers.cookie && !headers['x-user-staging-id'],
        ),
      ).toBe(true)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      vi.unstubAllEnvs()
    }
  },
)

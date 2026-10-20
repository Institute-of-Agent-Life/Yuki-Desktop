/** Real updater, HTTP, YAML and checksum handling with a test AppAdapter; no native install. */
import { createServer, type IncomingHttpHeaders } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { AppImageUpdater } from 'electron-updater'
import type { AppAdapter } from 'electron-updater/out/AppAdapter'
import { NodeHttpExecutor } from 'builder-util/out/nodeHttpExecutor'
import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor'
import { AppUpdates } from '../../src/main/updates'
import { FeedOnlyUpdater } from '../../src/main/feed-updater'

it('real SDK rejects tampered bytes, retries the original feed, and sends no persistent staging identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yuki-update-wire-'))
  const body = Buffer.from('Local transport/checksum fixture; never executed as an AppImage.')
  const sha512 = createHash('sha512').update(body).digest('base64')
  let corrupt = true
  const requests: { path: string; headers: IncomingHttpHeaders }[] = []
  const server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://fixture').pathname
    requests.push({ path, headers: request.headers })
    if (path.endsWith('.yml')) {
      response.writeHead(200, { 'Content-Type': 'text/yaml' })
      response.end(
        `version: 1.1.0\nfiles:\n  - url: Yuki-fixture.AppImage\n    sha512: ${sha512}\n    size: ${body.length}\npath: Yuki-fixture.AppImage\nsha512: ${sha512}\nreleaseDate: '2026-10-20T00:00:00Z'\n`,
      )
    } else if (path === '/Yuki-fixture.AppImage') {
      const bytes = corrupt ? Buffer.from('tampered payload') : body
      response.writeHead(200, { 'Content-Length': bytes.length })
      response.end(bytes)
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
  if (!address || typeof address === 'string') throw new Error('missing loopback endpoint')
  const url = `http://127.0.0.1:${address.port}`
  const installed = join(root, 'installed.AppImage')
  await writeFile(installed, 'Original local fixture, unchanged during checks.')
  for (const key of [
    'HTTP_PROXY',
    'http_proxy',
    'HTTPS_PROXY',
    'https_proxy',
    'ALL_PROXY',
    'all_proxy',
  ])
    vi.stubEnv(key, undefined)
  vi.stubEnv('NO_PROXY', '127.0.0.1,localhost')
  vi.stubEnv('no_proxy', '127.0.0.1,localhost')
  vi.stubEnv('APPIMAGE', installed)
  const data = join(root, 'data'),
    cache = join(root, 'cache')
  await mkdir(data)
  await mkdir(cache)
  const config = join(root, 'app-update.yml')
  await writeFile(config, `provider: generic\nurl: ${url}\nupdaterCacheDirName: yuki-wire\n`)
  const quit = vi.fn(),
    relaunch = vi.fn()
  const adapter: AppAdapter = {
    version: '1.0.0',
    name: 'Yuki wire fixture',
    isPackaged: true,
    appUpdateConfigPath: config,
    userDataPath: data,
    baseCachePath: cache,
    whenReady: async () => {},
    quit,
    relaunch,
    onQuit: () => {},
  }
  const sdk = new AppImageUpdater(undefined, adapter)
  // The headless AppAdapter leaves Electron HTTP empty; retain the vendor's actual
  // provider, YAML parser and checksum pipeline with its Node HTTP transport.
  const executor = new ElectronHttpExecutor()
  const sockets = new NodeHttpExecutor()
  // Replace only Electron's socket factory; keep the production download/checksum implementation.
  Reflect.set(executor, 'createRequest', sockets.createRequest.bind(sockets))
  Reflect.set(sdk, 'httpExecutor', executor)
  // Exercise complete-file SHA-512 validation; differential AppImage execution
  // requires Linux and is a separate native acceptance check.
  sdk.disableDifferentialDownload = true
  let downloaded: string | undefined
  sdk.on('update-downloaded', (event) => {
    downloaded = event.downloadedFile
  })
  const updates = new AppUpdates(
    { version: '1.0.0', packaged: true, platform: 'linux', appImage: installed, channel: 'stable' },
    () => sdk,
    () => {},
  )
  try {
    expect((await updates.check()).phase).toBe('available')
    expect(await updates.download()).toMatchObject({ phase: 'error', problem: 'integrity' })
    expect(downloaded).toBeUndefined()
    expect(updates.canInstall()).toBe(false)
    corrupt = false
    await updates.check()
    expect((await updates.download()).phase).toBe('downloaded')
    expect(downloaded).toBeTruthy()
    expect(await readFile(downloaded!)).toEqual(body)
    expect(await readFile(installed, 'utf8')).toBe(
      'Original local fixture, unchanged during checks.',
    )
    vi.stubEnv('APPIMAGE', undefined)
    const feed = new FeedOnlyUpdater(undefined, adapter)
    Reflect.set(feed, 'httpExecutor', executor)
    const manual = new AppUpdates(
      { version: '1.0.0', packaged: true, platform: 'linux', channel: 'stable' },
      () => feed,
      () => {},
    )
    expect(await manual.check()).toMatchObject({ phase: 'available', mode: 'manual' })
    expect(() => manual.download()).toThrow('update_manual_installation')
    expect(quit).not.toHaveBeenCalled()
    expect(relaunch).not.toHaveBeenCalled()
    expect(requests.filter((item) => item.path.endsWith('.yml')).length).toBeGreaterThan(0)
    expect(requests.filter((item) => item.path.endsWith('.AppImage'))).toHaveLength(2)
    for (const request of requests) {
      expect(request.headers['x-user-staging-id'] ?? '').toBe('')
      expect(request.headers.authorization).toBeUndefined()
      expect(request.headers.cookie).toBeUndefined()
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  }
})

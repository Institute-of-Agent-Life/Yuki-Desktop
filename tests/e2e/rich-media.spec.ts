import { expect, test, type Locator, type Page } from '@playwright/test'
import { copyFile, readFile, writeFile, open } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { currentConnection, ledgerEvents, pairUI, yukiFixture } from '../fixtures/backend'
import { navigate, sidebar } from '../fixtures/navigation'
import { contentSize } from '../fixtures/visual'
import { expectPdfPages } from '../fixtures/pdf'

async function playback(player: Locator) {
  const element = await player.elementHandle()
  try {
    await expect
      .poll(() =>
        element!.evaluate((node) => {
          const media = node as HTMLMediaElement
          if (media.error) throw Error(media.error.message)
          if (!media.isConnected) throw Error('The media player was removed')
          return media.readyState
        }),
      )
      .toBeGreaterThanOrEqual(2)
    const source = await element!.evaluate((node) => (node as HTMLMediaElement).currentSrc)
    const currentTime = (target: number) =>
      element!.evaluate(
        (node, { source, target }) => {
          const media = node as HTMLMediaElement
          if (media.error) throw Error(media.error.message)
          if (!media.isConnected || media.currentSrc !== source)
            throw Error('The playing media source was replaced')
          if (media.ended && media.currentTime <= target)
            throw Error(`Playback ended before ${target} seconds`)
          return media.currentTime
        },
        { source, target },
      )
    await element!.evaluate(async (node) => {
      const media = node as HTMLMediaElement
      media.muted = true
      await media.play()
    })
    await expect.poll(() => currentTime(0.2)).toBeGreaterThan(0.2)
    await element!.evaluate((node) => {
      const media = node as HTMLMediaElement
      media.pause()
      media.currentTime = 2.5
    })
    await expect
      .poll(async () => {
        await currentTime(2.5)
        return element!.evaluate((node) => {
          const media = node as HTMLMediaElement
          return !media.seeking && Math.abs(media.currentTime - 2.5) < 0.1
        })
      })
      .toBe(true)
    await element!.evaluate(async (node) => {
      await (node as HTMLMediaElement).play()
    })
    await expect.poll(() => currentTime(2.7)).toBeGreaterThan(2.7)
    await element!.evaluate((node) => (node as HTMLMediaElement).pause())
  } finally {
    await element!.dispose()
  }
}

async function upload(
  app: ElectronApplication,
  page: Page,
  root: string,
  name: string,
  base: string,
) {
  const path = join(root, name)
  await copyFile(join('tests/fixtures/media', name), path)
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, path)
  await page.getByRole('button', { name: '附加檔案', exact: true }).click()
  await expect(page.getByLabel('待送出附件')).toContainText('可送出')
  await page.getByRole('button', { name: '送出', exact: true }).click()
  await expect
    .poll(async () =>
      (await ledgerEvents(base)).some(
        (event) =>
          event.direction === 'inbound' && event.attachments.some((item) => item.filename === name),
      ),
    )
    .toBe(true)
  return (await ledgerEvents(base)).find(
    (event) =>
      event.direction === 'inbound' && event.attachments.some((item) => item.filename === name),
  )!
}

test('plays and seeks both actual media sources, renders local rich text and keeps binary IPC bounded', async () => {
  test.setTimeout(360000)
  const rig = await yukiFixture({ richMedia: true })
  let app = await rig.launch('rich-media'),
    second: Awaited<ReturnType<typeof yukiFixture>> | undefined,
    success = false
  try {
    let page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page)
    await page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ }).fill('請檢查媒體原件')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect.poll(async () => (await ledgerEvents(rig.base)).length).toBeGreaterThan(1)
    const publish = async (name: string, kind = 'file', text?: string) => {
      const response = await fetch(`${rig.base}/__test/media-artifact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: name, kind, text }),
      })
      expect(response.status).toBe(200)
      return (await response.json()) as {
        artifact_id: string
        sha256: string
        event_id: number
        name: string
      }
    }
    const inspector = () => page.getByRole('complementary', { name: '檢視器', exact: true })
    const close = async () => {
      await page.getByRole('button', { name: '關閉檢視器', exact: true }).click()
    }
    for (const name of ['clip.mp4', 'clip.webm', 'voice.wav']) {
      const event = await upload(app, page, rig.root, name, rig.base)
      await page
        .locator(`article[data-event-id="${event.event_id}"]`)
        .getByRole('button', { name: new RegExp(name.replace('.', '\\.')) })
        .click()
      await playback(inspector().locator(name.endsWith('.wav') ? 'audio' : 'video'))
      const url = await inspector().locator('audio,video').getAttribute('src')
      expect(url).toMatch(/^app:\/\/desktop\/__media\//)
      await close()
      expect(await page.evaluate(async (url) => (await fetch(url!)).status, url)).toBe(404)
      const artifact = await publish(name)
      await page
        .locator(`article[data-event-id="${artifact.event_id}"]`)
        .getByRole('button', { name: new RegExp(name.replace('.', '\\.')) })
        .click()
      await playback(inspector().locator(name.endsWith('.wav') ? 'audio' : 'video'))
      await close()
    }
    // A real record-kind WebM, deliberately lacking a MIME field in upload metadata.
    const voice = [...(await readFile('tests/fixtures/media/voice.webm'))]
    await page.evaluate(
      async ({ id, voice }) => {
        const reply = await window.yuki.client.record(id, Uint8Array.from(voice))
        if (!reply.ok) throw Error(reply.code)
      },
      { id: connection.characterId, voice },
    )
    await expect(page.getByLabel('待送出附件')).toContainText('可送出')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect
      .poll(async () =>
        (await ledgerEvents(rig.base)).some((event) =>
          event.attachments.some((item) => item.kind === 'record'),
        ),
      )
      .toBe(true)
    await fetch(`${rig.base}/__test/resume-asr`, { method: 'POST' })
    const recording = (await ledgerEvents(rig.base)).find((event) =>
      event.attachments.some((item) => item.kind === 'record'),
    )!
    await page
      .locator(`article[data-event-id="${recording.event_id}"]`)
      .getByRole('button', { name: /voice.webm/ })
      .click()
    await playback(inspector().locator('audio'))
    await close()
    expect(
      (await fetch(`${rig.base}/__test/media-expiry/${recording.event_id}`, { method: 'POST' })).ok,
    ).toBe(true)
    await page
      .locator(`article[data-event-id="${recording.event_id}"]`)
      .getByRole('button', { name: /voice.webm/ })
      .click()
    await expect(inspector().locator('audio')).toBeVisible()
    const expiredUrl = await inspector().locator('audio').getAttribute('src')
    await expect(inspector().locator('audio')).toHaveCount(0, { timeout: 10000 })
    expect(await page.evaluate(async (url) => (await fetch(url!)).status, expiredUrl)).toBe(404)
    await close()
    // The same bytes as a stable artifact use their filename's video MIME; an explicit audio MIME wins where available.
    await copyFile('tests/fixtures/media/voice.webm', join(rig.root, 'voice.webm'))
    await copyFile('tests/fixtures/media/animated.gif', join(rig.root, 'animated.gif'))
    const image = await publish('animated.gif', 'image')
    const imageArticle = page.locator(`article[data-event-id="${image.event_id}"]`)
    await imageArticle.scrollIntoViewIfNeeded()
    await expect(imageArticle.getByRole('img', { name: 'animated.gif' })).toBeVisible()
    expect(
      await imageArticle.locator('img').evaluate((node) => (node as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0)
    const md = `# Local rich text\n\n$x^2 + y^2$\n\n$$\n\\frac{1}{2}\n$$\n\n\`$literal$\`\n\n\`\`\`mermaid\ngraph LR\nA[Input]-->B[Output]\n\`\`\`\n\n\`\`\`mermaid\nthis is not a diagram\n\`\`\`\n\n![Internal](artifact:${image.artifact_id}@${image.sha256})\n\n![External](https://example.invalid/no-fetch.png)`
    await writeFile(join(rig.root, 'rich.md'), md)
    const outbound = await publish('rich.md', 'file', md)
    const article = page.locator(`article[data-event-id="${outbound.event_id}"]`)
    await expect(article.locator('.katex').first()).toBeVisible()
    await expect(article.locator('code').filter({ hasText: '$literal$' })).toBeVisible()
    await expect(article.locator('[data-mermaid] svg')).toBeVisible()
    await expect(article.locator('[data-mermaid] svg')).toContainText('Input')
    await expect(article.locator('[data-render-error] pre')).toContainText('this is not a diagram')
    await expect(article.locator('img[alt="Internal"]')).toBeVisible()
    await expect(article.locator('img[src*="example.invalid"]')).toHaveCount(0)
    // Files uses the same Markdown renderer.
    await article.getByRole('button', { name: /rich.md/ }).click()
    await expect(inspector().locator('.katex').first()).toBeVisible()
    await expect(inspector().locator('[data-mermaid] svg')).toBeVisible()
    await expect(inspector().locator('[data-mermaid] svg')).toContainText('Output')
    await page.screenshot({ path: test.info().outputPath('rich-markdown.png') })
    await close()
    const pdf = await upload(app, page, rig.root, 'manual.pdf', rig.base)
    await page
      .locator(`article[data-event-id="${pdf.event_id}"]`)
      .getByRole('button', { name: /manual.pdf/ })
      .click()
    // Chromium hides pagination in the compact sidebar toolbar.
    await page.getByRole('button', { name: '展開工作區', exact: true }).click()
    await expectPdfPages(inspector().locator('iframe'), 1)
    await page.screenshot({ path: test.info().outputPath('pdf-attachment.png') })
    await close()
    const defaults = (await (
      await fetch(`${rig.base}/__test/artifacts`, { method: 'POST' })
    ).json()) as { artifact_id: string; sha256: string; name: string }[]
    await navigate(page, '檔案與成果')
    await page.getByRole('button').filter({ hasText: defaults[2]!.artifact_id }).click()
    await expectPdfPages(page.getByRole('region', { name: '成果預覽' }).locator('iframe'), 1)
    await page.screenshot({ path: test.info().outputPath('pdf-artifact.png') })
    // 128 MiB valid MP4 with trailing padding: only the main-process disk stream holds its bytes.
    const large = join(rig.root, 'large.mp4')
    await copyFile('tests/fixtures/media/clip.mp4', large)
    const fd = await open(large, 'r+')
    await fd.truncate(128 * 1024 * 1024)
    await fd.close()
    const largeArtifact = await publish('large.mp4')
    const before = await app.evaluate(({ app }) =>
      app
        .getAppMetrics()
        .map((item) => ({ type: item.type, pid: item.pid, cpu: item.cpu, memory: item.memory })),
    )
    const metadata = await page.evaluate(
      async ({ id, item }) => {
        const reply = await window.yuki.client.artifactContent(id, {
          artifactId: item.artifact_id,
          version: item.sha256,
        })
        if (!reply.ok) throw Error(reply.code)
        return reply.value
      },
      { id: connection.characterId, item: largeArtifact },
    )
    expect(metadata.bytes).toBeNull()
    expect(JSON.stringify(metadata).length).toBeLessThan(1500)
    const range = await page.evaluate(async (url) => {
      const response = await fetch(url, { headers: { Range: 'bytes=16384-32767' } })
      return {
        status: response.status,
        length: (await response.arrayBuffer()).byteLength,
        range: response.headers.get('Content-Range'),
      }
    }, metadata.preview!.url)
    expect(range).toEqual({ status: 206, length: 16384, range: 'bytes 16384-32767/134217728' })
    await navigate(page, '檔案與成果')
    await page.getByRole('button').filter({ hasText: largeArtifact.artifact_id }).click()
    await playback(page.getByRole('region', { name: '成果預覽' }).locator('video'))
    const after = await app.evaluate(({ app }) =>
      app
        .getAppMetrics()
        .map((item) => ({ type: item.type, pid: item.pid, cpu: item.cpu, memory: item.memory })),
    )
    await writeFile(
      test.info().outputPath('media-process-metrics.json'),
      JSON.stringify(
        { bytes: 128 * 1024 * 1024, metadataBytes: JSON.stringify(metadata).length, before, after },
        null,
        2,
      ),
    )
    await page.screenshot({ path: test.info().outputPath('large-video-playing.png') })
    await page.evaluate(
      async ({ id, preview }) => {
        await window.yuki.client.releasePreview(id, preview)
      },
      { id: connection.characterId, preview: metadata.preview!.id },
    )
    await app.close()
    app = await rig.launch('rich-media')
    page = await app.firstWindow()
    if (!connection.persistentCredentials) await pairUI(page, rig.base, await rig.code())
    await navigate(page, '檔案與成果')
    await page.getByRole('button').filter({ hasText: image.artifact_id }).click()
    await expect(
      page.getByRole('region', { name: '成果預覽' }).getByRole('img', { name: 'animated.gif' }),
    ).toBeVisible()
    const oldUrl = await page
      .getByRole('region', { name: '成果預覽' })
      .getByRole('img', { name: 'animated.gif' })
      .getAttribute('src')
    const originalViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    const narrowMethod = await contentSize(app, page, 1024, 684)
    const narrowViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(narrowViewport.width).toBeLessThan(1100)
    // Role sessions intentionally remain mounted; their existing active context owns previews.
    second = await yukiFixture()
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: 'Yuki 連接', exact: true }).click()
    await page.getByRole('button', { name: '連接另一個 Yuki', exact: true }).click()
    await pairUI(page, second.base, await second.code())
    const oldUrlStatus = await page.evaluate(async (url) => (await fetch(url!)).status, oldUrl)
    expect(oldUrlStatus).toBe(404)
    await sidebar(page)
    await page.getByRole('button', { name: '切換 Yuki', exact: true }).click()
    await page
      .getByRole('menu', { name: 'Yuki', exact: true })
      .getByTitle(rig.base, { exact: true })
      .click()
    const restored = page
      .getByRole('region', { name: '成果預覽' })
      .filter({ visible: true })
      .getByRole('img', { name: 'animated.gif' })
    await expect(restored).toBeVisible()
    const restoredUrl = await restored.getAttribute('src')
    expect(restoredUrl).not.toBe(oldUrl)
    const restoredUrlStatus = await page.evaluate(
      async (url) => (await fetch(url!)).status,
      restoredUrl,
    )
    expect(restoredUrlStatus).toBe(200)
    const restoreMethod = await contentSize(
      app,
      page,
      originalViewport.width,
      originalViewport.height,
    )
    const restoredViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await writeFile(
      test.info().outputPath('narrow-role-preview-lifecycle.json'),
      JSON.stringify(
        {
          requestedNarrow: { width: 1024, height: 684 },
          originalViewport,
          narrowViewport,
          narrowMethod,
          oldUrl,
          oldUrlStatus,
          restoredUrl,
          restoredUrlStatus,
          restoredViewport,
          restoreMethod,
        },
        null,
        2,
      ),
    )
    await app.close()
    const seedStart = performance.now()
    const seeded = await fetch(`${rig.base}/__test/history?count=500`, { method: 'POST' })
    expect(seeded.status).toBe(200)
    const seedElapsedMs = performance.now() - seedStart
    app = await rig.launch('rich-media')
    page = await app.firstWindow()
    if (!connection.persistentCredentials) await pairUI(page, rig.base, await rig.code())
    await navigate(page, '對話')
    const log = page.getByRole('log', { name: '對話訊息' }).filter({ visible: true })
    await expect(log.locator('article[data-event-id]').first()).toBeVisible()
    const historyBefore = await app.evaluate(({ app }) => app.getAppMetrics())
    const start = performance.now()
    await log.hover()
    while (!(await log.getByText('歷史訊息 1', { exact: true }).count())) {
      const first = () =>
        log.locator('article[data-event-id]').first().getAttribute('data-event-id').then(Number)
      const before = await first()
      await page.mouse.wheel(0, -20000)
      await expect.poll(first).toBeLessThan(before)
    }
    const historyAfter = await app.evaluate(({ app }) => app.getAppMetrics())
    await writeFile(
      test.info().outputPath('history-process-metrics.json'),
      JSON.stringify(
        {
          acceptedEvents: 500,
          seedElapsedMs,
          mountedEvents: await log.locator('article[data-event-id]').count(),
          elapsedMs: performance.now() - start,
          before: historyBefore,
          after: historyAfter,
        },
        null,
        2,
      ),
    )
    expect(errors).toEqual([])
    success = true
  } finally {
    await app.close()
    await second?.close(success)
    await rig.close(success)
  }
})

test('plays and seeks actual MP3 and OGG audio from event attachments and published artifacts', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ richMedia: true }),
    app = await rig.launch('audio-mime-matrix')
  let success = false
  const facts: unknown[] = []
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const inspector = page.getByRole('complementary', { name: '檢視器', exact: true })
    for (const [name, mime] of [
      ['voice.mp3', 'audio/mpeg'],
      ['voice.ogg', 'audio/ogg'],
    ] as const) {
      const event = await upload(app, page, rig.root, name, rig.base)
      const response = await fetch(`${rig.base}/__test/media-artifact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: name }),
      })
      expect(response.status).toBe(200)
      const artifact = (await response.json()) as {
        artifact_id: string
        sha256: string
        event_id: number
      }
      for (const [source, eventId] of [
        ['event', event.event_id],
        ['artifact', artifact.event_id],
      ] as const) {
        await page
          .locator(`article[data-event-id="${eventId}"]`)
          .getByRole('button', { name: new RegExp(name.replace('.', '\\.')) })
          .click()
        const player = inspector.locator('audio')
        await playback(player)
        const actual = await player.evaluate(async (node) => {
          const audio = node as HTMLAudioElement
          const response = await fetch(audio.src, { method: 'HEAD' })
          return {
            mime: response.headers.get('Content-Type'),
            currentTime: audio.currentTime,
            duration: audio.duration,
          }
        })
        expect(actual.mime).toBe(mime)
        expect(actual.currentTime).toBeGreaterThan(2.7)
        facts.push({ filename: name, source, eventId, ...actual })
        await page.screenshot({ path: test.info().outputPath(`${name}-${source}.png`) })
        await page.getByRole('button', { name: '關閉檢視器', exact: true }).click()
      }
    }
    await writeFile(
      test.info().outputPath('audio-mime-playback.json'),
      JSON.stringify(facts, null, 2),
    )
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

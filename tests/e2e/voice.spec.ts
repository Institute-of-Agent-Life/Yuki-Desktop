import { expect, test } from '@playwright/test'
import type { Profile } from '../../src/shared/api'
import { currentConnection, ledgerEvents, yukiFixture, pairUI } from '../fixtures/backend'
import { writeFile } from 'node:fs/promises'

test('opening full-window settings ends real recording and retains its unsent attachment', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('voice-settings', [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ])
  let success = false
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ systemPreferences }) => {
      systemPreferences.askForMediaAccess = async () => true
    })
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page)
    const before = (await ledgerEvents(rig.base)).map((event) => event.event_id)
    const probe = await page.evaluateHandle(() => {
      const original = MediaRecorder.prototype.start
      let started!: () => void
      let stopped!: () => void
      const recording = new Promise<void>((resolve) => {
        started = resolve
      })
      const ended = new Promise<void>((resolve) => {
        stopped = resolve
      })
      MediaRecorder.prototype.start = function (...args) {
        MediaRecorder.prototype.start = original
        this.addEventListener('start', started, { once: true })
        this.addEventListener('stop', stopped, { once: true })
        return original.apply(this, args)
      }
      return {
        recording,
        ended,
        restore() {
          MediaRecorder.prototype.start = original
        },
      }
    })
    try {
      await page.getByRole('button', { name: '語音輸入', exact: true }).click()
      await probe.evaluate((value) => value.recording)
      await expect(page.getByRole('button', { name: '結束錄音', exact: true })).toBeVisible()
      await expect
        .poll(async () => {
          const label = await page
            .getByRole('status')
            .filter({ hasText: /^錄音 \d+:\d{2}$/ })
            .textContent()
          const time = /^錄音 (\d+):(\d{2})$/.exec(label!.trim())!
          return Number(time[1]) * 60 + Number(time[2])
        })
        .toBeGreaterThanOrEqual(1)
      await page.keyboard.press('ControlOrMeta+,')
      await expect(page.getByRole('tablist', { name: '設定分類', exact: true })).toBeVisible()
      await expect(page.getByRole('navigation', { name: '主要導覽', exact: true })).toBeHidden()
      await probe.evaluate((value) => value.ended)
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await expect(page.getByRole('button', { name: '語音輸入', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '結束錄音', exact: true })).toHaveCount(0)
      await expect(page.getByLabel('待送出附件')).toContainText('voice.webm')
      await expect(page.getByLabel('待送出附件')).toContainText('可送出')
      const recordings = await page.evaluate(async (id) => {
        const result = await window.yuki.client.uploads(id)
        if (!result.ok) throw Error(result.code)
        return result.value.filter((item) => item.kind === 'record')
      }, connection.characterId)
      expect(recordings).toHaveLength(1)
      expect(recordings[0]).toMatchObject({ filename: 'voice.webm', state: 'ready' })
      const after = (await ledgerEvents(rig.base)).map((event) => event.event_id)
      expect(after).toEqual(before)
      await page.screenshot({ path: test.info().outputPath('recording-draft-after-settings.png') })
      await writeFile(
        test.info().outputPath('recording-settings.json'),
        JSON.stringify(
          {
            before,
            after,
            recordings,
            endedWhenInactive: true,
          },
          null,
          2,
        ),
      )
    } finally {
      await probe.evaluate((value) => value.restore())
      await probe.dispose()
    }
    success = true
  } finally {
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

test('records through MediaRecorder, persists the original ASR transcript and converges on another device', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture()
  let app = await rig.launch('voice-A', [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ]),
    success = false
  try {
    let page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toBeVisible()
    await app.evaluate(({ systemPreferences }) => {
      systemPreferences.askForMediaAccess = async () => true
    })
    const code = await rig.code(),
      link = `yuki://pair?${new URLSearchParams({ server: rig.base, code })}`
    await app.evaluate(({ app }, link) => app.emit('open-url', { preventDefault() {} }, link), link)
    await expect(page.getByLabel('配對連結、綁定碼或完整回覆', { exact: true })).toHaveValue(link)
    await expect(page.getByText(`伺服器：${rig.base}`, { exact: true })).toBeVisible()
    await pairUI(page, rig.base, link)
    const connection = await currentConnection(page)
    const profile = await page.evaluate(async (id) => {
      const result = await window.yuki.client.read<Profile>(id, { kind: 'character' })
      if (!result.ok) throw Error(result.code)
      return result.value
    }, connection.characterId)
    await page.bringToFront()
    const recorderProbe = await page.evaluateHandle(() => {
      const originalStart = MediaRecorder.prototype.start
      let removeListeners: (() => void) | undefined
      let receivedStart!: () => void
      let rejectStart!: (error: unknown) => void
      const started = new Promise<void>((resolve, reject) => {
        receivedStart = () => resolve()
        rejectStart = reject
      })
      const failed = (event: Event) => {
        const name = (event as Event & { error?: DOMException }).error?.name ?? 'MediaRecorderError'
        rejectStart(new Error(`Native MediaRecorder error: ${name}`))
      }
      MediaRecorder.prototype.start = function (...args) {
        MediaRecorder.prototype.start = originalStart
        this.addEventListener('start', receivedStart, { once: true })
        this.addEventListener('error', failed, { once: true })
        removeListeners = () => {
          this.removeEventListener('start', receivedStart)
          this.removeEventListener('error', failed)
        }
        try {
          return originalStart.apply(this, args)
        } catch (error) {
          rejectStart(error)
          throw error
        }
      }
      return {
        started,
        restore() {
          MediaRecorder.prototype.start = originalStart
          removeListeners?.()
        },
      }
    })
    try {
      await page.getByRole('button', { name: '語音輸入', exact: true }).click()
      await test.step('Wait for the real MediaRecorder start event or native error', () =>
        recorderProbe.evaluate((probe) => probe.started))
      const recordingStatus = page.getByRole('status').filter({ hasText: /^錄音 \d+:\d{2}$/ })
      await expect
        .poll(
          async () => {
            const time = /^錄音 (\d+):(\d{2})$/.exec(
              (await recordingStatus.textContent())?.trim() ?? '',
            )
            return time ? Number(time[1]) * 60 + Number(time[2]) : 0
          },
          { message: 'The started recording must display at least one elapsed second' },
        )
        .toBeGreaterThanOrEqual(1)
      await page.getByRole('button', { name: '結束錄音', exact: true }).click()
      await expect(page.getByLabel('待送出附件')).toContainText('voice.webm')
      await expect(page.getByLabel('待送出附件')).toContainText('可送出')
    } finally {
      await recorderProbe.evaluate((probe) => probe.restore())
      await recorderProbe.dispose()
    }
    const recording = await page.evaluate(async (id) => {
      const result = await window.yuki.client.uploads(id)
      if (!result.ok) throw Error(result.code)
      const item = result.value.find(
        (item) => item.kind === 'record' && item.filename === 'voice.webm',
      )
      if (!item?.mediaId || item.state !== 'ready')
        throw Error('Original ready recording is missing')
      return item
    }, connection.characterId)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect
      .poll(
        async () =>
          ((await (await fetch(`${rig.base}/__test/asr-started`)).json()) as { started: boolean })
            .started,
        { timeout: 15000 },
      )
      .toBe(true)
    const before = await ledgerEvents(rig.base),
      originals = before.filter((item) =>
        item.attachments.some((attachment) => attachment.media_id === recording.mediaId),
      )
    expect(originals).toHaveLength(1)
    const original = originals[0]!
    expect(original.author_person_id).toBe(connection.personId)
    expect(original.conversation_id).toBe(connection.conversationId)
    expect(original.asr).toEqual([])
    const originalArticle = () => page.locator(`article[data-event-id="${original.event_id}"]`)
    await expect(originalArticle().getByRole('button', { name: /voice\.webm/ })).toBeVisible()
    await expect(originalArticle().locator('[data-transcript-segment]')).toHaveCount(0)
    await app.close()
    app = await rig.launch('voice-B')
    page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await expect(originalArticle().getByRole('button', { name: /voice\.webm/ })).toBeVisible()
    await expect(originalArticle().locator('[data-transcript-segment]')).toHaveCount(0)
    expect((await fetch(`${rig.base}/__test/disconnect`, { method: 'POST' })).ok).toBe(true)
    expect((await fetch(`${rig.base}/__test/resume-asr`, { method: 'POST' })).ok).toBe(true)
    await expect(
      originalArticle().getByText('原語音轉寫：請把附件留下。', { exact: true }),
    ).toBeVisible({
      timeout: 20000,
    })
    const after = await ledgerEvents(rig.base)
    expect(
      after
        .filter((item) =>
          item.attachments.some((attachment) => attachment.media_id === recording.mediaId),
        )
        .map((item) => item.event_id),
    ).toEqual([original.event_id])
    expect(after.find((item) => item.event_id === original.event_id)!.asr).toMatchObject([
      { text: '原語音轉寫：請把附件留下。', source: 'current' },
    ])
    await app.close()
    app = await rig.launch('voice-A')
    page = await app.firstWindow()
    const composer = page.getByRole('textbox', {
      name: `和 ${profile.display_name} 說點什麼`,
      exact: true,
    })
    if (!connection.persistentCredentials) await pairUI(page, rig.base, await rig.code())
    await expect(composer).toBeVisible()
    await expect(
      originalArticle().getByText('原語音轉寫：請把附件留下。', { exact: true }),
    ).toBeVisible()
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

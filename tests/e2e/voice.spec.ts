import { expect, test } from '@playwright/test'
import type { Profile } from '../../src/shared/api'
import { currentConnection, ledgerEvents, yukiFixture, pairUI } from '../fixtures/backend'

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
    await page.getByRole('button', { name: '語音輸入', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '錄音 0:01' })).toBeVisible()
    await page.getByRole('button', { name: '結束錄音', exact: true }).click()
    await expect(page.getByLabel('待送出附件')).toContainText('voice.webm')
    await expect(page.getByLabel('待送出附件')).toContainText('可送出')
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

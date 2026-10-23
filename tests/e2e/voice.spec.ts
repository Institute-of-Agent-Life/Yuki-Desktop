import { expect, test } from '@playwright/test'
import { currentEvents, yukiFixture, pairUI } from '../fixtures/backend'

test('records through MediaRecorder and restores the original persisted ASR on another device and a cold reopen', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture()
  let app = await rig.launch('voice-A', [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ]),
    success = false
  try {
    await app.evaluate(({ systemPreferences }) => {
      systemPreferences.askForMediaAccess = async () => true
    })
    let page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await page.getByRole('button', { name: '語音輸入', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '錄音 0:01' })).toBeVisible()
    await page.getByRole('button', { name: '結束錄音', exact: true }).click()
    await expect(page.getByLabel('待送出附件')).toContainText('voice.webm')
    await expect(page.getByLabel('待送出附件')).toContainText('可送出')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect
      .poll(
        async () =>
          ((await (await fetch(`${rig.base}/__test/asr-started`)).json()) as { started: boolean })
            .started,
        { timeout: 15000 },
      )
      .toBe(true)
    const original = (await currentEvents(page)).items.find((item) =>
      item.attachments.some((attachment) => attachment.filename === 'voice.webm'),
    )!
    expect(original.asr).toEqual([])
    await app.close()
    app = await rig.launch('voice-B')
    page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    expect((await currentEvents(page)).items.find((item) => item.id === original.id)?.asr).toEqual(
      [],
    )
    await page.evaluate(() => window.yuki.client.reconnect())
    expect((await fetch(`${rig.base}/__test/resume-asr`, { method: 'POST' })).status).toBe(200)
    const transcript = '原語音轉寫：請把附件留下。'
    await expect(page.getByText(transcript, { exact: true })).toHaveCount(1, { timeout: 20000 })
    const after = (await currentEvents(page)).items.filter((item) =>
      item.attachments.some((attachment) => attachment.filename === 'voice.webm'),
    )
    expect(after).toHaveLength(1)
    expect(after[0]!.id).toBe(original.id)
    expect(after[0]!.asr).toEqual([
      { segment_index: expect.any(Number), text: transcript, source: expect.any(String) },
    ])
    await app.close()
    app = await rig.launch('voice-A')
    page = await app.firstWindow()
    await expect(page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })).toBeVisible()
    await expect(page.getByText(transcript, { exact: true })).toHaveCount(1)
    success = true
  } finally {
    await fetch(`${rig.base}/__test/resume-asr`, { method: 'POST' })
    await app.close()
    await rig.close(success)
  }
})

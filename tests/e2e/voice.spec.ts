import { expect, test } from '@playwright/test'
import { yukiFixture, pairUI } from '../fixtures/backend'

test('records through MediaRecorder, persists the original ASR transcript and converges on another device', async () => {
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
    await expect(page.getByRole('button', { name: '開始', exact: true })).toBeVisible()
    const code = await rig.code(),
      link = `yuki://pair?${new URLSearchParams({ server: rig.base, code })}`
    await app.evaluate(({ app }, link) => app.emit('open-url', { preventDefault() {} }, link), link)
    await expect(page.getByLabel('伺服器位址')).toHaveValue(rig.base)
    await page.getByRole('button', { name: '繼續', exact: true }).click()
    await expect(page.getByLabel('綁定碼或完整回覆')).toHaveValue(code)
    await page.getByRole('button', { name: '配對', exact: true }).click()
    await page.getByRole('button', { name: '進入', exact: true }).click()
    await page.getByRole('button', { name: '語音輸入', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '錄音 0:01' })).toBeVisible()
    await page.getByRole('button', { name: '結束錄音', exact: true }).click()
    await expect(page.getByLabel('待送出附件')).toContainText('voice.webm')
    await expect(page.getByLabel('待送出附件')).toContainText('可送出')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('語音訊息', { exact: true })).toBeVisible()
    await expect(page.getByText('沒有轉寫', { exact: true })).toBeVisible()
    await expect
      .poll(
        async () =>
          ((await (await fetch(`${rig.base}/__test/asr-started`)).json()) as { started: boolean })
            .started,
        { timeout: 15000 },
      )
      .toBe(true)
    const before = (await (await fetch(`${rig.base}/__test/events`)).json()) as {
        id: number
        text: string
      }[],
      original = before.find((item) => item.text.includes('voice.webm'))!
    await app.close()
    app = await rig.launch('voice-B')
    page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await expect(page.getByText('沒有轉寫', { exact: true })).toBeVisible()
    await fetch(`${rig.base}/__test/disconnect`, { method: 'POST' })
    await fetch(`${rig.base}/__test/resume-asr`, { method: 'POST' })
    await expect(page.getByText('原語音轉寫：請把附件留下。', { exact: true })).toBeVisible({
      timeout: 20000,
    })
    const after = (await (await fetch(`${rig.base}/__test/events`)).json()) as {
      id: number
      text: string
    }[]
    expect(after.filter((item) => item.text.includes('voice.webm')).map((item) => item.id)).toEqual(
      [original.id],
    )
    await app.close()
    app = await rig.launch('voice-A')
    page = await app.firstWindow()
    await expect(
      page.getByRole('textbox', { name: '和 Yuki 說點什麼' }).or(page.getByLabel('伺服器位址')),
    ).toBeVisible()
    if (await page.getByLabel('伺服器位址').isVisible())
      await pairUI(page, rig.base, await rig.code())
    await expect(page.getByText('原語音轉寫：請把附件留下。', { exact: true })).toBeVisible()
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { currentConnection, pairUI, waitForAcceptedMessage, yukiFixture } from '../fixtures/backend'

test('a sent message shows at once while the original request is confirmed in the background', async () => {
  test.setTimeout(180_000)
  const rig = await yukiFixture(),
    app = await rig.launch('instant-send')
  const evidence: Record<string, unknown> = {}
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page)
    const box = page.getByRole('textbox', { name: `和 ${connection.name} 說點什麼`, exact: true })
    const send = page.getByRole('button', { name: '送出', exact: true })
    const post = (path: string) => fetch(`${rig.base}/__test/${path}`, { method: 'POST' })
    const bubble = (text: string) =>
      page.locator('article[data-message-request]').filter({ hasText: text })

    // 12–13: the server holds the owner check; the message is already on screen.
    const held = '伺服器確認前就看見這則訊息'
    await post('pause-next-me')
    await box.fill(held)
    const clicked = Date.now()
    await send.click()
    await expect(bubble(held)).toBeVisible({ timeout: 1000 })
    await expect(box).toHaveValue('', { timeout: 1000 })
    evidence.visibleAfterMs = Date.now() - clicked
    await expect
      .poll(
        async () =>
          ((await (await fetch(`${rig.base}/__test/me-blocked`)).json()) as { blocked: boolean })
            .blocked,
      )
      .toBe(true)
    // Sending passes silently: no state line and nothing to check yet.
    await expect(bubble(held).getByText('送出中', { exact: true })).toHaveCount(0)
    await expect(bubble(held).getByRole('button', { name: '查詢', exact: true })).toHaveCount(0)
    const outbox = async () =>
      page.evaluate(async (id) => {
        const result = await window.yuki.client.outbox(id)
        if (!result.ok) throw Error(result.code)
        return result.value
      }, connection.characterId)
    evidence.whileHeld = (await outbox()).find((item) => item.body.text === held)

    // 14: once released, the same request becomes the one accepted message.
    const accepted = waitForAcceptedMessage(page, connection.characterId, held)
    await post('resume-me')
    const sent = await accepted
    await expect(page.locator(`article[data-event-id="${sent.eventId}"]`)).toContainText(held)
    await expect(page.getByText(held, { exact: true })).toHaveCount(1)
    await expect(page.getByText('送出中', { exact: true })).toHaveCount(0)
    expect((await outbox()).filter((item) => item.body.text === held)).toHaveLength(1)
    evidence.accepted = sent

    // 15: with the server gone the message stays local until it can be sent.
    await post('shutdown')
    await expect
      .poll(async () => {
        try {
          await fetch(`${rig.base}/healthz`)
          return 'up'
        } catch {
          return 'down'
        }
      })
      .toBe('down')
    // The fixture notices the exit before it restarts the server.
    await page.waitForTimeout(2000)
    const offline = '離線時寫下的訊息'
    await box.fill(offline)
    await send.click()
    await expect(bubble(offline).getByText('連線後送出', { exact: true })).toBeVisible({
      timeout: 20_000,
    })
    await expect(box).toHaveValue('')
    evidence.offline = (await outbox()).find((item) => item.body.text === offline)
    await rig.restart()
    const delivered = waitForAcceptedMessage(page, connection.characterId, offline)
    await bubble(offline).getByRole('button', { name: '查詢', exact: true }).click()
    evidence.delivered = await delivered
    await expect(page.getByText(offline, { exact: true })).toHaveCount(1)
    success = true
  } finally {
    await writeFile(
      test.info().outputPath('instant-send.json'),
      JSON.stringify(evidence, null, 2) + '\n',
    )
    await app.close()
    await rig.close(success)
  }
})

import { expect, test } from '@playwright/test'
import type { MessageBoxOptions } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { currentConnection, pairUI, waitForAcceptedMessage, yukiFixture } from '../fixtures/backend'

type Confirmation = Pick<MessageBoxOptions, 'title' | 'detail' | 'defaultId' | 'cancelId'> & {
  response: 0 | 1
}
type LinkProbe = { confirmations: Confirmation[]; opened: string[]; response: 0 | 1 }
type TestMain = typeof globalThis & { messageLinkProbe: LinkProbe }

test('opens HTTP and HTTPS conversation links after confirmation', async () => {
  test.setTimeout(120_000)
  const sentUrl = 'http://example.invalid/wiki/Entry_(draft)',
    receivedUrl = 'https://example.invalid/guide?mode=desktop&lang=zh#start',
    markdownLabel = 'https://example.invalid/label',
    markdownUrl = 'https://example.invalid/markdown',
    inlineUrl = 'https://example.invalid/inline',
    fencedUrl = 'https://example.invalid/fenced',
    mailto = 'mailto:help@example.invalid'
  const sentText = `已送出 (${sentUrl}).`,
    receivedLine = `收到 ${receivedUrl}，請核對。`,
    receivedText = [
      receivedLine,
      `[${markdownLabel}](${markdownUrl})`,
      `[聯絡信箱](${mailto})`,
      `\`${inlineUrl}\``,
      `\`\`\`text\n${fencedUrl}\n\`\`\``,
      'example.invalid help@example.invalid ftp://example.invalid/docs //example.invalid/docs',
    ].join('\n\n')
  const rig = await yukiFixture({ richMedia: true }),
    app = await rig.launch('message-links')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page)
    await page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ }).fill(sentText)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const sent = await waitForAcceptedMessage(page, connection.characterId, sentText)
    const file = 'received-links.md'
    await writeFile(join(rig.root, file), receivedText)
    const delivery = await fetch(`${rig.base}/__test/media-artifact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: file, text: receivedText }),
    })
    expect(delivery.ok).toBe(true)
    const received = (await delivery.json()) as { event_id: number }
    const sentMessage = page.locator(`article[data-event-id="${sent.eventId}"]`)
    const receivedMessage = page.locator(`article[data-event-id="${received.event_id}"]`)
    await expect(sentMessage.locator('p')).toHaveText(sentText)
    await expect(receivedMessage.locator('p').filter({ hasText: '請核對' })).toHaveText(
      receivedLine,
    )
    await expect(receivedMessage.locator('code')).toHaveText([inlineUrl, fencedUrl])

    const renderEvidence = await Promise.all(
      [sentMessage, receivedMessage].map((message) =>
        message.evaluate((node) => ({
          eventId: node.getAttribute('data-event-id'),
          text: node.textContent,
          links: Array.from(node.querySelectorAll('a[href]'), (link) => ({
            text: link.textContent,
            href: link.getAttribute('href'),
          })),
        })),
      ),
    )
    await writeFile(
      test.info().outputPath('rendered-links.json'),
      JSON.stringify(renderEvidence, null, 2),
    )
    const sentLink = sentMessage.getByRole('link', { name: sentUrl, exact: true })
    const receivedLink = receivedMessage.getByRole('link', { name: receivedUrl, exact: true })
    const markdownLink = receivedMessage.getByRole('link', { name: markdownLabel, exact: true })
    await expect(sentLink).toHaveAttribute('href', sentUrl, { timeout: 5000 })
    await expect(sentLink).toHaveCSS('text-decoration-line', 'underline')
    await expect(receivedLink).toHaveAttribute('href', receivedUrl)
    await expect(markdownLink).toHaveAttribute('href', markdownUrl)
    await expect(sentMessage.getByRole('link')).toHaveCount(1)
    await expect(receivedMessage.getByRole('link')).toHaveCount(3)

    await app.evaluate(({ dialog, shell }) => {
      const host = globalThis as TestMain
      const probe: LinkProbe = { confirmations: [], opened: [], response: 0 }
      host.messageLinkProbe = probe
      dialog.showMessageBox = async (...args: unknown[]) => {
        const { title, detail, defaultId, cancelId } = args.at(-1) as MessageBoxOptions
        const { response } = probe
        probe.confirmations.push({ title, detail, defaultId, cancelId, response })
        return { response, checkboxChecked: false }
      }
      shell.openExternal = async (url) => {
        probe.opened.push(url)
      }
    })
    const readProbe = () => app.evaluate(() => (globalThis as TestMain).messageLinkProbe)
    const pageUrl = page.url()
    await sentLink.click()
    await expect.poll(async () => (await readProbe()).confirmations.length).toBe(1)
    expect((await readProbe()).opened).toEqual([])
    await app.evaluate(() => {
      const host = globalThis as TestMain
      host.messageLinkProbe.response = 1
    })
    await sentLink.click()
    await receivedLink.click()
    await markdownLink.click()
    const expectedTargets = [sentUrl, receivedUrl, markdownUrl]
    await expect.poll(async () => (await readProbe()).opened).toEqual(expectedTargets)

    await receivedMessage.getByRole('link', { name: '聯絡信箱', exact: true }).click()
    await expect(receivedMessage.getByText('請檢查輸入內容。', { exact: true })).toBeVisible()
    const { confirmations, opened } = await readProbe()
    await writeFile(
      test.info().outputPath('external-links.json'),
      JSON.stringify({ confirmations, opened, rejected: mailto }, null, 2),
    )
    expect(confirmations).toEqual(
      [sentUrl, ...expectedTargets].map((detail, index) => ({
        title: '開啟外部連結',
        detail,
        defaultId: 0,
        cancelId: 0,
        response: index === 0 ? 0 : 1,
      })),
    )
    expect(opened).toEqual(expectedTargets)
    await expect(page).toHaveURL(pageUrl)
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

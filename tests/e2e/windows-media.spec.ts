import { expect, test, type Page } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { EventsPage } from '../../src/shared/api'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
import { launchShell } from '../fixtures/shell-app'
import { completeWindowsFileDialog, windowsFileDialogOwner } from '../fixtures/windows-file-dialog'

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

test('Windows native attachments recover a lost upload receipt and save identical bytes on a second device without original files', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows interactive desktop')
  test.setTimeout(180000)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  const rig = await yukiFixture(),
    proxy = await forwardProxy(rig.base, '/native-media'),
    base = proxy.base,
    data = rig.root
  const source = join(data, '跨裝置原件.txt')
  const imageSource = join(data, '跨裝置圖片.png')
  const text = `原生附件驗證 ${randomUUID()}\n${'這是原件移除後仍須由伺服器讀取的內容。\n'.repeat(120)}`
  const bytes = Buffer.from(text)
  await writeFile(source, bytes)
  await copyFile(new URL('../fixtures/avatar-white.png', import.meta.url), imageSource)
  const imageBytes = await readFile(imageSource)
  let app = await launchShell(join(data, 'profile-a'))
  let success = false
  try {
    let page = await app.firstWindow()
    const pair = async (page: Page, label: string) => {
      await page.waitForLoadState('domcontentloaded')
      await pairUI(page, base, await rig.code(), label, 20000)
    }
    await pair(page, '原生附件裝置 A')
    const runtime = await app.evaluate(({ app, BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      return {
        platform: process.platform,
        arch: process.arch,
        packaged: app.isPackaged,
        scaleFactor: screen.getDisplayMatching(window.getBounds()).scaleFactor,
        sandboxed: app
          .getAppMetrics()
          .find((item) => item.pid === window.webContents.getOSProcessId())?.sandboxed,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
      }
    })
    expect(runtime).toMatchObject({
      platform: 'win32',
      arch: 'x64',
      packaged: true,
      sandboxed: true,
      noSandbox: false,
    })
    const originalConnections = await page.evaluate(() => window.yuki.client.connections())
    if (!originalConnections.ok) throw Error(originalConnections.code)
    const connection = originalConnections.value[0]!
    proxy.faults.loseNextSuffix = '/uploads'
    const receipts = []
    for (const selection of [source, imageSource]) {
      const owner = await windowsFileDialogOwner(app)
      await page.getByRole('button', { name: '附加檔案', exact: true }).click()
      const receipt = await completeWindowsFileDialog(owner, selection, 'open')
      expect(receipt).toMatchObject({
        Action: 'open',
        DialogClass: '#32770',
        FilenameControl: 1148,
        DefaultButton: 1,
      })
      expect(receipt.SessionId).toBeGreaterThan(0)
      receipts.push(receipt)
      const draft = page
        .getByLabel('待送出附件')
        .locator(':scope > div')
        .filter({ hasText: basename(selection) })
      await expect(draft).toContainText('可送出', { timeout: 15000 })
    }
    const staged = await page.evaluate(
      (id) => window.yuki.client.uploads(id),
      connection.characterId,
    )
    if (!staged.ok) throw Error(staged.code)
    expect(staged.value).toHaveLength(2)
    for (const [filename, content] of [
      [basename(source), bytes],
      [basename(imageSource), imageBytes],
    ] as const) {
      expect(staged.value.find((item) => item.filename === filename)).toMatchObject({
        state: 'ready',
        size: content.byteLength,
        sha256: sha256(content),
      })
    }
    const calls = proxy.calls
      .filter(
        (call) => call.method === 'POST' && new URL(call.path, base).pathname.endsWith('/uploads'),
      )
      .map((call) => call.requestId)
    expect(proxy.lostStatuses).toEqual([200])
    // The first HTTP response was lost after commit; receipt lookup must avoid another upload.
    expect(calls.sort()).toEqual(staged.value.map((item) => item.requestId).sort())
    const body = `請讀取這兩份原生附件 ${randomUUID()}`
    await page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ }).fill(body)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const sent = page.getByRole('article').filter({ has: page.getByText(body, { exact: true }) })
    await expect(sent).toHaveAttribute('data-event-id', /^\d+$/)
    const eventId = Number(await sent.getAttribute('data-event-id'))
    const events = await page.evaluate(
      async (args) => {
        const result = await window.yuki.client.read<EventsPage>(args.characterId, {
          kind: 'events',
          conversationId: args.conversationId,
        })
        if (!result.ok) throw Error(result.code)
        return result.value.items.find((event) => event.id === args.eventId)
      },
      { ...connection, eventId },
    )
    expect(events?.attachments).toHaveLength(2)
    for (const [filename, content] of [
      [basename(source), bytes],
      [basename(imageSource), imageBytes],
    ] as const)
      expect(events!.attachments.find((item) => item.filename === filename)).toMatchObject({
        size: content.byteLength,
      })
    await app.close()
    // These are only the two inputs created by this test, never user-selected files.
    await rm(source)
    await rm(imageSource)
    await expect(readFile(source)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(imageSource)).rejects.toMatchObject({ code: 'ENOENT' })
    app = await launchShell(join(data, 'profile-b'))
    page = await app.firstWindow()
    await pair(page, '原生附件裝置 B')
    const originalEvent = page.locator(`article[data-event-id="${eventId}"]`)
    await expect(originalEvent).toBeVisible()
    const image = originalEvent.getByRole('img', { name: basename(imageSource), exact: true })
    await expect(image).toBeVisible()
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
      .toBe(imageBytes.readUInt32BE(16))
    await originalEvent
      .getByRole('button', { name: new RegExp(basename(source).replace('.', '\\.')) })
      .click()
    await expect(page.locator('pre')).toHaveText(text)
    const saved = []
    for (const [filename, content] of [
      ['另存文字.txt', bytes],
      ['另存圖片.png', imageBytes],
    ] as const) {
      if (filename.endsWith('.png')) {
        await page.getByRole('button', { name: '關閉預覽', exact: true }).click()
        await image.click()
      }
      const destination = join(data, filename)
      const owner = await windowsFileDialogOwner(app)
      await page.getByRole('button', { name: '存成檔案', exact: true }).click()
      const receipt = await completeWindowsFileDialog(owner, destination, 'save')
      expect(receipt).toMatchObject({
        Action: 'save',
        DialogClass: '#32770',
        FilenameControl: 1001,
        DefaultButton: 1,
      })
      receipts.push(receipt)
      await expect
        .poll(async () => {
          try {
            return sha256(await readFile(destination))
          } catch {
            return null
          }
        })
        .toBe(sha256(content))
      expect((await readFile(destination)).byteLength).toBe(content.byteLength)
      saved.push({ filename, size: content.byteLength, sha256: sha256(content) })
    }
    await page.screenshot({
      path: test.info().outputPath('windows-native-second-device-media.png'),
      animations: 'disabled',
    })
    await writeFile(
      test.info().outputPath('windows-native-media.json'),
      JSON.stringify(
        {
          runtime,
          receipts,
          eventId,
          uploadedRequestIds: calls,
          staged: staged.value,
          saved,
          originalsRemoved: true,
        },
        null,
        2,
      ) + '\n',
    )
    success = true
  } finally {
    await app.close()
    await proxy.close()
    await rig.close(success)
  }
})

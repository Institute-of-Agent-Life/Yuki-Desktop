import { expect, test } from '@playwright/test'
import { writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { yukiFixture, pairUI } from '../fixtures/backend'

test('device A uploads with a lost receipt; device B previews and saves verified bytes without the original file', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    source = join(rig.root, 'handoff.txt'),
    destination = join(rig.root, 'saved-on-B.txt'),
    bytes = Buffer.from('跨裝置內容\n原件已從裝置 A 移除。')
  await writeFile(source, bytes)
  let app = await rig.launch('device-A'),
    success = false
  try {
    let page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await fetch(`${rig.base}/__test/lose-next-upload-response`, { method: 'POST' })
    await app.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
    }, source)
    await page.getByRole('button', { name: '附加檔案', exact: true }).click()
    await expect(page.getByLabel('待送出附件')).toContainText('handoff.txt')
    await expect(page.getByLabel('待送出附件')).toContainText('可送出', { timeout: 15000 })
    await page.getByRole('textbox', { name: '和 Yuki 說點什麼' }).fill('請看這份附件')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect
      .poll(async () => {
        const events = (await (await fetch(`${rig.base}/__test/events`)).json()) as {
          text: string
        }[]
        return events.some((item) => item.text.includes('[file附件0：handoff.txt]'))
      })
      .toBe(true)
    const posted = (await (await fetch(`${rig.base}/__test/uploads`)).json()) as {
      requests: string[]
    }
    expect(posted.requests).toHaveLength(1)
    const imagePath = join(rig.root, 'dropped.png')
    await writeFile(
      imagePath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=',
        'base64',
      ),
    )
    const drag = await page.context().newCDPSession(page)
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const)
      await drag.send('Input.dispatchDragEvent', {
        type,
        x: 600,
        y: 300,
        data: { items: [], files: [imagePath], dragOperationsMask: 1 },
      })
    await expect(page.getByLabel('待送出附件')).toContainText('dropped.png')
    await expect(page.getByLabel('待送出附件')).toContainText('可送出')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByRole('img', { name: 'dropped.png', exact: true })).toBeVisible()
    const videoPath = join(rig.root, 'clip.webm')
    await promisify(execFile)('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=32x32:r=5',
      '-t',
      '0.4',
      '-c:v',
      'libvpx-vp9',
      videoPath,
    ])
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, videoPath)
    await page.getByRole('button', { name: '附加檔案', exact: true }).click()
    await expect(page.getByLabel('待送出附件')).toContainText('可送出')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.locator('article').getByRole('button', { name: /clip\.webm/ })).toBeVisible()
    await expect
      .poll(async () => {
        const events = (await (await fetch(`${rig.base}/__test/events`)).json()) as {
          text: string
        }[]
        return events.some((item) => item.text.includes('[video附件0：clip.webm]'))
      })
      .toBe(true)
    await app.close()
    await rm(source)
    app = await rig.launch('device-B')
    page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await expect(page.getByRole('img', { name: 'dropped.png', exact: true })).toBeVisible()
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(message.text())
    })
    await page.getByRole('button', { name: /clip\.webm/ }).click()
    await expect
      .poll(() => page.locator('video').evaluate((video) => (video as HTMLVideoElement).readyState))
      .toBeGreaterThanOrEqual(2)
      .catch(async (error) => {
        console.error(
          await page.locator('video').evaluate((video) => {
            const element = video as HTMLVideoElement
            return {
              src: element.src,
              ready: element.readyState,
              network: element.networkState,
              error: element.error?.message,
            }
          }),
        )
        throw error
      })
    await page.getByRole('button', { name: /handoff\.txt/ }).click()
    await expect(page.getByText('跨裝置內容\n原件已從裝置 A 移除。', { exact: true })).toBeVisible()
    await app.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination })
    }, destination)
    await page.getByRole('button', { name: '存成檔案', exact: true }).click()
    await expect
      .poll(async () => {
        try {
          return createHash('sha256')
            .update(await readFile(destination))
            .digest('hex')
        } catch {
          return ''
        }
      })
      .toBe(createHash('sha256').update(bytes).digest('hex'))
    const facts = (await (await fetch(`${rig.base}/__test/events`)).json()) as {
        id: number
        text: string
      }[],
      event = facts.find((item) => item.text.includes('[file附件0：handoff.txt]'))!
    expect(
      (await fetch(`${rig.base}/__test/expire-attachments/${event.id}`, { method: 'POST' })).status,
    ).toBe(200)
    await fetch(`${rig.base}/__test/disconnect`, { method: 'POST' })
    await expect(page.getByText('已過期', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: '存成檔案', exact: true })).toHaveCount(0)
    await page.screenshot({
      path: test.info().outputPath('second-device-expired-attachment.png'),
      animations: 'disabled',
    })
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

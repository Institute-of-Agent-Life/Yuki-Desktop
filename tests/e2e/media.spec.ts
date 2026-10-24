import { expect, test, type Page } from '@playwright/test'
import { writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { OutboxItem, OriginalRequest, Profile } from '../../src/shared/api'
import { currentConnection, ledgerEvents, yukiFixture, pairUI } from '../fixtures/backend'

async function acceptedAttachment(page: Page, characterId: string, mediaId: string) {
  const item = await page.evaluate(
    ({ characterId, mediaId }) =>
      new Promise<OutboxItem>((resolve, reject) => {
        const read = async () => {
          try {
            const result = await window.yuki.client.outbox(characterId)
            if (!result.ok) throw Error(result.code)
            const item = result.value.find((item) => item.body.attachments?.includes(mediaId))
            if (item?.eventId) {
              dispose()
              resolve(item)
            }
          } catch (error) {
            dispose()
            reject(error)
          }
        }
        const dispose = window.yuki.client.onHint((id, kind) => {
          if (id === characterId && kind === 'outbox') void read()
        })
        void read()
      }),
    { characterId, mediaId },
  )
  const receipt = await page.evaluate(
    async ({ characterId, requestId }) => {
      const result = await window.yuki.client.read<OriginalRequest>(characterId, {
        kind: 'request',
        requestId,
      })
      if (!result.ok) throw Error(result.code)
      return result.value
    },
    { characterId, requestId: item.requestId },
  )
  expect(receipt).toMatchObject({
    found: true,
    operation_kind: 'message',
    payload_hash: item.payloadHash,
    event_id: item.eventId,
  })
  return item
}

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
    const connection = await currentConnection(page)
    const profile = await page.evaluate(async (id) => {
      const result = await window.yuki.client.read<Profile>(id, { kind: 'character' })
      if (!result.ok) throw Error(result.code)
      return result.value
    }, connection.characterId)
    expect(
      (await fetch(`${rig.base}/__test/lose-next-upload-response`, { method: 'POST' })).ok,
    ).toBe(true)
    await app.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
    }, source)
    await page.getByRole('button', { name: '附加檔案', exact: true }).click()
    await expect(page.getByLabel('待送出附件')).toContainText('handoff.txt')
    await expect(page.getByLabel('待送出附件')).toContainText('可送出', { timeout: 15000 })
    const upload = await page.evaluate(async (id) => {
      const result = await window.yuki.client.uploads(id)
      if (!result.ok) throw Error(result.code)
      const item = result.value.find((item) => item.filename === 'handoff.txt')
      if (!item?.mediaId || item.state !== 'ready') throw Error('Original ready upload is missing')
      return item
    }, connection.characterId)
    expect(upload.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    await page
      .getByRole('textbox', { name: `和 ${profile.display_name} 說點什麼`, exact: true })
      .fill('請看這份附件')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect
      .poll(async () => {
        const events = await ledgerEvents(rig.base)
        return events.filter((item) =>
          item.attachments.some((attachment) => attachment.media_id === upload.mediaId),
        ).length
      })
      .toBe(1)
    const original = (await ledgerEvents(rig.base)).find((item) =>
      item.attachments.some((attachment) => attachment.media_id === upload.mediaId),
    )!
    expect(original.author_person_id).toBe(connection.personId)
    expect(original.conversation_id).toBe(connection.conversationId)
    expect(original.attachments).toMatchObject([
      { attachment_index: 0, kind: 'file', filename: 'handoff.txt', media_id: upload.mediaId },
    ])
    const posted = (await (await fetch(`${rig.base}/__test/uploads`)).json()) as {
      requests: string[]
    }
    expect(posted.requests).toEqual([upload.requestId])
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
    const image = await page.evaluate(async (id) => {
      const result = await window.yuki.client.uploads(id)
      if (!result.ok) throw Error(result.code)
      const item = result.value.find((item) => item.filename === 'dropped.png')
      if (!item?.mediaId || item.state !== 'ready') throw Error('Original image upload is missing')
      return item
    }, connection.characterId)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const imageMessage = await acceptedAttachment(page, connection.characterId, image.mediaId!)
    await expect(
      page
        .locator(`article[data-event-id="${imageMessage.eventId}"]`)
        .getByRole('img', { name: 'dropped.png', exact: true }),
    ).toBeVisible()
    const videoPath = join(rig.root, 'clip.webm')
    const videoBytes = await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 32
      const context = canvas.getContext('2d')!
      context.fillStyle = 'blue'
      context.fillRect(0, 0, 32, 32)
      const stream = canvas.captureStream(10)
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })
      const chunks: Blob[] = []
      const recorded = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => chunks.push(event.data)
        recorder.onerror = () => reject(Error('Actual video fixture encoding failed'))
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }))
        recorder.start()
        // Generate the same 0.4-second real video without a host ffmpeg installation.
        setTimeout(() => recorder.stop(), 400)
      })
      try {
        return Array.from(new Uint8Array(await (await recorded).arrayBuffer()))
      } finally {
        stream.getTracks().forEach((track) => track.stop())
      }
    })
    await writeFile(videoPath, Uint8Array.from(videoBytes))
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, videoPath)
    await page.getByRole('button', { name: '附加檔案', exact: true }).click()
    await expect(page.getByLabel('待送出附件')).toContainText('可送出')
    const video = await page.evaluate(async (id) => {
      const result = await window.yuki.client.uploads(id)
      if (!result.ok) throw Error(result.code)
      const item = result.value.find((item) => item.filename === 'clip.webm')
      if (!item?.mediaId || item.state !== 'ready') throw Error('Original video upload is missing')
      return item
    }, connection.characterId)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const videoMessage = await acceptedAttachment(page, connection.characterId, video.mediaId!)
    await expect(
      page
        .locator(`article[data-event-id="${videoMessage.eventId}"]`)
        .getByRole('button', { name: /clip\.webm/ }),
    ).toBeVisible()
    await expect
      .poll(async () => {
        const events = await ledgerEvents(rig.base)
        return events.some((item) =>
          item.attachments.some(
            (attachment) => attachment.kind === 'video' && attachment.filename === 'clip.webm',
          ),
        )
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
    await page.getByRole('button', { name: '關閉預覽', exact: true }).click()
    await page.getByRole('button', { name: '關閉檢視器', exact: true }).click()
    await page
      .locator(`article[data-event-id="${original.event_id}"]`)
      .getByRole('button', { name: /handoff\.txt/ })
      .click()
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
    const originalAfterTransfer = (await ledgerEvents(rig.base)).filter(
      (item) => item.event_id === original.event_id,
    )
    expect(originalAfterTransfer).toEqual([original])
    expect(
      (
        await fetch(`${rig.base}/__test/expire-attachments/${original.event_id}`, {
          method: 'POST',
        })
      ).status,
    ).toBe(200)
    expect((await fetch(`${rig.base}/__test/disconnect`, { method: 'POST' })).ok).toBe(true)
    const preview = page.getByRole('complementary', { name: '檢視器', exact: true })
    await expect(
      preview.getByText('無法讀取或查證原項目，原文仍保留。', { exact: true }),
    ).toBeVisible()
    await expect(preview.getByRole('button', { name: '存成檔案', exact: true })).toHaveCount(0)
    expect(
      await page.evaluate(
        async ({ id, source }) => {
          const result = await window.yuki.client.content(id, source)
          return result.ok ? { ok: true } : result
        },
        {
          id: connection.characterId,
          source: {
            conversationId: original.conversation_id,
            eventId: original.event_id,
            index: 0,
          },
        },
      ),
    ).toMatchObject({ ok: false, code: 'not_found' })
    await expect(
      readFile(
        join(
          rig.root,
          'device-B',
          'connections',
          connection.characterId,
          'cache',
          connection.personId,
          upload.sha256 + '.blob',
        ),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(destination)).toEqual(bytes)
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

import { expect, test } from '@playwright/test'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { currentConnection, currentEvents, pairUI, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'

test('current uploads recover the original lost response and another device saves actual attachment and artifact bytes', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    proxy = await forwardProxy(rig.base, '/media')
  const source = join(rig.root, 'original.txt'),
    saved = join(rig.root, 'saved.txt')
  const bytes = Buffer.from('original cross-device attachment\n')
  await writeFile(source, bytes)
  let app = await rig.launch('media-a'),
    success = false
  try {
    let page = await app.firstWindow()
    await pairUI(page, proxy.base, await rig.code(), undefined, 15000)
    proxy.faults.loseNextSuffix = '/uploads'
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, source)
    await page.getByRole('button', { name: '附加檔案', exact: true }).click()
    await expect.poll(() => proxy.lostStatuses).toEqual([200])
    proxy.faults.holdReceipts = false
    await expect(page.getByLabel('待送出附件')).toContainText('可送出')
    await page
      .getByRole('textbox', { name: /^和 .+ 說點什麼$/ })
      .fill('original attachment delivery')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect
      .poll(async () =>
        (await currentEvents(page)).items.some((event) =>
          event.attachments.some((item) => item.filename === 'original.txt'),
        ),
      )
      .toBe(true)
    expect(
      proxy.calls.filter(
        (call) => call.method === 'POST' && call.path.split('?')[0]!.endsWith('/uploads'),
      ),
    ).toHaveLength(1)
    await app.close()
    await rm(source)
    app = await rig.launch('media-b')
    page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code(), undefined, 15000)
    await page.getByRole('button', { name: /original\.txt/ }).click()
    await expect(page.getByText('original cross-device attachment', { exact: true })).toBeVisible()
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, saved)
    await page.getByRole('button', { name: '存成檔案', exact: true }).click()
    await expect
      .poll(async () => {
        const content = await readFile(saved).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
        return content && createHash('sha256').update(content).digest('hex')
      })
      .toBe(createHash('sha256').update(bytes).digest('hex'))
    const state = await rig.state(),
      connection = await currentConnection(page)
    const artifact = await page.evaluate(
      async ({ id, source }) => {
        const result = await window.yuki.client.artifactContent(id, source)
        if (!result.ok) throw Error(result.code)
        return { sha256: result.value.sha256, text: new TextDecoder().decode(result.value.bytes!) }
      },
      {
        id: connection.characterId,
        source: { artifactId: state.artifact_id, version: state.artifact_version },
      },
    )
    expect(artifact).toEqual({
      sha256: state.artifact_version,
      text: 'Desktop reference artifact\n',
    })
    success = true
  } finally {
    await app.close().catch(() => {})
    await proxy.close()
    await rig.close(success)
  }
})

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { UploadDraft } from '../../src/shared/api'
import { activeCharacterName } from '../fixtures/active-character'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'

/*
 * Pasting into the composer (task book 2026-11-13 §3.6), failure cases written before the code:
 * 31 After pasting a screenshot or copied files, no attachment appears in the draft, or it is
 *    staged along a path other than dropping (other file name, kind or bytes; not uploaded
 *    as an upload request of its own).
 * 32 Pasting plain text over the threshold (4,000 characters or 80 lines, whichever comes first)
 *    still inserts the text or makes no `.md` attachment; text under the threshold becomes an
 *    attachment; the pasted-text attachment cannot be removed from the draft; Cmd/Ctrl+Shift+V
 *    does not paste the original text into the composer.
 * The pasted-text file name (粘貼內容-<time>.md) and the clipboard picture name are data and do
 * not follow the interface language.
 */

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

/** The system clipboard Chromium pastes from, and the fixture's stand-in Main reads text from. */
async function copyText(app: ElectronApplication, text: string) {
  await app.evaluate(({ clipboard }, text) => {
    clipboard.write({ text })
    clipboard.writeText(text)
  }, text)
}

async function uploads(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const result = await window.yuki.client.uploads(id)
    if (!result.ok) throw Error(result.code)
    return result.value
  }, id)
}

test('pasting files, a screenshot or long text attaches them; short text and Shift paste stay text', async () => {
  test.setTimeout(150000)
  const rig = await yukiFixture()
  const app = await rig.launch('composer-paste')
  let success = false
  const evidence: Record<string, unknown> = {}
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const name = await activeCharacterName(page)
    const { characterId } = await currentConnection(page)
    const composer = page.getByRole('textbox', { name: `和 ${name} 說點什麼`, exact: true })
    const drafts = page.getByLabel('待送出附件')
    const posted = async () =>
      ((await (await fetch(`${rig.base}/__test/uploads`)).json()) as { requests: string[] })
        .requests
    const ready = async (filename: string | RegExp) => {
      await expect
        .poll(async () =>
          (await uploads(page, characterId)).some(
            (item) =>
              (typeof filename === 'string'
                ? item.filename === filename
                : filename.test(item.filename)) && item.state === 'ready',
          ),
        )
        .toBe(true)
      const item = (await uploads(page, characterId)).find((item) =>
        typeof filename === 'string' ? item.filename === filename : filename.test(item.filename),
      )!
      expect(await posted()).toContain(item.requestId)
      return item
    }
    const removeAll = async () => {
      for (const item of await uploads(page, characterId))
        await page.getByRole('button', { name: `移除 ${item.filename}`, exact: true }).click()
      await expect(drafts).toBeHidden()
    }

    // 31: files copied in Finder or Explorer arrive with their paths, as dropped files do.
    const notes = join(rig.root, 'notes.txt'),
      photo = join(rig.root, 'photo.png')
    const notesBytes = Buffer.from('從檔案管理員複製的檔案\n')
    const photoBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=',
      'base64',
    )
    await writeFile(notes, notesBytes)
    await writeFile(photo, photoBytes)
    await page.evaluate(() => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.id = 'copied-files'
      input.hidden = true
      document.body.append(input)
    })
    await page.locator('#copied-files').setInputFiles([notes, photo])
    await composer.click()
    await composer.evaluate((textarea) => {
      const files = new DataTransfer()
      for (const file of document.querySelector<HTMLInputElement>('#copied-files')!.files!)
        files.items.add(file)
      textarea.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: files, bubbles: true, cancelable: true }),
      )
    })
    await expect(drafts).toContainText('notes.txt')
    await expect(drafts).toContainText('photo.png')
    const copied = [await ready('notes.txt'), await ready('photo.png')]
    expect(copied).toMatchObject([
      { kind: 'file', sha256: sha256(notesBytes), size: notesBytes.length },
      { kind: 'image', sha256: sha256(photoBytes), size: photoBytes.length },
    ])
    await expect(composer).toHaveValue('')
    evidence.copiedFiles = copied
    await page.screenshot({ path: test.info().outputPath('pasted-files.png') })
    await removeAll()

    // 31: a screenshot is picture data without a file; it is staged as the clipboard's PNG.
    const picture = await app.evaluate(({ clipboard, nativeImage }) => {
      const size = 24,
        pixels = Buffer.alloc(size * size * 4)
      for (let index = 0; index < size * size; index++)
        pixels.set([0x40, 0x80, 0xf0, 0xff], index * 4)
      clipboard.writeImage(nativeImage.createFromBitmap(pixels, { width: size, height: size }))
      return clipboard.readImage().toPNG().toString('base64')
    })
    await composer.click()
    await page.keyboard.press('ControlOrMeta+V')
    await expect(drafts).toContainText('剪貼簿圖片.png')
    const screenshot = await ready('剪貼簿圖片.png')
    expect(screenshot).toMatchObject({
      kind: 'image',
      sha256: sha256(Buffer.from(picture, 'base64')),
    })
    await expect(composer).toHaveValue('')
    evidence.screenshot = screenshot
    await page.screenshot({ path: test.info().outputPath('pasted-screenshot.png') })
    await removeAll()

    // 32: over 80 lines becomes a Markdown attachment and nothing is inserted.
    const manyLines = Array.from({ length: 81 }, (_, index) => `第 ${index + 1} 行`).join('\n')
    await copyText(app, manyLines)
    await composer.click()
    await page.keyboard.press('ControlOrMeta+V')
    const markdownName = /^粘貼內容-\d{8}-\d{6}\.md$/
    await expect(drafts).toContainText(/粘貼內容-\d{8}-\d{6}\.md/)
    const lines = await ready(markdownName)
    expect(lines).toMatchObject({
      kind: 'file',
      sha256: sha256(manyLines),
      size: Buffer.byteLength(manyLines),
    })
    await expect(composer).toHaveValue('')
    evidence.manyLines = lines
    await page.screenshot({ path: test.info().outputPath('pasted-long-text.png') })
    // The attachment is removable like any other draft attachment.
    await page.getByRole('button', { name: `移除 ${lines.filename}`, exact: true }).click()
    await expect(drafts).toBeHidden()

    // 32: over 4,000 characters on one line, too.
    const manyCharacters = '長'.repeat(4001)
    await copyText(app, manyCharacters)
    await composer.click()
    await page.keyboard.press('ControlOrMeta+V')
    const characters = await ready(markdownName)
    expect(characters).toMatchObject({ kind: 'file', sha256: sha256(manyCharacters) })
    await expect(composer).toHaveValue('')
    await removeAll()

    // 32: at the threshold the text is pasted as text.
    const head = Array.from({ length: 79 }, (_, index) => `第 ${index + 1} 行\n`).join('')
    const atLimit = head + '尾'.repeat(4000 - [...head].length)
    expect([[...atLimit].length, atLimit.split('\n').length]).toEqual([4000, 80])
    await copyText(app, atLimit)
    await composer.click()
    await page.keyboard.press('ControlOrMeta+V')
    await expect(composer).toHaveValue(atLimit)
    expect(await uploads(page, characterId)).toEqual([])
    await composer.fill('')

    // 32: Cmd/Ctrl+Shift+V pastes the original text however long it is.
    await copyText(app, manyLines)
    await composer.click()
    await page.keyboard.press('ControlOrMeta+Shift+V')
    await expect(composer).toHaveValue(manyLines)
    expect(await uploads(page, characterId)).toEqual([])
    await page.screenshot({ path: test.info().outputPath('shift-paste.png') })

    evidence.uploads = (await uploads(page, characterId)) satisfies UploadDraft[]
    await writeFile(test.info().outputPath('paste.json'), JSON.stringify(evidence, null, 2))
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

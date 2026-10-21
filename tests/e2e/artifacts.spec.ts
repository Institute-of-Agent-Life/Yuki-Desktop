import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pairUI, yukiFixture } from '../fixtures/backend'
import type { ArtifactPage } from '../../src/shared/api'

test('reads real delivered artifacts, keeps same names separate, saves exact versions and removes revoked previews', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('artifact-device')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await page.getByRole('textbox', { name: '和 Yuki 說點什麼' }).fill('請把成果交給我')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('真實帳本回覆', { exact: true })).toBeVisible()
    const response = await fetch(`${rig.base}/__test/artifacts`, { method: 'POST' })
    expect(response.status).toBe(200)
    const delivered = (await response.json()) as {
      artifact_id: string
      sha256: string
      name: string
    }[]
    const first = delivered[0]!,
      pdf = delivered[2]!
    expect(first.artifact_id.split('-')[2]?.[0]).toBe('5')
    const saved = join(rig.root, 'saved.md')
    await app.evaluate(({ dialog, clipboard, shell }, saved) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: saved })
      clipboard.writeText = (text) => {
        ;(globalThis as unknown as { copied: string }).copied = text
      }
      shell.showItemInFolder = (path) => {
        ;(globalThis as unknown as { revealed: string }).revealed = path
      }
      shell.openPath = async (path) => {
        ;(globalThis as unknown as { opened: string }).opened = path
        return ''
      }
    }, saved)
    await page.getByRole('button', { name: '檔案與成果', exact: true }).click()
    const stage = page.getByRole('region', { name: '成果預覽' })
    await expect(stage.getByRole('heading', { name: 'First artifact', exact: true })).toBeVisible()
    const rows = page.getByRole('button').filter({ hasText: 'same.md' })
    await expect(rows).toHaveCount(2)
    await expect(page.getByText('同一路徑的先後發布', { exact: true })).toHaveCount(0)
    await stage.getByText('傳送過的訊息', { exact: true }).click()
    await expect(
      stage
        .locator('details')
        .filter({ has: page.getByText('傳送過的訊息', { exact: true }) })
        .getByRole('button'),
    ).toHaveCount(2)
    await stage.getByRole('button', { name: '存到…', exact: true }).click()
    await expect
      .poll(async () => {
        try {
          return createHash('sha256')
            .update(await readFile(saved))
            .digest('hex')
        } catch {
          return ''
        }
      })
      .toBe(first.sha256)
    await stage.getByRole('button', { name: '在資料夾顯示', exact: true }).click()
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { revealed: string }).revealed))
      .toBe(saved)
    await stage.getByRole('tab', { name: '原始碼', exact: true }).click()
    await stage.getByRole('button', { name: '複製全文', exact: true }).click()
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { copied: string }).copied))
      .toBe('# First artifact\n\nOriginal immutable content.\n')
    await page.getByRole('button').filter({ hasText: delivered[3]!.artifact_id }).click()
    await stage.getByRole('button', { name: '以預設程式開啟', exact: true }).click()
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { opened: string }).opened))
      .toBeTruthy()
    const opened = await app.evaluate(() => (globalThis as unknown as { opened: string }).opened)
    expect(opened).toContain('unknown.custom')
    expect(
      createHash('sha256')
        .update(await readFile(opened))
        .digest('hex'),
    ).toBe(delivered[3]!.sha256)
    await rows.filter({ hasText: first.artifact_id }).click()
    const facts = await page.evaluate(async (artifactId) => {
      const connections = await window.yuki.client.connections()
      if (!connections.ok || !connections.value[0]) throw new Error('No paired connection')
      const connection = connections.value[0]
      const artifacts = await window.yuki.client.read<ArtifactPage>(connection.characterId, {
        kind: 'artifacts',
        category: 'all',
      })
      if (!artifacts.ok) throw new Error(artifacts.code)
      return {
        connection,
        refs: artifacts.value.items
          .filter((item) => item.artifact_id === artifactId)
          .map((item) => item.ref.event_id),
      }
    }, first.artifact_id)
    expect(facts.refs).toHaveLength(2)
    await stage.getByText('傳送過的訊息', { exact: true }).click()
    await stage
      .locator('details')
      .filter({ has: page.getByText('傳送過的訊息', { exact: true }) })
      .getByRole('button')
      .first()
      .click()
    await expect(page.locator(`article[data-event-id="${facts.refs[0]}"]`)).toHaveClass(/selected/)
    await page.getByRole('button', { name: '檔案與成果', exact: true }).click()
    for (const event of facts.refs)
      await fetch(`${rig.base}/__test/events/${event}?lose_hint=true`, { method: 'DELETE' })
    await expect(rows).toHaveCount(1)
    await expect(stage.getByRole('heading', { name: 'First artifact', exact: true })).toHaveCount(0)
    const cached = join(
      rig.root,
      'artifact-device',
      'connections',
      facts.connection.characterId,
      'cache',
      facts.connection.personId,
      'artifacts',
      first.sha256 + '.blob',
    )
    await expect
      .poll(async () => {
        try {
          await stat(cached)
          return true
        } catch {
          return false
        }
      })
      .toBe(false)
    expect(
      createHash('sha256')
        .update(await readFile(saved))
        .digest('hex'),
    ).toBe(first.sha256)
    await page.getByRole('button').filter({ hasText: pdf.artifact_id }).dblclick()
    const inspector = page.getByRole('complementary', { name: '檢視器' })
    await expect(inspector.locator('iframe')).toBeVisible()
    try {
      await expect
        .poll(async () => {
          for (const frame of page.frames()) {
            const pages = await frame
              .evaluate(() => {
                const viewer = document.querySelector('pdf-viewer') as
                  (HTMLElement & { documentDimensions?: { pageDimensions?: unknown[] } }) | null
                return viewer?.documentDimensions?.pageDimensions?.length ?? null
              })
              .catch(() => null)
            if (pages === 1) return pages
          }
          return null
        })
        .toBe(1)
    } catch (error) {
      for (const frame of page.frames())
        console.info(
          'PDF probe',
          frame.url(),
          await frame
            .evaluate(() => ({
              title: document.title,
              nodes: [...document.querySelectorAll('embed,pdf-viewer,iframe')].map((node) =>
                node.outerHTML.slice(0, 500),
              ),
              viewer: Object.keys(document.querySelector('pdf-viewer') ?? {}),
            }))
            .catch(() => null),
        )
      await page.screenshot({ path: test.info().outputPath('artifact-pdf-failed.png') })
      throw error
    }

    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath('artifact-pdf.png'),
    })
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

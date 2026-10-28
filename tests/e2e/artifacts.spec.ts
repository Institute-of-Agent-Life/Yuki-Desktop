import { navigate } from '../fixtures/navigation'
import { expectPdfPages } from '../fixtures/pdf'
import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  recordBusinessState,
  currentConnection,
  pairUI,
  waitForMainEnded,
  yukiFixture,
} from '../fixtures/backend'
import type { ArtifactPage, Profile } from '../../src/shared/api'

test('reads real delivered artifacts, keeps same names separate, saves exact versions and removes revoked previews', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('artifact-device')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page)
    const profile = await page.evaluate(async (id) => {
      const result = await window.yuki.client.read<Profile>(id, { kind: 'character' })
      if (!result.ok) throw Error(result.code)
      return result.value
    }, connection.characterId)
    const composer = page.getByRole('textbox', {
      name: `和 ${profile.display_name} 說點什麼`,
      exact: true,
    })
    await composer.fill('請把成果交給我')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(composer).toHaveValue('')
    const sent = await page.evaluate(async (id) => {
      const result = await window.yuki.client.outbox(id)
      if (!result.ok) throw Error(result.code)
      const item = result.value.find((item) => item.body.text === '請把成果交給我')
      if (!item?.eventId) throw Error('Original accepted request is missing')
      return { requestId: item.requestId, eventId: item.eventId }
    }, connection.characterId)
    const replied = await waitForMainEnded(page, connection.characterId, sent.requestId)
    expect(replied.event_id).toBe(sent.eventId)
    expect(replied.result_event_ids).toHaveLength(1)
    await expect(
      page
        .locator(`article[data-event-id="${replied.result_event_ids![0]}"]`)
        .getByText('Desktop reference reply', { exact: true }),
    ).toBeVisible()
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
    await navigate(page, '檔案與成果')
    const stage = page.getByRole('region', { name: '成果預覽' })
    await expect(stage.getByRole('heading', { name: 'First artifact', exact: true })).toBeVisible()
    const rows = page.getByRole('button').filter({ hasText: 'same.md' })
    await expect(rows).toHaveCount(2)
    await expect(page.getByText('同一路徑的先後發布', { exact: true })).toHaveCount(0)
    await stage.getByText('選擇另一項成果比較', { exact: true }).click()
    const choice = stage
      .locator('details')
      .filter({
        has: page.getByText('選擇另一項成果比較', { exact: true }),
      })
      .locator('div')
      .filter({ hasText: delivered[1]!.artifact_id })
    await choice.getByRole('button', { name: '比較此版本', exact: true }).click()
    const left = stage.getByRole('region', { name: '目前成果原版本', exact: true })
    const right = stage.getByRole('region', { name: '比較的原版本', exact: true })
    await expect(left.locator('pre').filter({ hasText: /^# First artifact$/ })).toBeVisible()
    await expect(right.locator('pre').filter({ hasText: /^# Another artifact$/ })).toBeVisible()
    await expect(stage.getByText(first.artifact_id, { exact: true })).toBeVisible()
    await expect(stage.locator('code').filter({ hasText: delivered[1]!.artifact_id })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('actual-immutable-comparison.png') })
    await stage.getByRole('button', { name: '結束比較', exact: true }).click()
    await expect(left).toHaveCount(0)
    await stage.getByText('選擇另一項成果比較', { exact: true }).click()
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
    await navigate(page, '檔案與成果')
    for (const event of facts.refs) {
      const deletion = await fetch(`${rig.base}/__test/events/${event}?lose_hint=true`, {
        method: 'DELETE',
      })
      expect(deletion.ok).toBe(true)
      expect(await deletion.json()).toMatchObject({ deleted: event, lost_hint: true })
    }
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
      await expectPdfPages(inspector.locator('iframe'), 1)
    } catch (error) {
      await page.screenshot({ path: test.info().outputPath('artifact-pdf-failed.png') })
      const contents = await app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .map((content) => ({
            id: content.id,
            url: content.getURL(),
            type: content.getType(),
            destroyed: content.isDestroyed(),
          })),
      )
      const source = await inspector.locator('iframe').getAttribute('src')
      const response = await page
        .evaluate(async (source) => {
          const response = await fetch(source!, { method: 'HEAD' })
          return { status: response.status, headers: Object.fromEntries(response.headers) }
        }, source)
        .catch((error) => ({ error: String(error) }))
      await writeFile(
        test.info().outputPath('native-pdf-diagnostic.json'),
        JSON.stringify({ contents, source, response }, null, 2),
      )
      throw error
    }

    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath('artifact-pdf.png'),
    })
    success = true
  } finally {
    if (!success)
      await recordBusinessState(await app.firstWindow(), 'business-state.json').catch(console.error)
    await app.close()
    await rig.close(success)
  }
})

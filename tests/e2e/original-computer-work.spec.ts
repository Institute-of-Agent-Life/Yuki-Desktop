import { activeCharacterName } from '../fixtures/active-character'
import { crashElectron } from '../fixtures/electron-process'
import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArtifactPage, Home, Work } from '../../src/shared/api'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { captureWorkspace, contentSize } from '../fixtures/visual'

interface Facts {
  phase: number | null
  run_id: string | null
  work_ids: string[]
  inputs: {
    id: number
    kind: string
    state: string
    event_id: number | null
    payload_json: string
  }[]
  runs: { run_id: string; status: string; completion: unknown }[]
  manager_jobs: { run_id: string; status: string }[]
  waits: { run_id: string; work_id: string; result: string | null }[]
  control: { holder: string; lease_id?: string }
}

test(
  'desktop returns the real CLI receipt to the original work and keeps its delivered artifact across restart',
  { tag: ['@unix-manager', '@linux-supervisor'] },
  async () => {
    test.setTimeout(180000)
    const rig = await yukiFixture({ computerWork: true })
    let app = await rig.launch('original-computer-work')
    let success = false
    const facts = async () =>
      (await (await fetch(`${rig.base}/__test/computer-work-facts`)).json()) as Facts
    try {
      let page = await app.firstWindow()
      await pairUI(page, rig.base, await rig.code())
      const asset = (await (
        await fetch(`${rig.base}/__test/computer-work-scenario`, { method: 'POST' })
      ).json()) as { artifact_id: string; name: string; sha256: string }
      await page
        .getByRole('textbox', {
          name: `和 ${await activeCharacterName(page)} 說點什麼`,
          exact: true,
        })
        .fill('請在原工作處理電腦步驟，交回後交付成果')
      await page.getByRole('button', { name: '送出', exact: true }).click()
      const waiting = () =>
        page
          .getByRole('article')
          .filter({ has: page.getByRole('heading', { name: '原電腦協助工作', exact: true }) })
      await expect(waiting().getByText(/等待電腦交回/)).toBeVisible({
        timeout: 30000,
      })
      await expect.poll(async () => (await facts()).waits.length).toBe(1)
      const initial = await facts()
      expect(initial.phase).toBe(3)
      expect(initial.manager_jobs).toEqual([{ run_id: initial.run_id, status: 'running' }])
      const original = await page.evaluate(async () => {
        const connections = await window.yuki.client.connections()
        if (!connections.ok || !connections.value[0]) throw Error('Missing paired connection')
        const characterId = connections.value[0].characterId
        const home = await window.yuki.client.read<Home>(characterId, { kind: 'home' })
        if (!home.ok || home.value.works.length !== 1) throw Error('Missing original waiting work')
        return { characterId, work: home.value.works[0]! }
      })
      expect(initial.work_ids).toEqual([original.work.work_id])
      expect(initial.waits[0]!.work_id).toBe(original.work.work_id)
      await captureWorkspace(
        app,
        page,
        'state-chat-computer-help',
        async () => {
          await page.keyboard.press('ControlOrMeta+1')
        },
        {
          verify: async () => {
            await waiting().scrollIntoViewIfNeeded()
            await expect(waiting()).toBeInViewport({ ratio: 1 })
          },
        },
      )
      await contentSize(app, page, 1440, 900)
      await page.keyboard.press('ControlOrMeta+,')
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page.getByRole('switch', { name: '增加對比', exact: true }).click()
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-contrast', 'false')
      await crashElectron(app)
      await app.close().catch(() => {})
      expect((await facts()).manager_jobs).toEqual(initial.manager_jobs)
      app = await rig.launch('original-computer-work')
      page = await app.firstWindow()
      await expect(waiting().getByText(/等待電腦交回/)).toBeVisible({
        timeout: 20000,
      })
      await contentSize(app, page, 1440, 900)
      await waiting().getByRole('button', { name: '查看詳情', exact: true }).click()
      await page.getByRole('button', { name: '放大詳情', exact: true }).click()
      await page
        .getByRole('complementary', { name: '詳情', exact: true })
        .getByRole('button', { name: '在電腦上查看', exact: true })
        .click()
      await expect(page.getByRole('button', { name: '還原版面', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '截圖存檔', exact: true })).toBeEnabled()
      await captureWorkspace(
        app,
        page,
        'flow-03-computer-help',
        async () => {
          await page.keyboard.press('ControlOrMeta+3')
          await expect(page.getByRole('button', { name: '截圖存檔', exact: true })).toBeEnabled()
        },
        {
          verify: async () => {
            await expect(
              page.getByRole('status').getByRole('button', { name: '接手', exact: true }),
            ).toBeInViewport({ ratio: 1 })
          },
        },
      )
      await contentSize(app, page, 1440, 900)
      await page.keyboard.press('ControlOrMeta+,')
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page.getByRole('switch', { name: '增加對比', exact: true }).click()
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-contrast', 'false')
      await page.screenshot({
        path: test
          .info()
          .outputPath(
            `${process.platform}-${await page.evaluate(() => devicePixelRatio)}x-${await page.locator('html').getAttribute('data-theme')}-flow-03-computer-help.png`,
          ),
      })
      await page.getByRole('status').getByRole('button', { name: '接手', exact: true }).click()
      await expect(
        page.getByRole('button', {
          name: `交回給 ${await activeCharacterName(page)}`,
          exact: true,
        }),
      ).toBeEnabled()
      await page
        .getByRole('application', { name: '遠端電腦畫面', exact: true })
        .click({ position: { x: 80, y: 80 } })
      await page.keyboard.press('k')
      await expect
        .poll(async () => {
          const observed = (await (await fetch(`${rig.base}/__test/computer`)).json()) as {
            events: { kind: string }[]
          }
          return observed.events.filter((item) => ['key', 'extended'].includes(item.kind)).length
        })
        .toBeGreaterThan(0)
      expect((await facts()).phase).toBe(3)
      await page
        .getByRole('button', { name: `交回給 ${await activeCharacterName(page)}`, exact: true })
        .click()
      const sheet = page.getByRole('dialog', {
        name: `交回給 ${await activeCharacterName(page)}`,
        exact: true,
      })
      const note = '畫面處理完成，請沿原工作接續。'
      await sheet.getByRole('textbox', { name: '說明', exact: true }).fill(note)
      await page.screenshot({
        path: test
          .info()
          .outputPath(
            `${process.platform}-${await page.evaluate(() => devicePixelRatio)}x-${await page.locator('html').getAttribute('data-theme')}-flow-05-original-return.png`,
          ),
      })
      await sheet.getByRole('button', { name: '交回', exact: true }).click()
      await expect.poll(async () => (await facts()).phase, { timeout: 30000 }).toBe(6)
      await page.keyboard.press('ControlOrMeta+1')
      await expect(waiting().getByText('已完成', { exact: true })).toBeVisible({ timeout: 20000 })
      const final = await facts()
      expect(final.work_ids).toEqual(initial.work_ids)
      expect(final.run_id).toBe(initial.run_id)
      expect(final.manager_jobs).toEqual([{ run_id: initial.run_id, status: 'succeeded' }])
      expect(final.control.holder).toBe('none')
      expect(final.waits).toHaveLength(1)
      expect(JSON.parse(final.waits[0]!.result!).note).toBe(note)
      expect(final.runs).toHaveLength(1)
      expect(final.runs[0]!.status).toBe('completed')
      const signals = final.inputs.filter(
        (item) => !initial.inputs.some((before) => before.id === item.id),
      )
      expect(signals).toHaveLength(1)
      expect(signals[0]).toMatchObject({ kind: 'control', state: 'consumed', event_id: null })
      expect(signals[0]!.payload_json).not.toContain(note)
      const delivered = await page.evaluate(async ({ characterId, work }) => {
        const current = await window.yuki.client.read<Work>(characterId, {
          kind: 'work',
          workId: work.work_id,
        })
        const artifacts = await window.yuki.client.read<ArtifactPage>(characterId, {
          kind: 'artifacts',
          category: 'all',
        })
        if (!current.ok || !artifacts.ok) throw Error('Original result unavailable')
        return { work: current.value, artifacts: artifacts.value }
      }, original)
      expect(delivered.work.state).toBe('completed')
      expect(delivered.work.work_id).toBe(original.work.work_id)
      expect(delivered.work.generation).toBe(original.work.generation)
      expect(delivered.work.budget.root_id).toBe(original.work.budget.root_id)
      expect(delivered.work.budget.models).toBe(original.work.budget.models + 3)
      expect(delivered.work.budget.tools).toBe(original.work.budget.tools + 2)
      expect(delivered.work.budget.model_limit).toBe(original.work.budget.model_limit)
      expect(delivered.work.budget.tool_limit).toBe(original.work.budget.tool_limit)
      expect(
        delivered.artifacts.items.filter((item) => item.artifact_id === asset.artifact_id),
      ).toEqual([
        expect.objectContaining({
          artifact_id: asset.artifact_id,
          work_id: original.work.work_id,
          version: asset.sha256,
        }),
      ])
      if (await page.getByRole('button', { name: '還原版面', exact: true }).isVisible())
        await page.getByRole('button', { name: '還原版面', exact: true }).click()
      await page.keyboard.press('ControlOrMeta+1')
      await page.screenshot({
        path: test
          .info()
          .outputPath(
            `${process.platform}-${await page.evaluate(() => devicePixelRatio)}x-${await page.locator('html').getAttribute('data-theme')}-flow-08-original-done.png`,
          ),
      })
      await page.keyboard.press('ControlOrMeta+4')
      const stage = page.getByRole('region', { name: '成果預覽', exact: true })
      await expect(
        stage.getByRole('heading', { name: 'Original computer artifact', exact: true }),
      ).toBeVisible()
      await page.screenshot({
        path: test
          .info()
          .outputPath(
            `${process.platform}-${await page.evaluate(() => devicePixelRatio)}x-${await page.locator('html').getAttribute('data-theme')}-flow-09-original-artifact.png`,
          ),
      })
      const destination = join(rig.root, asset.name)
      await app.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
      }, destination)
      await stage.getByRole('button', { name: '存到…', exact: true }).click()
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
        .toBe(asset.sha256)
      await rig.restart()
      await expect(
        stage.getByRole('heading', { name: 'Original computer artifact', exact: true }),
      ).toBeVisible({ timeout: 20000 })
      await expect.poll(async () => (await facts()).work_ids).toEqual(initial.work_ids)
      expect((await facts()).manager_jobs).toEqual(final.manager_jobs)
      const restored = await page.evaluate(async ({ characterId, work }) => {
        const current = await window.yuki.client.read<Work>(characterId, {
          kind: 'work',
          workId: work.work_id,
        })
        const artifacts = await window.yuki.client.read<ArtifactPage>(characterId, {
          kind: 'artifacts',
          category: 'all',
        })
        if (!current.ok || !artifacts.ok) throw Error('Restored result unavailable')
        return { work: current.value, artifacts: artifacts.value }
      }, original)
      expect(restored).toEqual(delivered)
      await writeFile(
        test.info().outputPath('original-computer-receipts.json'),
        JSON.stringify({ asset, original, initial, final, delivered, restored }, null, 2) + '\n',
      )
      success = true
    } finally {
      if (!success) await crashElectron(app).catch(() => {})
      await app.close().catch(() => {})
      await rig.close(success)
    }
  },
)

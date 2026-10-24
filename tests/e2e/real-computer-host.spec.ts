import { activeCharacterName } from '../fixtures/active-character'
import { expect, test } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import type { ArtifactPage, Work } from '../../src/shared/api'
import { pairUI } from '../fixtures/backend'
import { externalBackend } from '../fixtures/external-backend'
import { contentSize } from '../fixtures/visual'

interface Facts {
  phase: number | null
  run_id: string | null
  work_ids: string[]
  inputs: { id: number; kind: string; state: string; event_id: number | null }[]
  runs: { run_id: string; status: string }[]
  manager_jobs: { run_id: string; status: string; output: string }[]
  waits: { run_id: string; work_id: string; result: string | null }[]
  control: { holder: string; lease_id?: string }
  artifact: { artifact_id: string; sha256: string } | null
}

test('isolated real computer accepts desktop input and resumes its original work with an actual published file', async () => {
  test.setTimeout(180000)
  const rig = await externalBackend()
  let workTitle = `原電腦協助工作 ${randomUUID().slice(0, 8)}`
  let app = await rig.launch('real-computer')
  const facts = async () => {
    const response = await fetch(`${rig.base}/__test/computer-work-facts`)
    expect(response.ok).toBe(true)
    return (await response.json()) as Facts
  }
  try {
    let page = await app.firstWindow()
    if (rig.resumed) {
      const previous = await facts()
      expect(previous.phase).toBe(3)
      const wait = previous.waits.find((row) => row.run_id === previous.run_id && !row.result)
      expect(wait).toBeTruthy()
      await expect(page.getByRole('navigation', { name: '主要導覽' })).toBeVisible()
      workTitle = await page.evaluate(async (workId) => {
        const connections = await window.yuki.client.connections()
        if (!connections.ok || connections.value.length !== 1)
          throw Error('Missing original connection')
        const result = await window.yuki.client.read<Work>(connections.value[0]!.characterId, {
          kind: 'work',
          workId,
        })
        if (!result.ok) throw Error(result.code)
        return result.value.goal
      }, wait!.work_id)
    } else {
      await pairUI(page, rig.base, await rig.code())
      const setup = await fetch(
        `${rig.base}/__test/computer-work-scenario?goal=${encodeURIComponent(workTitle)}`,
        { method: 'POST' },
      )
      expect(setup.ok).toBe(true)
      expect(await setup.json()).toBeNull()
      await page
        .getByRole('textbox', {
          name: `和 ${await activeCharacterName(page)} 說點什麼`,
          exact: true,
        })
        .fill('請在真電腦處理原工作')
      await page.getByRole('button', { name: '送出', exact: true }).click()
    }
    await contentSize(app, page, 1440, 900)
    const waiting = () =>
      page.getByRole('article').filter({
        has: page.getByRole('heading', { name: workTitle, exact: true }),
      })
    await expect(waiting().getByText(/等待電腦交回/)).toBeVisible({ timeout: 45000 })
    await expect.poll(async () => (await facts()).phase).toBe(3)
    const initial = await facts()
    const help = initial.waits.find((wait) => wait.run_id === initial.run_id)
    expect(help).toBeTruthy()
    const original = await page.evaluate(async (workId) => {
      const connections = await window.yuki.client.connections()
      if (!connections.ok || connections.value.length !== 1)
        throw Error('Missing paired connection')
      const id = connections.value[0]!.characterId
      const work = await window.yuki.client.read<Work>(id, { kind: 'work', workId })
      if (!work.ok) throw Error(work.code)
      return { id, work: work.value }
    }, help!.work_id)
    expect(initial.waits.find((wait) => wait.run_id === initial.run_id)?.work_id).toBe(
      original.work.work_id,
    )
    expect(initial.manager_jobs.find((run) => run.run_id === initial.run_id)?.status).toBe(
      'running',
    )
    expect(initial.artifact).toBeNull()
    // Killing only the desktop must leave the real environment's original terminal waiting.
    const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
    app.process().kill('SIGKILL')
    await exited
    await app.close().catch(() => {})
    app = await rig.launch('real-computer')
    page = await app.firstWindow()
    await expect(waiting().getByText(/等待電腦交回/)).toBeVisible({ timeout: 20000 })
    expect((await facts()).run_id).toBe(initial.run_id)
    await page.keyboard.press('ControlOrMeta+3')
    await expect(page.getByRole('button', { name: '截圖存檔', exact: true })).toBeEnabled({
      timeout: 20000,
    })
    await page.screenshot({ path: test.info().outputPath('real-tigervnc-viewing.png') })
    await page.getByRole('status').getByRole('button', { name: '接手', exact: true }).click()
    await expect(
      page.getByRole('button', { name: `交回給 ${await activeCharacterName(page)}`, exact: true }),
    ).toBeEnabled()
    const canvas = page
      .getByRole('application', { name: '遠端電腦畫面', exact: true })
      .locator('canvas')
    const bounds = await canvas.boundingBox()
    expect(bounds).not.toBeNull()
    // Coordinates belong to the controlled HTML test page on the 1440×900 real display.
    await canvas.click({
      position: { x: (bounds!.width * 300) / 1440, y: (bounds!.height * 280) / 900 },
    })
    const marker = `desktop-input-${Date.now()}`
    await page.keyboard.type(marker)
    await expect
      .poll(
        async () =>
          (await facts()).manager_jobs.find((run) => run.run_id === initial.run_id)?.output,
        { timeout: 20000 },
      )
      .toContain(`observed-input:${marker}`)
    await page.keyboard.press('Control+Alt')
    await page.screenshot({ path: test.info().outputPath('real-tigervnc-human-input.png') })
    await page
      .getByRole('button', { name: `交回給 ${await activeCharacterName(page)}`, exact: true })
      .click()
    const sheet = page.getByRole('dialog', {
      name: `交回給 ${await activeCharacterName(page)}`,
      exact: true,
    })
    const note = '畫面處理完成，請沿原工作接續。'
    await sheet.getByRole('textbox', { name: '說明', exact: true }).fill(note)
    await sheet.getByRole('button', { name: '交回', exact: true }).click()
    await expect.poll(async () => (await facts()).phase, { timeout: 45000 }).toBe(7)
    await page.keyboard.press('ControlOrMeta+1')
    await expect(waiting().getByText('已完成', { exact: true })).toBeVisible({ timeout: 20000 })
    const final = await facts()
    expect(final.run_id).toBe(initial.run_id)
    expect(final.manager_jobs.find((run) => run.run_id === initial.run_id)?.status).toBe(
      'succeeded',
    )
    expect(final.control.holder).toBe('none')
    expect(
      JSON.parse(final.waits.find((wait) => wait.run_id === initial.run_id)!.result!).note,
    ).toBe(note)
    expect(final.runs.filter((run) => run.run_id === initial.run_id)).toEqual([
      expect.objectContaining({ status: 'completed' }),
    ])
    const signals = final.inputs.filter(
      (item) => !initial.inputs.some((before) => before.id === item.id),
    )
    expect(signals).toEqual([
      expect.objectContaining({ kind: 'control', state: 'consumed', event_id: null }),
    ])
    const delivered = await page.evaluate(async ({ id, work }) => {
      const current = await window.yuki.client.read<Work>(id, {
        kind: 'work',
        workId: work.work_id,
      })
      const artifacts = await window.yuki.client.read<ArtifactPage>(id, {
        kind: 'artifacts',
        category: 'all',
      })
      if (!current.ok || !artifacts.ok) throw Error('Missing original result')
      const artifact = artifacts.value.items.find((item) => item.work_id === work.work_id)
      if (!artifact) throw Error('Missing original artifact')
      const content = await window.yuki.client.artifactContent(id, {
        artifactId: artifact.artifact_id,
        version: artifact.version,
      })
      if (!content.ok) throw Error(content.code)
      return { work: current.value, artifact, content: content.value }
    }, original)
    expect(delivered.work.state).toBe('completed')
    expect(delivered.work.generation).toBe(original.work.generation)
    expect(delivered.work.budget.root_id).toBe(original.work.budget.root_id)
    expect(delivered.work.budget.model_limit).toBe(original.work.budget.model_limit)
    expect(delivered.work.budget.tool_limit).toBe(original.work.budget.tool_limit)
    expect(delivered.content.bytes).not.toBeNull()
    const bytes = Uint8Array.from(Object.values(delivered.content.bytes!))
    expect(new TextDecoder().decode(bytes)).toContain(marker)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(final.artifact!.sha256)
    expect(delivered.artifact.version).toBe(final.artifact!.sha256)
    await page.keyboard.press('ControlOrMeta+4')
    await expect(
      page
        .getByRole('region', { name: '成果預覽', exact: true })
        .getByText(marker, { exact: false }),
    ).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('real-original-work-artifact.png') })
    await writeFile(
      test.info().outputPath('real-computer-receipts.json'),
      JSON.stringify(
        { recoveredFromProfile: rig.resumed, original, initial, final, delivered },
        null,
        2,
      ) + '\n',
    )
  } finally {
    app.process().kill('SIGKILL')
    await app.close().catch(() => {})
    console.info(`Real-host desktop evidence retained at ${rig.root}`)
  }
})

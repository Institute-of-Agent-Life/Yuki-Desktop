import { navigate } from '../fixtures/navigation'
import { activeCharacterName } from '../fixtures/active-character'
import { crashElectron } from '../fixtures/electron-process'
import { expect, test, type Page } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import type { ArtifactPage, Work } from '../../src/shared/api'
import { pairUI } from '../fixtures/backend'
import { externalBackend } from '../fixtures/external-backend'
import { contentSize } from '../fixtures/visual'

interface Facts {
  phase: number | null
  run_id: string | null
  manager_pid: number
  environment_generation: string
  inputs: { id: number; kind: string; state: string; event_id: number | null }[]
  runs: { run_id: string; status: string }[]
  manager_jobs: { run_id: string; status: string; output: string }[]
  waits: {
    kind: string
    run_id: string
    work_id: string
    lease_id: string | null
    result: string | null
  }[]
  control: { holder: string; lease_id?: string; device_id?: string }
  artifact: { artifact_id: string; sha256: string } | null
}

const controls = (page: Page) =>
  page.locator('[data-region="toolbar"]').getByRole('group', {
    name: '電腦狀態與控制',
    exact: true,
  })

test('real wait-control follows three leases and survives each Manager restart before resuming its original work', async () => {
  test.setTimeout(300000)
  test.skip(
    process.env.YUKI_DESKTOP_REAL_MANAGER_RESTART !== '1',
    'Requires an operator to restart only the isolated Manager at the emitted gates.',
  )
  const rig = await externalBackend()
  const a = await rig.launch('lifecycle-a')
  const b = await rig.launch('lifecycle-b')
  const facts = async () => {
    const response = await fetch(`${rig.base}/__test/computer-work-facts`)
    expect(response.ok).toBe(true)
    return (await response.json()) as Facts
  }
  try {
    const pa = await a.firstWindow()
    const pb = await b.firstWindow()
    let expectedGoal: string | undefined
    if (rig.resumed) {
      for (const page of [pa, pb])
        await expect(page.getByRole('navigation', { name: '主要導覽' })).toBeVisible()
      expect((await facts()).phase).toBe(3)
    } else {
      await pairUI(pa, rig.base, await rig.code())
      await pairUI(pb, rig.base, await rig.code())
      const workTitle = `原電腦純等待 ${randomUUID().slice(0, 8)}`
      expectedGoal = workTitle
      const setup = await fetch(
        `${rig.base}/__test/computer-work-scenario?wait_control=true&goal=${encodeURIComponent(workTitle)}`,
        { method: 'POST' },
      )
      expect(setup.ok).toBe(true)
      expect(await setup.json()).toBeNull()
      await pa
        .getByRole('textbox', { name: `和 ${await activeCharacterName(pa)} 說點什麼`, exact: true })
        .fill('請沿原工作處理電腦步驟')
      await pa.getByRole('button', { name: '送出', exact: true }).click()
    }
    await expect.poll(async () => (await facts()).phase, { timeout: 45000 }).toBe(3)
    const started = await facts()
    await expect
      .poll(
        async () =>
          (await facts()).manager_jobs.find((run) => run.run_id === started.run_id)?.output,
      )
      .toContain('computer-work-ready')
    if (!rig.resumed) {
      expect(started.control.holder).toBe('none')
      expect(started.waits.filter((wait) => wait.run_id === started.run_id)).toEqual([])
    }
    await contentSize(a, pa, 1440, 900)
    await contentSize(b, pb, 1440, 900)
    for (const page of [pa, pb]) {
      await navigate(page, `${await activeCharacterName(page)} 的電腦`)
      await expect(page.getByRole('button', { name: '截圖存檔', exact: true })).toBeEnabled({
        timeout: 20000,
      })
    }
    if (!rig.resumed) await controls(pa).getByRole('button', { name: '接手', exact: true }).click()
    await expect(
      controls(pa).getByRole('button', {
        name: `交回給 ${await activeCharacterName(pa)}`,
        exact: true,
      }),
    ).toBeEnabled({ timeout: 20000 })
    await expect
      .poll(async () => (await facts()).waits.find((wait) => wait.run_id === started.run_id)?.kind)
      .toBe('wait_control')
    const initial = await facts()
    const wait = initial.waits.find((row) => row.run_id === initial.run_id)!
    const original = await pa.evaluate(async (workId) => {
      const connections = await window.yuki.client.connections()
      if (!connections.ok || connections.value.length !== 1) throw Error('Missing connection')
      const connection = connections.value[0]!
      const result = await window.yuki.client.read<Work>(connection.characterId, {
        kind: 'work',
        workId,
      })
      if (!result.ok) throw Error(result.code)
      return { id: connection.characterId, deviceId: connection.deviceId, work: result.value }
    }, wait.work_id)
    if (expectedGoal) expect(original.work.goal).toBe(expectedGoal)
    expect(initial.control.device_id).toBe(original.deviceId)
    await navigate(pa, '對話')
    await expect(
      pa
        .getByRole('article')
        .filter({
          has: pa.getByRole('heading', { name: original.work.goal, exact: true }),
        })
        .getByText(/等待電腦交回/),
    ).toBeVisible({ timeout: 20000 })
    await navigate(pa, `${await activeCharacterName(pa)} 的電腦`)
    const stages: Facts[] = []
    for (const [index, page] of [pa, pb, pa].entries()) {
      if (index > 0) {
        await controls(page).getByRole('button', { name: '改由這台控制', exact: true }).click()
        await page
          .getByRole('dialog', { name: '改由這台裝置控制？', exact: true })
          .getByRole('button', { name: '改由這台控制', exact: true })
          .click()
        await expect
          .poll(async () => (await facts()).control.lease_id)
          .not.toBe(stages[index - 1]!.control.lease_id)
      }
      const before = await facts()
      expect(before.control.holder).toBe('human')
      expect(before.control.device_id).toBe(
        index === 1
          ? await pb.evaluate(async () => {
              const result = await window.yuki.client.connections()
              if (!result.ok) throw Error(result.code)
              return result.value[0]!.deviceId
            })
          : original.deviceId,
      )
      expect(before.waits.find((row) => row.run_id === initial.run_id)).toMatchObject({
        kind: 'wait_control',
        lease_id: before.control.lease_id,
        result: null,
      })
      expect(before.manager_pid).toBeGreaterThan(0)
      await writeFile(
        test.info().outputPath(`manager-restart-L${index + 1}-needed.json`),
        JSON.stringify({ stage: index + 1, ...before }, null, 2),
      )
      // The operator restarts the isolated service. Only a new kernel SO_PEERCRED PID counts.
      await expect
        .poll(
          async () => {
            try {
              return (await facts()).manager_pid
            } catch {
              return before.manager_pid
            }
          },
          { timeout: 45000 },
        )
        .not.toBe(before.manager_pid)
      const after = await facts()
      expect(after.environment_generation).toBe(initial.environment_generation)
      expect(after.control).toEqual(before.control)
      expect(after.run_id).toBe(initial.run_id)
      expect(after.phase).toBe(3)
      expect(after.manager_jobs.find((row) => row.run_id === initial.run_id)?.status).toBe(
        'running',
      )
      expect(after.waits.find((row) => row.run_id === initial.run_id)).toEqual(
        before.waits.find((row) => row.run_id === initial.run_id),
      )
      expect(after.inputs).toEqual(initial.inputs)
      expect(after.artifact).toBeNull()
      await expect(page.getByText(/Yuki 需要你幫忙/)).toHaveCount(0)
      await expect(
        controls(page).getByRole('button', {
          name: `交回給 ${await activeCharacterName(page)}`,
          exact: true,
        }),
      ).toBeEnabled({ timeout: 20000 })
      await expect(page.getByRole('button', { name: '截圖存檔', exact: true })).toBeEnabled({
        timeout: 20000,
      })
      stages.push(after)
    }
    expect(new Set(stages.map((stage) => stage.control.lease_id)).size).toBe(3)
    expect(stages[1]!.control.device_id).not.toBe(original.deviceId)
    const canvas = pa
      .getByRole('application', { name: '遠端電腦畫面', exact: true })
      .locator('canvas')
    const bounds = await canvas.boundingBox()
    expect(bounds).not.toBeNull()
    await canvas.click({
      position: { x: (bounds!.width * 300) / 1440, y: (bounds!.height * 280) / 900 },
    })
    const marker = `lease-three-${Date.now()}`
    await pa.keyboard.type(marker)
    await expect
      .poll(
        async () =>
          (await facts()).manager_jobs.find((row) => row.run_id === initial.run_id)?.output,
        { timeout: 20000 },
      )
      .toContain(`observed-input:${marker}`)
    await pa.keyboard.press('Control+Alt')
    await pa.screenshot({ path: test.info().outputPath('real-three-leases.png') })
    await controls(pa)
      .getByRole('button', { name: `交回給 ${await activeCharacterName(pa)}`, exact: true })
      .click()
    const sheet = pa.getByRole('dialog', {
      name: `交回給 ${await activeCharacterName(pa)}`,
      exact: true,
    })
    const note = '畫面處理完成，請沿原工作接續。'
    await sheet.getByRole('textbox', { name: '說明', exact: true }).fill(note)
    await sheet.getByRole('button', { name: '交回', exact: true }).click()
    await expect.poll(async () => (await facts()).phase, { timeout: 45000 }).toBe(7)
    const final = await facts()
    expect(final.control.holder).toBe('none')
    const result = JSON.parse(final.waits.find((row) => row.run_id === initial.run_id)!.result!)
    expect(result).toMatchObject({ returned: true, lease_id: stages[2]!.control.lease_id, note })
    expect(final.runs.filter((row) => row.run_id === initial.run_id)).toEqual([
      expect.objectContaining({ status: 'completed' }),
    ])
    expect(final.manager_jobs.find((row) => row.run_id === initial.run_id)?.status).toBe(
      'succeeded',
    )
    expect(final.inputs.filter((row) => !initial.inputs.some((old) => old.id === row.id))).toEqual([
      expect.objectContaining({ kind: 'control', state: 'consumed', event_id: null }),
    ])
    const delivered = await pa.evaluate(async ({ id, work }) => {
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
    await writeFile(
      test.info().outputPath('real-lifecycle-receipts.json'),
      JSON.stringify({ original, initial, stages, final, delivered }, null, 2) + '\n',
    )
  } finally {
    for (const app of [a, b]) {
      await crashElectron(app).catch(() => {})
      await app.close().catch(() => {})
    }
    console.info(`Real-host desktop evidence retained at ${rig.root}`)
  }
})

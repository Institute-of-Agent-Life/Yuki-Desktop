import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { Home, Work } from '../../src/shared/api'
import {
  currentConnection,
  pairUI,
  recordBusinessState,
  waitForAcceptedMessage,
  waitForMainEnded,
  waitForWorkState,
  yukiFixture,
} from '../fixtures/backend'
import { navigate } from '../fixtures/navigation'
import { captureViewport, contentSize, workspaceSizes } from '../fixtures/visual'

test('step rows retain a static running symbol, full accessible label and readable time with long input', async ({
  page,
}) => {
  const label = 'Browser original step ' + 'LongOriginalOperationWithoutSpaces'.repeat(12)
  const stages: unknown[] = []
  await page.goto('http://127.0.0.1:4178/components.html')
  await page.getByRole('textbox', { name: '元件文字輸入', exact: true }).fill(label)
  const region = page.getByRole('region', { name: '步驟狀態', exact: true })
  const row = region.getByText(label, { exact: true }).locator('..')
  for (const theme of ['淺色', '深色']) {
    await page.getByRole('radio', { name: theme, exact: true }).click()
    for (const [width, height] of [
      [1100, 760],
      [960, 492],
    ]) {
      await page.setViewportSize({ width: width!, height: height! })
      await region.scrollIntoViewIfNeeded()
      const metrics = await row.evaluate((row) => {
        const icon = row.querySelector('svg')!,
          label = row.querySelector('span')!,
          time = row.querySelector('time')!
        const rect = (node: Element) => {
          const r = node.getBoundingClientRect()
          return { x: r.x, right: r.right, width: r.width, height: r.height }
        }
        return {
          row: rect(row),
          icon: rect(icon),
          label: rect(label),
          time: rect(time),
          fill: getComputedStyle(icon).fill,
          stroke: getComputedStyle(icon).stroke,
          labelFont: getComputedStyle(label).fontSize,
          timeFont: getComputedStyle(time).fontSize,
          timeLine: getComputedStyle(time).lineHeight,
          labelTitle: label.getAttribute('title'),
          labelNaturalWidth: label.scrollWidth,
          animations: icon.getAnimations({ subtree: true }).length,
          overflow: row.scrollWidth > row.clientWidth,
        }
      })
      stages.push({ theme, width, height, metrics })
      await writeFile(
        test.info().outputPath('step-rows.json'),
        JSON.stringify(stages, null, 2) + '\n',
      )
      await page.screenshot({
        path: test.info().outputPath(`steps-${theme}-${width}x${height}.png`),
      })
      expect(metrics.row.height).toBe(32)
      expect(metrics.icon.width).toBe(14)
      expect(metrics.fill).toBe(metrics.stroke)
      expect(metrics.animations).toBe(0)
      expect(metrics.labelFont).toBe('13px')
      expect(metrics.timeFont).toBe('12px')
      expect(metrics.timeLine).toBe('16px')
      expect(metrics.labelTitle).toBe(label)
      expect(metrics.labelNaturalWidth).toBeGreaterThan(metrics.label.width)
      expect(metrics.label.right).toBeLessThanOrEqual(metrics.time.x - 8)
      expect(metrics.time.right).toBeLessThanOrEqual(metrics.row.right)
      expect(metrics.overflow).toBe(false)
      await expect(region.getByRole('img', { name: '執行中', exact: true })).toBeVisible()
      await expect(region.getByRole('img', { name: '已完成', exact: true })).toBeVisible()
      await expect(region.getByRole('img', { name: '結果未確認', exact: true })).toBeVisible()
    }
  }
})

test('the actual work keeps its source filters, cancellation and folded usage attached to the original receipt', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('work-view-details')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page)
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    const reducedMotion = page.getByRole('switch', { name: '減少動態', exact: true })
    if ((await reducedMotion.getAttribute('aria-checked')) !== 'true') await reducedMotion.click()
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    const scenario = await fetch(`${rig.base}/__test/work-scenario`, { method: 'POST' })
    expect(scenario.ok).toBe(true)
    const prompt = '保留原工作回執並驗證工作頁配置'
    await page
      .getByRole('textbox', { name: `和 ${connection.name} 說點什麼`, exact: true })
      .fill(prompt)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const accepted = await waitForAcceptedMessage(page, connection.characterId, prompt)
    const main = await waitForMainEnded(page, connection.characterId, accepted.requestId)
    expect(main.event_id).toBe(accepted.eventId)
    const workId = await page.evaluate(async (id) => {
      const home = await window.yuki.client.read<Home>(id, { kind: 'home' })
      if (!home.ok || !home.value.works[0]) throw Error('Expected the original fixture work')
      return home.value.works[0].work_id
    }, connection.characterId)
    const original = await waitForWorkState(page, connection.characterId, workId, 'waiting_user')
    expect(original.goal).toBe('原工作整合測試')
    const commands = await page.evaluate(
      (id) => window.yuki.client.workCommands(id),
      connection.characterId,
    )
    expect(commands).toMatchObject({ ok: true })
    await navigate(page, '工作')
    await expect(page.getByRole('heading', { name: '工作', exact: true, level: 2 })).toHaveCount(0)
    const filters = page.getByRole('tablist', { name: '工作來源', exact: true })
    await expect(filters.getByRole('tab')).toHaveText(['全部', '桌面', '其他入口'])
    const row = page.getByRole('button', { name: /等你回覆.*原工作整合測試/ })
    await filters.getByRole('tab', { name: '桌面', exact: true }).click()
    await expect(row).toBeVisible()
    await filters.getByRole('tab', { name: '其他入口', exact: true }).click()
    await expect(row).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '目前沒有工作', exact: true })).toBeVisible()
    await filters.getByRole('tab', { name: '全部', exact: true }).click()
    await row.click()
    const detail = page.getByRole('complementary', { name: '詳情', exact: true })
    await expect(detail.getByRole('heading', { name: original.goal, exact: true })).toBeVisible()
    const cancel = detail.getByRole('button', { name: '取消工作', exact: true })
    const usage = detail.locator('details').filter({ has: page.getByText('用量', { exact: true }) })
    const layouts = []
    for (const [width, height] of workspaceSizes) {
      const viewportMethod = await contentSize(app, page, width, height)
      await cancel.scrollIntoViewIfNeeded()
      const status = cancel.locator('..')
      await expect(status.getByText('等你回覆', { exact: true })).toBeVisible()
      const metrics = await status.evaluate((row) => {
        const pill = row.querySelector('span')!,
          cancel = row.querySelector('button')!
        const rect = (node: Element) => {
          const { x, y, width, height } = node.getBoundingClientRect()
          return { x, y, width, height }
        }
        return { status: rect(pill), cancel: rect(cancel) }
      })
      expect(metrics.status.x + metrics.status.width).toBeLessThanOrEqual(metrics.cancel.x)
      expect(metrics.status.y + metrics.status.height / 2).toBeCloseTo(
        metrics.cancel.y + metrics.cancel.height / 2,
        1,
      )
      await expect(usage).toHaveJSProperty('open', false)
      await captureViewport(
        app,
        page,
        test.info().outputPath(`work-usage-collapsed-${width}x${height}.png`),
      )
      await usage.getByText('用量', { exact: true }).click()
      await expect(usage).toHaveJSProperty('open', true)
      await expect(usage).toContainText(
        `模型請求 ${original.budget.models}／${original.budget.model_limit ?? '無上限'}`,
      )
      await expect(usage).toContainText(
        `工具呼叫 ${original.budget.tools}${original.budget.tool_limit === null ? '' : `／${original.budget.tool_limit}`}`,
      )
      await usage.scrollIntoViewIfNeeded()
      const usageText = await usage.innerText()
      await captureViewport(
        app,
        page,
        test.info().outputPath(`work-usage-expanded-${width}x${height}.png`),
      )
      layouts.push({ requested: { width, height }, viewportMethod, metrics, usageText })
      await usage.getByText('用量', { exact: true }).click()
    }
    await cancel.click()
    const confirmation = page.getByRole('dialog', { name: '取消這項工作？', exact: true })
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: '保持執行', exact: true }).click()
    await expect(confirmation).toBeHidden()
    const after = await page.evaluate(
      async ({ id, workId }) => {
        const work = await window.yuki.client.read<Work>(id, { kind: 'work', workId })
        if (!work.ok) throw Error(work.code)
        return { work: work.value, commands: await window.yuki.client.workCommands(id) }
      },
      { id: connection.characterId, workId: original.work_id },
    )
    expect(after.work).toMatchObject({
      work_id: original.work_id,
      conversation_id: original.conversation_id,
      generation: original.generation,
      state: 'waiting_user',
      budget: original.budget,
    })
    expect(after.commands).toEqual(commands)
    await writeFile(
      test.info().outputPath('original-work-view-layout.json'),
      JSON.stringify({ connection, accepted, main, original, after, layouts }, null, 2),
    )
    success = true
  } finally {
    if (!success)
      await recordBusinessState(await app.firstWindow(), 'work-view-state.json').catch(
        console.error,
      )
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

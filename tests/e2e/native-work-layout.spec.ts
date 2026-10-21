import { expect, test } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Home, Work, WorkCommandItem } from '../../src/shared/api'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { launchShell } from '../fixtures/shell-app'
import { captureViewport, contentSize } from '../fixtures/visual'
import { windowsFileDialogOwner } from '../fixtures/windows-file-dialog'
import { nativeWindowsControls } from '../fixtures/windows-window-controls'

test('native work list and inspector preserve step layout, keyboard focus and original work continuation across appearances', async () => {
  test.setTimeout(240000)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  const external = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  const rig = external ? undefined : await yukiFixture()
  const base = external ?? rig!.base
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base).hostname)
  const data = await mkdtemp(join(tmpdir(), 'yuki-native-work-layout-'))
  const app = await launchShell(data)
  const stages: unknown[] = []
  const proof: Record<string, unknown> = {
    data,
    backend: rig?.root ?? 'operator-isolated-reference',
    stages,
  }
  const save = () =>
    writeFile(
      test.info().outputPath('native-work-layout.json'),
      JSON.stringify(proof, null, 2) + '\n',
    )
  try {
    const page = await app.firstWindow()
    const native = await app.evaluate(({ app, BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      return {
        platform: process.platform,
        pid: process.pid,
        packaged: app.isPackaged,
        sandboxed: app
          .getAppMetrics()
          .find((entry) => entry.pid === win.webContents.getOSProcessId())?.sandboxed,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
        workArea: screen.getDisplayMatching(win.getBounds()).workArea,
      }
    })
    expect(native).toMatchObject({ packaged: true, sandboxed: true, noSandbox: false })
    proof.native = native
    const sizes =
      native.platform === 'win32'
        ? [
            [1360, 833],
            [1100, 760],
            [960, 492],
          ]
        : [
            [1440, 900],
            [1100, 760],
            [960, 492],
          ]
    const code = await fetch(base + '/__test/link-code', { method: 'POST' })
    expect(code.ok).toBe(true)
    await pairUI(page, base, ((await code.json()) as { code: string }).code, '工作版面驗證', 20000)
    expect((await fetch(base + '/__test/work-scenario', { method: 'POST' })).ok).toBe(true)
    await page
      .getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
      .fill('請沿同一份工作確認版面與回覆接續。')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const card = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: '原工作整合測試', exact: true }) })
    await expect(card.getByText('等你回覆', { exact: true })).toBeVisible({ timeout: 20000 })
    const original = await page.evaluate(async () => {
      const connections = await window.yuki.client.connections()
      if (!connections.ok || !connections.value[0]) throw Error('Original identity missing')
      const connection = connections.value[0]
      const home = await window.yuki.client.read<Home>(connection.characterId, { kind: 'home' })
      if (!home.ok || home.value.works.length !== 1) throw Error('Original work missing')
      return { connection, work: home.value.works[0]! }
    })
    proof.original = original
    const detail = page.getByRole('complementary', { name: '檢視器', exact: true })
    const row = page.getByRole('button', { name: /等你回覆.*原工作整合測試/ })
    const capture = async (name: string) => {
      const path = test
        .info()
        .outputPath(
          `${native.platform}-${await page.evaluate(() => devicePixelRatio)}x-${name}.png`,
        )
      if (native.platform === 'win32') {
        const receipt = await nativeWindowsControls(await windowsFileDialogOwner(app), {
          outputPath: path,
        })
        expect(receipt.processId).toBe(native.pid)
      } else await captureViewport(app, page, path)
    }
    for (const mode of ['light', 'dark', 'opaque', 'contrast']) {
      await contentSize(app, page, sizes[0]![0]!, sizes[0]![1]!)
      await page.keyboard.press('ControlOrMeta+,')
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page.getByRole('tab', { name: mode === 'dark' ? '深色' : '淺色', exact: true }).click()
      for (const [name, checked] of [
        ['永遠不透明', mode === 'opaque'],
        ['增加對比', mode === 'contrast'],
        ['減少動態', true],
      ] as const) {
        const toggle = page.getByRole('switch', { name, exact: true })
        if ((await toggle.getAttribute('aria-checked')) !== String(checked)) await toggle.click()
        await expect(toggle).toHaveAttribute('aria-checked', String(checked))
      }
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        mode === 'dark' ? 'dark' : 'light',
      )
      await expect(page.locator('html')).toHaveAttribute(
        'data-contrast',
        String(mode === 'contrast'),
      )
      await expect(page.locator('html')).toHaveAttribute(
        'data-opaque',
        String(mode === 'opaque' || mode === 'contrast'),
      )
      for (const [width, height] of sizes) {
        const viewportMethod = await contentSize(app, page, width!, height!)
        await page.keyboard.press('ControlOrMeta+2')
        if (await detail.isVisible())
          await detail.getByRole('button', { name: '關閉檢視器', exact: true }).click()
        await expect(row).toBeVisible()
        const list = await row.evaluate((row) => {
          const rect = (node: Element) => {
            const r = node.getBoundingClientRect()
            return { x: r.x, right: r.right, width: r.width, height: r.height }
          }
          return {
            row: rect(row),
            state: rect(row.firstElementChild!),
            goal: rect(row.children[1]!),
            source: rect(row.children[2]!),
            time: rect(row.lastElementChild!),
            timeFont: getComputedStyle(row.lastElementChild!).fontSize,
            timeLine: getComputedStyle(row.lastElementChild!).lineHeight,
            overflow: row.scrollWidth > row.clientWidth,
          }
        })
        stages.push({ mode, width, height, viewportMethod, view: 'list', list })
        await save()
        expect(list.row.height).toBe(56)
        expect(list.timeFont).toBe('11px')
        expect(list.timeLine).toBe('14px')
        expect(list.state.width).toBe(92)
        expect(list.source.width).toBeGreaterThan(0)
        expect(list.goal.right).toBeLessThanOrEqual(list.source.x)
        expect(list.time.right).toBeLessThanOrEqual(list.row.right)
        expect(list.overflow).toBe(false)
        await capture(`${mode}-state-works-waiting-${width}x${height}-${viewportMethod}`)
        await row.focus()
        await page.keyboard.press('Enter')
        await expect(
          detail.getByRole('heading', { name: '原工作整合測試', exact: true }),
        ).toBeVisible()
        const steps = detail.getByRole('heading', { name: '步驟', exact: true }).locator('..')
        await expect(steps.locator(':scope > div').first()).toBeVisible()
        const stepMetrics = await steps.locator(':scope > div').evaluateAll((rows) =>
          rows.map((row) => {
            const icon = row.querySelector('svg')!,
              label = row.querySelector('span')!,
              time = row.querySelector('time')!
            const r = row.getBoundingClientRect(),
              t = time.getBoundingClientRect(),
              l = label.getBoundingClientRect()
            return {
              height: r.height,
              labelRight: l.right,
              timeX: t.x,
              timeRight: t.right,
              right: r.right,
              label: label.textContent,
              title: label.getAttribute('title'),
              labelFont: getComputedStyle(label).fontSize,
              timeFont: getComputedStyle(time).fontSize,
              timeLine: getComputedStyle(time).lineHeight,
              status: icon.getAttribute('aria-label'),
              fill: getComputedStyle(icon).fill,
              stroke: getComputedStyle(icon).stroke,
              animations: icon.getAnimations({ subtree: true }).length,
              overflow: row.scrollWidth > row.clientWidth,
            }
          }),
        )
        const budget = await detail.getByText(/^模型請求/).evaluate((node) => ({
          font: getComputedStyle(node).fontSize,
          line: getComputedStyle(node).lineHeight,
        }))
        stages.push({
          mode,
          width,
          height,
          viewportMethod,
          view: 'inspector',
          steps: stepMetrics,
          budget,
        })
        expect(budget).toEqual({ font: '11px', line: '14px' })
        await save()
        expect(stepMetrics.length).toBeGreaterThan(0)
        for (const step of stepMetrics) {
          expect(step.height).toBe(32)
          expect(step.labelRight).toBeLessThanOrEqual(step.timeX - 8)
          expect(step.timeRight).toBeCloseTo(step.right, 3)
          expect(step.labelFont).toBe('13px')
          expect(step.timeFont).toBe('12px')
          expect(step.timeLine).toBe('16px')
          expect(step.title).toBe(step.label)
          expect(step.status).toBeTruthy()
          expect(step.animations).toBe(0)
          expect(step.overflow).toBe(false)
          if (step.status === '執行中') expect(step.fill).toBe(step.stroke)
        }
        await capture(`${mode}-state-work-inspector-${width}x${height}-${viewportMethod}`)
        const reply = detail.getByRole('button', { name: '回覆', exact: true })
        await reply.click()
        const answer = detail.getByRole('textbox', { name: '回答這個問題', exact: true })
        await answer.fill('台北，沿原工作繼續。')
        const field = await answer.evaluate((input) => ({
          height: input.getBoundingClientRect().height,
          clientHeight: input.clientHeight,
          scrollHeight: input.scrollHeight,
          font: getComputedStyle(input).fontSize,
          line: getComputedStyle(input).lineHeight,
        }))
        stages.push({ mode, width, height, viewportMethod, view: 'answer', field })
        await save()
        expect(field.scrollHeight).toBeLessThanOrEqual(field.clientHeight)
        if (width === sizes[0]![0]) await capture(`${mode}-work-answer-${width}x${height}`)
        await answer.fill('台北，沿原工作繼續。\n第二行保留同一問題的回答')
        await expect
          .poll(async () => (await answer.boundingBox())!.height)
          .toBeGreaterThan(field.height)
        const multiline = await answer.evaluate((input) => ({
          height: input.getBoundingClientRect().height,
          clientHeight: input.clientHeight,
          scrollHeight: input.scrollHeight,
        }))
        expect(multiline.scrollHeight).toBeLessThanOrEqual(multiline.clientHeight)
        await answer.fill('台北，沿原工作繼續。')
        await expect
          .poll(async () => (await answer.boundingBox())!.height)
          .toBeCloseTo(field.height, 3)
        stages.push({
          mode,
          width,
          height,
          viewportMethod,
          view: 'multiline-answer',
          field: multiline,
        })
        await save()
        await page.keyboard.press('Escape')
        await expect(reply).toBeFocused()
        const close = detail.getByRole('button', { name: '關閉檢視器', exact: true })
        await close.focus()
        await page.keyboard.press('Space')
        const toggle = page.getByRole('button', { name: '檢視器', exact: true })
        await expect(toggle).toBeFocused()
        await page.keyboard.press('Space')
        await expect(detail).toBeVisible()
      }
    }
    await detail.getByRole('button', { name: '回覆', exact: true }).click()
    const answer = detail.getByRole('textbox', { name: '回答這個問題', exact: true })
    await expect(answer).toHaveValue('台北，沿原工作繼續。')
    await detail.getByRole('button', { name: '送出回答', exact: true }).click()
    await expect(detail.getByText('已完成', { exact: true })).toBeVisible({ timeout: 20000 })
    const result = await page.evaluate(async ({ connection, work }) => {
      const result = await window.yuki.client.read<Work>(connection.characterId, {
        kind: 'work',
        workId: work.work_id,
      })
      const commands = await window.yuki.client.workCommands(connection.characterId)
      if (!result.ok || !commands.ok) throw Error('Original result missing')
      return { work: result.value, commands: commands.value as WorkCommandItem[] }
    }, original)
    expect(result.work).toMatchObject({
      work_id: original.work.work_id,
      conversation_id: original.work.conversation_id,
      generation: original.work.generation,
      state: 'completed',
    })
    expect(result.work.budget.root_id).toBe(original.work.budget.root_id)
    expect(result.commands).toHaveLength(1)
    expect(result.commands[0]).toMatchObject({
      state: 'result',
      problem: null,
      command: { kind: 'input', workId: original.work.work_id, text: '台北，沿原工作繼續。' },
    })
    proof.result = result
    proof.complete = true
  } finally {
    await save()
    await app.close().catch(() => {})
    await rig?.close(false)
  }
})

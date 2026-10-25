import { activeCharacterName } from '../fixtures/active-character'
import { expect, test } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { launchShell } from '../fixtures/shell-app'
import { captureViewport, contentSize } from '../fixtures/visual'
import { windowsFileDialogOwner } from '../fixtures/windows-file-dialog'
import { nativeWindowsControls } from '../fixtures/windows-window-controls'

function contrast(foreground: number[], background: number[]) {
  const luminance = (rgb: number[]) => {
    const values = rgb
      .map((value) => value / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722
  }
  const a = luminance(foreground),
    b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

test('native About follows compact role layout and preserves memory evidence interactions', async () => {
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  test.setTimeout(120000)
  const external = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  const rig = external ? undefined : await yukiFixture({ character: true })
  const base = external ?? rig!.base
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base).hostname)
  const data = await mkdtemp(join(tmpdir(), 'yuki-native-about-'))
  const app = await launchShell(data)
  const nativeCaptures: unknown[] = []
  const stages: unknown[] = [],
    proof: Record<string, unknown> = {
      data,
      backend: rig?.root ?? 'operator-isolated-reference',
      stages,
      nativeCaptures,
    }
  const save = () =>
    writeFile(
      test.info().outputPath('native-about-layout.json'),
      JSON.stringify(proof, null, 2) + '\n',
    )
  try {
    const page = await app.firstWindow()
    const native = await app.evaluate(({ app, BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      return {
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        packaged: app.isPackaged,
        sandboxed: app
          .getAppMetrics()
          .find((entry) => entry.pid === win.webContents.getOSProcessId())?.sandboxed,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
        workArea: screen.getDisplayMatching(win.getBounds()).workArea,
        gpu: app.getGPUFeatureStatus(),
      }
    })
    expect(native).toMatchObject({ packaged: true, sandboxed: true, noSandbox: false })
    proof.native = native
    const code = await fetch(base + '/__test/link-code', { method: 'POST' })
    expect(code.ok).toBe(true)
    await pairUI(page, base, ((await code.json()) as { code: string }).code, '角色版面驗證', 20000)
    const source = '記憶版面的原始依據 ' + randomUUID()
    const replies = await page.getByText('Desktop reference reply', { exact: true }).count()
    await page
      .getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼` })
      .fill(source)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('Desktop reference reply', { exact: true })).toHaveCount(
      replies + 1,
    )
    const response = await fetch(base + '/__test/character-data', { method: 'POST' })
    expect(response.ok).toBe(true)
    const seeded = (await response.json()) as { source_event_id: number }
    proof.seeded = seeded
    await page.getByRole('button', { name: /^關於 / }).click()
    const fact = page.getByRole('button', { name: /^已核對的記錄 52/ })
    await expect(fact).toBeVisible()
    for (const mode of ['light', 'dark', 'opaque', 'contrast'] as const) {
      await contentSize(app, page, 1100, 760)
      await page.keyboard.press('ControlOrMeta+,')
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page
        .getByRole('radio', { name: mode === 'dark' ? '深色' : '淺色', exact: true })
        .click()
      for (const [label, checked] of [
        ['永遠不透明', mode === 'opaque'],
        ['增加對比', mode === 'contrast'],
      ] as const) {
        const toggle = page.getByRole('switch', { name: label, exact: true })
        if ((await toggle.getAttribute('aria-checked')) !== String(checked)) await toggle.click()
      }
      await page.keyboard.press('ControlOrMeta+5')
      await expect(fact).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        mode === 'dark' ? 'dark' : 'light',
      )
      await expect(page.locator('html')).toHaveAttribute(
        'data-opaque',
        String(mode === 'opaque' || mode === 'contrast'),
      )
      await expect(page.locator('html')).toHaveAttribute(
        'data-contrast',
        String(mode === 'contrast'),
      )
      for (const [width, height] of [
        [1100, 760],
        [960, 492],
      ] as const) {
        const viewportMethod = await contentSize(app, page, width, height)
        const metrics = await fact.evaluate((button) => {
          const panel = button.closest('[role=tabpanel]')!
          const column = panel.parentElement!
          const hero = column.querySelector('header')!
          const row = button.closest('article')!,
            meta = button.querySelector('time')!.parentElement!,
            tag = meta.firstElementChild!,
            text = button.firstElementChild!
          const describe = (node: Element) => {
            const style = getComputedStyle(node),
              rect = node.getBoundingClientRect()
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              font: style.fontSize,
              line: style.lineHeight,
              paddingTop: style.paddingTop,
              paddingBottom: style.paddingBottom,
              paddingLeft: style.paddingLeft,
              paddingRight: style.paddingRight,
              color: style.color,
              background: style.backgroundColor,
              border: style.borderTopWidth,
            }
          }
          const css = getComputedStyle(column),
            bg = css.getPropertyValue('--bg-content').trim()
          return {
            dpr: devicePixelRatio,
            column: describe(column),
            hero: describe(hero),
            row: describe(row),
            meta: describe(meta),
            tag: describe(tag),
            text: describe(text),
            bg,
            scroller: {
              clientWidth: column.parentElement!.clientWidth,
              scrollWidth: column.parentElement!.scrollWidth,
            },
          }
        })
        stages.push({ mode, width, height, viewportMethod, metrics })
        await save()
        await captureViewport(
          app,
          page,
          test
            .info()
            .outputPath(
              `${native.platform}-${metrics.dpr}x-${mode}-about-memory-${width}x${height}-${viewportMethod}.png`,
            ),
        )
        if (native.platform === 'win32') {
          const receipt = await nativeWindowsControls(await windowsFileDialogOwner(app), {
            outputPath: test.info().outputPath(`win32-own-hwnd-${mode}-${width}x${height}.png`),
          })
          expect(receipt.processId).toBe(native.pid)
          expect(receipt.sessionId).toBeGreaterThan(0)
          nativeCaptures.push({ mode, width, height, receipt })
          await save()
        }
        expect(metrics.column.width).toBe(760)
        expect(metrics.hero.width).toBe(width >= 1100 ? 696 : 712)
        expect(metrics.scroller.scrollWidth).toBe(metrics.scroller.clientWidth)
        expect(metrics.row).toMatchObject({ paddingTop: '12px', paddingBottom: '12px' })
        expect(metrics.text).toMatchObject({ font: '14px', line: '22px' })
        expect(metrics.meta).toMatchObject({ font: '11px', line: '14px', paddingTop: '4px' })
        expect(metrics.tag).toMatchObject({
          font: '11px',
          line: '14px',
          paddingLeft: '6px',
          paddingRight: '6px',
          border: '0px',
        })
        const bg = metrics.bg
          .replace('#', '')
          .match(/../g)!
          .map((value) => parseInt(value, 16))
        const foreground = metrics.meta.color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
        expect(contrast(foreground, bg)).toBeGreaterThanOrEqual(4.5)
        const tagInk = metrics.tag.color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
        const fill = metrics.tag.background.match(/[\d.]+/g)!.map(Number)
        const alpha = fill[3] ?? 1
        const tagBackground = bg.map((value, index) => fill[index]! * alpha + value * (1 - alpha))
        expect(contrast(tagInk, tagBackground)).toBeGreaterThanOrEqual(4.5)
      }
    }
    await contentSize(app, page, 1100, 760)
    await fact.press('Enter')
    const evidence = page.getByRole('button', { name: source, exact: true })
    await expect(evidence).toBeVisible()
    await evidence.click()
    await expect(
      page.getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼` }),
    ).toBeVisible()
    const original = page
      .getByRole('article', { name: '你的訊息', exact: true })
      .filter({ hasText: source })
    await expect(original).toHaveCount(1)
    proof.evidenceEventId = await original.getAttribute('data-event-id')
    expect(proof.evidenceEventId).toBe(String(seeded.source_event_id))
    proof.complete = true
  } finally {
    await save()
    await app.close().catch(() => {})
    await rig?.close(false)
  }
})

import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { isolatedDesktop } from '../fixtures/isolated-desktop'
import { captureViewport, contentSize, workspaceSizes } from '../fixtures/visual'

test('frosted workspace keeps opaque paper, floating controls, real receipts and drafts across appearances and sizes', async () => {
  test.setTimeout(180000)
  const external = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  const rig = external ? undefined : await yukiFixture()
  const base = external ?? rig!.base
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base).hostname)
  const data = await mkdtemp(join(tmpdir(), 'yuki-frosted-')),
    desktop = await isolatedDesktop(data),
    app = await desktop.launch('workspace')
  const stages: unknown[] = [],
    evidence: Record<string, unknown> = { data, stages }
  let success = false
  try {
    const page = await app.firstWindow()
    const native = await app.evaluate(({ app, BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      return {
        platform: process.platform,
        packaged: app.isPackaged,
        pid: process.pid,
        workArea: screen.getDisplayMatching(win.getBounds()).workArea,
        sandboxed: app
          .getAppMetrics()
          .find((entry) => entry.pid === win.webContents.getOSProcessId())?.sandboxed,
        linuxSeccomp:
          process.platform === 'linux'
            ? process
                .getBuiltinModule('node:fs')
                .readFileSync(`/proc/${win.webContents.getOSProcessId()}/status`, 'utf8')
                .match(/^Seccomp:\s+(\d+)$/m)?.[1]
            : undefined,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
      }
    })
    evidence.native = native
    if (native.platform === 'linux') expect(native.linuxSeccomp).toBe('2')
    else expect(native.sandboxed).toBe(true)
    expect(native.noSandbox).toBe(false)
    expect(native.packaged).toBe(false)
    const link = await fetch(base + '/__test/link-code', { method: 'POST' })
    expect(link.ok).toBe(true)
    await pairUI(page, base, ((await link.json()) as { code: string }).code, '霜面桌面驗證')
    const composer = page.locator('[data-region="composer"]:visible'),
      input = composer.getByRole('textbox')
    const marker = randomUUID()
    const text =
      marker +
      '\n' +
      Array.from(
        { length: 80 },
        (_, index) => `${index + 1}. 核對真實對話、原回執與玻璃捲動邊緣。`,
      ).join('\n')
    await input.fill(text)
    await composer.getByRole('button', { name: '送出', exact: true }).click()
    const original = page
      .getByRole('article', { name: '你的訊息', exact: true })
      .filter({ hasText: marker })
    await expect(original).toHaveCount(1)
    const event = await original.getAttribute('data-event-id')
    expect(Number(event)).toBeGreaterThan(0)
    evidence.event = event
    const draft = '浮動輸入框保留真實草稿\n第二行，跨外觀與視窗尺寸仍然存在。'
    await input.fill(draft)
    const sizes = workspaceSizes
    for (const mode of ['light', 'dark', 'opaque', 'contrast'] as const) {
      await contentSize(app, page, sizes[0]![0]!, sizes[0]![1]!)
      await page.keyboard.press('ControlOrMeta+,')
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page
        .getByRole('radio', { name: mode === 'dark' ? '深色' : '淺色', exact: true })
        .click()
      for (const [name, checked] of [
        ['永遠不透明', mode === 'opaque'],
        ['增加對比', mode === 'contrast'],
      ] as const) {
        const toggle = page.getByRole('switch', { name, exact: true })
        if ((await toggle.getAttribute('aria-checked')) !== String(checked)) await toggle.click()
        await expect(toggle).toHaveAttribute('aria-checked', String(checked))
      }
      await page.getByRole('button', { name: '返回', exact: true }).click()
      for (const [width, height] of sizes) {
        const method = await contentSize(app, page, width!, height!)
        await expect(input).toHaveValue(draft)
        await expect(composer.getByRole('button', { name: '送出', exact: true })).toBeInViewport({
          ratio: 1,
        })
        const geometry = await composer.evaluate((node) => {
          const main = node.closest('section')!,
            mainRect = main.getBoundingClientRect(),
            footer = node.getBoundingClientRect()
          const paper = getComputedStyle(main),
            toolbar = main.querySelector<HTMLElement>('[data-region="toolbar"]')!
          const glass = toolbar.querySelector<HTMLElement>('[data-glass="toolbar"]')!
          const log = main.querySelector<HTMLElement>('[role="log"]')!,
            styles = getComputedStyle(node)
          return {
            paper: paper.backgroundColor,
            radius: paper.borderRadius,
            inset: mainRect.y,
            bottom: mainRect.bottom - footer.bottom,
            toolbarPosition: getComputedStyle(toolbar).position,
            toolbarHeight: toolbar.getBoundingClientRect().height,
            capsuleHeight: glass.getBoundingClientRect().height,
            filter: styles.backdropFilter,
            refract: styles.getPropertyValue('--refract'),
            footerHeight: footer.height,
            logPadding: parseFloat(getComputedStyle(log).paddingBottom),
            opaque: document.documentElement.dataset.opaque,
            htmlWidth: document.documentElement.scrollWidth,
            viewport: innerWidth,
          }
        })
        expect(geometry.paper).toBe(mode === 'dark' ? 'rgb(27, 29, 34)' : 'rgb(255, 255, 255)')
        expect(geometry.radius).toBe('14px')
        expect(geometry.inset).toBe(6)
        expect(geometry.bottom).toBeCloseTo(14, 0)
        expect(geometry.toolbarPosition).toBe('absolute')
        expect(geometry.toolbarHeight).toBe(52)
        expect(geometry.capsuleHeight).toBe(34)
        expect(geometry.logPadding).toBeGreaterThanOrEqual(geometry.footerHeight + 26)
        expect(geometry.htmlWidth).toBe(geometry.viewport)
        if (geometry.opaque === 'true') expect(geometry.filter).toBe('none')
        else {
          expect(geometry.filter).toContain('blur(28px)')
          expect(geometry.refract).toContain('url(')
        }
        await expect(original).toHaveAttribute('data-event-id', event!)
        stages.push({ mode, width, height, method, geometry })
        await captureViewport(
          app,
          page,
          test.info().outputPath(`frosted-${native.platform}-${mode}-${width}x${height}.png`),
        )
      }
    }
    const count = await page.evaluate(async () => {
      const list = await window.yuki.client.connections()
      if (!list.ok || !list.value[0]) throw Error('Paired identity missing')
      const outbox = await window.yuki.client.outbox(list.value[0].characterId)
      if (!outbox.ok) throw Error(outbox.code)
      return outbox.value.map((item) => ({
        requestId: item.requestId,
        eventId: item.eventId,
        state: item.state,
      }))
    })
    evidence.receipts = count
    expect(count.filter((item) => String(item.eventId) === event)).toHaveLength(1)
    success = true
  } finally {
    await writeFile(
      test.info().outputPath('frosted-workspace.json'),
      JSON.stringify(evidence, null, 2) + '\n',
    )
    await app.close()
    await rig?.close(success)
  }
})

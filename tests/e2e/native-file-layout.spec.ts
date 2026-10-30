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

test('native file library keeps real long names and distinct original artifacts legible across workspace sizes', async () => {
  test.setTimeout(180000)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  const external = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  const rig = external ? undefined : await yukiFixture()
  const base = external ?? rig!.base
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base).hostname)
  const data = await mkdtemp(join(tmpdir(), 'yuki-native-files-'))
  const app = await launchShell(data)
  const stages: unknown[] = []
  const proof: Record<string, unknown> = {
    data,
    backend: rig?.root ?? 'operator-isolated-reference',
    stages,
  }
  const save = () =>
    writeFile(
      test.info().outputPath('native-file-layout.json'),
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
    proof.workspaceSizes = sizes
    proof.largerWindowsWorkspace =
      native.platform === 'win32'
        ? 'Default Windows checks use 1360x833; 1440x900 native acceptance remains separate'
        : undefined
    const code = await fetch(base + '/__test/link-code', { method: 'POST' })
    expect(code.ok).toBe(true)
    await pairUI(
      page,
      base,
      ((await code.json()) as { code: string }).code,
      '原成果版面驗證',
      20000,
    )
    await page
      .getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼` })
      .fill('原成果版面 ' + randomUUID())
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('Desktop reference reply', { exact: true })).toBeVisible()
    const response = await fetch(base + '/__test/artifacts?long_names=true', { method: 'POST' })
    expect(response.ok).toBe(true)
    const delivered = (await response.json()) as {
      artifact_id: string
      sha256: string
      name: string
      event_id: number
    }[]
    proof.delivered = delivered
    const first = delivered[0]!,
      second = delivered[1]!
    expect(first.name).toBe(second.name)
    expect(first.artifact_id).not.toBe(second.artifact_id)
    await page.keyboard.press('ControlOrMeta+4')
    const row = page.getByRole('button').filter({ hasText: first.artifact_id })
    const other = page.getByRole('button').filter({ hasText: second.artifact_id })
    const stage = page.getByRole('region', { name: '成果預覽', exact: true })
    await expect(row).toHaveCount(1)
    await expect(other).toHaveCount(1)
    await row.click()
    await expect(stage.getByRole('heading', { name: 'First artifact', exact: true })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: '檔案與成果', exact: true, level: 2 }),
    ).toHaveCount(0)
    const information = stage.getByRole('region', { name: '成果資訊', exact: true })
    const technical = information
      .locator('details')
      .filter({ has: page.getByText('詳細資料', { exact: true }) })
    await expect(technical).toHaveJSProperty('open', false)
    await expect(technical.getByText(first.artifact_id, { exact: true })).toBeHidden()
    await technical.getByText('詳細資料', { exact: true }).click()
    await expect(technical.getByText(first.artifact_id, { exact: true })).toBeVisible()
    const originalVersion = await technical.locator('code[title]').getAttribute('title')
    expect(originalVersion).toBeTruthy()
    proof.technicalDetails = {
      artifactId: first.artifact_id,
      version: originalVersion,
      text: await technical.innerText(),
    }
    await technical.getByText('詳細資料', { exact: true }).click()
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
      }
      await page.keyboard.press('ControlOrMeta+4')
      await expect(
        stage.getByRole('heading', { name: 'First artifact', exact: true }),
      ).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        mode === 'dark' ? 'dark' : 'light',
      )
      for (const size of sizes) {
        const width = size[0]!,
          height = size[1]!
        const viewportMethod = await contentSize(app, page, width, height)
        await page.evaluate(() => document.fonts.ready.then(() => undefined))
        const metrics = await row.evaluate((button) => {
          const label = button.querySelector('span > span')!,
            metadata = button.querySelector('small')!,
            size = button.lastElementChild!,
            list = button.closest('section')!,
            preview = list.nextElementSibling!
          const rect = (node: Element) => {
            const r = node.getBoundingClientRect()
            return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right }
          }
          const text = document.createRange()
          text.selectNodeContents(label)
          const ink = text.getBoundingClientRect(),
            style = getComputedStyle(metadata)
          const stem = label.firstElementChild,
            extension = label.lastElementChild
          let visibleRight = ink.right
          if (stem && extension && getComputedStyle(stem).overflowX === 'hidden') {
            text.selectNodeContents(stem)
            visibleRight = Math.max(
              Math.min(text.getBoundingClientRect().right, stem.getBoundingClientRect().right),
              extension.getBoundingClientRect().right,
            )
          }
          const header = preview.querySelector('header')!,
            card = preview.querySelector('[aria-label="成果資訊"]')

          return {
            dpr: devicePixelRatio,
            row: rect(button),
            label: rect(label),
            ink: { x: ink.x, right: visibleRight, naturalRight: ink.right, width: ink.width },
            size: rect(size),
            list: rect(list),
            preview: rect(preview),
            previewHeader: rect(header),
            previewBackground: getComputedStyle(preview).backgroundColor,
            informationCard: card
              ? {
                  rect: rect(card),
                  background: getComputedStyle(card).backgroundColor,
                  preview: rect(card.previousElementSibling!),
                  previewBeforeInfo: !!(
                    card.previousElementSibling!.compareDocumentPosition(card) &
                    Node.DOCUMENT_POSITION_FOLLOWING
                  ),
                  technicalOpen: card.querySelector('details')!.open,
                }
              : null,
            metadata: {
              font: style.fontSize,
              line: style.lineHeight,
              identity: metadata.firstElementChild?.textContent,
              detail: metadata.lastElementChild?.textContent,
              detailWidth: metadata.lastElementChild?.clientWidth,
              detailScrollWidth: metadata.lastElementChild?.scrollWidth,
            },
            visibleName: label.textContent,
            fullName: button.getAttribute('title'),
            horizontalOverflow: list.scrollWidth > list.clientWidth,
          }
        })
        stages.push({ mode, width, height, viewportMethod, metrics })
        await save()
        const screenshot = test
          .info()
          .outputPath(
            `${native.platform}-${metrics.dpr}x-${mode}-files-${width}x${height}-${viewportMethod}.png`,
          )
        if (native.platform === 'win32') {
          const receipt = await nativeWindowsControls(await windowsFileDialogOwner(app), {
            outputPath: screenshot,
            captureOnly: true,
          })
          expect(receipt.processId).toBe(native.pid)
        } else await captureViewport(app, page, screenshot)
        expect(metrics.row.height).toBe(52)
        expect(metrics.list.width).toBe(320)
        expect(metrics.previewHeader.height).toBe(44)
        expect(metrics.previewBackground).toBe(
          mode === 'dark' ? 'rgb(22, 24, 28)' : 'rgb(241, 243, 247)',
        )
        expect(metrics.informationCard).not.toBeNull()
        expect(metrics.informationCard!.previewBeforeInfo).toBe(true)
        expect(metrics.informationCard!.technicalOpen).toBe(false)
        await expect(technical.locator('code[title]')).toHaveAttribute('title', originalVersion!)
        expect(metrics.informationCard!.rect.y).toBeGreaterThanOrEqual(
          metrics.informationCard!.preview.y + metrics.informationCard!.preview.height,
        )
        await expect(stage.getByRole('button', { name: '存到…', exact: true })).toBeInViewport({
          ratio: 1,
        })
        expect(metrics.horizontalOverflow).toBe(false)
        expect(metrics.ink.right).toBeLessThanOrEqual(metrics.size.x - 9)
        expect(metrics.ink.right).toBeLessThanOrEqual(metrics.label.right + 1)
        expect(metrics.visibleName).toMatch(/….*\.md$/)
        expect(metrics.fullName).toBe(`${first.name}\n按兩下放大詳情`)
        expect(metrics.metadata).toMatchObject({
          font: '11px',
          line: '14px',
          identity: first.artifact_id,
        })
        expect(metrics.metadata.detail).toContain('桌面對話')
        expect(metrics.metadata.detailScrollWidth).toBeLessThanOrEqual(
          metrics.metadata.detailWidth!,
        )
        await expect(row).toBeInViewport({ ratio: 1 })
      }
    }
    await contentSize(app, page, 1100, 760)
    await other.press('Enter')
    await expect(
      stage.getByRole('heading', { name: 'Another artifact', exact: true }),
    ).toBeVisible()
    await row.press('Enter')
    await expect(stage.getByRole('heading', { name: 'First artifact', exact: true })).toBeVisible()
    await stage.getByText('傳送過的訊息', { exact: true }).click()
    const references = stage
      .locator('details')
      .filter({ has: page.getByText('傳送過的訊息', { exact: true }) })
      .getByRole('button')
    await expect(references).toHaveCount(2)
    await references.first().click()
    const original = page.locator(`article[data-event-id="${delivered.at(-1)!.event_id}"]`)
    await expect(original).toBeVisible()
    proof.complete = true
  } finally {
    await save()
    await app.close().catch(() => {})
    await rig?.close(false)
  }
})

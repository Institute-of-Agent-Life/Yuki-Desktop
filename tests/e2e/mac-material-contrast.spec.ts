import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchShell } from '../fixtures/shell-app'
import { pairUI } from '../fixtures/backend'

test('macOS native material keeps secondary sidebar text readable in actual window captures', async () => {
  test.skip(process.platform !== 'darwin', 'Requires an actual macOS compositor')
  const base = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  test.skip(!base, 'Requires an isolated reference server')
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  test.setTimeout(120000)
  const data = await mkdtemp(join(tmpdir(), 'yuki-mac-material-contrast-'))
  const app = await launchShell(data)
  const stages: unknown[] = []
  const proof: Record<string, unknown> = { data, stages }
  try {
    const page = await app.firstWindow()
    const response = await fetch(base + '/__test/link-code', { method: 'POST' })
    expect(response.ok).toBe(true)
    await pairUI(
      page,
      base!,
      ((await response.json()) as { code: string }).code,
      '原生材質對比',
      20000,
    )
    await page.keyboard.press('Meta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    const owner = await app.evaluate(({ app, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      return {
        pid: process.pid,
        profile: app.getPath('userData'),
        executable: app.getPath('exe'),
        source: win.getMediaSourceId(),
        packaged: app.isPackaged,
      }
    })
    proof.owner = owner
    expect(owner.packaged).toBe(true)
    expect(resolve(owner.profile)).toBe(resolve(data))
    expect(owner.executable).toBe(process.env.YUKI_ELECTRON_EXECUTABLE)
    expect(owner.pid).toBe(await app.evaluate(() => process.pid))
    const windowId = /^window:(\d+):\d+$/.exec(owner.source)?.[1]
    expect(windowId).toBeTruthy()
    for (const [theme, label] of [
      ['light', '淺色'],
      ['dark', '深色'],
    ] as const) {
      await page
        .getByRole('radiogroup', { name: '主題', exact: true })
        .getByRole('radio', { name: label, exact: true })
        .click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      for (const mode of ['material', 'opaque', 'contrast'] as const) {
        if (mode !== 'material')
          await page
            .getByRole('switch', {
              name: mode === 'opaque' ? '永遠不透明' : '增加對比',
              exact: true,
            })
            .click()
        const samples = []
        for (const label of ['已連線', '工作與成果']) {
          const element = page
            .getByRole('navigation', { name: '主要導覽', exact: true })
            .getByText(label, { exact: true })
          await expect(element).toHaveCount(1)
          samples.push(
            await element.evaluate((element) => {
              const rect = element.getBoundingClientRect()
              return {
                text: element.textContent,
                color: getComputedStyle(element).color,
                y: rect.y + rect.height / 2,
              }
            }),
          )
        }
        const viewport = await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio,
        }))
        const file = test.info().outputPath(`mac-native-material-${theme}-${mode}.png`)
        // The ID came from this exact test process; never capture a screen or another window.
        await promisify(execFile)('/usr/sbin/screencapture', ['-x', '-o', '-l' + windowId!, file], {
          timeout: 20000,
        })
        const contrast = await app.evaluate(
          ({ nativeImage }, input) => {
            const image = nativeImage.createFromPath(input.file),
              size = image.getSize()
            if (
              size.width !== input.viewport.width * input.viewport.dpr ||
              size.height !== input.viewport.height * input.viewport.dpr
            )
              throw Error('Own native image and viewport differ')
            const pixels = image.toBitmap({ scaleFactor: 1 })
            const luminance = (rgb: number[]) =>
              rgb
                .map((n) => n / 255)
                .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
                .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i]!, 0)
            return input.samples.map((sample) => {
              const index =
                (Math.floor(sample.y * input.viewport.dpr) * size.width +
                  Math.floor(232 * input.viewport.dpr)) *
                4
              const background = [pixels[index + 2]!, pixels[index + 1]!, pixels[index]!]
              const foreground = sample.color
                .match(/[\d.]+/g)!
                .slice(0, 3)
                .map(Number)
              const [low, high] = [luminance(background), luminance(foreground)].sort(
                (a, b) => a - b,
              )
              return { ...sample, background, foreground, ratio: (high! + 0.05) / (low! + 0.05) }
            })
          },
          { file, viewport, samples },
        )
        stages.push({ theme, mode, file, viewport, contrast })
        await writeFile(
          test.info().outputPath('mac-native-material-contrast.json'),
          JSON.stringify(proof, null, 2) + '\n',
        )
        for (const sample of contrast)
          expect(sample.ratio, `${theme}/${mode}/${sample.text}`).toBeGreaterThanOrEqual(4.5)
        if (mode !== 'material')
          await page
            .getByRole('switch', {
              name: mode === 'opaque' ? '永遠不透明' : '增加對比',
              exact: true,
            })
            .click()
      }
    }
    proof.complete = true
  } catch (error) {
    proof.error = String(error)
    throw error
  } finally {
    await writeFile(
      test.info().outputPath('mac-native-material-contrast.json'),
      JSON.stringify(proof, null, 2) + '\n',
    )
    await app.close().catch(() => {})
  }
})

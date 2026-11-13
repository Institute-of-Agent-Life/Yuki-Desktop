import { expect, test, type ElectronApplication } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isolatedDesktop } from '../fixtures/isolated-desktop'
import { sidebar } from '../fixtures/navigation'

// 全局透明磨砂与统一顶部淡出任务书 (2026-11-12), failure cases 1, 5 and 12–14, in a real window:
// the system's frost is composited outside the page, so only the screen shows what a person sees.
test('the real window frosts what lies behind it, and its glass hides what lies beneath', async () => {
  test.skip(process.platform !== 'darwin', 'Requires the macOS compositor')
  test.setTimeout(120000)
  const root = await mkdtemp(join(tmpdir(), 'yuki-native-frost-'))
  const app = await (await isolatedDesktop(root)).launch('profile')
  const proof: Record<string, unknown> = {}
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    // A window of known colours right behind ours: red on the left half, blue on the right.
    await app.evaluate(async ({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows()[0]!
      main.setBounds({ x: 120, y: 120, width: 1100, height: 720 })
      const behind = new BrowserWindow({
        x: 60,
        y: 60,
        width: 1220,
        height: 840,
        frame: false,
        show: false,
        focusable: false,
      })
      await behind.loadURL(
        'data:text/html,<body style="margin:0;background:linear-gradient(90deg,%23e0402a 50%25,%232a60e0 50%25)"></body>',
      )
      behind.showInactive()
      main.moveTop()
      main.focus()
    })
    await sidebar(page)
    await page.waitForTimeout(800)
    let shots = 0
    // Our own window's region of the screen, while it lies in front of everything else.
    const capture = async (name: string) => {
      const file = test.info().outputPath(`${name}.png`)
      const bounds = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => !window.webContents.getURL().startsWith('data:'))!
          .getContentBounds(),
      )
      await promisify(execFile)(
        '/usr/sbin/screencapture',
        ['-x', `-R${bounds.x},${bounds.y},${bounds.width},${bounds.height}`, file],
        { timeout: 20000 },
      )
      shots++
      return file
    }
    const pixels = (app: ElectronApplication, file: string, points: [number, number][]) =>
      app.evaluate(
        ({ nativeImage, BrowserWindow }, { file, points }) => {
          const image = nativeImage.createFromPath(file),
            size = image.getSize(),
            scale =
              size.width /
              BrowserWindow.getAllWindows()
                .find((window) => !window.webContents.getURL().startsWith('data:'))!
                .getContentBounds().width,
            bitmap = image.toBitmap({ scaleFactor: 1 })
          return points.map(([x, y]) => {
            const k = (Math.round(y * scale) * size.width + Math.round(x * scale)) * 4
            return [bitmap[k + 2]!, bitmap[k + 1]!, bitmap[k]!]
          })
        },
        { file, points },
      )
    const appearance = async (theme: string, material: string) => {
      await page.keyboard.press('Meta+,')
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page
        .getByRole('radiogroup', { name: '主題', exact: true })
        .getByRole('radio', { name: theme, exact: true })
        .click()
      await page
        .getByRole('radiogroup', { name: '視窗材質', exact: true })
        .getByRole('radio', { name: material, exact: true })
        .click()
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await page.waitForTimeout(500)
    }
    // Sidebar and page, each on the red half and the blue half of the window behind.
    const points: [number, number][] = [
      [120, 520],
      [420, 600],
      [900, 600],
    ]
    for (const theme of ['淺色', '深色']) {
      for (const material of ['透明磨砂', '不透明']) {
        await appearance(theme, material)
        const [sidebar, left, right] = await pixels(
          app,
          await capture(`${theme}-${material}`),
          points,
        )
        proof[`${theme}-${material}`] = { sidebar, left, right }
        const tint = (rgb: number[]) => rgb[0]! - rgb[2]!
        if (material === '透明磨砂') {
          // 1: what lies behind the window shows through the sidebar and the page.
          expect(tint(sidebar!), `${theme} sidebar over red`).toBeGreaterThan(8)
          expect(tint(left!) - tint(right!), `${theme} page over red and blue`).toBeGreaterThan(20)
        } else {
          // 5: asked to be opaque, nothing behind the window shows.
          expect(Math.abs(tint(left!) - tint(right!)), `${theme} opaque`).toBeLessThan(4)
        }
      }
    }
    await appearance('深色', '透明磨砂')
    // 12–14: the Yuki menu is glass in its own right. Stripes laid on the sidebar beneath it are
    // blurred away, it looks the same as it opens as once it has settled, and opening it never
    // holds the page up.
    await page.evaluate(() => {
      const navigation = document.querySelector<HTMLElement>('nav[aria-label="主要導覽"]')!
      navigation.style.background = 'repeating-linear-gradient(90deg, #000 0 3px, #fff 3px 6px)'
      const state = window as unknown as { long: number[] }
      state.long = []
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.long.push(entry.duration)
      }).observe({ type: 'longtask' })
    })
    await page.getByRole('button', { name: '切換 Yuki', exact: true }).click()
    const menu = page.getByRole('menu', { name: 'Yuki', exact: true })
    await expect(menu).toBeVisible()
    await page.waitForTimeout(120)
    const opening = await capture('menu-opening')
    await page.waitForTimeout(900)
    const settled = await capture('menu-settled')
    const box = (await menu.boundingBox())!
    // Along the menu's right side, clear of its own text.
    const row: [number, number][] = Array.from({ length: 24 }, (_, index) => [
      Math.round(box.x + box.width - 40 + index),
      Math.round(box.y + box.height / 2),
    ])
    const luma = (rgb: number[]) => 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!
    const early = (await pixels(app, opening, row)).map(luma),
      late = (await pixels(app, settled, row)).map(luma)
    const long = await page.evaluate(() => (window as unknown as { long: number[] }).long)
    proof.menu = { early, late, long, shots }
    expect(Math.max(...late) - Math.min(...late)).toBeLessThan(12)
    expect(Math.max(...early.map((value, index) => Math.abs(value - late[index]!)))).toBeLessThan(
      12,
    )
    expect(long.filter((duration) => duration > 50)).toEqual([])
  } finally {
    await writeFile(test.info().outputPath('native-frost.json'), JSON.stringify(proof, null, 2))
    await app.close()
  }
})

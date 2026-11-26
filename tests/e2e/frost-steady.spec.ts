import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { picture } from '../fixtures/pictures'
import { contentSize } from '../fixtures/visual'

/*
 * Switching a tab or a page never shows the picture bare where frost lies before and after: no
 * frame flashes the sharp picture through the content's frost. Every frame the compositor draws
 * across the switch is captured (CDP screencast), at 1x and 2x, for Settings' categories, About's
 * tabs and the sidebar's pages, each already shown once (a first load is not a switch). Fails when, in any frame, more than 15% of the pixels that frost or
 * content covers both before and after the switch (each differs from the bare picture there by
 * more than 8 levels) are the bare picture's (within 6 levels).
 */
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('frost-steady.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

async function frames(cdp: CDPSession, act: () => Promise<unknown>) {
  const shown: string[] = []
  const listener = (frame: { data: string; sessionId: number }) => {
    shown.push(frame.data)
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId })
  }
  cdp.on('Page.screencastFrame', listener)
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
  await new Promise((resolve) => setTimeout(resolve, 400))
  await act()
  await new Promise((resolve) => setTimeout(resolve, 900))
  await cdp.send('Page.stopScreencast')
  cdp.off('Page.screencastFrame', listener)
  return shown
}

/** The worst frame's share of what was covered before and after that shows the bare picture. */
function worst(page: Page, captured: string[], bare: string) {
  return page.evaluate(
    async ({ captured, bare }) => {
      const read = async (data: string) => {
        const image = await createImageBitmap(
          new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: 'image/png' }),
        )
        // Every frame at the window's own CSS pixels (a screencast may scale its frames).
        const context = new OffscreenCanvas(innerWidth, innerHeight).getContext('2d')!
        context.drawImage(image, 0, 0, innerWidth, innerHeight)
        return context.getImageData(0, 0, innerWidth, innerHeight).data
      }
      const picture = await read(bare)
      const all = await Promise.all(captured.map(read))
      const [before, after] = [all[0]!, all.at(-1)!]
      const luma = (data: Uint8ClampedArray, k: number) =>
        0.2126 * data[k]! + 0.7152 * data[k + 1]! + 0.0722 * data[k + 2]!
      const covered: number[] = []
      for (let k = 0; k < picture.length; k += 16)
        if (
          Math.abs(luma(before, k) - luma(picture, k)) > 8 &&
          Math.abs(luma(after, k) - luma(picture, k)) > 8
        )
          covered.push(k)
      let most = 0,
        at = 0
      for (const [index, frame] of all.entries()) {
        let bareCount = 0
        for (const k of covered) if (Math.abs(luma(frame, k) - luma(picture, k)) <= 6) bareCount++
        const share = covered.length ? bareCount / covered.length : 0
        if (share > most) {
          most = share
          at = index
        }
      }
      return {
        frames: all.length,
        covered: covered.length,
        worst: Math.round(most * 1000) / 1000,
        at,
      }
    },
    { captured, bare },
  )
}

for (const scale of [1, 2] as const)
  test(`at ${scale}x no tab or page switch flashes the picture through the frost`, async () => {
    test.setTimeout(400000)
    await mkdir(test.info().outputPath(), { recursive: true })
    const rig = await yukiFixture({ character: true }),
      app = await rig.launch(`frost-steady-${scale}`, [`--force-device-scale-factor=${scale}`])
    let success = false
    try {
      const page = await app.firstWindow()
      await contentSize(app, page, 1100, 760)
      await pairUI(page, rig.base, await rig.code())
      for (let i = 0; i < 3; i++) await fetch(`${rig.base}/__test/work`, { method: 'POST' })
      const path = test.info().outputPath('berries.png')
      await writeFile(path, await picture(page, 'berries'))
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
      }, path)
      await page.keyboard.press('ControlOrMeta+,')
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page.getByRole('button', { name: '加入圖片…', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'custom')
      await page.waitForTimeout(1500)
      const cdp = await page.context().newCDPSession(page)
      // The bare picture: everything but what draws the window's backdrop hidden.
      const bare = async () => {
        await page.evaluate(() => {
          for (const node of document.querySelectorAll<HTMLElement>('#root *'))
            if (getComputedStyle(node).backgroundImage.includes('__backgrounds/'))
              node.dataset.backdropLayer = ''
        })
        const style = await page.addStyleTag({
          content:
            '#root * { visibility: hidden !important } #root [data-backdrop-layer] { visibility: visible !important }',
        })
        const [shot] = await frames(cdp, () => page.waitForTimeout(100))
        await style.evaluate((node) => (node as HTMLElement).remove())
        await page.waitForTimeout(300)
        return shot!
      }
      const picture0 = await bare()
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await page.waitForTimeout(500)
      const switches: [string, () => Promise<unknown>][] = [
        ['settings', () => page.keyboard.press('ControlOrMeta+,')],
        ['settings 一般', () => page.getByRole('tab', { name: '一般', exact: true }).click()],
        ['settings 通知', () => page.getByRole('tab', { name: '通知', exact: true }).click()],
        ['settings 外觀', () => page.getByRole('tab', { name: '外觀', exact: true }).click()],
        ['back to chat', () => page.getByRole('button', { name: '返回', exact: true }).click()],
        [
          'works',
          () => page.locator('[data-region="sidebar"]').getByText('工作', { exact: true }).click(),
        ],
        // (Not Files: it reads its preview afresh on every visit, as media-content.ts releases a
        // preview's native resources on leaving: a load, not a switch.)
        ['about', () => page.locator('[data-region="sidebar"]').getByText(/^關於/).first().click()],
        ['about 她自己', () => page.getByRole('tab', { name: '她自己', exact: true }).click()],
        ['about 安排', () => page.getByRole('tab', { name: '安排', exact: true }).click()],
      ]
      const found: Record<string, unknown> = {}
      evidence[`${scale}x`] = found
      // Every page and tab once first, so that what is measured is the switch, not a first load.
      for (const [, act] of switches) {
        await act()
        await page.waitForTimeout(900)
      }
      for (const [name, act] of switches) {
        const shown = await frames(cdp, act)
        const result = await worst(page, shown, picture0)
        // The worst frame, kept as the switch's evidence.
        await writeFile(
          test.info().outputPath(`${name}-worst.png`),
          Buffer.from(shown[result.at]!, 'base64'),
        )
        found[name] = result
        expect
          .soft(result.worst, `${scale}x ${name}: frames flash the bare picture`)
          .toBeLessThanOrEqual(0.15)
      }
      success = true
    } finally {
      await app.close()
      await rig.close(success)
    }
  })

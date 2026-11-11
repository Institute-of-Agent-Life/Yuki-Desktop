/** README images and the tour video. Run only on request:
 *  PROMO_OUT=<dir> npx playwright test tests/e2e/readme-showcase.spec.ts
 *  then python3 build-tools/readme-media.py <dir> docs/images/showcase */
import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = process.env.PROMO_OUT!
interface Showcase {
  regression: {
    connection(state: 'online'): void
    confirmGlassSend(): void
    receiveGlassReply(text: string): void
  }
}
test.use({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
})

test('tour', async ({ page }) => {
  test.skip(!out, 'Set PROMO_OUT to regenerate the README images')
  const pause = (ms: number) => page.waitForTimeout(ms)
  mkdirSync(join(out, 'frames'), { recursive: true })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=showcase')
  await pause(1200)
  await page.evaluate(() => (window as unknown as Showcase).regression.connection('online'))
  await pause(900)
  await page.screenshot({ path: join(out, 'conversation-light.png') })
  let frame = 0
  let capturing = true
  const marks: Record<string, number> = {}
  const times: number[] = []
  const capture = (async () => {
    while (capturing) {
      const image = await page.screenshot({ scale: 'css' })
      times.push(Date.now())
      writeFileSync(join(out, 'frames', `${String(frame++).padStart(4, '0')}.png`), image)
    }
  })()
  await pause(1200)
  marks.sendStart = frame
  await page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true }).click()
  await page.keyboard.type('今晚幫我把這週的訪談整理成一頁摘要好嗎？', { delay: 65 })
  await pause(350)
  await page.getByRole('button', { name: '送出', exact: true }).click()
  await pause(450)
  await page.evaluate(() => (window as unknown as Showcase).regression.confirmGlassSend())
  await pause(1400)
  await page.evaluate(() =>
    (window as unknown as Showcase).regression.receiveGlassReply(
      '好，我整理好了：三個主題、五個要追問的問題，原始訪談的來源都標在每段下面。',
    ),
  )
  await pause(2000)
  marks.sendEnd = frame
  await page.screenshot({ path: join(out, 'conversation-after.png') })
  await page.getByText('查看詳情').first().click()
  await pause(1100)
  await page.screenshot({ path: join(out, 'work-detail.png') })
  await page.keyboard.press('Escape')
  await pause(500)
  await page.getByRole('button', { name: '工作', exact: true }).first().click()
  await pause(1100)
  await page.screenshot({ path: join(out, 'works.png') })
  await page.getByRole('button', { name: '桌面對話', exact: true }).first().click()
  await pause(800)
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  await pause(900)
  await page.screenshot({ path: join(out, 'conversation-dark.png') })
  await pause(2500)
  capturing = false
  await capture
  writeFileSync(join(out, 'frames.json'), JSON.stringify({ marks, times }))
})

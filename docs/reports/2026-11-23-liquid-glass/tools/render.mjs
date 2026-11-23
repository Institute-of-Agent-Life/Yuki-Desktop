// Renders the lab's disc over the stand-in backgrounds, as Apple's HIG discs are drawn.
import { chromium } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'
const [out, looks = 'current,pane,slab,v3', paramFile] = process.argv.slice(2)
const presets = paramFile ? JSON.parse(readFileSync(paramFile, 'utf8')) : {}
const S = process.env.LAB_DIR
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 233, height: 233 }, deviceScaleFactor: 2 })
await page.route((url) => url.pathname.startsWith('/__ref/'), (route) =>
  route.fulfill({ body: readFileSync(`${S}/liquid-glass/v3/backgrounds/${new URL(route.request().url()).pathname.split('/').pop()}`), contentType: 'image/png' }))
for (const look of looks.split(','))
  for (const [image, theme, preset] of [['over-light', 'light', 'light'], ['over-dark', 'dark', 'dark'], ['clear', 'light', 'clear']]) {
    const params = JSON.stringify(presets[preset] ?? {})
    await page.goto(`http://127.0.0.1:4178/liquid-glass-lab.html?page=disc&look=${look}&theme=${theme}&img=/__ref/${image}.png&p=${encodeURIComponent(params)}`)
    await page.waitForSelector('html[data-lab-ready]', { state: 'attached' })
    await page.mouse.move(-10, -10)
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${out}/${look}-${image}.png` })
  }
await browser.close()

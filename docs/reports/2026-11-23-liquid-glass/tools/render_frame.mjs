// Our glass over a rebuilt WWDC frame background, at the frame's own geometry (1x, 1920x1080).
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
const [background, out, geometry, params = '{}', look = 'v3'] = process.argv.slice(2)
const S = process.env.LAB_DIR
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
await page.route((url) => url.pathname.startsWith('/__ref/'), (route) =>
  route.fulfill({ body: readFileSync(`${S}/liquid-glass/v3/backgrounds/${new URL(route.request().url()).pathname.split('/').pop()}`), contentType: 'image/png' }))
await page.goto(`http://127.0.0.1:4178/liquid-glass-lab.html?page=disc&look=${look}&img=/__ref/${background}&${geometry}&p=${encodeURIComponent(params)}`)
await page.waitForSelector('html[data-lab-ready]', { state: 'attached' })
await page.mouse.move(-10, -10)
await page.waitForTimeout(1200)
await page.screenshot({ path: out })
await browser.close()

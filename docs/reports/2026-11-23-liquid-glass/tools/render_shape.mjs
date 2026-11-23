// One glass shape over a background at a phone's 3x: ?x,y,w,h,r in CSS px; viewport w x h.
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
const [background, out, vw, vh, geometry, params = '{}', look = 'v4', theme = 'light'] = process.argv.slice(2)
const S = process.env.LAB_DIR
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: +vw, height: +vh }, deviceScaleFactor: 3 })
page.on('pageerror', (e) => console.log('pageerror', e.message))
await page.route((url) => url.pathname.startsWith('/__ref/'), (route) =>
  route.fulfill({ body: readFileSync(`${S}/liquid-glass/v3/backgrounds/${new URL(route.request().url()).pathname.split('/').pop()}`), contentType: 'image/png' }))
await page.goto(`http://127.0.0.1:4178/liquid-glass-lab.html?page=disc&look=${look}&theme=${theme}&img=/__ref/${background}&${geometry}&p=${encodeURIComponent(params)}`)
await page.waitForSelector('html[data-lab-ready]', { state: 'attached' })
await page.mouse.move(-10, -10)
await page.waitForTimeout(900)
await page.screenshot({ path: out })
await browser.close()

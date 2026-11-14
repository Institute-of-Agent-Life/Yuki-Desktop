import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'

// The SSH entry, "Deploy to my server" and the connection-method dialog are the same welcome
// card, form fields, settings rows and dialog as deploying on this computer. Screenshots in light
// and dark, frosted and opaque, each beside the local deployment card for comparison.
const looks = [
  { theme: 'light', opaque: false },
  { theme: 'dark', opaque: false },
  { theme: 'light', opaque: true },
  { theme: 'dark', opaque: true },
] as const

async function look(page: Page, value: (typeof looks)[number]) {
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('tab', { name: '外觀', exact: true }).click()
  await page
    .getByRole('radio', { name: value.theme === 'dark' ? '深色' : '淺色', exact: true })
    .click()
  await page
    .getByRole('radiogroup', { name: '視窗材質', exact: true })
    .getByRole('radio', { name: value.opaque ? '不透明' : '透明磨砂', exact: true })
    .click()
  await expect(page.locator('html')).toHaveAttribute('data-opaque', String(value.opaque))
  await page.getByRole('button', { name: '返回', exact: true }).click()
  // Material and theme transitions settle before the picture.
  await page.waitForTimeout(600)
}

// One look per test, each within its own deadline on the slowest runner.
for (const value of looks) {
  const key = `${value.theme}-${value.opaque ? 'opaque' : 'frosted'}`
  test(`SSH and server deployment screens use the existing glass card, rows and dialog (${key})`, async ({
    browser,
  }) => {
    test.setTimeout(180000)
    const rig = await yukiFixture()
    // The local deployment card shows its "Docker unavailable" state; nothing touches a real Docker.
    const docker = process.env.DOCKER_HOST
    process.env.DOCKER_HOST = 'unix:///nonexistent/yuki-look.sock'
    const app = await rig.launch(`look-${key}`)
    if (docker === undefined) delete process.env.DOCKER_HOST
    else process.env.DOCKER_HOST = docker
    let success = false
    const shots: Record<string, string> = {}
    const shot = async (page: Page, name: string) => {
      const path = test.info().outputPath(`${key}-${name}.png`)
      await page.screenshot({ path })
      shots[name] = path
    }
    try {
      const page = await app.firstWindow()
      await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toBeVisible()
      await look(page, value)
      await page.getByRole('button', { name: '在本機部署 Yuki', exact: true }).click()
      await expect(page.getByRole('heading', { name: '在本機部署 Yuki' })).toBeVisible()
      await shot(page, '1-local')
      await page.getByRole('button', { name: '返回／稍後設定', exact: true }).click()
      await page.getByRole('button', { name: '部署到我的伺服器', exact: true }).click()
      await expect(page.getByRole('heading', { name: '部署到我的伺服器' })).toBeVisible()
      await shot(page, '2-server')
      await page.getByRole('button', { name: '返回／稍後設定', exact: true }).click()
      await page.getByRole('button', { name: '連接已有 Yuki', exact: true }).click()
      await page.getByRole('button', { name: '通過 SSH 連接', exact: true }).click()
      await expect(page.getByRole('heading', { name: '通過 SSH 連接' })).toBeVisible()
      await shot(page, '3-ssh')
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await pairUI(page, rig.base, await rig.code())
      await page.keyboard.press('ControlOrMeta+,')
      await page.getByRole('tab', { name: '連線', exact: true }).click()
      const row = page.getByRole('button', { name: '更改…', exact: true })
      await row.scrollIntoViewIfNeeded()
      await shot(page, '4-settings')
      await row.click()
      const dialog = page.getByRole('dialog', { name: '更改連線方式', exact: true })
      await dialog.getByRole('radio', { name: '通過 SSH', exact: true }).click()
      await page.waitForTimeout(600)
      await shot(page, '5-dialog')
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      // One sheet: the local deployment card beside each new screen.
      const sheet = await browser.newPage({ viewport: { width: 2400, height: 900 } })
      const images = await Promise.all(
        Object.entries(shots)
          .sort()
          .map(
            async ([name, path]) =>
              `<figure><img src="data:image/png;base64,${(await readFile(path)).toString('base64')}"><figcaption>${name}</figcaption></figure>`,
          ),
      )
      await sheet.setContent(
        `<style>body{margin:0;display:flex;gap:8px;background:#888;font:14px system-ui}figure{margin:0}img{width:460px;display:block}</style>${images.join('')}`,
      )
      await sheet.screenshot({ path: test.info().outputPath(`compare-${key}.png`), fullPage: true })
      await writeFile(test.info().outputPath(`looks-${key}.json`), JSON.stringify(shots, null, 2))
      success = true
    } finally {
      await app.close()
      await rig.close(success)
    }
  })
}

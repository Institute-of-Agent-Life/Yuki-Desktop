import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resources, type Language } from '../../src/shared/locales'
import { activeCharacterName } from '../fixtures/active-character'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { contentSize } from '../fixtures/visual'

/*
 * Every main page in all three languages (task book 2026-11-13 §3.4), light and dark, opaque:
 * the conversation, works, files, each settings category, the platform list, the 連線方式 dialog,
 * deploying on this computer, deploying to a server and connecting over SSH. Failure cases,
 * written before the extraction:
 * - Text of a button, tab or segment runs past its own box (it is clipped or spills), or the
 *   control itself sticks out of its settings row, its dialog, the sidebar or the window.
 * - A page still shows Traditional Chinese in Simplified Chinese or English (an unextracted string),
 *   other than data: names, addresses, backend content.
 * The output directory keeps one screenshot per page, language and theme, and `layout.json` with
 * every overflow and every ellipsis-truncated text (for review; truncation is allowed by design
 * for names and paths, not for controls).
 */

// A step that cannot find its control fails instead of waiting out the whole run.
test.use({ actionTimeout: 15000 })

const languages: Language[] = ['zh-Hant', 'zh-Hans', 'en']
const themes = ['light', 'dark'] as const
const words = (language: Language) => resources[language]

interface Finding {
  page: string
  kind: 'overflow' | 'outside' | 'truncated'
  role: string
  text: string
  container?: string
}
const findings: Finding[] = []

/** Overflowing controls and truncated text on the current screen. */
async function measure(page: Page, name: string) {
  const found = await page.evaluate(() => {
    const result: Omit<Finding, 'page'>[] = []
    const shown = (element: Element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        !element.closest('[hidden], [inert], [aria-hidden="true"]')
      )
    }
    const label = (element: Element) =>
      (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 80)
    const controls = document.querySelectorAll(
      'button, [role="tab"], [role="radio"], [role="menuitem"], [role="menuitemradio"], summary',
    )
    for (const control of controls) {
      if (!shown(control)) continue
      const role = control.getAttribute('role') ?? control.tagName.toLowerCase()
      if (control.scrollWidth > control.clientWidth + 1)
        result.push({ kind: 'overflow', role, text: label(control) })
      const box = control.getBoundingClientRect()
      const container = control.closest('[data-settings-row], dialog, nav, [role="tablist"]')
      const bounds = container?.getBoundingClientRect() ?? {
        left: 0,
        top: 0,
        right: innerWidth,
        bottom: innerHeight,
      }
      if (
        box.left < bounds.left - 1 ||
        box.right > bounds.right + 1 ||
        // A dialog's body scrolls; only its rows bound a control vertically.
        (container &&
          container.tagName !== 'DIALOG' &&
          (box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1))
      )
        result.push({
          kind: 'outside',
          role,
          text: label(control),
          container: container?.tagName.toLowerCase() ?? 'window',
        })
    }
    for (const element of document.querySelectorAll('body *')) {
      if (!shown(element) || element.children.length > 0) continue
      const style = getComputedStyle(element)
      if (style.textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth + 1)
        result.push({
          kind: 'truncated',
          role: element.tagName.toLowerCase(),
          text: label(element),
        })
    }
    return result
  })
  findings.push(...found.map((item) => ({ ...item, page: name })))
}

/**
 * Visible text that is not in this language: in English any Han text, in Simplified Chinese
 * characters only Traditional Chinese writes this way. Messages, names and addresses are data and
 * are left out (message bubbles, the Yuki's own name, file names).
 */
async function untranslated(page: Page, language: Language, name: string) {
  return page.evaluate(
    ({ language, name }) => {
      const traditional =
        /[設視檔線們這個與點開關閉選擇對話編輯記憶裝訊號頁認證請確讀寫雲腦電鍵範處應]/
      const han = /[\u4e00-\u9fff]/
      const found = new Set<string>()
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent!.replaceAll(name, '').trim()
        const parent = node.parentElement!
        if (!text || parent.closest('article, [hidden], [inert], code, pre, time')) continue
        if (!parent.getClientRects().length) continue
        if (language === 'en' ? han.test(text) : traditional.test(text))
          found.add(text.slice(0, 80))
      }
      return [...found]
    },
    { language, name },
  )
}

async function command(page: Page, detail: string) {
  await page.evaluate(
    (detail) => window.dispatchEvent(new CustomEvent('yuki:command', { detail })),
    detail,
  )
  // Views and panels slide in; screenshots wait for rest.
  await page.waitForTimeout(700)
}

async function shot(app: ElectronApplication, page: Page, directory: string, name: string) {
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(directory, `${name}.png`) })
  await measure(page, name)
  void app
}

test('every main page in three languages, light and dark, keeps its controls inside their rows, dialogs and sidebar', async () => {
  test.setTimeout(20 * 60 * 1000)
  const rig = await yukiFixture({ modelConfiguration: true })
  await mkdir(join(rig.root, 'webui-config'), { recursive: true })
  // The local deployment page shows its "Docker unavailable" state; no real Docker is touched.
  const docker = process.env.DOCKER_HOST
  process.env.DOCKER_HOST = 'unix:///nonexistent/yuki-language-layout.sock'
  const app = await rig.launch('language-layout')
  if (docker === undefined) delete process.env.DOCKER_HOST
  else process.env.DOCKER_HOST = docker
  let success = false
  const leftovers: Record<string, string[]> = {}
  try {
    let page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await contentSize(app, page, 1280, 820)
    // A conversation with a reply and a work item waiting for an answer.
    const name = await activeCharacterName(page)
    const composer = page.getByRole('textbox', {
      name: `和 ${name} 說點什麼`,
      exact: true,
    })
    await fetch(`${rig.base}/__test/work-scenario`, { method: 'POST' })
    await composer.fill('語言與排版檢查')
    await composer.press('Enter')
    await expect(page.getByText('Desktop reference reply', { exact: true }).first()).toBeVisible()

    for (const theme of themes)
      for (const language of languages) {
        const key = `${language}-${theme}`
        const directory = test.info().outputPath(key)
        await mkdir(directory, { recursive: true })
        const w = words(language)
        // Theme and material are read at start; the window reloads into them.
        await page.evaluate(
          ({ language, theme }) => window.yuki.preferences({ language, theme, opaque: true }),
          { language, theme },
        )
        await page.reload()
        await expect(page.locator('[data-character-session] [data-region="toolbar"]')).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('lang', language)
        await expect(page.locator('html')).toHaveAttribute('data-opaque', 'true')

        await command(page, 'chat')
        await shot(app, page, directory, '01-conversation')
        if (language !== 'zh-Hant')
          leftovers[`${key}/conversation`] = await untranslated(page, language, name)
        await command(page, 'works')
        await shot(app, page, directory, '02-works')
        if (language !== 'zh-Hant')
          leftovers[`${key}/works`] = await untranslated(page, language, name)
        await command(page, 'files')
        await shot(app, page, directory, '03-files')
        if (language !== 'zh-Hant')
          leftovers[`${key}/files`] = await untranslated(page, language, name)

        await command(page, 'settings')
        const tabs = page.getByRole('tablist', { name: w.settings.categories, exact: true })
        const names = Object.entries(w.settings.category)
        for (const [index, [id, title]] of names.entries()) {
          await tabs.getByRole('tab', { name: title, exact: true }).click()
          await page.waitForTimeout(300)
          await shot(app, page, directory, `04-settings-${String(index).padStart(2, '0')}-${id}`)
          if (language !== 'zh-Hant')
            leftovers[`${key}/settings-${id}`] = await untranslated(page, language, name)
          if (id === 'connection') {
            await page
              .locator('[data-settings-row]')
              .filter({ hasText: w.ssh.transport })
              .getByRole('button', { name: w.ssh.change, exact: true })
              .click()
            const dialog = page.getByRole('dialog', { name: w.ssh.changeTransportTitle })
            await expect(dialog).toBeVisible()
            await shot(app, page, directory, '05-transport-direct')
            await dialog.getByRole('radio', { name: w.ssh.overSsh, exact: true }).click()
            await shot(app, page, directory, '05-transport-ssh')
            if (language !== 'zh-Hant')
              leftovers[`${key}/transport`] = await untranslated(page, language, name)
            await page.keyboard.press('Escape')
            await expect(dialog).toBeHidden()
          }
        }

        // The three ways to add a Yuki, each its own screen.
        for (const [index, button, name] of [
          [0, w.settings.deployManage, '06-deploy-local'],
          [1, w.remoteDeploy.deploy, '07-deploy-server'],
          [2, w.settings.connect, '08-connect-ssh'],
        ] as const) {
          await command(page, 'settings')
          await tabs.getByRole('tab', { name: w.settings.category.yukis, exact: true }).click()
          await page.getByRole('button', { name: button, exact: true }).click()
          if (index === 2) await page.getByRole('button', { name: w.ssh.connectOverSsh }).click()
          await page.waitForTimeout(800)
          await shot(app, page, directory, name)
          if (language !== 'zh-Hant')
            leftovers[`${key}/${name}`] = await untranslated(page, language, name)
          // Back to the workspace: the window reloads into the paired Yuki.
          await page.reload()
          page = await app.firstWindow()
          await expect(
            page.locator('[data-character-session] [data-region="toolbar"]'),
          ).toBeVisible()
        }
      }

    await writeFile(
      test.info().outputPath('layout.json'),
      JSON.stringify({ findings, leftovers }, null, 2),
    )
    expect(findings.filter((item) => item.kind !== 'truncated')).toEqual([])
    // What is left is data: the Yuki's avatar initial and the reference work's own goal.
    const data = [name.slice(0, 1), '原工作整合測試']
    expect(
      Object.entries(leftovers).filter(([, texts]) => texts.some((text) => !data.includes(text))),
    ).toEqual([])
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

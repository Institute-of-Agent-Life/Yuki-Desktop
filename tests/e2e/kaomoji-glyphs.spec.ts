import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { activeCharacterName } from '../fixtures/active-character'
import { pairUI, yukiFixture } from '../fixtures/backend'

/*
 * Kaomoji glyphs (task book 2026-11-13 §3.7), failure case written before the code:
 * 33 At any weight (400, 600, 700), `( ｰ̀֊ｰ́ )✧` or `ヽ(✿ﾟ▽ﾟ)ノ` is drawn with a fallback font
 *    that paints boxes (`.CJK Symbols Fallback …`, LastResort), in a message bubble or in the
 *    composer; or Latin letters and Han characters change font because of the added families.
 * The screenshots at the three weights are the artifact.
 */

const kaomoji = ['( ｰ̀֊ｰ́ )✧', 'ヽ(✿ﾟ▽ﾟ)ノ', '✦✩❀', '｡･ω･'] as const
const latin = 'Yuki keeps working'
const han = '雪在這裡陪你'
const samples = [...kaomoji, latin, han]
const weights = [400, 600, 700] as const
// Fonts that only exist to paint a box for a glyph nothing else has.
const boxes = /Fallback|LastResort/i
// The families added for these glyphs; text either side of them must not reach them.
const added = /Hiragino|ZapfDingbats|Zapf Dingbats|AppleSymbols|Apple Symbols/i

type Used = { familyName: string; postScriptName: string; glyphCount: number }[]

async function fonts(cdp: CDPSession, selector: string): Promise<Used> {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
  // A text field draws its text in its user-agent shadow tree (editor and placeholder).
  const { node } = await cdp.send('DOM.describeNode', { nodeId, depth: -1, pierce: true })
  const shadow = node.shadowRoots?.[0]?.children ?? []
  const nodeIds = shadow.length
    ? (
        await cdp.send('DOM.pushNodesByBackendIdsToFrontend', {
          backendNodeIds: shadow.map((child) => child.backendNodeId),
        })
      ).nodeIds
    : [nodeId]
  const used: Used = []
  for (const id of nodeIds)
    for (const { familyName, postScriptName, glyphCount } of (
      await cdp.send('CSS.getPlatformFontsForNode', { nodeId: id })
    ).fonts)
      used.push({ familyName, postScriptName: postScriptName ?? '', glyphCount })
  return used
}

async function weigh(page: Page, weight: number) {
  await page.evaluate((weight) => {
    for (const element of document.querySelectorAll<HTMLElement>(
      '[data-glyph-sample], [data-region="composer"] textarea',
    ))
      element.style.fontWeight = String(weight)
  }, weight)
}

test('kaomoji keep their glyphs at every weight while Latin and Han keep their fonts', async () => {
  test.setTimeout(150000)
  const rig = await yukiFixture()
  const app = await rig.launch('kaomoji-glyphs')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const name = await activeCharacterName(page)
    const platform = await page.evaluate(async () => (await window.yuki.boot()).platform)
    const composer = page.getByRole('textbox', { name: `和 ${name} 說點什麼`, exact: true })
    for (const sample of samples) {
      await composer.fill(sample)
      await composer.press('Enter')
      await expect(
        page.locator('article[aria-label="你的訊息"]').getByText(sample, { exact: true }),
      ).toBeVisible()
    }
    // Each sample's own text node, in its bubble.
    await page.evaluate((samples) => {
      const own = [...document.querySelectorAll('article[aria-label="你的訊息"]')]
      samples.forEach((sample, index) => {
        for (const article of own) {
          const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT)
          for (let node = walker.nextNode(); node; node = walker.nextNode())
            if (node.textContent === sample)
              node.parentElement!.setAttribute('data-glyph-sample', String(index))
        }
      })
    }, samples)
    const cdp = await app.context().newCDPSession(page)
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const report: Record<string, unknown> = { platform }
    for (const weight of weights) {
      await weigh(page, weight)
      const bubbles: Record<string, Used> = {}
      for (const [index, sample] of samples.entries())
        bubbles[sample] = await fonts(cdp, `[data-glyph-sample="${index}"]`)
      const typed: Record<string, Used> = {}
      for (const sample of samples) {
        await composer.fill(sample)
        typed[sample] = await fonts(cdp, '[data-region="composer"] textarea')
      }
      report[weight] = { bubbles, composer: typed }
      await composer.fill(kaomoji.join(' '))
      // The kaomoji bubbles and the composer in one picture.
      await page
        .locator('[data-glyph-sample="0"]')
        .evaluate((element) => element.scrollIntoView({ block: 'start' }))
      await page.screenshot({ path: test.info().outputPath(`kaomoji-${weight}.png`) })
      await writeFile(test.info().outputPath('kaomoji-fonts.json'), JSON.stringify(report, null, 2))
      for (const used of [...Object.values(bubbles), ...Object.values(typed)])
        expect(used.filter((font) => boxes.test(font.familyName + font.postScriptName))).toEqual([])
      for (const used of [bubbles[latin]!, typed[latin]!, bubbles[han]!, typed[han]!])
        expect(used.filter((font) => added.test(font.familyName + font.postScriptName))).toEqual([])
      if (platform === 'darwin')
        for (const [used, family] of [
          [bubbles[latin]!, /^\.?SFNS/],
          [typed[latin]!, /^\.?SFNS/],
          [bubbles[han]!, /^PingFangTC-/],
          [typed[han]!, /^PingFangTC-/],
        ] as const)
          expect(used.map((font) => font.postScriptName)).toEqual([expect.stringMatching(family)])
    }
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

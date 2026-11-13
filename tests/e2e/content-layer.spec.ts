import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'

// 液态玻璃组件统一任务书 (2026-11-12), step 6 and the further inventory of §2.1.1: every field,
// check box and disclosure in settings is drawn one way. Failure cases 5 and C1–C5.

// Every field, check box and disclosure on screen, as drawn.
const survey = (page: Page) =>
  page.evaluate(() => {
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden'
    }
    const name = (element: Element) =>
      (
        element.getAttribute('aria-label') ??
        element.closest('label')?.textContent ??
        element.textContent ??
        ''
      )
        .trim()
        .slice(0, 24)
    const fields = [
      ...document.querySelectorAll<HTMLElement>(
        'select, textarea, input:not([type]), input[type="text"], input[type="url"], input[type="password"], input[type="number"], input[type="search"], input[type="email"]',
      ),
    ]
      .filter(visible)
      .map((element) => {
        const style = getComputedStyle(element)
        return {
          name: `${element.tagName.toLowerCase()} ${name(element)}`,
          radius: style.borderTopLeftRadius,
          border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
          background: style.backgroundColor,
          clipped:
            element instanceof HTMLInputElement &&
            element.scrollWidth > element.clientWidth + 1 &&
            element.value.length < 40,
        }
      })
    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .filter(visible)
      .map((element) => ({
        name: name(element),
        drawn: getComputedStyle(element).appearance,
        radius: getComputedStyle(element).borderTopLeftRadius,
      }))
    const summaries = [...document.querySelectorAll<HTMLElement>('summary')]
      .filter(visible)
      .map((element) => ({
        name: name(element),
        marker: getComputedStyle(element).listStyleType,
        drawn: getComputedStyle(element, '::before').content,
        row: !!element.closest('[data-disclosure="row"]'),
      }))
    const overflowing = [...document.querySelectorAll<HTMLElement>('button')]
      .filter(visible)
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map(name)
    return {
      fields,
      boxes,
      summaries,
      overflowing,
      material: document.documentElement.dataset.material,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    }
  })

test('settings draw every field, check box and disclosure one way', async () => {
  test.setTimeout(240000)
  const rig = await yukiFixture({ modelConfiguration: true })
  const app = await rig.launch('content-layer')
  let success = false
  const seen: Record<string, Awaited<ReturnType<typeof survey>>> = {}
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await page.keyboard.press('ControlOrMeta+,')
    const tabs = page.getByRole('tablist', { name: '設定分類', exact: true }).getByRole('tab')
    for (const label of (await tabs.allInnerTexts()).map((text) => text.trim())) {
      if (!(await tabs.first().isVisible())) await page.keyboard.press('ControlOrMeta+,')
      await tabs.filter({ hasText: label }).first().click()
      await page.waitForTimeout(400)
      // Every disclosure open, so what it holds is surveyed too.
      for (const summary of await page.locator('#settings-panel summary').all())
        if (!(await summary.evaluate((element) => element.closest('details')!.open)))
          await summary.click()
      seen[label] = await survey(page)
      if (label === '模型')
        for (const sub of ['用途', '用量', '連接']) {
          await page.locator('#settings-panel').getByRole('tab', { name: sub, exact: true }).click()
          await page.waitForTimeout(400)
          seen[`模型 ${sub}`] = await survey(page)
        }
    }
    // The dialog that adds a model connection, with its long provider names.
    await tabs.filter({ hasText: '模型' }).first().click()
    await page.locator('#settings-panel').getByRole('tab', { name: '連接', exact: true }).click()
    await page.getByRole('button', { name: '新增連接', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(400)
    seen['新增連接'] = await survey(page)
    await page.screenshot({ path: test.info().outputPath('add-connection.png') })
    await page.keyboard.press('Escape')
    // C5: adding a connection is a settings row with a title, not a card holding a lone button.
    const add = page.getByRole('button', { name: '新增連接', exact: true })
    expect(
      await add.evaluate(
        (button) => button.closest('[data-settings-row]')?.textContent?.trim().length ?? 0,
      ),
    ).toBeGreaterThan('新增連接'.length)

    const all = Object.entries(seen)
    const fields = all.flatMap(([where, page]) => page.fields.map((field) => ({ where, ...field })))
    const looks = new Set(
      fields.map(({ radius, border, background }) => `${radius} | ${border} | ${background}`),
    )
    // C1 and 5: one look for every field, see-through over the window's frost; none cut short.
    expect([...looks]).toHaveLength(1)
    expect(fields.length).toBeGreaterThan(5)
    if (all[0]![1].material !== 'none') {
      const alpha = await page.evaluate((colour) => {
        const context = new OffscreenCanvas(1, 1).getContext('2d')!
        context.fillStyle = colour
        context.fillRect(0, 0, 1, 1)
        return context.getImageData(0, 0, 1, 1).data[3]! / 255
      }, fields[0]!.background)
      expect(alpha).toBeLessThan(0.9)
    }
    expect(fields.filter((field) => field.clipped)).toEqual([])
    // C2: check boxes are drawn by the app, one way, never the browser's own square.
    const boxes = all.flatMap(([, page]) => page.boxes)
    expect(boxes.length).toBeGreaterThan(0)
    expect(new Set(boxes.map((box) => `${box.drawn} | ${box.radius}`))).toEqual(
      new Set(['none | 5px']),
    )
    // C3: every disclosure is opened by the same drawn arrow, never the browser's own marker.
    const summaries = all.flatMap(([, page]) => page.summaries).filter((summary) => !summary.row)
    expect(summaries.length).toBeGreaterThan(2)
    expect(new Set(summaries.map((summary) => `${summary.marker} | ${summary.drawn}`)).size).toBe(1)
    expect(summaries[0]!.marker).toBe('none')
    // C4: no button's words run past its edge.
    expect(
      all.flatMap(([where, page]) => page.overflowing.map((name) => `${where}: ${name}`)),
    ).toEqual([])
    success = true
  } finally {
    await writeFile(
      test.info().outputPath('content-layer.json'),
      JSON.stringify(seen, null, 2) + '\n',
    )
    await app.close()
    await rig.close(success)
  }
})

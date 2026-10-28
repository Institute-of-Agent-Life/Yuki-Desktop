import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import {
  currentConnection,
  pairUI,
  waitForAcceptedMessage,
  waitForMainEnded,
  yukiFixture,
} from '../fixtures/backend'

test('keeps real flowchart edges and arrowheads visible across existing light and dark themes', async () => {
  test.setTimeout(90000)
  const rig = await yukiFixture(),
    app = await rig.launch('mermaid-theme')
  let success = false
  try {
    const page = await app.firstWindow()
    await page.bringToFront()
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page),
      markdownText = '```mermaid\ngraph LR\nA[Input]-->B[Output]\n```'
    await page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ }).fill(markdownText)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const accepted = await waitForAcceptedMessage(page, connection.characterId, markdownText),
      ended = await waitForMainEnded(page, connection.characterId, accepted.requestId)
    expect(ended.event_id).toBe(accepted.eventId)
    expect(ended.result_event_ids).toHaveLength(1)
    for (const eventId of ended.result_event_ids!)
      await expect(
        page
          .locator(`article[data-event-id="${eventId}"]`)
          .getByText('Desktop reference reply', { exact: true }),
      ).toBeVisible()
    const article = page.locator(`article[data-event-id="${accepted.eventId}"]`),
      block = article.locator('[data-mermaid]'),
      diagram = block.locator('svg')
    await block.scrollIntoViewIfNeeded()
    await expect(diagram).toContainText('Input')
    const facts: unknown[] = []
    for (const [theme, label] of [
      ['light', '淺色'],
      ['dark', '深色'],
      ['light', '淺色'],
      ['dark', '深色'],
      ['light', '淺色'],
      ['dark', '深色'],
    ] as const) {
      await page.keyboard.press('ControlOrMeta+,')
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page.getByRole('radio', { name: label, exact: true }).click()
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(article.getByText('已取得原回執', { exact: true })).toBeVisible()
      for (const eventId of ended.result_event_ids!) {
        const reply = page
          .locator(`article[data-event-id="${eventId}"]`)
          .getByText('Desktop reference reply', { exact: true })
        await reply.scrollIntoViewIfNeeded()
        await expect(reply).toBeInViewport()
      }
      await block.scrollIntoViewIfNeeded()
      await expect(diagram).toBeVisible()
      await expect(diagram).toContainText('Output')
      const colors = await diagram.evaluate((svg) => {
        const root = getComputedStyle(document.documentElement),
          edge = getComputedStyle(svg.querySelector('.flowchart-link')!).stroke,
          arrow = getComputedStyle(svg.querySelector('.arrowMarkerPath')!).fill,
          label = getComputedStyle(svg.querySelector('.node text')!).fill,
          nodeBackground = getComputedStyle(svg.querySelector('.node rect')!).fill,
          background = root.getPropertyValue('--bg-content').trim()
        const rgb = (value: string) =>
          value.startsWith('#')
            ? value
                .slice(1)
                .match(/../g)!
                .map((part) => parseInt(part, 16))
            : value
                .match(/[\d.]+/g)!
                .slice(0, 3)
                .map(Number)
        const luminance = (color: string) =>
          rgb(color)
            .map((channel) => {
              const value = channel / 255
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
            })
            .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0)
        const contrast = (color: string, against = background) => {
          const a = luminance(color),
            b = luminance(against)
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        }
        return {
          edge,
          arrow,
          background,
          label,
          nodeBackground,
          labelContrast: contrast(label, nodeBackground),
          edgeContrast: contrast(edge),
          arrowContrast: contrast(arrow),
        }
      })
      expect(colors.edgeContrast).toBeGreaterThanOrEqual(3)
      expect(colors.arrowContrast).toBeGreaterThanOrEqual(3)
      expect(colors.labelContrast).toBeGreaterThanOrEqual(4.5)
      // Capture before reading SVG text geometry: getBBox itself can flush stale text layout.
      const screenshot = await diagram.screenshot({
        path: test.info().outputPath(`mermaid-${theme}.png`),
      })
      const geometry = await diagram.evaluate((svg) => {
        const bounds = svg.getBoundingClientRect()
        return {
          width: bounds.width,
          height: bounds.height,
          labels: [...svg.querySelectorAll('.node text')].map((node) => {
            const element = node as SVGGraphicsElement,
              box = element.getBBox(),
              rect = element.getBoundingClientRect()
            return {
              text: node.textContent,
              rect: {
                x: rect.x - bounds.x,
                y: rect.y - bounds.y,
                width: rect.width,
                height: rect.height,
              },
              bbox: { x: box.x, y: box.y, width: box.width, height: box.height },
            }
          }),
        }
      })
      const ink = await app.evaluate(
        ({ nativeImage }, { png, geometry }) => {
          const image = nativeImage.createFromBuffer(Buffer.from(png, 'base64'))
          const ratio = image.getSize().width / geometry.width
          return geometry.labels.map(({ text, rect }) => {
            const pixels = image
              .crop({
                x: Math.floor(rect.x * ratio),
                y: Math.floor(rect.y * ratio),
                width: Math.ceil(rect.width * ratio),
                height: Math.ceil(rect.height * ratio),
              })
              .toBitmap()
            let darkPixels = 0,
              lightPixels = 0
            for (let index = 0; index < pixels.length; index += 4)
              if (pixels[index]! < 120 && pixels[index + 1]! < 120 && pixels[index + 2]! < 120)
                darkPixels++
              else if (pixels[index]! > 220 && pixels[index + 1]! > 220 && pixels[index + 2]! > 220)
                lightPixels++
            return { text, darkPixels, lightPixels, pixelCount: pixels.length / 4 }
          })
        },
        { png: screenshot.toString('base64'), geometry },
      )
      facts.push({ theme, ...colors, geometry, ink })
      await writeFile(
        test.info().outputPath('mermaid-theme-colors.json'),
        JSON.stringify(facts, null, 2),
      )
      for (const label of ink) {
        expect(label.lightPixels).toBeGreaterThan(label.pixelCount / 2)
        expect(label.darkPixels, `${theme} ${label.text} must actually be painted`).toBeGreaterThan(
          10,
        )
      }
    }
    await writeFile(
      test.info().outputPath('mermaid-theme-colors.json'),
      JSON.stringify(facts, null, 2),
    )
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test('step rows retain a static running symbol, full accessible label and readable time with long input', async ({
  page,
}) => {
  const label = 'Browser original step ' + 'LongOriginalOperationWithoutSpaces'.repeat(12)
  const stages: unknown[] = []
  await page.goto('http://127.0.0.1:4178/components.html')
  await page.getByRole('textbox', { name: '元件文字輸入', exact: true }).fill(label)
  const region = page.getByRole('region', { name: '步驟狀態', exact: true })
  const row = region.getByText(label, { exact: true }).locator('..')
  for (const theme of ['淺色', '深色']) {
    await page.getByRole('radio', { name: theme, exact: true }).click()
    for (const [width, height] of [
      [1100, 760],
      [960, 492],
    ]) {
      await page.setViewportSize({ width: width!, height: height! })
      await region.scrollIntoViewIfNeeded()
      const metrics = await row.evaluate((row) => {
        const icon = row.querySelector('svg')!,
          label = row.querySelector('span')!,
          time = row.querySelector('time')!
        const rect = (node: Element) => {
          const r = node.getBoundingClientRect()
          return { x: r.x, right: r.right, width: r.width, height: r.height }
        }
        return {
          row: rect(row),
          icon: rect(icon),
          label: rect(label),
          time: rect(time),
          fill: getComputedStyle(icon).fill,
          stroke: getComputedStyle(icon).stroke,
          labelFont: getComputedStyle(label).fontSize,
          timeFont: getComputedStyle(time).fontSize,
          timeLine: getComputedStyle(time).lineHeight,
          labelTitle: label.getAttribute('title'),
          labelNaturalWidth: label.scrollWidth,
          animations: icon.getAnimations({ subtree: true }).length,
          overflow: row.scrollWidth > row.clientWidth,
        }
      })
      stages.push({ theme, width, height, metrics })
      await writeFile(
        test.info().outputPath('step-rows.json'),
        JSON.stringify(stages, null, 2) + '\n',
      )
      await page.screenshot({
        path: test.info().outputPath(`steps-${theme}-${width}x${height}.png`),
      })
      expect(metrics.row.height).toBe(32)
      expect(metrics.icon.width).toBe(14)
      expect(metrics.fill).toBe(metrics.stroke)
      expect(metrics.animations).toBe(0)
      expect(metrics.labelFont).toBe('13px')
      expect(metrics.timeFont).toBe('12px')
      expect(metrics.timeLine).toBe('16px')
      expect(metrics.labelTitle).toBe(label)
      expect(metrics.labelNaturalWidth).toBeGreaterThan(metrics.label.width)
      expect(metrics.label.right).toBeLessThanOrEqual(metrics.time.x - 8)
      expect(metrics.time.right).toBeLessThanOrEqual(metrics.row.right)
      expect(metrics.overflow).toBe(false)
      await expect(region.getByRole('img', { name: '執行中', exact: true })).toBeVisible()
      await expect(region.getByRole('img', { name: '已完成', exact: true })).toBeVisible()
      await expect(region.getByRole('img', { name: '結果未確認', exact: true })).toBeVisible()
    }
  }
})

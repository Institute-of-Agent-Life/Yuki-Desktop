import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { Profile } from '../../src/shared/api'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { navigate } from '../fixtures/navigation'
import { captureViewport, contentSize } from '../fixtures/visual'
import { colorBoundary } from '../fixtures/avatar-crop'
import { avatarVariants } from '../fixtures/avatar-assets'

async function profile(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const result = await window.yuki.client.read<Profile>(id, { kind: 'character' })
    if (!result.ok) throw Error(result.code)
    return result.value
  }, id)
}

test('short avatar sheet preserves crop scale, real pointer and keyboard movement, and saves through the actual API', async () => {
  test.setTimeout(90000)
  const rig = await yukiFixture({ character: true })
  const app = await rig.launch('short-avatar')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page)
    const original = await profile(page, connection.characterId)
    const inputResponse = await fetch(`${rig.base}/__test/avatar-inputs`, { method: 'POST' })
    expect(inputResponse.ok).toBe(true)
    const inputs = (await inputResponse.json()) as { rotated: string }
    await navigate(page, `關於 ${original.display_name}`)
    await page.getByRole('button', { name: '更換頭像', exact: true }).click()
    const sheet = page.getByRole('dialog', {
      name: `更換 ${original.display_name} 的頭像`,
      exact: true,
    })
    await app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
    }, inputs.rotated)
    await sheet.getByRole('button', { name: '選擇圖片…', exact: true }).click()
    const crop = sheet.getByRole('application')
    const save = sheet.getByRole('button', { name: '儲存', exact: true })
    await expect(save).toBeEnabled()
    await contentSize(app, page, 1440, 900)
    await expect(crop).toHaveCSS('width', '280px')
    const method = await contentSize(app, page, 960, 492)
    await captureViewport(app, page, test.info().outputPath('short-avatar-before-interaction.png'))
    await expect(crop).toHaveCSS('width', '220px')
    await expect(crop).toHaveCSS('height', '220px')
    const geometry = await sheet.evaluate((dialog) => {
      const crop = dialog.querySelector('[role="application"]')!.getBoundingClientRect()
      const preview = [...dialog.querySelectorAll('small')]
        .find((item) => item.textContent === '預覽')!
        .getBoundingClientRect()
      return { crop: { y: crop.y, bottom: crop.bottom }, preview: { y: preview.y } }
    })
    expect(geometry.preview.y).toBeGreaterThanOrEqual(geometry.crop.bottom)
    await expect(save).toBeInViewport({ ratio: 1 })
    await expect(sheet.getByRole('button', { name: '取消', exact: true })).toBeInViewport({
      ratio: 1,
    })
    const zoom = sheet.getByRole('slider', { name: '頭像縮放', exact: true })
    await zoom.focus()
    await zoom.press('End')
    await expect(zoom).toHaveAttribute('aria-valuenow', '400')
    await crop.scrollIntoViewIfNeeded()
    const before = await colorBoundary(crop)
    const box = (await crop.boundingBox())!
    await page.mouse.move(box.x + 110, box.y + 110)
    await page.mouse.down()
    await page.mouse.move(box.x + 132, box.y + 110)
    await page.mouse.up()
    await expect.poll(async () => (await colorBoundary(crop)) - before).toBeCloseTo(22, 0)
    const dragged = await colorBoundary(crop)
    await crop.press('Shift+ArrowLeft')
    await expect.poll(async () => dragged - (await colorBoundary(crop))).toBeCloseTo(20, 0)
    const shifted = await colorBoundary(crop)
    await crop.press('ArrowRight')
    await expect.poll(async () => (await colorBoundary(crop)) - shifted).toBeCloseTo(4, 0)
    const keyMoved = await colorBoundary(crop)
    const cropped = await crop
      .locator('canvas')
      .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
    await contentSize(app, page, 1440, 900)
    await expect(crop).toHaveCSS('width', '280px')
    expect(
      await crop.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
    ).toBe(cropped)
    await contentSize(app, page, 960, 492)
    await sheet.getByRole('button', { name: '取消', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(save).toBeFocused()
    await save.press('Enter')
    await expect(sheet).not.toBeVisible()
    const updated = await profile(page, connection.characterId)
    expect(updated.id).toBe(original.id)
    expect(updated.avatar_revision).toBe(original.avatar_revision + 1)
    expect(updated.avatar).toBeTruthy()
    const sha = updated.avatar!.sha256
    const variants = await avatarVariants(page, connection.characterId, sha)
    expect(variants.map((file) => file.size).sort()).toEqual(['1024', '128', '256', '512', '64'])
    expect(variants.find((file) => file.size === '1024')?.dimensions).toEqual([1024, 1024])
    await writeFile(
      test.info().outputPath('short-avatar-behavior.json'),
      JSON.stringify(
        {
          method,
          viewport: await page.evaluate(() => ({
            width: innerWidth,
            height: innerHeight,
            dpr: devicePixelRatio,
          })),
          geometry,
          measuredDragPixels: dragged - before,
          measuredKeyboardPixels: [dragged - shifted, keyMoved - shifted],
          avatarSha256: sha,
          variants,
        },
        null,
        2,
      ) + '\n',
    )
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

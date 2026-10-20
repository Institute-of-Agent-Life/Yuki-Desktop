import { expect, test, type Locator } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { captureViewport, contentSize } from '../fixtures/visual'

async function colorBoundary(crop: Locator) {
  return crop.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, canvas.height / 4, canvas.width, 1)
    for (let x = 0; x < canvas.width; x++) {
      if (pixels.data[x * 4]! > 200 && pixels.data[x * 4 + 2]! < 80)
        return (x / canvas.width) * canvas.getBoundingClientRect().width
    }
    throw Error('Expected the decoded EXIF image to retain its blue/red boundary')
  })
}

test('short avatar sheet preserves crop scale, real pointer and keyboard movement, and saves through the actual API', async () => {
  test.setTimeout(90000)
  const rig = await yukiFixture({ character: true })
  const app = await rig.launch('short-avatar')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const inputResponse = await fetch(`${rig.base}/__test/avatar-inputs`, { method: 'POST' })
    expect(inputResponse.ok).toBe(true)
    const inputs = (await inputResponse.json()) as { rotated: string }
    await page.getByRole('button', { name: '關於 Yuki', exact: true }).click()
    await page.getByRole('button', { name: '更換頭像', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: '更換 Yuki 的頭像', exact: true })
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
    await expect(zoom).toHaveValue('4')
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
    const connections = await page.evaluate(() => window.yuki.client.connections())
    if (!connections.ok) throw Error(connections.code)
    const id = connections.value[0]!.characterId
    const profile = await page.evaluate(
      (id) =>
        window.yuki.client.read<{ avatar_revision: number; avatar: { sha256: string } | null }>(
          id,
          { kind: 'character' },
        ),
      id,
    )
    expect(profile.ok && profile.value.avatar_revision).toBe(1)
    expect(profile.ok && profile.value.avatar).toBeTruthy()
    const filesResponse = await fetch(`${rig.base}/__test/avatar-files`)
    expect(filesResponse.ok).toBe(true)
    const files = (await filesResponse.json()) as {
      files: { sha256: string; size: string; dimensions: number[] }[]
    }
    const sha = profile.ok && profile.value.avatar!.sha256
    const variants = files.files.filter((file) => file.sha256 === sha)
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

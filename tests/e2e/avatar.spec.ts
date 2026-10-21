import { captureViewport, contentSize } from '../fixtures/visual'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { pairUI, yukiFixture } from '../fixtures/backend'
import type { Connection, Profile } from '../../src/shared/api'

const editor = (page: Page) => page.getByRole('dialog', { name: '更換 Yuki 的頭像', exact: true })
async function choose(app: ElectronApplication, page: Page, path: string) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
  }, path)
  await editor(page)
    .getByRole('button', { name: /選擇.*圖片…/ })
    .click()
  await expect(editor(page).getByRole('button', { name: '儲存', exact: true })).toBeEnabled()
}
async function profile(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const result = await window.yuki.client.read<Profile>(id, { kind: 'character' })
    if (!result.ok) throw Error(result.code)
    return result.value
  }, id)
}
test('actual avatar crop, EXIF orientation, two-device CAS, reset and cold recovery', async ({
  page: browser,
}) => {
  test.setTimeout(180000)
  const rig = await yukiFixture({ character: true })
  let a = await rig.launch('avatar-a')
  const b = await rig.launch('avatar-b')
  let success = false
  try {
    let pa = await a.firstWindow()
    const pb = await b.firstWindow(),
      errors: string[] = []
    pa.on('pageerror', (error) => errors.push(error.message))
    pb.on('pageerror', (error) => errors.push(error.message))
    await pairUI(pa, rig.base, await rig.code())
    await pairUI(pb, rig.base, await rig.code())
    const connection = (await pa.evaluate(async () => {
      const result = await window.yuki.client.connections()
      if (!result.ok) throw Error(result.code)
      return result.value[0]
    })) as Connection
    const response = await fetch(`${rig.base}/__test/avatar-inputs`, { method: 'POST' })
    expect(response.status, await response.clone().text()).toBe(200)
    const inputs = (await response.json()) as Record<
      'rotated' | 'small' | 'large' | 'downsample' | 'broken',
      string
    >
    for (const page of [pa, pb]) {
      await page.getByRole('button', { name: '關於 Yuki', exact: true }).click()
      await page.getByRole('button', { name: '更換頭像', exact: true }).click()
    }
    await choose(a, pa, inputs.rotated)
    await expect(editor(pa)).toContainText('3000×4000')
    const crop = editor(pa).getByRole('application')
    const colors = await crop.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d')!
      return [
        Array.from(context.getImageData(20, 20, 1, 1).data),
        Array.from(context.getImageData(canvas.width - 20, 20, 1, 1).data),
      ]
    })
    expect(colors[0]![2]).toBeGreaterThan(220) // EXIF rotation moves blue to top-left.
    expect(colors[1]![0]).toBeGreaterThan(220)
    const original = await crop
      .locator('canvas')
      .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
    await crop.focus()
    await pa.keyboard.press('+')
    await pa.keyboard.press('Shift+ArrowDown')
    const zoom = editor(pa).getByRole('slider', { name: '頭像縮放' })
    await expect
      .poll(async () => Number(await zoom.getAttribute('aria-valuenow')))
      .toBeCloseTo(110, 8)
    await expect(zoom).toHaveAttribute('aria-valuetext', '110%')
    const box = await crop.boundingBox()
    if (!box) throw Error('crop not visible')
    await pa.mouse.move(box.x + 140, box.y + 140)
    await pa.mouse.down()
    await pa.mouse.move(box.x + 155, box.y + 155)
    await pa.mouse.up()
    await expect
      .poll(() =>
        crop.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
      )
      .not.toBe(original)
    await choose(b, pb, inputs.small)
    await expect(editor(pb)).toContainText('仍然可以儲存')
    await pb.screenshot({
      path: test.info().outputPath('avatar-small.png'),
      animations: 'disabled',
    })
    await editor(pa).getByRole('button', { name: '儲存', exact: true }).click()
    await expect(editor(pa)).not.toBeVisible()
    const first = await profile(pa, connection.characterId)
    expect(first.avatar_revision).toBe(1)
    expect(first.avatar).not.toBeNull()
    await editor(pb).getByRole('button', { name: '儲存', exact: true }).click()
    await expect(editor(pb)).toContainText('頭像剛被另一台裝置更新')
    await expect(editor(pb).getByRole('slider', { name: '頭像縮放' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
    await editor(pb).getByRole('button', { name: '用我的', exact: true }).click()
    await expect(editor(pb)).not.toBeVisible()
    await expect
      .poll(async () => (await profile(pa, connection.characterId)).avatar_revision)
      .toBe(2)
    await expect
      .poll(() =>
        pa.locator('[data-region="sidebar"] img').evaluate((image: HTMLImageElement) => {
          if (!image.complete || !image.naturalWidth) return null
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = 1
          const context = canvas.getContext('2d')!
          context.drawImage(
            image,
            image.naturalWidth / 2,
            image.naturalHeight / 2,
            1,
            1,
            0,
            0,
            1,
            1,
          )
          return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3)
        }),
      )
      .toEqual([232, 53, 74])
    await pa.getByRole('button', { name: '更換頭像', exact: true }).click()
    await expect(editor(pa)).toContainText('重新選擇原圖可以得到更大範圍')
    await editor(pa).getByRole('button', { name: '還原預設', exact: true }).click()
    const reset = pa.getByRole('dialog', { name: '還原為字母頭像', exact: true })
    await expect(reset).toBeVisible()
    await reset.getByRole('button', { name: '確認還原' }).click()
    await expect(editor(pa)).not.toBeVisible()
    const letter = await profile(pa, connection.characterId)
    expect(letter.avatar_revision).toBe(3)
    expect(letter.avatar).toBeNull()
    await expect(pa.locator('[data-region="sidebar"] img')).toHaveCount(0)
    await pa.getByRole('button', { name: '更換頭像', exact: true }).click()
    await fetch(`${rig.base}/__test/set-default-avatar`, { method: 'POST' })
    await expect
      .poll(async () => (await profile(pa, connection.characterId)).avatar_revision)
      .toBe(4)
    await choose(a, pa, inputs.large)
    await expect(editor(pa)).toContainText('6000×4000')
    await expect(editor(pa)).toContainText('30.0 MB')
    await fetch(`${rig.base}/__test/lose-next-avatar-response`, { method: 'POST' })
    await editor(pa).getByRole('button', { name: '儲存', exact: true }).click()
    await expect(editor(pa)).toContainText('更新結果尚未確認')
    const pending = await pa.evaluate(async (id) => {
      const result = await window.yuki.client.avatarCommands(id)
      return result.ok ? result.value.filter((item) => item.state === 'submitted') : []
    }, connection.characterId)
    expect(pending).toHaveLength(1)
    await editor(pa).getByRole('button', { name: '取消', exact: true }).click()
    await a.close()
    await fetch(`${rig.base}/__test/release-original-queries`, { method: 'POST' })
    a = await rig.launch('avatar-a')
    pa = await a.firstWindow()
    pa.on('pageerror', (error) => errors.push(error.message))
    await pa.getByRole('button', { name: '關於 Yuki', exact: true }).click()
    await expect
      .poll(() =>
        pa.evaluate(
          async (args) => {
            const result = await window.yuki.client.avatarCommands(args.id)
            return result.ok
              ? result.value.find((item) => item.requestId === args.requestId)?.state
              : null
          },
          { id: connection.characterId, requestId: pending[0]!.requestId },
        ),
      )
      .toBe('result')
    expect((await profile(pa, connection.characterId)).avatar_revision).toBe(4)
    await pa.getByRole('button', { name: '查看這次更新', exact: true }).click()
    await expect(editor(pa)).toContainText('頭像剛被另一台裝置更新')
    await editor(pa).getByRole('button', { name: '用我的', exact: true }).click()
    await expect(editor(pa)).not.toBeVisible()
    expect((await profile(pa, connection.characterId)).avatar_revision).toBe(5)
    await expect(pa.getByRole('button', { name: '查看這次更新', exact: true })).toHaveCount(0)
    await pa.getByRole('button', { name: '更換頭像', exact: true }).click()
    await choose(a, pa, inputs.small)
    await fetch(`${rig.base}/__test/lose-next-avatar-response`, { method: 'POST' })
    await editor(pa).getByRole('button', { name: '儲存', exact: true }).click()
    await expect(editor(pa)).toContainText('更新結果尚未確認')
    const committed = await pa.evaluate(async (id) => {
      const result = await window.yuki.client.avatarCommands(id)
      return result.ok ? result.value.find((item) => item.state === 'submitted')?.requestId : null
    }, connection.characterId)
    expect(committed).toBeTruthy()
    await editor(pa).getByRole('button', { name: '取消', exact: true }).click()
    await a.close()
    await fetch(`${rig.base}/__test/release-original-queries`, { method: 'POST' })
    a = await rig.launch('avatar-a')
    pa = await a.firstWindow()
    pa.on('pageerror', (error) => errors.push(error.message))
    await pa.getByRole('button', { name: '關於 Yuki', exact: true }).click()
    await expect
      .poll(() =>
        pa.evaluate(
          async (args) => {
            const result = await window.yuki.client.avatarCommands(args.id)
            const item = result.ok
              ? result.value.find((item) => item.requestId === args.requestId)
              : null
            return item ? [item.state, item.problem] : null
          },
          { id: connection.characterId, requestId: committed },
        ),
      )
      .toEqual(['result', null])
    expect((await profile(pa, connection.characterId)).avatar_revision).toBe(6)
    await pa.getByRole('button', { name: '更換頭像', exact: true }).click()
    await editor(pa).getByRole('button', { name: '還原預設', exact: true }).click()
    await pa
      .getByRole('dialog', { name: '還原為預設頭像', exact: true })
      .getByRole('button', { name: '確認還原' })
      .click()
    await expect(editor(pa)).not.toBeVisible()
    const restored = await profile(pa, connection.characterId)
    expect(restored.avatar_revision).toBe(7)
    expect(restored.avatar?.sha256).toBe(restored.default_avatar?.sha256)
    const old = await pa.evaluate(
      async (args) => window.yuki.client.avatarBytes(args.id, args.sha, 128),
      { id: connection.characterId, sha: first.avatar!.sha256 },
    )
    expect(old.ok).toBe(true)
    await pa.getByRole('button', { name: '更換頭像', exact: true }).click()
    const drag = await pa.context().newCDPSession(pa)
    const dropTarget = await editor(pa)
      .getByRole('heading', { name: '更換 Yuki 的頭像' })
      .boundingBox()
    if (!dropTarget) throw Error('avatar sheet header missing')
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const)
      await drag.send('Input.dispatchDragEvent', {
        type,
        x: dropTarget.x + 20,
        y: dropTarget.y + 10,
        data: { items: [], files: [inputs.small], dragOperationsMask: 1 },
      })
    await expect(editor(pa)).toContainText('small.png')
    await expect(editor(pa).getByRole('button', { name: '儲存', exact: true })).toBeEnabled()
    await a.evaluate(({ clipboard, nativeImage }, path) => {
      clipboard.readImage = () => nativeImage.createFromPath(path)
    }, inputs.small)
    await editor(pa).getByRole('button', { name: '貼上圖片', exact: true }).click()
    await expect(editor(pa)).toContainText('剪貼簿圖片.png')
    await choose(a, pa, inputs.small)
    await expect(editor(pa)).not.toContainText('剪貼簿圖片.png')
    await editor(pa).getByRole('button', { name: '選擇其他圖片…', exact: true }).focus()
    await pa.keyboard.press('ControlOrMeta+V')
    await expect(editor(pa)).toContainText('剪貼簿圖片.png')
    await editor(pa).getByRole('button', { name: '取消', exact: true }).click()
    if (process.platform === 'darwin') {
      const heic = join(rig.root, 'rotated.heic')
      await promisify(execFile)('/usr/bin/sips', [
        '-s',
        'format',
        'heic',
        inputs.rotated,
        '--out',
        heic,
      ])
      await pa.getByRole('button', { name: '更換頭像', exact: true }).click()
      await choose(a, pa, heic)
      await expect(editor(pa)).toContainText('rotated.heic')
      const sample = await editor(pa)
        .locator('canvas')
        .evaluate((canvas: HTMLCanvasElement) =>
          Array.from(canvas.getContext('2d')!.getImageData(20, 20, 1, 1).data),
        )
      expect(sample[2]).toBeGreaterThan(220)
      await editor(pa).getByRole('button', { name: '取消', exact: true }).click()
    }
    await pa.getByRole('button', { name: '更換頭像', exact: true }).click()
    await a.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, inputs.broken)
    await editor(pa).getByRole('button', { name: '選擇其他圖片…', exact: true }).click()
    await expect(editor(pa)).toContainText('無法讀取這張圖片')
    expect((await profile(pa, connection.characterId)).avatar_revision).toBe(7)
    await editor(pa).getByRole('button', { name: '取消', exact: true }).click()
    const facts = (await (await fetch(`${rig.base}/__test/avatar-files`)).json()) as {
      files: { sha256: string; size: string; dimensions: number[]; metadata: string[] }[]
    }
    for (const sha of [first.avatar!.sha256, restored.avatar!.sha256])
      expect(
        facts.files
          .filter((file) => file.sha256 === sha)
          .map((file) => file.size)
          .sort(),
      ).toEqual(['1024', '128', '256', '512', '64'])
    expect(facts.files.every((file) => !file.metadata.includes('exif'))).toBe(true)
    await pa.screenshot({
      path: test.info().outputPath('about-avatar.png'),
      animations: 'disabled',
    })
    await browser.goto('http://127.0.0.1:4178/components.html')
    const downsample = await browser.evaluate(
      async (args) => {
        const module = await import(args.module)
        const image = await module.decodeAvatar({
          filename: 'downsample.jpg',
          bytes: new Uint8Array(args.bytes),
        })
        const result = {
          original: [image.width, image.height],
          working: [image.bitmap.width, image.bitmap.height],
        }
        image.bitmap.close()
        return result
      },
      {
        module: `/@fs/${process.cwd()}/src/renderer/images/avatar.ts`,
        bytes: [...(await readFile(inputs.downsample))],
      },
    )
    expect(downsample.original).toEqual([8000, 6000])
    expect(Math.min(...downsample.working)).toBeLessThanOrEqual(4096)
    for (const mode of ['light', 'dark', 'opaque', 'contrast'] as const) {
      await contentSize(a, pa, 1440, 900)
      await expect.poll(() => pa.evaluate(() => [innerWidth, innerHeight])).toEqual([1440, 900])
      await pa.getByRole('button', { name: '設定', exact: true }).click()
      await pa.getByRole('tab', { name: '外觀', exact: true }).click()
      await pa.getByRole('radio', { name: mode === 'dark' ? '深色' : '淺色', exact: true }).click()
      for (const [label, checked] of [
        ['永遠不透明', mode === 'opaque'],
        ['增加對比', mode === 'contrast'],
        ['減少動態', true],
      ] as const) {
        const toggle = pa.getByRole('switch', { name: label, exact: true })
        if ((await toggle.getAttribute('aria-checked')) !== String(checked)) await toggle.click()
        await expect(toggle).toHaveAttribute('aria-checked', String(checked))
      }
      await pa.getByRole('button', { name: '返回', exact: true }).click()
      await pa.getByRole('button', { name: '關於 Yuki', exact: true }).click()
      for (const [width, height] of [
        [1440, 900],
        [1100, 760],
        [960, 492],
      ] as const) {
        const viewportMethod = await contentSize(a, pa, width, height)
        await expect
          .poll(() => pa.evaluate(() => [innerWidth, innerHeight]))
          .toEqual([width, height])
        await captureViewport(
          a,
          pa,
          test
            .info()
            .outputPath(
              `darwin-2x-${mode}-about-${width}x${height}${viewportMethod === 'electron-device-emulation' ? '-emulated' : ''}.png`,
            ),
        )
        await pa.getByRole('button', { name: '更換頭像', exact: true }).click()
        await choose(a, pa, inputs.small)
        await expect(editor(pa).locator('img').first()).toBeVisible()
        await expect(editor(pa).getByRole('application')).toHaveCSS(
          'width',
          height < 600 ? '220px' : '280px',
        )
        await expect(editor(pa).getByRole('application').locator('canvas')).toHaveCSS(
          'width',
          height < 600 ? '220px' : '280px',
        )
        await expect(editor(pa).getByRole('button', { name: '儲存', exact: true })).toBeInViewport({
          ratio: 1,
        })
        await captureViewport(
          a,
          pa,
          test
            .info()
            .outputPath(
              `darwin-2x-${mode}-avatar-${width}x${height}${viewportMethod === 'electron-device-emulation' ? '-emulated' : ''}.png`,
            ),
        )
        await editor(pa).getByRole('button', { name: '取消', exact: true }).click()
      }
    }
    expect(errors).toEqual([])
    success = true
  } finally {
    await a.close()
    await b.close()
    await rig.close(success)
  }
})

test('avatar loading after a reset never reuses a revoked image URL', async () => {
  test.setTimeout(90000)
  const rig = await yukiFixture({ character: true }),
    app = await rig.launch('avatar-url-lifetime')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const response = await fetch(`${rig.base}/__test/avatar-inputs`, { method: 'POST' }),
      inputs = (await response.json()) as { small: string; rotated: string }
    expect(response.status).toBe(200)
    await page.getByRole('button', { name: '關於 Yuki', exact: true }).click()
    await page.getByRole('button', { name: '更換頭像', exact: true }).click()
    await choose(app, page, inputs.small)
    await editor(page).getByRole('button', { name: '儲存', exact: true }).click()
    await expect(editor(page)).not.toBeVisible()
    await expect(page.locator('img:visible')).toHaveCount(2)
    await page.getByRole('button', { name: '更換頭像', exact: true }).click()
    await editor(page).getByRole('button', { name: '還原預設', exact: true }).click()
    await page
      .getByRole('dialog', { name: '還原為字母頭像', exact: true })
      .getByRole('button', { name: '確認還原' })
      .click()
    await expect(editor(page)).not.toBeVisible()
    await expect(page.locator('img:visible')).toHaveCount(0)
    await app.evaluate(() => {
      const runtime = globalThis as typeof globalThis & {
        __avatarReads?: { hero: number; release: () => void }
      }
      const original = globalThis.fetch,
        pending: (() => void)[] = []
      const state = {
        hero: 0,
        release: () => {
          globalThis.fetch = original
          for (const done of pending.splice(0)) done()
        },
      }
      runtime.__avatarReads = state
      globalThis.fetch = async (input, init) => {
        if (String(input).includes('/character/avatar/')) {
          if (String(input).endsWith('/512.png')) state.hero++
          await new Promise<void>((resolve) => pending.push(resolve))
        }
        return original(input, init)
      }
    })
    await page.getByRole('button', { name: '更換頭像', exact: true }).click()
    await choose(app, page, inputs.rotated)
    await editor(page).getByRole('button', { name: '儲存', exact: true }).click()
    await expect(editor(page)).not.toBeVisible()
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as typeof globalThis & { __avatarReads?: { hero: number } }).__avatarReads
              ?.hero ?? 0,
        ),
      )
      .toBeGreaterThan(0)
    await expect(page.locator('img:visible')).toHaveCount(0)
    await app.evaluate(() =>
      (
        globalThis as typeof globalThis & { __avatarReads?: { release: () => void } }
      ).__avatarReads?.release(),
    )
    await expect(page.locator('img:visible')).toHaveCount(2)
    await expect
      .poll(() =>
        page
          .locator('img:visible')
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true)
    success = true
  } finally {
    await app
      .evaluate(() =>
        (
          globalThis as typeof globalThis & { __avatarReads?: { release: () => void } }
        ).__avatarReads?.release(),
      )
      .catch(() => {})
    await app.close()
    await rig.close(success)
  }
})

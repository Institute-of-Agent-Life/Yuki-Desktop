import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { Profile } from '../../src/shared/api'
import { pairUI } from '../fixtures/backend'
import { navigate } from '../fixtures/navigation'
import { launchShell } from '../fixtures/shell-app'
import { completeWindowsFileDialog, windowsFileDialogOwner } from '../fixtures/windows-file-dialog'
import { avatarVariants } from '../fixtures/avatar-assets'

async function profile(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const result = await window.yuki.client.read<Profile>(id, { kind: 'character' })
    if (!result.ok) throw Error(result.code)
    return result.value
  }, id)
}

async function sidebarImage(page: Page) {
  return page.locator('[data-region="sidebar"] img').evaluate((image: HTMLImageElement) => {
    if (!image.complete || !image.naturalWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    canvas.getContext('2d')!.drawImage(image, 0, 0, 64, 64)
    return canvas.toDataURL()
  })
}

test('Windows native avatar selection preserves EXIF, crop, second-device convergence and cold recovery', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows interactive desktop')
  const base = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  const input = process.env.YUKI_NATIVE_AVATAR_INPUT
  test.skip(!base || !input, 'Requires an isolated character fixture and its EXIF-rotated JPEG')
  test.setTimeout(180000)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  const data = await mkdtemp(join(tmpdir(), 'yuki-windows-avatar-'))
  const launch = () => launchShell(join(data, 'profile-a'))
  let a = await launch()
  const b = await launchShell(join(data, 'profile-b'))
  try {
    let pa = await a.firstWindow()
    const pb = await b.firstWindow()
    for (const [index, page] of [pa, pb].entries()) {
      await page.waitForLoadState('domcontentloaded')
      const link = await fetch(`${base}/__test/link-code`, { method: 'POST' })
      expect(link.ok).toBe(true)
      await pairUI(
        page,
        base!,
        ((await link.json()) as { code: string }).code,
        `頭像裝置 ${index + 1}`,
        20000,
      )
    }
    const connections = await pa.evaluate(() => window.yuki.client.connections())
    if (!connections.ok) throw Error(connections.code)
    const connection = connections.value[0]!
    const original = await profile(pa, connection.characterId)
    expect(original.avatar).toBeNull()
    const runtime = await a.evaluate(({ app, BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      return {
        platform: process.platform,
        arch: process.arch,
        packaged: app.isPackaged,
        electron: process.versions.electron,
        scaleFactor: screen.getDisplayMatching(window.getBounds()).scaleFactor,
        sandboxed: app
          .getAppMetrics()
          .find((item) => item.pid === window.webContents.getOSProcessId())?.sandboxed,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
      }
    })
    expect(runtime).toMatchObject({
      platform: 'win32',
      arch: process.env.YUKI_NATIVE_EXPECT_ARCH ?? process.arch,
      packaged: true,
      sandboxed: true,
      noSandbox: false,
    })
    await navigate(pa, `關於 ${original.display_name}`)
    await pa
      .getByRole('region', { name: '頭像', exact: true })
      .getByRole('button', { name: '更換頭像', exact: true })
      .click()
    const sheet = pa.getByRole('dialog', {
      name: `更換 ${original.display_name} 的頭像`,
      exact: true,
    })
    const owner = await windowsFileDialogOwner(a)
    await sheet.getByRole('button', { name: '選擇圖片…', exact: true }).click()
    const receipt = await completeWindowsFileDialog(owner, input!, 'open')
    expect(receipt).toMatchObject({
      Action: 'open',
      DialogClass: '#32770',
      FilenameControl: 1148,
      DefaultButton: 1,
      Method: 'native-win32-controls',
    })
    expect(receipt.SessionId).toBeGreaterThan(0)
    await expect(sheet).toContainText(basename(input!))
    await expect(sheet).toContainText('3000×4000')
    const save = sheet.getByRole('button', { name: '儲存', exact: true })
    await expect(save).toBeEnabled()
    const crop = sheet.getByRole('application')
    const colors = await crop.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d')!
      return [
        Array.from(context.getImageData(20, 20, 1, 1).data),
        Array.from(context.getImageData(canvas.width - 20, 20, 1, 1).data),
      ]
    })
    expect(colors[0]![2]).toBeGreaterThan(220)
    expect(colors[1]![0]).toBeGreaterThan(220)
    const before = await crop
      .locator('canvas')
      .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
    await crop.press('+')
    await crop.press('Shift+ArrowDown')
    await expect
      .poll(async () =>
        Number(await sheet.getByRole('slider', { name: '頭像縮放' }).getAttribute('aria-valuenow')),
      )
      .toBeCloseTo(110)
    const box = (await crop.boundingBox())!
    await pa.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await pa.mouse.down()
    await pa.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2 + 15)
    await pa.mouse.up()
    await expect
      .poll(() =>
        crop.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
      )
      .not.toBe(before)
    await pa.screenshot({
      path: test.info().outputPath('windows-native-avatar-crop.png'),
      animations: 'disabled',
    })
    await save.click()
    await expect(sheet).not.toBeVisible()
    const updated = await profile(pa, connection.characterId)
    expect(updated.avatar_revision).toBe(original.avatar_revision + 1)
    expect(updated.id).toBe(original.id)
    expect(updated.avatar).not.toBeNull()
    await expect(pa.locator('[data-region="sidebar"] img')).toBeVisible()
    await expect.poll(() => sidebarImage(pa)).not.toBeNull()
    const rendered = await sidebarImage(pa)
    // No reload or cache invalidation on B: its original SSE must deliver the update.
    await expect(pb.locator('[data-region="sidebar"] img')).toBeVisible()
    await expect.poll(() => sidebarImage(pb)).toBe(rendered)
    const second = await profile(pb, connection.characterId)
    expect(second.avatar?.sha256).toBe(updated.avatar!.sha256)
    expect(second.avatar_revision).toBe(updated.avatar_revision)
    const variants = await avatarVariants(pa, connection.characterId, updated.avatar!.sha256)
    expect(variants.map((file) => file.size).sort()).toEqual(['1024', '128', '256', '512', '64'])
    for (const variant of variants) {
      const pixels = Number(variant.size)
      expect(variant.dimensions).toEqual([pixels, pixels])
      expect(variant.metadata).not.toContain('eXIf')
    }
    await a.close()
    a = await launch()
    pa = await a.firstWindow()
    await pa.waitForLoadState('domcontentloaded')
    await expect(
      pa.getByRole('button', { name: `關於 ${original.display_name}`, exact: true }),
    ).toBeVisible()
    await expect(pa.locator('[data-region="sidebar"] img')).toBeVisible()
    await expect.poll(() => sidebarImage(pa)).toBe(rendered)
    const reopenedConnections = await pa.evaluate(() => window.yuki.client.connections())
    if (!reopenedConnections.ok) throw Error(reopenedConnections.code)
    expect(reopenedConnections.value[0]).toMatchObject({
      characterId: connection.characterId,
      personId: connection.personId,
      bindingId: connection.bindingId,
      conversationId: connection.conversationId,
    })
    expect((await profile(pa, connection.characterId)).avatar_revision).toBe(
      updated.avatar_revision,
    )
    await pa.screenshot({
      path: test.info().outputPath('windows-native-avatar-reopened.png'),
      animations: 'disabled',
    })
    await writeFile(
      test.info().outputPath('windows-native-avatar.json'),
      JSON.stringify(
        {
          receipt,
          runtime,
          sourceSha256: createHash('sha256')
            .update(await readFile(input!))
            .digest('hex'),
          orientedDimensions: [3000, 4000],
          orientationSamples: colors,
          characterId: connection.characterId,
          originalRevision: original.avatar_revision,
          savedRevision: updated.avatar_revision,
          avatarSha256: updated.avatar!.sha256,
          variants,
          secondDeviceConverged: true,
          coldRecovery: true,
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    await a.close()
    await b.close()
    console.log(`Windows avatar evidence profile: ${data}`)
  }
})

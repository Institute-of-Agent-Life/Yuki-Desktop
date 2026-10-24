import { expect, test, type ElectronApplication } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { Connection } from '../../src/shared/api'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { launchShell } from '../fixtures/shell-app'

async function instrumentNativeBoundary(app: ElectronApplication, destination: string) {
  await app.evaluate(({ BrowserWindow, dialog, shell }, destination) => {
    const state = globalThis as unknown as {
      artifactDragCalls: { path: string; emptyIcon: boolean }[]
      artifactRevealed?: string
    }
    state.artifactDragCalls = []
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination })
    shell.showItemInFolder = (path) => {
      state.artifactRevealed = path
    }
    BrowserWindow.getAllWindows()[0]!.webContents.startDrag = (item) => {
      state.artifactDragCalls.push({
        path: item.file,
        emptyIcon: typeof item.icon === 'string' ? !item.icon : item.icon.isEmpty(),
      })
    }
  }, destination)
}

test('native artifact bridge stages authorized original bytes and restores actual saved-file availability', async () => {
  test.setTimeout(120000)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  const rig = await yukiFixture()
  const data = await mkdtemp(join(tmpdir(), 'yuki-artifact-actions-'))
  const destination = join(data, 'saved-original.md')
  let app = await launchShell(data)
  const proof: Record<string, unknown> = {
    data,
    backend: rig.root,
    scope:
      'real API, cache, native file icon and renderer gesture; OS drag, picker and reveal are instrumented boundaries',
  }
  const save = () =>
    writeFile(
      test.info().outputPath('artifact-native-bridge.json'),
      JSON.stringify(proof, null, 2) + '\n',
    )
  try {
    let page = await app.firstWindow()
    proof.native = await app.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged,
      sandboxed: app
        .getAppMetrics()
        .find(
          (entry) => entry.pid === BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId(),
        )?.sandboxed,
      noSandbox: app.commandLine.hasSwitch('no-sandbox'),
    }))
    expect(proof.native).toMatchObject({ packaged: true, sandboxed: true, noSandbox: false })
    await pairUI(page, rig.base, await rig.code())
    await page.getByRole('textbox', { name: '和 Yuki 說點什麼' }).fill('這些是原成果的來源。')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('真實帳本回覆', { exact: true })).toBeVisible()
    const response = await fetch(rig.base + '/__test/artifacts', { method: 'POST' })
    expect(response.ok).toBe(true)
    const delivered = (await response.json()) as {
      artifact_id: string
      sha256: string
      name: string
      event_id: number
    }[]
    const first = delivered[0]!,
      source = { artifactId: first.artifact_id, version: first.sha256 }
    proof.delivered = delivered
    const connection = (await page.evaluate(async () => {
      const result = await window.yuki.client.connections()
      if (!result.ok || !result.value[0]) throw Error('No paired identity')
      return result.value[0]
    })) as Connection
    await page.keyboard.press('ControlOrMeta+4')
    const stage = () => page.getByRole('region', { name: '成果預覽', exact: true })
    await expect(
      stage().getByRole('heading', { name: 'First artifact', exact: true }),
    ).toBeVisible()
    await expect(stage().getByRole('button', { name: '在資料夾顯示', exact: true })).toBeDisabled()
    await instrumentNativeBoundary(app, destination)
    const row = page.getByRole('button').filter({ hasText: first.artifact_id })
    await expect(row).toHaveAttribute('draggable', 'true')
    const box = await row.boundingBox()
    await page.mouse.move(box!.x + 24, box!.y + 20)
    await page.mouse.down()
    try {
      await page.mouse.move(box!.x + 96, box!.y + 26, { steps: 12 })
      await expect
        .poll(() =>
          app.evaluate(
            () =>
              (globalThis as unknown as { artifactDragCalls: unknown[] }).artifactDragCalls.length,
          ),
        )
        .toBe(1)
    } finally {
      await page.mouse.up()
    }
    const dragged = await app.evaluate(
      () =>
        (globalThis as unknown as { artifactDragCalls: { path: string; emptyIcon: boolean }[] })
          .artifactDragCalls[0]!,
    )
    expect(dragged.emptyIcon).toBe(false)
    expect(basename(dragged.path)).toBe(first.name)
    expect(
      createHash('sha256')
        .update(await readFile(dragged.path))
        .digest('hex'),
    ).toBe(first.sha256)
    proof.dragged = dragged
    await stage().getByRole('button', { name: '存到…', exact: true }).click()
    await expect
      .poll(async () =>
        readFile(destination).then(
          (bytes) => createHash('sha256').update(bytes).digest('hex'),
          () => '',
        ),
      )
      .toBe(first.sha256)
    await expect(stage().getByRole('button', { name: '在資料夾顯示', exact: true })).toBeEnabled()
    await stage().getByRole('button', { name: '在資料夾顯示', exact: true }).click()
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { artifactRevealed?: string }).artifactRevealed,
      ),
    ).toBe(destination)
    await app.close()
    app = await launchShell(data)
    page = await app.firstWindow()
    await instrumentNativeBoundary(app, destination)
    await page
      .getByRole('navigation', { name: '主要導覽' })
      .getByRole('button', { name: '檔案與成果', exact: true })
      .click()
    await expect(
      stage().getByRole('heading', { name: 'First artifact', exact: true }),
    ).toBeVisible()
    await expect(stage().getByRole('button', { name: '在資料夾顯示', exact: true })).toBeEnabled()
    await unlink(destination)
    await app.close()
    app = await launchShell(data)
    page = await app.firstWindow()
    await instrumentNativeBoundary(app, destination)
    await page
      .getByRole('navigation', { name: '主要導覽' })
      .getByRole('button', { name: '檔案與成果', exact: true })
      .click()
    await expect(
      stage().getByRole('heading', { name: 'First artifact', exact: true }),
    ).toBeVisible()
    await expect(stage().getByRole('button', { name: '在資料夾顯示', exact: true })).toBeDisabled()
    await stage().getByRole('button', { name: '存到…', exact: true }).click()
    await expect
      .poll(async () =>
        readFile(destination).then(
          (bytes) => createHash('sha256').update(bytes).digest('hex'),
          () => '',
        ),
      )
      .toBe(first.sha256)
    await expect(stage().getByRole('button', { name: '在資料夾顯示', exact: true })).toBeEnabled()
    const invalid = await page.evaluate(
      async ({ id, source }) => window.yuki.client.dragArtifact(id, source),
      { id: connection.characterId, source: { ...source, version: '0'.repeat(64) } },
    )
    expect(invalid.ok).toBe(false)
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { artifactDragCalls: unknown[] }).artifactDragCalls.length,
      ),
    ).toBe(0)
    for (const ref of delivered.filter((item) => item.artifact_id === first.artifact_id)) {
      const result = await fetch(`${rig.base}/__test/events/${ref.event_id}?lose_hint=true`, {
        method: 'DELETE',
      })
      expect(result.ok).toBe(true)
    }
    const denied = await page.evaluate(
      async ({ id, source }) => window.yuki.client.dragArtifact(id, source),
      { id: connection.characterId, source },
    )
    expect(denied.ok).toBe(false)
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { artifactDragCalls: unknown[] }).artifactDragCalls.length,
      ),
    ).toBe(0)
    await expect
      .poll(async () =>
        stat(dragged.path).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false)
    expect(
      createHash('sha256')
        .update(await readFile(destination))
        .digest('hex'),
    ).toBe(first.sha256)
    proof.invalid = invalid
    proof.denied = denied
    await app.close()
    app = await launchShell(data)
    page = await app.firstWindow()
    const remaining = delivered[1]!
    await page
      .getByRole('navigation', { name: '主要導覽' })
      .getByRole('button', { name: '檔案與成果', exact: true })
      .click()
    await page.getByRole('button').filter({ hasText: remaining.artifact_id }).click()
    await expect(
      stage().getByRole('heading', { name: 'Another artifact', exact: true }),
    ).toBeVisible()
    await expect(stage().getByRole('button', { name: '在資料夾顯示', exact: true })).toBeDisabled()
    proof.complete = true
  } finally {
    await save()
    await app.close().catch(() => {})
    await rig.close(false)
  }
})

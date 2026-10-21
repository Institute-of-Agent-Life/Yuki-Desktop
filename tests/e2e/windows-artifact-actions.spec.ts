import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { launchShell } from '../fixtures/shell-app'
import { pairUI } from '../fixtures/backend'
import { completeWindowsFileDialog, windowsFileDialogOwner } from '../fixtures/windows-file-dialog'
import {
  artifactDropTarget,
  dragOriginalArtifact,
  revealedArtifact,
} from '../fixtures/windows-artifact-drag'

test('Windows artifact actions use a real Save picker, Explorer selection and native cross-process FileDrop', async () => {
  test.skip(process.platform !== 'win32', 'Requires a Windows interactive desktop')
  test.setTimeout(180000)
  const base = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  expect(base).toBeTruthy()
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  const data = await mkdtemp(join(tmpdir(), 'yuki-windows-artifact-actions-'))
  const destination = join(data, 'saved-original.md')
  const app = await launchShell(data)
  let probe: Awaited<ReturnType<typeof artifactDropTarget>> | undefined
  const proof: Record<string, unknown> = {
    data,
    scope:
      'real Windows picker, Explorer selected file and native FileDrop into an owned isolated receiver; not an Explorer drag destination or Linux/Mac acceptance',
  }
  const save = () =>
    writeFile(
      test.info().outputPath('windows-artifact-actions.json'),
      JSON.stringify(proof, null, 2) + '\n',
    )
  try {
    const page = await app.firstWindow()
    const owner = await windowsFileDialogOwner(app)
    proof.owner = owner
    const native = await app.evaluate(({ app, BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      return {
        packaged: app.isPackaged,
        pid: process.pid,
        zoom: win.webContents.getZoomFactor(),
        sandboxed: app
          .getAppMetrics()
          .find((entry) => entry.pid === win.webContents.getOSProcessId())?.sandboxed,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
        dpr: screen.getDisplayMatching(win.getBounds()).scaleFactor,
      }
    })
    expect(native).toMatchObject({ packaged: true, sandboxed: true, noSandbox: false })
    proof.native = native
    const code = await fetch(base + '/__test/link-code', { method: 'POST' })
    expect(code.ok).toBe(true)
    await pairUI(page, base!, ((await code.json()) as { code: string }).code, '原生成果動作', 20000)
    await page.getByRole('textbox', { name: '和 Yuki 說點什麼' }).fill('請交付這份原成果。')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('真實帳本回覆', { exact: true })).toBeVisible()
    const response = await fetch(base + '/__test/artifacts?long_names=true', { method: 'POST' })
    expect(response.ok).toBe(true)
    const delivered = (await response.json()) as {
      artifact_id: string
      sha256: string
      name: string
      event_id: number
    }[]
    proof.delivered = delivered
    const first = delivered[0]!
    expect(first.name).toHaveLength(40)
    await page.keyboard.press('Control+4')
    const stage = page.getByRole('region', { name: '成果預覽', exact: true })
    await expect(stage.getByRole('heading', { name: 'First artifact', exact: true })).toBeVisible()
    await expect(stage.getByRole('button', { name: '在資料夾顯示', exact: true })).toBeDisabled()
    const picking = stage.getByRole('button', { name: '存到…', exact: true }).click()
    const picker = await completeWindowsFileDialog(owner, destination, 'save')
    await picking
    proof.picker = picker
    await save()
    await expect
      .poll(async () =>
        readFile(destination).then(
          (bytes) => createHash('sha256').update(bytes).digest('hex'),
          () => '',
        ),
      )
      .toBe(first.sha256)
    await expect(stage.getByRole('button', { name: '在資料夾顯示', exact: true })).toBeEnabled()
    await stage.getByRole('button', { name: '在資料夾顯示', exact: true }).click()
    let selection: Awaited<ReturnType<typeof revealedArtifact>>
    await expect
      .poll(
        async () => {
          selection = await revealedArtifact(data)
          return (
            selection?.selected.some((path) => path.toLowerCase() === destination.toLowerCase()) ??
            false
          )
        },
        { timeout: 20000 },
      )
      .toBe(true)
    proof.explorerSelection = selection!
    await save()
    await revealedArtifact(data, true)
    const directory = join(data, 'drop-receiver')
    probe = await artifactDropTarget(directory, first.name, first.sha256)
    proof.dropTarget = probe.target
    await save()
    const row = page.getByRole('button').filter({ hasText: first.artifact_id })
    await expect(row).toHaveAttribute('draggable', 'true')
    const box = await row.boundingBox()
    proof.gesture = await dragOriginalArtifact(
      owner,
      probe.target,
      { x: box!.x + 32, y: box!.y + 20 },
      native.zoom,
    )
    const receipt = join(directory, 'dropped.json')
    await expect
      .poll(
        async () => {
          const failure = await readFile(join(directory, 'drop-error.json'), 'utf8').catch(() => '')
          if (failure) throw Error(failure)
          return stat(receipt).then(
            () => true,
            () => false,
          )
        },
        { timeout: 15000 },
      )
      .toBe(true)
    const drop = JSON.parse((await readFile(receipt, 'utf8')).replace(/^\uFEFF/, '')) as {
      event: string
      destination: string
      sha256: string
      source: string
    }
    expect(drop.event).toBe('native-WinForms-DragDrop')
    expect(drop.sha256).toBe(first.sha256)
    expect(
      createHash('sha256')
        .update(await readFile(drop.destination))
        .digest('hex'),
    ).toBe(first.sha256)
    expect(drop.source).not.toBe(destination)
    expect(drop.destination).toBe(join(directory, first.name))
    proof.drop = drop
    proof.complete = true
  } finally {
    await save()
    await probe?.close()
    await revealedArtifact(data, true).catch(() => {})
    await app.close().catch(() => {})
  }
})

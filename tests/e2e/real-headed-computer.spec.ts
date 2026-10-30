import { navigate } from '../fixtures/navigation'
import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Computer, Profile } from '../../src/shared/api'
import { currentConnection, pairUI } from '../fixtures/backend'
import { isolatedDesktop } from '../fixtures/isolated-desktop'

test('actual headed Chromium preserves its lease while real pointer, keyboard, Unicode clipboard and screenshots work', async () => {
  test.setTimeout(120000)
  const base = process.env.YUKI_DESKTOP_HEADED_BACKEND_URL?.replace(/\/+$/, '')
  test.skip(!base, 'Requires an explicitly selected isolated backend with real Xvnc and Chromium.')
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  const facts = async () => {
    const response = await fetch(`${base}/__test/computer`)
    expect(response.ok).toBe(true)
    return (await response.json()) as {
      headed: boolean
      environment: { ready: boolean }
      display: { display: string }
      control: { holder: string; device_id?: string; lease_id?: string }
    }
  }
  expect(await facts()).toMatchObject({
    headed: true,
    environment: { ready: true },
    display: { display: 'running' },
    control: { holder: 'none' },
  })
  const typed = `real-keyboard-${randomUUID()}`,
    pasted = '中文剪貼簿與表情 🙂，沿原控制租約輸入。',
    root = await mkdtemp(join(tmpdir(), 'yd-real-headed-'))
  const input: string[] = []
  let ready: { title: string; point: { x: number; y: number } } | undefined
  const receiver = createServer((request, response) => {
    if (request.method === 'POST') {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        if (request.url === '/ready') ready = JSON.parse(body)
        if (request.url === '/observed') input.push(body)
        response.writeHead(204).end()
      })
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><meta charset="utf-8"><title>真實中文桌面驗收</title>
      <style>body{margin:40px;font:24px sans-serif;background:#f2f6ff;color:#173151}
      textarea{display:block;width:75%;height:180px;margin-top:24px;font:24px sans-serif}
      h1{font-size:36px}p{font-size:22px}</style>
      <h1>跨平台電腦接手驗證</h1><p>真實 Xvnc、Chromium、鍵盤與中文剪貼簿</p>
      <label>原控制租約的實際輸入<textarea autofocus></textarea></label>
      <script>
        const area=document.querySelector('textarea');
        area.addEventListener('input',()=>fetch('/observed',{method:'POST',body:area.value}));
        addEventListener('load',()=>{
          const rect=area.getBoundingClientRect();
          fetch('/ready',{method:'POST',body:JSON.stringify({title:document.title,point:{
            x:screenX+(outerWidth-innerWidth)/2+rect.x+30,
            y:screenY+outerHeight-innerHeight+rect.y+30
          }})});
        });
      </script>`)
  })
  await new Promise<void>((resolve) => receiver.listen(0, '0.0.0.0', resolve))
  const address = receiver.address()
  if (!address || typeof address === 'string') throw Error('Missing actual HTTP receiver address')
  const url = `http://host.docker.internal:${address.port}/`
  const desktop = await isolatedDesktop(root),
    app = await desktop.launch('headed-device')
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
    })
    const page = await app.firstWindow()
    const codeResponse = await fetch(`${base}/__test/link-code`, { method: 'POST' })
    expect(codeResponse.ok).toBe(true)
    const code = (await codeResponse.json()) as { code: string }
    await pairUI(page, base!, code.code)
    const connection = await currentConnection(page)
    const profile = await page.evaluate(async (id) => {
      const result = await window.yuki.client.read<Profile>(id, { kind: 'character' })
      if (!result.ok) throw Error(result.code)
      return result.value
    }, connection.characterId)
    const returnLabel = `交回給 ${profile.display_name}`
    await navigate(page, `${profile.display_name} 的電腦`)
    const screenshot = page.getByRole('button', { name: '截圖存檔', exact: true })
    await expect(screenshot).toBeEnabled()
    const canvas = page
      .getByRole('application', { name: '遠端電腦畫面', exact: true })
      .locator('canvas')
    await expect(canvas).toBeVisible()
    const pixels = await canvas.evaluate((node: HTMLCanvasElement) => {
      const data = node.getContext('2d')!.getImageData(0, 0, node.width, node.height).data
      const colors = new Set<number>()
      for (let offset = 0; offset < data.length; offset += 400)
        colors.add((data[offset]! << 16) | (data[offset + 1]! << 8) | data[offset + 2]!)
      return { width: node.width, height: node.height, colors: colors.size }
    })
    expect(pixels.width).toBeGreaterThan(800)
    expect(pixels.height).toBeGreaterThan(600)
    expect(pixels.colors).toBeGreaterThan(20)
    await page.getByRole('button', { name: '接手', exact: true }).click()
    await expect(page.getByRole('button', { name: returnLabel, exact: true })).toBeEnabled()
    const controlled = await facts()
    expect(controlled.control).toMatchObject({ holder: 'human', device_id: connection.deviceId })
    const lease = controlled.control.lease_id
    expect(lease).toBeTruthy()
    await canvas.click()
    await page.keyboard.press('Control+l')
    await page.keyboard.type(url)
    await page.keyboard.press('Enter')
    await expect.poll(() => ready?.title).toBe('真實中文桌面驗收')
    await page.keyboard.type(typed)
    await expect.poll(() => input.at(-1)).toBe(typed)
    await page.keyboard.press('Control+Alt')
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), pasted)
    await page.getByRole('button', { name: '貼上文字到遠端畫面', exact: true }).click()
    const bounds = await canvas.boundingBox()
    expect(bounds).not.toBeNull()
    await canvas.click({
      position: {
        x: (ready!.point.x * bounds!.width) / pixels.width,
        y: (ready!.point.y * bounds!.height) / pixels.height,
      },
    })
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Control+v')
    await expect.poll(() => input.at(-1)).toBe(typed + pasted)
    await page.keyboard.press('Control+Alt')
    const png = join(root, 'actual-headed-desktop.png')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, png)
    await screenshot.click()
    await expect
      .poll(async () => {
        try {
          return (await readFile(png)).subarray(0, 8).toString('hex')
        } catch {
          return ''
        }
      })
      .toBe('89504e470d0a1a0a')
    expect(
      await app.evaluate(
        ({ nativeImage }, path) => nativeImage.createFromPath(path).getSize(),
        png,
      ),
    ).toEqual({ width: pixels.width, height: pixels.height })
    await page.screenshot({ path: test.info().outputPath('actual-chinese-headed-desktop.png') })
    await test.info().attach('actual-remote-screen', { path: png, contentType: 'image/png' })
    await navigate(page, '桌面對話')
    await navigate(page, `${profile.display_name} 的電腦`)
    await expect(screenshot).toBeEnabled()
    expect((await facts()).control.lease_id).toBe(lease)
    const current = await page.evaluate(async (id) => {
      const result = await window.yuki.client.read<Computer>(id, { kind: 'computer' })
      if (!result.ok) throw Error(result.code)
      return result.value
    }, connection.characterId)
    expect(current.control?.lease_id).toBe(lease)
    await page.getByRole('button', { name: returnLabel, exact: true }).click()
    const sheet = page.getByRole('dialog', { name: returnLabel, exact: true })
    await sheet
      .getByRole('textbox', { name: '說明', exact: true })
      .fill('真實中文畫面與輸入已完成。')
    await sheet.getByRole('button', { name: '交回', exact: true }).click()
    await expect.poll(async () => (await facts()).control.holder).toBe('none')
    await expect(page.getByRole('button', { name: '接手', exact: true })).toBeEnabled()
    await expect(
      page.getByRole('button', { name: '貼上文字到遠端畫面', exact: true }),
    ).toBeDisabled()
  } finally {
    await app.close().catch(() => {})
    receiver.closeAllConnections()
    await new Promise<void>((resolve) => receiver.close(() => resolve()))
  }
})

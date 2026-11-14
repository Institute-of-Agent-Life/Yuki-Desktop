import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { isolatedDesktop } from '../fixtures/isolated-desktop'
import { navigate } from '../fixtures/navigation'
import type { Computer, Profile } from '../../src/shared/api'

test(
  'switching displays keeps focus, the visible source, and separate control',
  {
    tag: '@unix-manager',
  },
  async () => {
    test.setTimeout(60000)
    const rig = await yukiFixture({ computer: true, snowluma: true })
    const app = await rig.launch('display-switch')
    const info = test.info()
    const evidence: unknown[] = []
    const qq = async () =>
      (await readFile(join(rig.root, 'qq-rfb.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as { session: number; kind: string; down?: boolean; key?: number },
        )
    const sandbox = async () =>
      (await (await fetch(rig.base + '/__test/computer')).json()) as {
        control: Computer['control']
        mutations: number
        events: { kind: string; hex?: string }[]
      }
    let passed = false
    try {
      const page = await app.firstWindow()
      await pairUI(page, rig.base, await rig.code())
      const { characterId, deviceId } = await currentConnection(page)
      const name = await page.evaluate(async (id) => {
        const result = await window.yuki.client.read<Profile>(id, { kind: 'character' })
        if (!result.ok) throw Error(result.code)
        return result.value.display_name
      }, characterId)
      await navigate(page, name + ' 的電腦')
      // 10: the two displays are a segmented choice, each one a press away.
      const picker = page.getByRole('radiogroup', { name: '顯示器', exact: true })
      const option = (source: 'sandbox' | 'qq-view') =>
        picker.getByRole('radio', {
          name: source === 'sandbox' ? `${name} 的沙箱` : 'QQ 登入',
          exact: true,
        })
      const display = page.getByRole('application', { name: '遠端電腦畫面' })
      const capture = page.getByRole('button', { name: '截圖存檔', exact: true })
      const keyboard = page.getByRole('button', { name: '傳送 Ctrl Alt Delete', exact: true })
      const takeQQ = page.getByRole('button', { name: '接手 QQ', exact: true })
      const endQQ = page.getByRole('button', { name: '結束 QQ 控制', exact: true })
      const returnSandbox = page.getByRole('button', { name: `交回給 ${name}`, exact: true })

      const verifyDisplay = async (source: 'sandbox' | 'qq-view', controlling: boolean) => {
        await expect(option(source)).toHaveAttribute('aria-checked', 'true')
        await expect(capture).toBeEnabled()
        const frame = () =>
          display.locator('canvas').evaluate((canvas: HTMLCanvasElement) => ({
            size: [canvas.width, canvas.height],
            pixel: Array.from(canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data),
          }))
        await expect
          .poll(frame)
          .toEqual(
            source === 'sandbox'
              ? { size: [960, 600], pixel: [53, 48, 45, 255] }
              : { size: [640, 480], pixel: [22, 117, 225, 255] },
          )
        if (controlling) await expect(keyboard).toBeEnabled()
        else await expect(keyboard).toBeDisabled()
        evidence.push({ source, controlling, frame: await frame() })
      }

      await verifyDisplay('sandbox', false)
      const pointerRegion = await picker.evaluate((element) => {
        for (let node: Element | null = element; node; node = node.parentElement) {
          const region = getComputedStyle(node).getPropertyValue('-webkit-app-region')
          if (region === 'drag' || region === 'no-drag') return region
        }
        return 'none'
      })
      evidence.push({ pointerRegion })
      expect.soft(pointerRegion, 'the display picker accepts pointer input').not.toBe('drag')
      await page.getByRole('button', { name: '接手', exact: true }).click()
      await expect(returnSandbox).toBeEnabled()
      const { control, mutations } = await sandbox()
      expect(control).toMatchObject({ holder: 'human', device_id: deviceId })
      evidence.push({ sandboxLease: control, mutations })

      await option('sandbox').focus()
      await page.keyboard.press('ArrowRight')
      await expect(option('qq-view')).toHaveAttribute('aria-checked', 'true')
      await expect.soft(option('qq-view')).toBeFocused({ timeout: 1000 })
      await verifyDisplay('qq-view', false)
      await display.click()
      await page.keyboard.press('v')
      await takeQQ.click()
      await verifyDisplay('qq-view', true)
      await expect(endQQ).toBeVisible()
      const qqControl = (await qq()).filter(({ kind }) => kind === 'open').at(-1)!.session
      await display.click()
      await page.keyboard.press('x')
      await expect
        .poll(async () => (await qq()).filter(({ kind }) => kind === 'key'))
        .toEqual([
          { session: qqControl, kind: 'key', down: true, key: 120 },
          { session: qqControl, kind: 'key', down: false, key: 120 },
        ])
      await page.screenshot({ path: info.outputPath('qq-control.png') })

      await option('sandbox').click()
      await expect.soft(option('sandbox')).toBeFocused({ timeout: 1000 })
      await verifyDisplay('sandbox', true)
      await expect
        .poll(async () =>
          (await qq()).some(({ kind, session }) => kind === 'close' && session === qqControl),
        )
        .toBe(true)
      await expect(returnSandbox).toBeEnabled()
      await display.click()
      await page.keyboard.press('s')
      await expect
        .poll(async () =>
          (await sandbox()).events.some(
            ({ kind, hex }) =>
              (kind === 'key' || kind === 'extended') &&
              Buffer.from(hex!, 'hex').readUInt32BE(4) === 115,
          ),
        )
        .toBe(true)
      await page.screenshot({ path: info.outputPath('sandbox-control.png') })

      await option('qq-view').click()
      await option('sandbox').click()
      await option('qq-view').click()
      await verifyDisplay('qq-view', false)
      await expect(takeQQ).toBeVisible()
      await expect(endQQ).toHaveCount(0)
      await takeQQ.click()
      await verifyDisplay('qq-view', true)
      await endQQ.click()
      await verifyDisplay('qq-view', false)
      await option('sandbox').click()
      await verifyDisplay('sandbox', true)
      const resumedSandbox = await sandbox()
      expect(resumedSandbox).toMatchObject({ control, mutations })
      evidence.push({
        resumedSandboxLease: resumedSandbox.control,
        mutations: resumedSandbox.mutations,
      })
      await returnSandbox.click()
      await page
        .getByRole('dialog', { name: `交回給 ${name}` })
        .getByRole('button', { name: '交回', exact: true })
        .click()
      await expect.poll(async () => (await sandbox()).control?.holder).toBe('none')
      passed = info.errors.length === 0
    } finally {
      try {
        await writeFile(
          info.outputPath('display-switch.json'),
          JSON.stringify({ evidence, qq: await qq(), sandbox: await sandbox() }, null, 2) + '\n',
        )
      } finally {
        await app
          .evaluate(({ dialog }) => {
            dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
          })
          .catch(() => {})
        await app.close().finally(() => rig.close(passed))
      }
    }
  },
)

test('switch between a real sandbox and SnowLuma login without taking the sandbox lease', async () => {
  const base = process.env.YUKI_DESKTOP_QQ_BACKEND_URL
  test.skip(!base, 'Requires an isolated backend and a new, unpaired QQ desktop.')
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(base!).hostname)
  const root = await mkdtemp(join(tmpdir(), 'yuki-qq-display-'))
  const app = await (await isolatedDesktop(root)).launch('qq-display')
  try {
    const page = await app.firstWindow()
    const response = await fetch(base + '/__test/link-code', { method: 'POST' })
    await pairUI(page, base!, ((await response.json()) as { code: string }).code)
    const connection = await currentConnection(page)
    const profile = await page.evaluate(async (id) => {
      const result = await window.yuki.client.read<Profile>(id, { kind: 'character' })
      if (!result.ok) throw Error(result.code)
      return result.value.display_name
    }, connection.characterId)
    await navigate(page, profile + ' 的電腦')
    const selector = page.getByRole('radiogroup', { name: '顯示器', exact: true })
    const capture = page.getByRole('button', { name: '截圖存檔', exact: true })
    await expect(capture).toBeEnabled()
    await selector.getByRole('radio', { name: 'QQ 登入', exact: true }).click()
    await expect(capture).toBeEnabled()
    await page.getByRole('button', { name: '接手 QQ', exact: true }).click()
    await expect(capture).toBeEnabled()
    const getSandbox = () =>
      page.evaluate(async (id) => {
        const result = await window.yuki.client.read<Computer>(id, { kind: 'computer' })
        if (!result.ok) throw Error(result.code)
        return result.value
      }, connection.characterId)
    expect((await getSandbox()).control?.holder).toBe('none')
    await page.screenshot({ path: test.info().outputPath('local-qq-login.png') })
    await page.getByRole('button', { name: '結束 QQ 控制', exact: true }).click()
    await expect(capture).toBeEnabled()
    await selector.getByRole('radio', { name: `${profile} 的沙箱`, exact: true }).click()
    await expect(capture).toBeEnabled()
    await expect(page.getByRole('button', { name: '接手', exact: true })).toBeEnabled()
    expect((await getSandbox()).control?.holder).toBe('none')
  } finally {
    await app.close()
  }
})

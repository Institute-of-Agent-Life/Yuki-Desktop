import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { captureWorkspace, contentSize } from '../fixtures/visual'

interface Facts {
  events: { kind: string; flags?: number; hex?: string }[]
  clipboard: string
  connections: number
  mutations: number
  control: { holder: string; lease_id?: string }
}
const inspector = (page: Page) => page.getByRole('complementary', { name: '檢視器', exact: true })
const inputEvents = (facts: Facts) =>
  facts.events.filter((event) => ['key', 'extended', 'pointer'].includes(event.kind))
async function preview(page: Page) {
  await page.keyboard.press('ControlOrMeta+1')
  if (!(await inspector(page).count()))
    await page.getByRole('button', { name: '檢視器', exact: true }).click()
  await inspector(page).getByRole('tab', { name: '電腦', exact: true }).click()
  await expect(
    inspector(page).getByRole('img', { name: '遠端電腦預覽' }).locator('canvas'),
  ).toBeVisible()
  await expect(inspector(page).getByText('正在連接畫面', { exact: true })).toHaveCount(0)
}

test('real preview stays read-only even with its own lease, verifies a lost take, transfers and opens full input only after confirmation', async () => {
  test.setTimeout(180000)
  const rig = await yukiFixture({ computer: true, character: true }),
    a = await rig.launch('preview-a'),
    b = await rig.launch('preview-b')
  const facts = async () => (await (await fetch(`${rig.base}/__test/computer`)).json()) as Facts
  let success = false
  try {
    const pa = await a.firstWindow(),
      pb = await b.firstWindow()
    await pairUI(pa, rig.base, await rig.code())
    await pairUI(pb, rig.base, await rig.code())
    await contentSize(b, pb, 1440, 900)
    await preview(pb)
    await captureWorkspace(a, pa, 'inspector-live-preview', async () => preview(pa), {
      verify: async () => {
        await expect(inspector(pa).getByRole('img', { name: '遠端電腦預覽' })).toBeInViewport({
          ratio: 1,
        })
        await expect(
          inspector(pa).getByRole('button', { name: '開啟完整畫面', exact: true }),
        ).toBeInViewport({ ratio: 1 })
      },
    })
    await contentSize(a, pa, 1440, 900)
    await expect
      .poll(async () => (await facts()).events.filter((event) => event.kind === 'clipboard').length)
      .toBeGreaterThanOrEqual(2)
    const watching = await facts()
    expect(
      watching.events
        .filter((event) => event.kind === 'clipboard')
        .every((event) => !!(event.flags! & 0x01000000)),
    ).toBe(true)
    const mutations = watching.mutations
    await fetch(`${rig.base}/__test/lose-next-computer-response`, { method: 'POST' })
    await inspector(pa).getByRole('button', { name: '接手', exact: true }).click()
    await expect.poll(async () => (await facts()).control.holder).toBe('human')
    await expect(pa.getByRole('button', { name: '收合工作區', exact: true })).toHaveCount(0)
    await inspector(pa).getByRole('button', { name: '查證原請求', exact: true }).click()
    await expect(
      inspector(pa).getByRole('button', { name: '交回給 Yuki', exact: true }),
    ).toBeEnabled()
    expect((await facts()).mutations).toBe(mutations + 1)
    const firstLease = (await facts()).control.lease_id
    const beforePreviewInput = inputEvents(await facts())
    await inspector(pa).getByRole('img', { name: '遠端電腦預覽' }).click()
    await pa.keyboard.press('q')
    await expect(
      inspector(pa).getByText('預覽僅供觀看，請在完整畫面操作。', { exact: true }),
    ).toBeVisible()
    expect(inputEvents(await facts())).toEqual(beforePreviewInput)
    await inspector(pb).getByRole('button', { name: '改由這台控制', exact: true }).click()
    await pb
      .getByRole('dialog', { name: '改由這台裝置控制？' })
      .getByRole('button', { name: '改由這台控制', exact: true })
      .click()
    await expect(pb.getByRole('button', { name: '收合工作區', exact: true })).toBeVisible()
    await expect(pb.getByRole('button', { name: '貼上到角色的電腦' })).toBeEnabled()
    expect((await facts()).control.lease_id).not.toBe(firstLease)
    await pb
      .getByRole('application', { name: '遠端電腦畫面' })
      .click({ position: { x: 80, y: 80 } })
    await pb.keyboard.press('x')
    await expect
      .poll(async () => inputEvents(await facts()).length)
      .toBeGreaterThan(beforePreviewInput.length)
    expect(
      inputEvents(await facts()).filter(
        (event) =>
          ['key', 'extended'].includes(event.kind) &&
          Buffer.from(event.hex!, 'hex').readUInt32BE(4) === 0x71,
      ),
    ).toHaveLength(0)
    await pb.keyboard.press('Control+Alt')
    await pb.getByRole('button', { name: '交回給 Yuki', exact: true }).click()
    await pb
      .getByRole('dialog', { name: '交回給 Yuki' })
      .getByRole('button', { name: '交回', exact: true })
      .click()
    await expect.poll(async () => (await facts()).control.holder).toBe('none')
    await inspector(pa).getByRole('button', { name: '接手', exact: true }).click()
    await expect(pa.getByRole('button', { name: '收合工作區', exact: true })).toBeVisible()
    await expect(pa.getByRole('button', { name: '貼上到角色的電腦' })).toBeEnabled()
    const beforePaste = await facts()
    expect(
      beforePaste.events
        .filter((event) => event.kind === 'clipboard')
        .every((event) => !!(event.flags! & 0x01000000)),
    ).toBe(true)
    await a.evaluate(({ clipboard }) => clipboard.writeText('從預覽接手後明確貼上的中文 🙂'))
    await pa.getByRole('button', { name: '貼上到角色的電腦' }).click()
    await expect.poll(async () => (await facts()).clipboard).toBe('從預覽接手後明確貼上的中文 🙂')
    await pa.getByRole('button', { name: '交回給 Yuki', exact: true }).click()
    await pa
      .getByRole('dialog', { name: '交回給 Yuki' })
      .getByRole('button', { name: '交回', exact: true })
      .click()
    await expect.poll(async () => (await facts()).control.holder).toBe('none')
    await pa.getByRole('button', { name: '關閉檢視器', exact: true }).click()
    await preview(pa)
    await inspector(pa).getByRole('button', { name: '開啟完整畫面', exact: true }).click()
    await expect(pa.getByRole('application', { name: '遠端電腦畫面' })).toBeVisible()
    await expect(pa.getByRole('button', { name: '貼上到角色的電腦' })).toBeDisabled()
    expect((await facts()).control.holder).toBe('none')
    await writeFile(
      test.info().outputPath('preview-facts.json'),
      JSON.stringify({ watching, beforePaste, final: await facts() }, null, 2),
    )
    success = true
  } finally {
    for (const app of [a, b]) {
      await app
        .evaluate(({ dialog }) => {
          dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
        })
        .catch(() => {})
      await app.close()
    }
    await rig.close(success)
  }
})

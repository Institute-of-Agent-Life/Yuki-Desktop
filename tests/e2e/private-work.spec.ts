import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { Work } from '../../src/shared/api'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { navigate } from '../fixtures/navigation'

test('a Work the Host opened for a private request stays out of the chat but in the Works list', async () => {
  test.setTimeout(180_000)
  const rig = await yukiFixture({ richMedia: true }),
    app = await rig.launch('private-work')
  const evidence: Record<string, unknown> = {}
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page)
    const box = page.getByRole('textbox', { name: `和 ${connection.name} 說點什麼`, exact: true })
    const send = page.getByRole('button', { name: '送出', exact: true })
    const works = () =>
      page.evaluate(async (id) => {
        const result = await window.yuki.client.read<{ works: Work[] }>(id, {
          kind: 'works',
          group: 'ended',
          origin: 'all',
        })
        const active = await window.yuki.client.read<{ works: Work[] }>(id, {
          kind: 'works',
          group: 'active',
          origin: 'all',
        })
        if (!result.ok || !active.ok) throw Error('works unavailable')
        return [...active.value.works, ...result.value.works]
      }, connection.characterId)

    // The model's first call is a tool other than send, so the Host admits the Work itself.
    await fetch(`${rig.base}/__test/private-execution-scenario`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '排程已查完' }),
    })
    await box.fill('幫我看看排程')
    await send.click()
    await expect(page.getByText('排程已查完', { exact: true })).toBeVisible()
    let hosted: Work | undefined
    await expect
      .poll(async () => (hosted = (await works()).find((w) => w.admission === 'host_execution')))
      .toBeTruthy()
    hosted = hosted!
    evidence.hosted = { work_id: hosted.work_id, goal: hosted.goal, admission: hosted.admission }
    // 7: no card for it in the conversation...
    await expect(page.getByRole('heading', { name: hosted.goal, exact: true })).toHaveCount(0)

    // ...while a Work started explicitly keeps its card.
    await fetch(`${rig.base}/__test/link-work-scenario`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: '明確開始的工作', text: '明確工作完成' }),
    })
    await box.fill('請開始一項工作')
    await send.click()
    const started = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: '明確開始的工作', exact: true }) })
    await expect(started).toBeVisible()
    const explicit = (await works()).find((work) => work.goal === '明確開始的工作')!
    evidence.explicit = { work_id: explicit.work_id, admission: explicit.admission }
    expect(explicit.admission ?? null).toBeNull()
    await expect(page.getByRole('heading', { name: hosted.goal, exact: true })).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('private-work-chat.png') })

    // The Works list still lists it.
    await navigate(page, '工作')
    await expect(page.getByText(hosted.goal, { exact: true }).first()).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('private-work-list.png') })
    success = true
  } finally {
    await writeFile(
      test.info().outputPath('private-work.json'),
      JSON.stringify(evidence, null, 2) + '\n',
    )
    await app.close()
    await rig.close(success)
  }
})

import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { activeCharacterName } from '../fixtures/active-character'
import { pairUI, yukiFixture } from '../fixtures/backend'

// 全局透明磨砂与统一顶部淡出任务书 (2026-11-12), failure cases 10–11.
test('a sent message stays still while its request is on its way, and an unconfirmed one still asks to be checked', async () => {
  test.setTimeout(240000)
  const rig = await yukiFixture()
  const app = await rig.launch('send-steady')
  let success = false
  const evidence: Record<string, unknown> = {}
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const name = await activeCharacterName(page)
    const composer = page.getByRole('textbox', { name: `和 ${name} 說點什麼` })
    const processing = page.getByText(`${name} 正在處理`, { exact: true })
    // Enough history for the list to scroll, so a shrinking end would move it.
    for (let index = 0; index < 6; index++) {
      await composer.fill(`第 ${index} 則：` + '讓對話夠長的內容。'.repeat(4))
      await composer.press('Enter')
      await expect(processing).toHaveCount(0, { timeout: 15000 })
    }
    await fetch(`${rig.base}/__test/model-delay/2`, { method: 'POST' })
    for (const round of [1, 2, 3]) {
      await composer.fill(`第 ${round} 次等待回覆`)
      await page.evaluate(() => {
        const state = window as unknown as { frames: [number, number, string][] }
        state.frames = []
        const log = document.querySelector<HTMLElement>('[role="log"]')!
        const start = performance.now()
        const record = () => {
          const own = [...log.querySelectorAll<HTMLElement>('article')].at(-1)!
          state.frames.push([
            Math.round(performance.now() - start),
            log.scrollHeight,
            own.innerText.replace(/\s+/g, ' '),
          ])
          if (performance.now() - start < 1500) requestAnimationFrame(record)
        }
        requestAnimationFrame(record)
      })
      await composer.press('Enter')
      await page.waitForTimeout(1700)
      const frames = await page.evaluate(
        () => (window as unknown as { frames: [number, number, string][] }).frames,
      )
      evidence[`round-${round}`] = frames.filter(
        (frame, index) => index === 0 || frame[1] !== frames[index - 1]![1],
      )
      // 10: while the request is on its way nothing asks the person to check it, and the list's
      // end never draws back (which would pull everything under the toolbar down at once).
      expect(frames.filter((frame) => frame[2].includes('狀態未確認'))).toEqual([])
      const shrinks = frames.filter((frame, index) => index > 0 && frame[1] < frames[index - 1]![1])
      expect(shrinks).toEqual([])
      await expect(processing).toHaveCount(0, { timeout: 15000 })
    }
    // 11: a request whose answer was lost is no longer on its way: it is not called sending, and
    // while its problem stands the person is offered a check.
    await fetch(`${rig.base}/__test/model-delay/0`, { method: 'POST' })
    await fetch(`${rig.base}/__test/lose-next-response`, { method: 'POST' })
    const text = '這則的回執會遺失'
    await composer.fill(text)
    await composer.press('Enter')
    const characterId = await page.evaluate(async () => {
      const connections = await window.yuki.client.connections()
      if (!connections.ok) throw Error(connections.code)
      return connections.value[0]!.characterId
    })
    const lost = () =>
      page.evaluate(
        async ({ characterId, text }) => {
          const result = await window.yuki.client.outbox(characterId)
          if (!result.ok) throw Error(result.code)
          const item = result.value.find((item) => item.body.text === text)!
          return { state: item.state, problem: item.problem, sending: item.sending }
        },
        { characterId, text },
      )
    await expect.poll(async () => (await lost()).problem, { timeout: 15000 }).toBeTruthy()
    const settled = await lost()
    evidence.lost = settled
    expect(settled.sending).toBe(false)
    if (settled.problem && settled.state !== 'result')
      await expect(
        page
          .locator('article')
          .filter({ hasText: text })
          .getByRole('button', { name: '查詢', exact: true }),
      ).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('send-steady-lost.png') })
    success = true
  } finally {
    await writeFile(
      test.info().outputPath('send-steady.json'),
      JSON.stringify(evidence, null, 2) + '\n',
    )
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'

// Coming back to the window leaves a healthy connection alone. Failure case: every focus tore the
// live stream down and opened a new one, whose first sync reloaded every picture and every list.
test('focusing the window keeps a live stream as it is', async () => {
  test.setTimeout(240000)
  const rig = await yukiFixture()
  const app = await rig.launch('focus-steady')
  let success = false
  const evidence: Record<string, unknown> = {}
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    // The stream is live once the first sync has come.
    await page.evaluate(() => {
      const state = window as unknown as { hints: string[] }
      state.hints = []
      window.yuki.client.onHint((_character, kind) => state.hints.push(kind))
    })
    await page.waitForTimeout(1500)
    await page.evaluate(() => ((window as unknown as { hints: string[] }).hints = []))
    for (let round = 0; round < 3; round++) {
      await app.evaluate(({ app, BrowserWindow }) => {
        app.emit('browser-window-focus', {}, BrowserWindow.getAllWindows()[0])
      })
      await page.waitForTimeout(1000)
    }
    const hints = await page.evaluate(() => (window as unknown as { hints: string[] }).hints)
    evidence.hints = hints
    expect(hints.filter((kind) => kind === 'sync' || kind === 'connection')).toEqual([])
    success = true
  } finally {
    await writeFile(test.info().outputPath('focus-steady.json'), JSON.stringify(evidence, null, 2))
    await app.close()
    await rig.close(success)
  }
})

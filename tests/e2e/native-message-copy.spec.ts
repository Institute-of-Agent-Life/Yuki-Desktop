import { expect, test } from '@playwright/test'
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { activeCharacterName } from '../fixtures/active-character'
import {
  currentConnection,
  pairUI,
  waitForAcceptedMessage,
  waitForMainEnded,
  yukiFixture,
} from '../fixtures/backend'

const run = promisify(execFile)

test('message Copy uses the native popup and copies the selection or full message', async () => {
  test.skip(
    process.platform !== 'darwin' || process.env.YUKI_NATIVE_MESSAGE_COPY !== '1',
    'Requires an interactive macOS desktop with Accessibility access.',
  )
  test.setTimeout(120_000)
  const rig = await yukiFixture({ nativeShell: true })
  const app = await rig.launch('message-copy')
  const fragment = 'selectMe43'
  const fullMessage = `開頭 **${fragment}** 結尾`
  const sentinel = `message-copy-${randomUUID()}`
  const fixtureTexts = [fragment, fullMessage, sentinel]
  const results: unknown[] = []
  let savedClipboard: ReturnType<typeof spawn> | undefined
  let success = false
  try {
    const driver = join(rig.root, 'mac-message-copy')
    await run('/usr/bin/swiftc', ['tests/fixtures/mac-message-copy.swift', '-o', driver], {
      timeout: 30_000,
    })
    savedClipboard = spawn(driver, ['preserve-clipboard', ...fixtureTexts], {
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    const [ready] = await once(savedClipboard.stdout!, 'data')
    expect(String(ready).trim()).toBe('ready')
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page)
    await page
      .getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼` })
      .fill(fullMessage)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const submission = await waitForAcceptedMessage(page, connection.characterId, fullMessage)
    await waitForMainEnded(page, connection.characterId, submission.requestId)
    const part = page
      .locator(`article[data-event-id="${submission.eventId}"]`)
      .getByText(fragment, {
        exact: true,
      })
    await expect(part).toBeVisible()
    const window = await app.browserWindow(page)
    const pid = await app.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true })
      BrowserWindow.getFocusedWindow()?.focus()
      return String(process.pid)
    })
    const native = async (...args: string[]) =>
      (await run(driver, args, { timeout: 10_000 })).stdout.trim()
    const rightClickCopy = async () => {
      const box = (await part.boundingBox())!
      const bounds = await window.evaluate((win) => win.getContentBounds())
      return native(
        'context-menu',
        pid,
        String(bounds.x + box.x + box.width / 2),
        String(bounds.y + box.y + box.height / 2),
      )
    }
    const selection = () => page.evaluate(() => globalThis.getSelection()?.toString() ?? '')
    const clipboard = () =>
      app.evaluate(({ clipboard }, fixtureTexts) => {
        const text = clipboard.readText()
        return fixtureTexts.includes(text) ? text : null
      }, fixtureTexts)
    const verifyCopy = async (
      expectedSelection: string,
      expected: string,
      copy: () => Promise<string>,
    ) => {
      const selected = await selection()
      expect(selected).toBe(expectedSelection)
      await app.evaluate(({ clipboard }, sentinel) => clipboard.writeText(sentinel), sentinel)
      const action = await copy()
      await expect.poll(clipboard).not.toBe(sentinel)
      const actual = await clipboard()
      results.push({ action, selected, expected, actual })
      expect.soft(actual, action).toBe(expected)
    }

    await part.dblclick()
    await verifyCopy(fragment, fragment, () => native('shortcut', pid))
    await verifyCopy(fragment, fragment, rightClickCopy)
    await part.click()
    await verifyCopy('', fullMessage, rightClickCopy)
    success = test.info().errors.length === 0
  } finally {
    if (savedClipboard && savedClipboard.exitCode === null) {
      const closed = once(savedClipboard, 'close')
      savedClipboard.stdin!.end()
      await closed
    }
    await writeFile(
      test.info().outputPath('message-copy.json'),
      JSON.stringify({ results }, null, 2) + '\n',
    )
    await app.close()
    await rig.close(success)
  }
})

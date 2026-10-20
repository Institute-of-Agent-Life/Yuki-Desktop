import { expect, test, type Page } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PromptDocuments } from '../../src/shared/api'
import { pairUI } from '../fixtures/backend'
import { launchShell } from '../fixtures/shell-app'

interface PromptFacts {
  presences: unknown[]
  files: Record<'system_prompt' | 'persona', { content: string; inode: number }>
  active: PromptDocuments['active']
  events: number
  prefixes: string[]
}
const revision = (content: string) => `sha256:${createHash('sha256').update(content).digest('hex')}`
const editor = (page: Page, key = 'system_prompt') =>
  page.getByRole('textbox', { name: `${key}.md 內容`, exact: true })
const save = (page: Page) =>
  page.locator('[data-region="toolbar"]').getByRole('button', { name: '儲存', exact: true })
async function connection(page: Page) {
  return page.evaluate(async () => {
    const result = await window.yuki.client.connections()
    if (!result.ok || !result.value[0]) throw Error('Original connection missing')
    return result.value[0]
  })
}
async function draft(page: Page, key = 'system_prompt') {
  const original = await connection(page)
  return page.evaluate(
    async ({ id, key }) => {
      const result = await window.yuki.client.promptDrafts(id)
      if (!result.ok) throw Error(result.code)
      return result.value.find((item) => item.key === key)
    },
    { id: original.characterId, key },
  )
}
async function open(page: Page) {
  await page.getByRole('button', { name: '關於 Yuki', exact: true }).click()
  await page.getByRole('button', { name: '編輯提示詞', exact: true }).click()
  await expect(editor(page)).toBeVisible()
}
async function edit(page: Page, content: string, key = 'system_prompt') {
  await expect(editor(page, key)).toHaveAttribute('aria-readonly', 'false')
  await editor(page, key).click()
  await page.keyboard.press('Control+A')
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (index) await page.keyboard.press('Enter')
    await page.keyboard.insertText(line)
  }
  await expect.poll(async () => (await draft(page, key))?.draft).toBe(content)
}

test('Windows native prompt keyboard saves, recovers a crashed draft and changes the next real request prefix', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows interactive desktop')
  const base = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  test.skip(!base, 'Requires an isolated reference server with character and prompt fixtures')
  test.setTimeout(180000)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  const facts = async (): Promise<PromptFacts> => {
    const response = await fetch(`${base}/__test/prompt-facts`)
    expect(response.ok).toBe(true)
    return response.json() as Promise<PromptFacts>
  }
  const data = await mkdtemp(join(tmpdir(), 'yuki-windows-prompts-'))
  const launch = () => launchShell(join(data, 'profile-a'))
  let a = await launch()
  const b = await launchShell(join(data, 'profile-b'))
  let mainA: number | undefined
  let mainB: number | undefined
  const cleanupErrors: unknown[] = []
  try {
    mainA = await a.evaluate(() => process.pid)
    mainB = await b.evaluate(() => process.pid)
    let pa = await a.firstWindow()
    const pb = await b.firstWindow()
    for (const [index, page] of [pa, pb].entries()) {
      await page.waitForLoadState('domcontentloaded')
      const response = await fetch(`${base}/__test/link-code`, { method: 'POST' })
      expect(response.ok).toBe(true)
      await pairUI(
        page,
        base!,
        ((await response.json()) as { code: string }).code,
        `提示詞裝置 ${index + 1}`,
        20000,
      )
      await open(page)
    }
    const native = await a.evaluate(({ app, BrowserWindow }) => ({
      pid: process.pid,
      browserPid: app.getAppMetrics().find((item) => item.type === 'Browser')?.pid,
      platform: process.platform,
      executable: app.getPath('exe'),
      packaged: app.isPackaged,
      sandboxed: app
        .getAppMetrics()
        .find((item) => item.pid === BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId())
        ?.sandboxed,
      noSandbox: app.commandLine.hasSwitch('no-sandbox'),
    }))
    expect(native.executable).toBe(process.env.YUKI_ELECTRON_EXECUTABLE)
    expect(native.pid).toBe(mainA)
    expect(native.pid).toBe(native.browserPid)
    expect(native).toMatchObject({
      platform: 'win32',
      packaged: true,
      sandboxed: true,
      noSandbox: false,
    })
    const session = Number(
      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${native.pid}).SessionId`],
        { encoding: 'utf8', windowsHide: true, timeout: 10000 },
      ).trim(),
    )
    expect(session).toBeGreaterThan(0)
    const owner = await connection(pa)
    const before = await facts()
    await writeFile(
      test.info().outputPath('windows-native-prompts-before.json'),
      JSON.stringify({ native, session, launcherPid: a.process().pid, mainB, owner }, null, 2) +
        '\n',
    )
    expect((await draft(pa))?.baseContent).toBe(before.files.system_prompt.content)
    const marker = randomUUID()
    const first = `# Windows 原生提示詞 ${marker}\r\n{{YUKI_PERSONA_CORE}}`
    const recovered = `# Windows 崩潰後恢復 ${marker}\r\n{{YUKI_PERSONA_CORE}}`
    const persona = `Windows 人格提示詞 ${marker}\n保持同一個角色與原有歷史。`
    await edit(pa, first)
    await pa.keyboard.press('Control+S')
    await expect.poll(async () => (await draft(pa))?.baseRevision).toBe(revision(first))
    await expect(save(pa)).toBeDisabled()
    let stored = await facts()
    expect(stored.files.system_prompt.content).toBe(first)
    expect(stored.active.system_prompt).toBe(revision(first))
    expect(stored.events).toBe(before.events)
    expect(stored.presences).toEqual(before.presences)
    // B remains on its original editor and must converge through its real SSE.
    await expect(editor(pb)).toContainText(`Windows 原生提示詞 ${marker}`)
    expect((await draft(pb))?.baseRevision).toBe(revision(first))
    await edit(pa, recovered)
    await pa.keyboard.press('Control+Z')
    await expect.poll(async () => (await draft(pa))?.draft).not.toBe(recovered)
    await pa.keyboard.press('Control+Y')
    await expect.poll(async () => (await draft(pa))?.draft).toBe(recovered)
    await pa
      .locator('[data-region="toolbar"]')
      .getByRole('button', { name: '關於 Yuki', exact: true })
      .click()
    const guard = pa.getByRole('dialog', { name: '要儲存變更嗎？', exact: true })
    await expect(guard).toBeVisible()
    await guard.getByRole('button', { name: '取消', exact: true }).click()
    expect((await draft(pa))?.draft).toBe(recovered)
    const launcher = a.process()
    const exited = new Promise<void>((resolve) => launcher.once('exit', () => resolve()))
    expect(process.kill(native.pid, 'SIGKILL')).toBe(true)
    mainA = undefined
    await exited
    await a.close()
    a = await launch()
    mainA = await a.evaluate(() => process.pid)
    pa = await a.firstWindow()
    await pa.waitForLoadState('domcontentloaded')
    await open(pa)
    const recovery = pa.getByRole('dialog', { name: '恢復未儲存的草稿？', exact: true })
    await expect(recovery).toBeVisible()
    await recovery.getByRole('button', { name: '恢復草稿', exact: true }).click()
    expect((await draft(pa))?.draft).toBe(recovered)
    expect((await draft(pa))?.baseRevision).toBe(revision(first))
    expect(await connection(pa)).toEqual(owner)
    await pa.keyboard.press('Control+S')
    await expect.poll(async () => (await draft(pa))?.baseRevision).toBe(revision(recovered))
    await expect(save(pa)).toBeDisabled()
    await expect(editor(pb)).toContainText(`Windows 崩潰後恢復 ${marker}`)
    await pa.getByRole('tab', { name: 'persona.md', exact: true }).click()
    await edit(pa, persona, 'persona')
    await pa.keyboard.press('Control+S')
    await expect
      .poll(async () => (await draft(pa, 'persona'))?.baseRevision)
      .toBe(revision(persona))
    await expect(save(pa)).toBeDisabled()
    stored = await facts()
    expect(stored.files.system_prompt.content).toBe(recovered)
    expect(stored.files.persona.content).toBe(persona)
    expect(stored.active).toMatchObject({
      system_prompt: revision(recovered),
      persona: revision(persona),
    })
    expect(stored.events).toBe(before.events)
    expect(stored.presences).toEqual(before.presences)
    await pa.getByRole('button', { name: '對話', exact: true }).click()
    await pa
      .getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
      .fill(`確認新提示詞前綴 ${marker}`)
    await pa.getByRole('button', { name: '送出', exact: true }).click()
    const sent = pa
      .getByRole('article')
      .filter({ has: pa.getByText(`確認新提示詞前綴 ${marker}`, { exact: true }) })
    await expect(sent).toHaveAttribute('data-event-id', /^\d+$/)
    await expect
      .poll(async () => (await facts()).prefixes.at(-1))
      .toContain(`Windows 崩潰後恢復 ${marker}`)
    const applied = await facts()
    expect(applied.prefixes.at(-1)).toContain(`Windows 崩潰後恢復 ${marker}`)
    expect(applied.prefixes.at(-1)).toContain(`Windows 人格提示詞 ${marker}`)
    await open(pa)
    await pa.screenshot({
      path: test.info().outputPath('windows-native-prompt-recovered-saved.png'),
      animations: 'disabled',
    })
    const cdp = await pa.context().newCDPSession(pa)
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const document = await cdp.send('DOM.getDocument')
    const line = await cdp.send('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector: '.cm-content .cm-line',
    })
    const fonts = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: line.nodeId })
    await writeFile(
      test.info().outputPath('windows-native-prompts.json'),
      JSON.stringify(
        {
          native,
          session,
          characterId: owner.characterId,
          originalActive: before.active,
          savedActive: stored.active,
          recoveredBase: revision(first),
          files: stored.files,
          unchangedPresences: stored.presences,
          eventsBefore: before.events,
          eventsBeforeNextRequest: stored.events,
          nextRequestPrefix: applied.prefixes.at(-1),
          actualEditorFonts: fonts.fonts,
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    // Stop the observed Electron mains, which can differ from launcher PIDs.
    // This also closes dirty failure windows without discarding their drafts.
    for (const pid of [mainA, mainB]) {
      if (!pid) continue
      try {
        process.kill(pid, 'SIGKILL')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          cleanupErrors.push(error)
          console.error('Failed to stop the test Electron main:', pid, error)
        }
      }
    }
    await Promise.allSettled([a.close(), b.close()])
    console.log(`Windows prompt evidence profiles: ${data}`)
  }
  expect(cleanupErrors).toEqual([])
})

import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pairUI } from '../fixtures/backend'
import { launchShell } from '../fixtures/shell-app'

test('Windows packaged client pairs with the real API and recovers the original message, owner and draft after process death', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows interactive desktop')
  const base = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  test.skip(!base, 'Requires an explicitly selected isolated loopback Yuki reference server')
  test.setTimeout(120000)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  const post = async (path: string) => {
    const response = await fetch(`${base}/__test/${path}`, { method: 'POST' })
    expect(response.ok).toBe(true)
    return response
  }
  const events = async () => {
    const response = await fetch(`${base}/__test/events`)
    expect(response.ok).toBe(true)
    return (await response.json()) as { id: number; text: string; direction: string }[]
  }
  const code = ((await (await post('link-code')).json()) as { code: string }).code
  const data = await mkdtemp(join(tmpdir(), 'yuki-windows-client-'))
  const marker = randomUUID()
  const first = `Windows 原生訊息 ${marker}`
  const lost = `Windows 原回應遺失 ${marker}`
  const draft = `Windows 保留草稿 ${marker}`
  let app = await launchShell(data)
  try {
    let page = await app.firstWindow()
    await pairUI(page, base!, code, undefined, 20000)
    const native = await app.evaluate(({ app, BrowserWindow, safeStorage }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      return {
        packaged: app.isPackaged,
        pid: process.pid,
        browserPid: app.getAppMetrics().find((item) => item.type === 'Browser')?.pid,
        executable: app.getPath('exe'),
        encryptionAvailable: safeStorage.isEncryptionAvailable(),
        sandboxed: app
          .getAppMetrics()
          .find((item) => item.pid === window.webContents.getOSProcessId())?.sandboxed,
      }
    })
    expect(native.pid).toBe(native.browserPid)
    expect(native.packaged).toBe(true)
    expect(native.encryptionAvailable).toBe(true)
    expect(native.sandboxed).toBe(true)
    const session = JSON.parse(
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$ErrorActionPreference='Stop'; $target=Get-Process -Id ${native.pid}; ` +
            '[pscustomobject]@{SessionId=$target.SessionId; Executable=$target.Path; DesktopPresent=' +
            '(@(Get-Process explorer | Where-Object {$_.SessionId -eq $target.SessionId}).Count -gt 0)} ' +
            '| ConvertTo-Json -Compress',
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 10000 },
      ),
    ) as { SessionId: number; Executable: string; DesktopPresent: boolean }
    expect(session.SessionId).toBeGreaterThan(0)
    expect(session.DesktopPresent).toBe(true)
    expect(session.Executable.toLowerCase()).toBe(native.executable.toLowerCase())
    const storageFacts = () =>
      app.evaluate(({ app, safeStorage }) => {
        const fs = process.getBuiltinModule('node:fs')
        const path = process.getBuiltinModule('node:path')
        let keyOnDisk = false
        let localState = 'present'
        try {
          const state = JSON.parse(
            fs.readFileSync(path.join(app.getPath('userData'), 'Local State'), 'utf8'),
          )
          keyOnDisk =
            typeof state.os_crypt?.encrypted_key === 'string' &&
            state.os_crypt.encrypted_key.length > 0
        } catch (error) {
          localState = (error as NodeJS.ErrnoException).code ?? 'invalid'
        }
        return {
          userData: app.getPath('userData'),
          localState,
          keyOnDisk,
          encryptionAvailable: safeStorage.isEncryptionAvailable(),
        }
      })
    const owner = await page.evaluate(async () => {
      const result = await window.yuki.client.connections()
      if (!result.ok || result.value.length !== 1) throw Error('Expected one paired character')
      const connection = result.value[0]!
      return {
        characterId: connection.characterId,
        personId: connection.personId,
        persistentCredentials: connection.persistentCredentials,
      }
    })
    let composer = page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
    await post('pause-next-me')
    await composer.fill(first)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect
      .poll(
        async () =>
          ((await (await fetch(`${base}/__test/me-blocked`)).json()) as { blocked: boolean })
            .blocked,
      )
      .toBe(true)
    await composer.fill(draft)
    await post('resume-me')
    await expect(composer).toHaveValue(draft)
    await expect
      .poll(async () => (await events()).filter((item) => item.text === first).length, {
        timeout: 20000,
      })
      .toBe(1)
    await expect(page.getByText('真實帳本回覆', { exact: true }).first()).toBeVisible({
      timeout: 20000,
    })
    await post('lose-next-response')
    await composer.fill(lost)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(composer).toHaveValue('')
    await composer.fill(draft)
    await expect
      .poll(() =>
        page.evaluate(async (characterId) => {
          const result = await window.yuki.client.draft(characterId)
          return result.ok ? result.value : ''
        }, owner.characterId),
      )
      .toBe(draft)
    await expect
      .poll(async () => (await events()).filter((item) => item.text === lost).length, {
        timeout: 20000,
      })
      .toBe(1)
    const original = await page.evaluate(
      async ({ characterId, text }) => {
        const result = await window.yuki.client.outbox(characterId)
        if (!result.ok) throw Error('Cannot read original outbox')
        const item = result.value.find((item) => item.body.text === text)
        if (!item) throw Error('Original message is missing from outbox')
        return { requestId: item.requestId, payloadHash: item.payloadHash, state: item.state }
      },
      { characterId: owner.characterId, text: lost },
    )
    const storageBefore = await storageFacts()
    expect(owner.persistentCredentials).toBe(true)
    expect(storageBefore.userData).toBe(data)
    expect(storageBefore.keyOnDisk).toBe(true)
    await writeFile(
      test.info().outputPath('windows-client-before-crash.json'),
      JSON.stringify(
        { native, launcherPid: app.process().pid, session, owner, original, storageBefore },
        null,
        2,
      ) + '\n',
    )
    const launcher = app.process()
    const exited = new Promise<void>((resolve) => launcher.once('exit', () => resolve()))
    expect(process.kill(native.pid, 'SIGKILL')).toBe(true)
    await exited
    await app.close()
    app = await launchShell(data)
    page = await app.firstWindow()
    composer = page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
    const storageAfter = await storageFacts()
    expect(storageAfter.userData).toBe(data)
    expect(storageAfter.keyOnDisk).toBe(true)
    const connectionsAfter = await page.evaluate(() => window.yuki.client.connections())
    await writeFile(
      test.info().outputPath('windows-client-after-crash.json'),
      JSON.stringify({ storageAfter, connectionsAfter }, null, 2) + '\n',
    )
    // Windows must recover its real DPAPI credentials. Re-pairing would hide a storage failure.
    await expect(composer).toHaveValue(draft, { timeout: 20000 })
    await expect(page.getByRole('button', { name: '配對', exact: true })).toHaveCount(0)
    const recovered = await page.evaluate(
      async ({ characterId, requestId }) => {
        const connections = await window.yuki.client.connections()
        const outbox = await window.yuki.client.outbox(characterId)
        if (!connections.ok || !outbox.ok) throw Error('Cold recovery read failed')
        const connection = connections.value.find((item) => item.characterId === characterId)
        const item = outbox.value.find((item) => item.requestId === requestId)
        return {
          personId: connection?.personId,
          requestId: item?.requestId,
          payloadHash: item?.payloadHash,
        }
      },
      { characterId: owner.characterId, requestId: original.requestId },
    )
    expect(recovered).toEqual({
      personId: owner.personId,
      requestId: original.requestId,
      payloadHash: original.payloadHash,
    })
    await expect(page.getByText(lost, { exact: true })).toHaveCount(1)
    await expect
      .poll(async () => (await events()).filter((item) => item.text === lost).length)
      .toBe(1)
    await composer.press('Enter')
    await expect(composer).toHaveValue('')
    await expect
      .poll(async () => (await events()).filter((item) => item.text === draft).length, {
        timeout: 20000,
      })
      .toBe(1)
    const ledger = await events()
    const source = ledger.find((item) => item.text === first)!
    await page
      .locator(`article[data-event-id="${source.id}"]`)
      .getByRole('button', { name: '引用回覆' })
      .click()
    const quotedText = `Windows 原事件引用 ${marker}`
    await composer.fill(quotedText)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect
      .poll(
        async () => {
          const quoted = (await events()).find((item) => item.text.endsWith('\n' + quotedText))
          return quoted?.text.includes(` event=${source.id}]]`) ?? false
        },
        { timeout: 20000 },
      )
      .toBe(true)
    expect(
      (await fetch(`${base}/__test/events/${source.id}?lose_hint=true`, { method: 'DELETE' })).ok,
    ).toBe(true)
    await expect(page.getByText(first, { exact: true })).toHaveCount(0)
    const originalQuote = page.getByRole('article').filter({
      has: page.getByText(quotedText, { exact: true }),
    })
    await expect(originalQuote.getByText('引用的訊息無法讀取', { exact: true })).toBeVisible()
    await expect(originalQuote.getByText('引用：真實帳本回覆', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('windows-client-cold-recovery.png') })
    await writeFile(
      test.info().outputPath('windows-client-facts.json'),
      JSON.stringify(
        {
          native,
          session,
          owner,
          original,
          recovered,
          sourceEventId: source.id,
          originalEventId: ledger.find((item) => item.text === lost)!.id,
          uniqueOriginalMessages: ledger.filter((item) => item.text === lost).length,
          draftSubmittedOnce: ledger.filter((item) => item.text === draft).length,
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    await post('resume-me').catch(() => {})
    await app.close()
    // Retain the explicitly isolated profile for private receipt inspection, including failures.
    console.log(`Windows client evidence profile: ${data}`)
  }
})

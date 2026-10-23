import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchShell } from '../fixtures/shell-app'
import { currentConnection, pairUI } from '../fixtures/backend'
import type { EventsPage, OriginalRequest } from '../../src/shared/api'

test('native conversation wheel scrolling applies toolbar material and preserves opaque accessibility modes', async () => {
  const base = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  test.skip(!base, 'Requires an isolated reference server')
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  test.setTimeout(120000)
  const data = await mkdtemp(join(tmpdir(), 'yuki-native-toolbar-'))
  const app = await launchShell(data)
  const stages: unknown[] = []
  const proof: Record<string, unknown> = { data, stages }
  const save = () =>
    writeFile(
      test.info().outputPath('native-toolbar-scroll.json'),
      JSON.stringify(proof, null, 2) + '\n',
    )
  try {
    const page = await app.firstWindow()
    const response = await fetch(base + '/__test/link-code', { method: 'POST' })
    expect(response.ok).toBe(true)
    await pairUI(
      page,
      base!,
      ((await response.json()) as { code: string }).code,
      '捲動工具列驗證',
      20000,
    )
    const connection = await currentConnection(page)
    const native = await app.evaluate(({ app, BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      return {
        platform: process.platform,
        packaged: app.isPackaged,
        pid: process.pid,
        bounds: win.getBounds(),
        dpr: screen.getDisplayMatching(win.getBounds()).scaleFactor,
        sandboxed: app
          .getAppMetrics()
          .find((entry) => entry.pid === win.webContents.getOSProcessId())?.sandboxed,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
      }
    })
    expect(native).toMatchObject({ packaged: true, sandboxed: true, noSandbox: false })
    proof.native = native
    const boot = await page.evaluate(() => window.yuki.boot())
    proof.boot = boot
    const media = await page.evaluate(() => ({
      reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
      highContrast: matchMedia('(prefers-contrast: more)').matches,
    }))
    proof.media = media
    const marker = randomUUID()
    const text = (
      marker +
      '\n' +
      Array.from(
        { length: 200 },
        (_, i) => `${i + 1}. 原對話中的長段文字，用於捲動與工具列檢查。`,
      ).join('\n')
    ).slice(0, 5000)
    await page
      .getByRole('textbox', { name: `和 ${connection.name} 說點什麼`, exact: true })
      .fill(text)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const original = page
      .getByRole('article', { name: '你的訊息', exact: true })
      .filter({ hasText: marker })
    await expect(original).toHaveCount(1)
    const eventId = await original.getAttribute('data-event-id')
    expect(Number(eventId)).toBeGreaterThan(0)
    proof.eventId = eventId
    const toolbar = page.locator('[data-region="toolbar"]:visible')
    const log = page.getByRole('log', { name: '對話訊息', exact: true })
    const style = () =>
      toolbar.evaluate((element) => {
        const edge = getComputedStyle(element, '::before')
        const style = getComputedStyle(element),
          rect = element.getBoundingClientRect()
        return {
          filter: style.backdropFilter,
          background: style.backgroundColor,
          shadow: style.boxShadow,
          height: rect.height,
          opaque: document.documentElement.dataset.opaque,
          edgeFilter: edge.backdropFilter,
          edgeOpacity: edge.opacity,
          edgeShadow: edge.boxShadow,
        }
      })
    for (const mode of ['light', 'dark', 'opaque', 'contrast'] as const) {
      await page.keyboard.press('ControlOrMeta+,')
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page
        .getByRole('radiogroup', { name: '主題', exact: true })
        .getByRole('radio', { name: mode === 'dark' ? '深色' : '淺色', exact: true })
        .click()
      for (const [label, checked] of [
        ['永遠不透明', mode === 'opaque'],
        ['增加對比', mode === 'contrast'],
      ] as const) {
        const control = page.getByRole('switch', { name: label, exact: true })
        if (((await control.getAttribute('aria-checked')) === 'true') !== checked)
          await control.click()
      }
      expect((await style()).filter).toBe('none')
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await expect(log).toBeVisible()
      expect(await log.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
        true,
      )
      await log.hover({ position: { x: 8, y: 80 } })
      await page.mouse.wheel(0, -100000)
      await expect.poll(() => log.evaluate((element) => element.scrollTop)).toBe(0)
      await expect.poll(async () => (await style()).filter).toBe('none')
      await expect.poll(async () => (await style()).shadow).toBe('none')
      await page.mouse.wheel(0, 100000)
      await expect.poll(() => log.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
      const after = await style()
      stages.push({ mode, after, scrollTop: await log.evaluate((element) => element.scrollTop) })
      await save()
      const nativeOpaque =
        mode === 'opaque' || mode === 'contrast' || boot.reducedTransparency || boot.highContrast
      const opaque = nativeOpaque || media.reducedTransparency || media.highContrast
      await expect.poll(async () => (await style()).filter).toBe('none')
      expect((await style()).opaque).toBe(String(opaque))
      expect((await style()).height).toBe(52)
      await expect.poll(async () => (await style()).edgeOpacity).toBe('1')
      expect((await style()).edgeFilter).toBe(opaque ? 'none' : 'blur(6px)')
      if (opaque) expect((await style()).edgeShadow).not.toBe('none')
      await expect(original).toHaveAttribute('data-event-id', eventId!)
      await expect(
        page.getByRole('textbox', { name: `和 ${connection.name} 說點什麼`, exact: true }),
      ).toBeVisible()
      expect(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds()),
      ).toEqual(native.bounds)
      await page.screenshot({ path: test.info().outputPath(`native-toolbar-${mode}.png`) })
    }
    if (
      !boot.reducedTransparency &&
      !boot.highContrast &&
      !media.reducedTransparency &&
      !media.highContrast
    ) {
      await page.keyboard.press('ControlOrMeta+,')
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      for (const label of ['永遠不透明', '增加對比']) {
        const control = page.getByRole('switch', { name: label, exact: true })
        if ((await control.getAttribute('aria-checked')) === 'true') await control.click()
      }
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await log.hover({ position: { x: 8, y: 80 } })
      await page.mouse.wheel(0, 100000)
      await expect.poll(() => log.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
      const cdp = await app.context().newCDPSession(page)
      try {
        for (const [name, value] of [
          ['prefers-reduced-transparency', 'reduce'],
          ['prefers-contrast', 'more'],
        ] as const) {
          await cdp.send('Emulation.setEmulatedMedia', { features: [{ name, value }] })
          await expect
            .poll(() => page.evaluate((query) => matchMedia(query).matches, `(${name}: ${value})`))
            .toBe(true)
          await expect.poll(async () => (await style()).filter).toBe('none')
          stages.push({
            mode: 'renderer-media-emulation',
            name,
            value,
            after: await style(),
            actualOsSettingChanged: false,
          })
          await cdp.send('Emulation.setEmulatedMedia', { features: [] })
          await expect.poll(async () => (await style()).edgeFilter).toBe('blur(6px)')
        }
      } finally {
        await cdp.send('Emulation.setEmulatedMedia', { features: [] })
        await cdp.detach()
      }
    }
    // A display stress message may exceed the role's configured input limit.
    // Follow it with a real short Main turn to verify the conversation recovers.
    proof.observedLengthGuards = await log
      .getByRole('article')
      .filter({ hasText: '消息过长，请控制在 4000 个字符以内。' })
      .count()
    const recoveryMarker = randomUUID()
    const recoveryText = recoveryMarker + ' 確認原對話仍可接續。'
    await page
      .getByRole('textbox', { name: `和 ${connection.name} 說點什麼`, exact: true })
      .fill(recoveryText)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const recovery = log
      .getByRole('article', { name: '你的訊息', exact: true })
      .filter({ hasText: recoveryMarker })
    await expect(recovery).toHaveCount(1)
    const recoveryEventId = await recovery.getAttribute('data-event-id')
    expect(Number(recoveryEventId)).toBeGreaterThan(Number(eventId))
    const receipt = () =>
      page.evaluate(
        async ({ characterId, text }) => {
          const outbox = await window.yuki.client.outbox(characterId)
          if (!outbox.ok) throw Error(outbox.code)
          const original = outbox.value.find((item) => item.body.text === text)
          if (!original) throw Error('Original recovery request is missing')
          const result = await window.yuki.client.read<OriginalRequest>(characterId, {
            kind: 'request',
            requestId: original.requestId,
          })
          if (!result.ok) throw Error(result.code)
          return result.value
        },
        { characterId: connection.characterId, text: recoveryText },
      )
    await expect
      .poll(async () => (await receipt()).result_event_ids?.length ?? 0, {
        timeout: 20000,
      })
      .toBeGreaterThan(0)
    const completed = await receipt()
    expect(completed.event_id).toBe(Number(recoveryEventId))
    expect(completed.conversation_id).toBe(connection.conversationId)
    for (const eventId of completed.result_event_ids!) {
      const event = await page.evaluate(
        async ({ characterId, conversationId, eventId }) => {
          const result = await window.yuki.client.read<EventsPage>(characterId, {
            kind: 'events',
            conversationId,
            after: eventId - 1,
            limit: 1,
          })
          if (!result.ok) throw Error(result.code)
          return result.value.items[0]!
        },
        { characterId: connection.characterId, conversationId: connection.conversationId, eventId },
      )
      expect(event.id).toBe(eventId)
      expect(event.direction).toBe('outbound')
      await expect(log.locator(`article[data-event-id="${eventId}"]`)).toContainText(event.text)
    }
    proof.shortMainRecovery = {
      recoveryEventId,
      resultEventIds: completed.result_event_ids,
    }
    proof.complete = true
  } catch (error) {
    proof.error = String(error)
    throw error
  } finally {
    await save()
    await app.close().catch(() => {})
  }
})

import { activeCharacterName } from '../fixtures/active-character'
import { contentSize } from '../fixtures/visual'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { AppUpdater, UpdateCheckResult } from 'electron-updater'
import type { CancellationToken } from 'builder-util-runtime'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'

interface FixtureState {
  checks: number
  downloads: number
  installs: number
  physical: number
  rejectInstall: boolean
  holdDownload: boolean
  failDownload: boolean
  cancelled: number
  releaseDownload?: () => void
  release?: () => void
  lifecycle: string[]
}
async function mockInstaller(app: ElectronApplication) {
  await app.evaluate(({ app, shell, dialog }) => {
    const { createRequire } = process.getBuiltinModule('node:module')
    const require = createRequire(`${app.getAppPath()}/package.json`)
    const sdk = require('electron-updater') as typeof import('electron-updater')
    const { CancellationToken } =
      require('builder-util-runtime') as typeof import('builder-util-runtime')
    const state: FixtureState = {
      checks: 0,
      downloads: 0,
      installs: 0,
      physical: 0,
      rejectInstall: true,
      holdDownload: false,
      failDownload: false,
      cancelled: 0,
      lifecycle: [],
    }
    Object.assign(globalThis, { __updateFixture: state })
    app.on('before-quit', () => state.lifecycle.push('before-quit'))
    app.on('will-quit', () => state.lifecycle.push('will-quit'))
    app.on('quit', () => state.lifecycle.push('quit'))
    dialog.showMessageBox = async (...args: unknown[]) => {
      state.lifecycle.push(JSON.stringify(args))
      return { response: 0, checkboxChecked: false }
    }
    sdk.AppUpdater.prototype.checkForUpdates = async function (
      this: AppUpdater,
    ): Promise<UpdateCheckResult> {
      state.checks++
      const info = {
        version: '1.1.0',
        path: 'test-only.zip',
        files: [],
        sha512: 'UI fixture only; no installer is executed',
        releaseDate: '2026-10-20',
      }
      return {
        isUpdateAvailable: true,
        updateInfo: info,
        versionInfo: info,
        cancellationToken: new CancellationToken(),
      }
    }
    sdk.AppUpdater.prototype.downloadUpdate = async function (
      this: AppUpdater,
      token?: CancellationToken,
    ) {
      state.downloads++
      if (state.failDownload)
        throw Object.assign(new Error('fixture corrupt download'), {
          code: 'ERR_CHECKSUM_MISMATCH',
        })
      this.emit('download-progress', {
        total: 10,
        transferred: 2,
        percent: 20,
        bytesPerSecond: 10,
        delta: 10,
      })
      if (state.holdDownload)
        await token!.createPromise<void>((resolve, _reject, onCancel) => {
          state.releaseDownload = resolve
          onCancel(() => {
            state.cancelled++
          })
        })
      this.emit('update-downloaded', {
        version: '1.1.0',
        path: 'test-only.zip',
        files: [],
        sha512: 'UI fixture',
        releaseDate: '2026-10-20',
        downloadedFile: '/test-only/not-an-installer',
      })
      return [] // Match the actual Mac SDK's deferred installation return value.
    }
    for (const Constructor of [sdk.MacUpdater, sdk.NsisUpdater, sdk.AppImageUpdater]) {
      Constructor.prototype.quitAndInstall = function (this: AppUpdater) {
        state.installs++
        if (state.rejectInstall) this.emit('error', new Error('fixture: native installer rejected'))
        else app.quit() // Exercise the actual graceful exit; never run an installer.
      }
    }
    shell.openExternal = async () => {
      state.physical++
      await new Promise<void>((resolve) => {
        state.release = resolve
      })
    }
  })
}
async function snapshot(app: ElectronApplication) {
  return app.evaluate(() => {
    const state = (globalThis as unknown as { __updateFixture: FixtureState }).__updateFixture
    return {
      installs: state.installs,
      physical: state.physical,
      checks: state.checks,
      lifecycle: state.lifecycle,
    }
  })
}
async function updateState(page: Page) {
  return page.evaluate(async () => {
    const value = await window.yuki.updates.state()
    if (!value.ok) throw Error(value.code)
    return value.value
  })
}
async function configure(app: ElectronApplication, values: Partial<FixtureState>) {
  await app.evaluate((_, values) => {
    Object.assign(
      (globalThis as unknown as { __updateFixture: FixtureState }).__updateFixture,
      values,
    )
  }, values)
}
async function download(page: Page) {
  await page.getByRole('tab', { name: '一般', exact: true }).click()
  await page.getByRole('button', { name: '檢查更新', exact: true }).click()
  await page.getByRole('button', { name: '下載更新', exact: true }).click()
  await expect(page.getByRole('button', { name: '重新啟動以更新', exact: true })).toBeVisible()
}

test('actual update buttons wait for a started native operation, recover a rejected install and retain original data on restart', async () => {
  test.skip(
    !process.env.YUKI_DESKTOP_EXECUTABLE,
    'Requires a packaged executable; development mode never updates.',
  )
  test.setTimeout(120000)
  const rig = await yukiFixture({ executor: true })
  let app = await rig.launch('update-boundary'),
    success = false
  try {
    let page = await app.firstWindow()
    test.skip(
      (await updateState(page)).mode !== 'managed',
      'deb/rpm are feed-only; no automatic installation.',
    )
    await mockInstaller(app)
    await pairUI(page, rig.base, await rig.code())
    const owner = await page.evaluate(async () => {
      const value = await window.yuki.client.connections()
      if (!value.ok) throw Error(value.code)
      return value.value[0]!
    })
    await page
      .getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼`, exact: true })
      .fill('更新前要保留的草稿')
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '本機連接', exact: true }).click()
    await page
      .getByRole('button', {
        name: `允許 ${await activeCharacterName(page)} 使用這台電腦`,
        exact: true,
      })
      .click()
    await page.getByRole('switch', { name: '允許開啟網址', exact: true }).click()
    await expect(page.getByRole('switch', { name: '允許開啟網址', exact: true })).toBeChecked()
    const local = await page.evaluate(async (id) => {
      const value = await window.yuki.client.executorState(id)
      if (!value.ok || !value.value.installation) throw Error('executor unavailable')
      return value.value.installation
    }, owner.characterId)
    await download(page)
    const invoke = fetch(rig.base + '/__test/executor/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        person_id: owner.personId,
        tool_call_key: 'fixture:update-live-native',
        arguments: {
          executor_id: local.executorId,
          capability: 'open.url',
          params: { url: 'https://example.test/update-boundary' },
        },
      }),
    })
    await expect.poll(async () => (await snapshot(app)).physical).toBe(1)
    await page.getByRole('button', { name: '重新啟動以更新', exact: true }).click()
    await expect.poll(async () => (await updateState(page)).phase).toBe('preparing')
    expect((await snapshot(app)).installs).toBe(0)
    await expect(page.getByRole('dialog', { name: '正在準備更新' })).toBeVisible()
    await app.evaluate(() => {
      ;(globalThis as unknown as { __updateFixture: FixtureState }).__updateFixture.release!()
    })
    await invoke
    await expect.poll(async () => (await snapshot(app)).installs).toBe(1)
    await expect.poll(async () => (await updateState(page)).phase).toBe('error')
    const operations = async () =>
      (await (await fetch(rig.base + '/__test/executor/state')).json()) as {
        operations: { op_id: string; state: string }[]
      }
    await expect
      .poll(async () => (await operations()).operations.map((op) => op.state))
      .toEqual(['succeeded'])
    const originalOperation = (await operations()).operations[0]!.op_id
    await page.getByRole('tab', { name: '本機連接', exact: true }).click()
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const value = await window.yuki.client.executorState(id)
          return value.ok ? value.value.state : 'error'
        }, owner.characterId),
      )
      .toBe('online')
    await expect(page.getByRole('switch', { name: '允許開啟網址', exact: true })).toBeChecked()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(
      page.getByRole('textbox', {
        name: `和 ${await activeCharacterName(page)} 說點什麼`,
        exact: true,
      }),
    ).toHaveValue('更新前要保留的草稿')
    expect((await snapshot(app)).physical).toBe(1)
    await app.evaluate(() => {
      ;(globalThis as unknown as { __updateFixture: FixtureState }).__updateFixture.rejectInstall =
        false
    })
    await page.keyboard.press('ControlOrMeta+,')
    await download(page)
    const stopped = app.waitForEvent('close')
    await page.getByRole('button', { name: '重新啟動以更新', exact: true }).click()
    await stopped.catch(async (error) => {
      console.log('Update exit evidence:', await snapshot(app))
      throw error
    })
    app = await rig.launch('update-boundary')
    page = await app.firstWindow()
    await expect(
      page.getByRole('textbox', {
        name: `和 ${await activeCharacterName(page)} 說點什麼`,
        exact: true,
      }),
    ).toHaveValue('更新前要保留的草稿')
    const current = await page.evaluate(async (id) => {
      const value = await window.yuki.client.executorState(id)
      return value.ok ? value.value.installation?.executorId : undefined
    }, owner.characterId)
    expect(current).toBe(local.executorId)
    expect((await operations()).operations.map((op) => op.op_id)).toEqual([originalOperation])
    success = true
  } finally {
    if (!success) app.process().kill('SIGKILL')
    await app
      .evaluate(() => {
        ;(globalThis as unknown as { __updateFixture?: FixtureState }).__updateFixture?.release?.()
      })
      .catch(() => {})
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

test('minimum client rejection precedes credentials and opens App updates for new and returning connections', async () => {
  const rig = await yukiFixture()
  const proxy = await forwardProxy(rig.base, '/update-minimum')
  let app = await rig.launch('minimum-client'),
    success = false
  try {
    let page = await app.firstWindow()
    proxy.faults.minDesktop = '999.0.0'
    await page.getByRole('button', { name: '連接已有 Yuki', exact: true }).click()
    await page.getByRole('button', { name: '手動輸入伺服器位址', exact: true }).click()
    await page.getByLabel('伺服器位址', { exact: true }).fill(proxy.base)
    await page.getByRole('button', { name: '繼續', exact: true }).click()
    await expect(
      page.getByText('這個伺服器需要新版桌面 App，請先更新。', { exact: true }),
    ).toBeVisible()
    expect(proxy.calls.every((call) => !call.bearer)).toBe(true)
    await page.getByRole('button', { name: '查看 App 更新', exact: true }).click()
    await expect(page.getByRole('tab', { name: '一般', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await app.close()
    proxy.faults.minDesktop = null
    app = await rig.launch('minimum-returning')
    page = await app.firstWindow()
    await pairUI(page, proxy.base, await rig.code())
    await page
      .getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼`, exact: true })
      .fill('最低版本檢查仍保留原草稿')
    await app.close()
    proxy.calls.length = 0
    proxy.faults.minDesktop = '999.0.0'
    app = await rig.launch('minimum-returning')
    page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '查看 App 更新', exact: true })).toBeVisible()
    expect(proxy.calls.length).toBeGreaterThan(0)
    expect(proxy.calls.every((call) => !call.bearer)).toBe(true)
    await page.getByRole('button', { name: '查看 App 更新', exact: true }).click()
    await expect(page.getByRole('tab', { name: '一般', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    proxy.faults.minDesktop = null
    await app.close()
    app = await rig.launch('minimum-returning')
    page = await app.firstWindow()
    await expect(
      page.getByRole('textbox', {
        name: `和 ${await activeCharacterName(page)} 說點什麼`,
        exact: true,
      }),
    ).toHaveValue('最低版本檢查仍保留原草稿')
    success = true
  } finally {
    if (!success) app.process().kill('SIGKILL')
    await app.close().catch(() => {})
    await proxy.close()
    await rig.close(success)
  }
})

test('update controls cancel an active download, reject corrupt content, retain channel choice and show S16 across supported layouts', async () => {
  test.skip(!process.env.YUKI_DESKTOP_EXECUTABLE, 'Requires a packaged executable.')
  test.setTimeout(120000)
  const rig = await yukiFixture()
  let app = await rig.launch('update-controls'),
    success = false
  try {
    let page = await app.firstWindow()
    test.skip((await updateState(page)).mode !== 'managed', 'Managed update UI only.')
    await mockInstaller(app)
    await pairUI(page, rig.base, await rig.code())
    expect((await snapshot(app)).checks).toBe(0)
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '測試版本', exact: true }).click()
    await expect.poll(async () => (await updateState(page)).channel).toBe('beta')
    await configure(app, { holdDownload: true })
    await page.getByRole('button', { name: '檢查更新', exact: true }).click()
    await page.getByRole('button', { name: '下載更新', exact: true }).click()
    await expect(
      page.getByRole('progressbar', { name: '更新下載進度', exact: true }),
    ).toHaveAttribute('value', '20')
    await page.getByRole('button', { name: '取消下載', exact: true }).click()
    await expect.poll(async () => (await updateState(page)).phase).toBe('idle')
    expect(
      await app.evaluate(
        () =>
          (globalThis as unknown as { __updateFixture: FixtureState }).__updateFixture.cancelled,
      ),
    ).toBe(1)
    await expect(page.getByRole('button', { name: '重新啟動以更新', exact: true })).toHaveCount(0)
    await configure(app, { holdDownload: false, failDownload: true })
    await page.getByRole('button', { name: '檢查更新', exact: true }).click()
    await page.getByRole('button', { name: '下載更新', exact: true }).click()
    await expect(
      page.getByText('下載內容或簽章未通過核對，請重新檢查更新。', { exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: '重新啟動以更新', exact: true })).toHaveCount(0)
    await configure(app, { failDownload: false })
    await download(page)
    for (const mode of ['light', 'dark', 'opaque', 'contrast'] as const) {
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page
        .getByRole('radio', { name: mode === 'dark' ? '深色' : '淺色', exact: true })
        .click()
      for (const [name, checked] of [
        ['永遠不透明', mode === 'opaque'],
        ['增加對比', mode === 'contrast'],
        ['減少動態', true],
      ] as const) {
        const toggle = page.getByRole('switch', { name, exact: true })
        if ((await toggle.getAttribute('aria-checked')) !== String(checked)) await toggle.click()
      }
      await page.getByRole('tab', { name: '一般', exact: true }).click()
      for (const [width, height] of [
        [1600, 900],
        [1280, 800],
        [960, 640],
      ] as const) {
        const viewportMethod = await contentSize(app, page, width, height)
        if (viewportMethod === 'electron-device-emulation')
          await expect
            .poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight]))
            .toEqual([width, height])
        const ready = page.getByRole('button', { name: '重新啟動以更新', exact: true })
        await expect(async () => {
          await ready.scrollIntoViewIfNeeded()
          await expect(ready).toBeInViewport()
        }).toPass()
        await page.screenshot({ path: test.info().outputPath(`S16-settings-${mode}-${width}.png`) })
        await page.getByRole('button', { name: '返回', exact: true }).click()
        await ready.focus()
        await expect(ready).toBeFocused()
        await expect(ready).toBeInViewport()
        await page.screenshot({ path: test.info().outputPath(`S16-toolbar-${mode}-${width}.png`) })
        await page.keyboard.press('ControlOrMeta+,')
      }
    }
    expect((await snapshot(app)).installs).toBe(0)
    await app.close()
    app = await rig.launch('update-controls')
    page = await app.firstWindow()
    await expect(
      page.getByRole('textbox', {
        name: `和 ${await activeCharacterName(page)} 說點什麼`,
        exact: true,
      }),
    ).toBeVisible()
    await page.keyboard.press('ControlOrMeta+,')
    await expect(page.getByRole('tab', { name: '測試版本', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect((await updateState(page)).phase).toBe('idle')
    success = true
  } finally {
    if (!success) app.process().kill('SIGKILL')
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

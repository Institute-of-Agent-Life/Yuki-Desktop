import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Connection, Profile } from '../../src/shared/api'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
import { navigate } from '../fixtures/navigation'
import { captureViewport, contentSize } from '../fixtures/visual'
import { colorBoundary } from '../fixtures/avatar-crop'

const editor = (page: Page) => page.getByRole('dialog', { name: /^更換 .+ 的頭像$/ })

async function inputs(base: string) {
  const response = await fetch(`${base}/__test/avatar-inputs`, { method: 'POST' })
  expect(response.status, await response.clone().text()).toBe(200)
  return (await response.json()) as Record<'rotated' | 'small' | 'large' | 'broken', string>
}

async function about(page: Page) {
  await navigate(page, /^關於 /)
}

async function choose(app: ElectronApplication, page: Page, path: string) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
  }, path)
  await editor(page)
    .getByRole('button', { name: /^選擇.*圖片…$/ })
    .click()
  await expect(editor(page).getByRole('button', { name: '儲存', exact: true })).toBeEnabled()
}

async function profile(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const result = await window.yuki.client.read<Profile>(id, { kind: 'character' })
    if (!result.ok) throw Error(result.code)
    return result.value
  }, id)
}

async function sidebarColor(page: Page) {
  const image = page.locator('[data-region="sidebar"] img').first()
  if (!(await image.count())) return null
  return image.evaluate((image: HTMLImageElement) => {
    if (!image.complete || !image.naturalWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0, 1, 1)
    return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3)
  })
}

function outboxPath(root: string, name: string, connection: Connection) {
  return join(
    root,
    name,
    'connections',
    connection.characterId,
    'outbox',
    connection.personId,
    `${connection.bindingId}.sqlite3`,
  )
}

async function commandState(app: ElectronApplication, path: string, requestId: string) {
  return app.evaluate(
    ({ app }, { path, requestId }) => {
      const require = process
        .getBuiltinModule('node:module')
        .createRequire(`${app.getAppPath()}/package.json`)
      const Database = require('better-sqlite3') as typeof import('better-sqlite3')
      const db = new Database(path, { readonly: true })
      try {
        return db
          .prepare(
            "SELECT request_id AS requestId,state,problem,hash AS payloadHash,json_extract(command,'$.png') IS NOT NULL AS hasImage FROM character_commands WHERE request_id=?",
          )
          .get(requestId) as
          | {
              requestId: string
              state: string
              problem: string | null
              payloadHash: string
              hasImage: number
            }
          | undefined
      } finally {
        db.close()
      }
    },
    { path, requestId },
  )
}

async function exportRetired(app: ElectronApplication, page: Page, id: string, path: string) {
  await app.evaluate(({ dialog }, destination) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination })
  }, path)
  const result = await page.evaluate((id) => window.yuki.client.exportRetiredHistory(id), id)
  expect(result).toEqual({ ok: true, value: true })
  return readFile(path)
}

test('real image crop works in a short window; two devices resolve CAS, sync and reset the same character', async () => {
  test.setTimeout(180000)
  const rig = await yukiFixture()
  const a = await rig.launch('avatar-a')
  const b = await rig.launch('avatar-b')
  let success = false
  try {
    const pa = await a.firstWindow()
    const pb = await b.firstWindow()
    await pairUI(pa, rig.base, await rig.code())
    await pairUI(pb, rig.base, await rig.code())
    const connection = await currentConnection(pa)
    expect((await currentConnection(pb)).characterId).toBe(connection.characterId)
    const initial = await profile(pa, connection.characterId)
    const images = await inputs(rig.base)
    for (const page of [pa, pb]) {
      await about(page)
      await page
        .getByRole('region', { name: '頭像', exact: true })
        .getByRole('button', { name: '更換頭像', exact: true })
        .click()
    }
    await choose(a, pa, images.rotated)
    await expect(editor(pa)).toContainText('3000×4000')
    const crop = editor(pa).getByRole('application')
    const top = await crop.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d')!
      return [
        Array.from(context.getImageData(20, 20, 1, 1).data),
        Array.from(context.getImageData(canvas.width - 20, 20, 1, 1).data),
      ]
    })
    expect(top[0]![2]).toBeGreaterThan(220)
    expect(top[1]![0]).toBeGreaterThan(220)
    await contentSize(a, pa, 960, 492)
    await expect(crop).toHaveCSS('width', '220px')
    const save = editor(pa).getByRole('button', { name: '儲存', exact: true })
    await expect(save).toBeInViewport({ ratio: 1 })
    const zoom = editor(pa).getByRole('slider', { name: '頭像縮放', exact: true })
    await zoom.focus()
    await zoom.press('End')
    await expect(zoom).toHaveAttribute('aria-valuenow', '400')
    await crop.scrollIntoViewIfNeeded()
    const before = await colorBoundary(crop)
    const box = (await crop.boundingBox())!
    await pa.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await pa.mouse.down()
    await pa.mouse.move(box.x + box.width / 2 + 22, box.y + box.height / 2)
    await pa.mouse.up()
    await expect.poll(async () => (await colorBoundary(crop)) - before).toBeCloseTo(22, 0)
    const dragged = await colorBoundary(crop)
    await crop.press('Shift+ArrowLeft')
    await expect.poll(async () => dragged - (await colorBoundary(crop))).toBeCloseTo(20, 0)
    const shifted = await colorBoundary(crop)
    await crop.press('ArrowRight')
    await expect.poll(async () => (await colorBoundary(crop)) - shifted).toBeCloseTo(4, 0)
    const cropped = await crop
      .locator('canvas')
      .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
    await captureViewport(a, pa, test.info().outputPath('avatar-short-crop.png'))
    await contentSize(a, pa, 1440, 900)
    await expect(crop).toHaveCSS('width', '280px')
    expect(
      await crop.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
    ).toBe(cropped)
    await choose(b, pb, images.small)
    await expect(editor(pb)).toContainText('仍然可以儲存')
    await save.click()
    await expect(editor(pa)).not.toBeVisible()
    const first = await profile(pa, connection.characterId)
    expect(first.avatar_revision).toBe(initial.avatar_revision + 1)
    expect(first.avatar).not.toBeNull()
    const dimensions = await pa.evaluate(
      async ({ id, sha }) => {
        const result = await window.yuki.client.avatarBytes(id, sha, 1024)
        if (!result.ok) throw Error(result.code)
        const bytes = Uint8Array.from(result.value)
        const view = new DataView(bytes.buffer)
        return [view.getUint32(16), view.getUint32(20)]
      },
      { id: connection.characterId, sha: first.avatar!.sha256 },
    )
    expect(dimensions).toEqual([1024, 1024])
    await editor(pb).getByRole('button', { name: '儲存', exact: true }).click()
    await expect(editor(pb)).toContainText('頭像剛被另一台裝置更新')
    await expect(editor(pb).getByRole('slider', { name: '頭像縮放' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
    await editor(pb).getByRole('button', { name: '用我的', exact: true }).click()
    await expect(editor(pb)).not.toBeVisible()
    await expect
      .poll(async () => (await profile(pa, connection.characterId)).avatar_revision)
      .toBe(initial.avatar_revision + 2)
    for (const page of [pa, pb]) await expect.poll(() => sidebarColor(page)).toEqual([232, 53, 74])
    await pa
      .getByRole('region', { name: '頭像', exact: true })
      .getByRole('button', { name: '更換頭像', exact: true })
      .click()
    await editor(pa).getByRole('button', { name: '還原預設', exact: true }).click()
    await expect(editor(pa)).not.toBeVisible()
    const reset = await profile(pa, connection.characterId)
    expect(reset.avatar_revision).toBe(initial.avatar_revision + 3)
    expect(reset.avatar).toBeNull()
    for (const page of [pa, pb])
      await expect(page.locator('[data-region="sidebar"] img')).toHaveCount(0)
    success = true
  } finally {
    await a.close().catch(() => {})
    await b.close().catch(() => {})
    await rig.close(success)
  }
})

test('a committed upload with a lost response cold-recovers its original UUID once and leaves retired avatar bytes untouched', async () => {
  test.setTimeout(150000)
  const rig = await yukiFixture()
  const proxy = await forwardProxy(rig.base, '/avatar-recovery')
  let app = await rig.launch('avatar-recovery')
  let success = false
  try {
    let page = await app.firstWindow()
    await pairUI(page, proxy.base, await rig.code())
    const connection = await currentConnection(page)
    const path = outboxPath(rig.root, 'avatar-recovery', connection)
    const oldRequest = randomUUID()
    await app.evaluate(
      ({ app }, { path, oldRequest }) => {
        const require = process
          .getBuiltinModule('node:module')
          .createRequire(`${app.getAppPath()}/package.json`)
        const Database = require('better-sqlite3') as typeof import('better-sqlite3')
        const db = new Database(path)
        try {
          db.exec(
            'CREATE TABLE avatar_commands(request_id TEXT PRIMARY KEY,body BLOB,state TEXT); CREATE TABLE avatar_command_acknowledgements(request_id TEXT PRIMARY KEY,value BLOB)',
          )
          db.prepare('INSERT INTO avatar_commands VALUES(?,?,?)').run(
            oldRequest,
            Buffer.from([0, 255, 128, 10, 34]),
            'submitted',
          )
          db.prepare('INSERT INTO avatar_command_acknowledgements VALUES(?,?)').run(
            oldRequest,
            Buffer.from(' { "original": "ack bytes" }\n'),
          )
        } finally {
          db.close()
        }
      },
      { path, oldRequest },
    )
    const before = await exportRetired(
      app,
      page,
      connection.characterId,
      join(rig.root, 'retired-before.json'),
    )
    const images = await inputs(rig.base)
    const initial = await profile(page, connection.characterId)
    await about(page)
    await page
      .getByRole('region', { name: '頭像', exact: true })
      .getByRole('button', { name: '更換頭像', exact: true })
      .click()
    await choose(app, page, images.large)
    proxy.faults.loseNextSuffix = '/character/avatar'
    await editor(page).getByRole('button', { name: '儲存', exact: true }).click()
    await expect(editor(page)).toContainText('更新結果尚未確認')
    const pending = await page.evaluate(async (id) => {
      const result = await window.yuki.client.characterCommands(id)
      if (!result.ok) throw Error(result.code)
      return result.value.filter((item) => item.command.kind === 'avatar')
    }, connection.characterId)
    expect(pending).toHaveLength(1)
    const command = pending[0]!
    expect(command).toMatchObject({
      state: 'submitted',
      command: { kind: 'avatar', action: 'set' },
    })
    expect(command.command).not.toHaveProperty('png')
    expect(proxy.lostStatuses).toEqual([200])
    const writes = () =>
      proxy.calls.filter(
        (call) =>
          call.method === 'PUT' &&
          new URL(call.path, proxy.base).pathname.endsWith('/character/avatar'),
      )
    expect(writes()).toHaveLength(1)
    expect(writes()[0]!.requestId).toBe(command.requestId)
    const committed = await profile(page, connection.characterId)
    expect(committed.avatar_revision).toBe(initial.avatar_revision + 1)
    expect(await commandState(app, path, command.requestId)).toMatchObject({
      state: 'submitted',
      hasImage: 1,
    })
    const closed = app.waitForEvent('close')
    await app.evaluate(() => process.exit(1)).catch(() => {})
    await closed
    const restartCalls = proxy.calls.length
    proxy.faults.holdReceipts = false
    app = await rig.launch('avatar-recovery')
    page = await app.firstWindow()
    await expect(page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })).toBeVisible()
    await expect
      .poll(() => commandState(app, path, command.requestId))
      .toMatchObject({
        requestId: command.requestId,
        payloadHash: command.payloadHash,
        state: 'result',
        problem: null,
      })
    expect(
      proxy.calls
        .slice(restartCalls)
        .some(
          (call) => call.method === 'GET' && call.path.endsWith(`/requests/${command.requestId}`),
        ),
    ).toBe(true)
    expect(writes()).toHaveLength(1)
    const receipt = await page.evaluate(
      async ({ id, requestId }) => {
        const result = await window.yuki.client.read(id, { kind: 'request', requestId })
        if (!result.ok) throw Error(result.code)
        return result.value
      },
      { id: connection.characterId, requestId: command.requestId },
    )
    expect(receipt).toMatchObject({
      found: true,
      operation_kind: 'client.character_avatar',
      target: connection.characterId,
      payload_hash: command.payloadHash,
      status: 'succeeded',
    })
    expect((await profile(page, connection.characterId)).avatar_revision).toBe(
      committed.avatar_revision,
    )
    const after = await exportRetired(
      app,
      page,
      connection.characterId,
      join(rig.root, 'retired-after.json'),
    )
    expect(after.equals(before)).toBe(true)
    expect(
      proxy.calls.some((call) => call.requestId === oldRequest || call.path.includes(oldRequest)),
    ).toBe(false)
    success = true
  } finally {
    await app.close().catch(() => {})
    await proxy.close()
    await rig.close(success)
  }
})

test('revoking one real device clears its private avatar cache while another valid device can keep editing', async () => {
  test.setTimeout(150000)
  const rig = await yukiFixture({ character: true })
  const a = await rig.launch('avatar-permission-a')
  const b = await rig.launch('avatar-permission-b')
  let success = false
  try {
    const pa = await a.firstWindow()
    const pb = await b.firstWindow()
    await pairUI(pa, rig.base, await rig.code(), 'Avatar device A')
    await pairUI(pb, rig.base, await rig.code(), 'Avatar device B')
    const connection = await currentConnection(pa)
    const images = await inputs(rig.base)
    await about(pa)
    await pa
      .getByRole('region', { name: '頭像', exact: true })
      .getByRole('button', { name: '更換頭像', exact: true })
      .click()
    await choose(a, pa, images.small)
    await editor(pa).getByRole('button', { name: '儲存', exact: true }).click()
    await expect(editor(pa)).not.toBeVisible()
    const current = await profile(pa, connection.characterId)
    for (const page of [pa, pb]) await expect.poll(() => sidebarColor(page)).toEqual([232, 53, 74])
    await pa
      .getByRole('region', { name: '頭像', exact: true })
      .getByRole('button', { name: '更換頭像', exact: true })
      .click()
    const revoked = await fetch(`${rig.base}/__test/revoke-character-device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: connection.deviceId }),
    })
    expect(revoked.status).toBe(200)
    expect(await revoked.json()).toMatchObject({ device_id: connection.deviceId, revoked: true })
    await expect(editor(pa)).not.toBeVisible()
    await expect(
      pa
        .getByRole('region', { name: '頭像', exact: true })
        .getByRole('button', { name: '更換頭像', exact: true }),
    ).toHaveCount(0)
    const noAccess = await pa.evaluate(
      async ({ id, sha }) => {
        const result = await window.yuki.client.avatarBytes(id, sha, 64)
        return result.ok ? 'unexpected-success' : result.code
      },
      { id: connection.characterId, sha: current.avatar!.sha256 },
    )
    expect(noAccess).toBe('unauthenticated')
    await expect(pa.locator('[data-region="sidebar"] img')).toHaveCount(0)
    await expect.poll(() => sidebarColor(pb)).toEqual([232, 53, 74])
    const readable = await pb.evaluate(
      async ({ id, sha }) => {
        const result = await window.yuki.client.avatarBytes(id, sha, 64)
        return result.ok ? result.value.byteLength : result.code
      },
      { id: connection.characterId, sha: current.avatar!.sha256 },
    )
    expect(typeof readable).toBe('number')
    await about(pb)
    await expect(
      pb
        .getByRole('region', { name: '頭像', exact: true })
        .getByRole('button', { name: '更換頭像', exact: true }),
    ).toBeVisible()
    const changed = await pb.evaluate(
      async ({ id, revision }) => {
        const result = await window.yuki.client.avatarCommand(id, revision)
        if (!result.ok) throw Error(result.code)
        return result.value
      },
      { id: connection.characterId, revision: current.avatar_revision },
    )
    expect(changed).toMatchObject({ state: 'result', problem: null })
    expect((await profile(pb, connection.characterId)).avatar_revision).not.toBe(
      current.avatar_revision,
    )
    const cached = await a.evaluate(
      ({ app }, path) => {
        const require = process
          .getBuiltinModule('node:module')
          .createRequire(`${app.getAppPath()}/package.json`)
        const Database = require('better-sqlite3') as typeof import('better-sqlite3')
        const db = new Database(path, { readonly: true })
        try {
          return db
            .prepare("SELECT count(*) AS n FROM read_cache WHERE key LIKE 'avatar/%'")
            .get() as { n: number }
        } finally {
          db.close()
        }
      },
      outboxPath(rig.root, 'avatar-permission-a', connection),
    )
    expect(cached.n).toBe(0)
    success = true
  } finally {
    await a.close().catch(() => {})
    await b.close().catch(() => {})
    await rig.close(success)
  }
})

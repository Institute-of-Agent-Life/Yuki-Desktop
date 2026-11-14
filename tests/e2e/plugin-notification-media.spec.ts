import { expect, test } from '@playwright/test'
import { artifactRow } from '../fixtures/artifact-row'
import { createHash } from 'node:crypto'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArtifactPage, EventsPage } from '../../src/shared/api'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { navigate } from '../fixtures/navigation'

test('delivers an approved plugin original through the real notification worker to Electron and saves the same bytes', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ richMedia: true }),
    app = await rig.launch('approved-plugin-notification'),
    filename = 'approved-notification.gif',
    original = await readFile('tests/fixtures/media/animated.gif'),
    digest = createHash('sha256').update(original).digest('hex'),
    saved = join(rig.root, 'saved-plugin-notification.gif')
  let success = false
  try {
    await copyFile('tests/fixtures/media/animated.gif', join(rig.root, filename))
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page)
    const publish = await fetch(`${rig.base}/__test/plugin-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filename, conversationId: connection.conversationId }),
    })
    expect(publish.status).toBe(200)
    const accepted = (await publish.json()) as {
      plugin_id: string
      notification_id: string
      source_event_id: number
      media_handle_id: string
      sha256: string
      filename: string
      installation: { plugin_api: string; status: string; enabled: boolean; approved_at: string }
    }
    expect(accepted.sha256).toBe(digest)
    expect(accepted.installation).toMatchObject({
      plugin_api: '9.0',
      status: 'running',
      enabled: true,
    })
    expect(accepted.installation.approved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const receipt = async () => {
      const response = await fetch(
        `${rig.base}/__test/plugin-notification/${accepted.notification_id}`,
      )
      expect(response.status).toBe(200)
      return (await response.json()) as {
        items: {
          outbox_id: number
          status: string
          event_id: number
          source_event_id: number
          platform_message_id: string | null
          prepared: { route: { local_ledger: boolean; platform: string; provider_id: string } }
          event: {
            id: number
            caused_by_event_id: number
            native_message_id: string | null
            origin_key: string | null
            conversation_id: string
          }
          references: { artifact_id: string; version: string }[]
        }[]
      }
    }
    await expect
      .poll(async () => (await receipt()).items.map((item) => item.status), { timeout: 20000 })
      .toEqual(['sent'])
    const delivered = (await receipt()).items[0]!
    expect(delivered.source_event_id).toBe(accepted.source_event_id)
    expect(delivered.platform_message_id).toBeNull()
    expect(delivered.prepared.route).toMatchObject({
      local_ledger: true,
      platform: 'app',
      provider_id: 'app',
    })
    expect(delivered.event).toEqual({
      id: delivered.event_id,
      caused_by_event_id: accepted.source_event_id,
      native_message_id: null,
      origin_key: null,
      conversation_id: connection.conversationId,
    })
    expect(delivered.references).toHaveLength(1)
    const reference = delivered.references[0]!
    expect(reference.version).toBe(digest)
    const article = page.locator(`article[data-event-id="${delivered.event_id}"]`)
    const image = article.getByRole('img', { name: filename, exact: true })
    await expect(image).toBeVisible()
    expect(await image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(32)
    const client = await page.evaluate(
      async ({ id, conversationId, eventId }) => {
        const events = await window.yuki.client.read<EventsPage>(id, {
          kind: 'events',
          conversationId,
          after: eventId - 1,
          limit: 1,
        })
        const files = await window.yuki.client.read<ArtifactPage>(id, {
          kind: 'artifacts',
          category: 'all',
        })
        if (!events.ok || !files.ok)
          throw Error('Original notification is not readable through Client API')
        return {
          event: events.value.items.find((item) => item.event_id === eventId),
          files: files.value.items.filter((item) => item.ref.event_id === eventId),
        }
      },
      {
        id: connection.characterId,
        conversationId: connection.conversationId,
        eventId: delivered.event_id,
      },
    )
    expect(client.event?.attachments).toMatchObject([
      {
        kind: 'image',
        filename,
        mime_type: 'image/gif',
        size: original.length,
        artifact_id: reference.artifact_id,
        version: digest,
      },
    ])
    expect(client.files).toHaveLength(1)
    expect(client.files[0]).toMatchObject({
      artifact_id: reference.artifact_id,
      version: digest,
      media_type: 'image/gif',
      size: original.length,
    })
    await article.getByRole('button', { name: new RegExp(filename.replace('.', '\\.')) }).click()
    const inspector = page.getByRole('complementary', { name: '詳情', exact: true })
    await expect(inspector.getByRole('img', { name: filename, exact: true })).toBeVisible()
    await app.evaluate(({ dialog }, saved) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: saved })
    }, saved)
    await inspector.getByRole('button', { name: '存到…', exact: true }).click()
    await expect
      .poll(async () =>
        readFile(saved).then(
          (bytes) => createHash('sha256').update(bytes).digest('hex'),
          () => '',
        ),
      )
      .toBe(digest)
    expect(await readFile(saved)).toEqual(original)
    await page.getByRole('button', { name: '關閉詳情', exact: true }).click()
    await navigate(page, '檔案與成果')
    await artifactRow(page, reference.artifact_id).click()
    await expect(
      page
        .getByRole('region', { name: '成果預覽' })
        .getByRole('img', { name: filename, exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: test.info().outputPath('approved-plugin-notification-files.png'),
    })
    await writeFile(
      test.info().outputPath('plugin-notification-joined.json'),
      JSON.stringify(
        { accepted, delivered, client, savedSha256: digest, originalBytes: original.length },
        null,
        2,
      ),
    )
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

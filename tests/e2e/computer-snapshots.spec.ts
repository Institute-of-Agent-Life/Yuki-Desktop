import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { ComputerCommandItem, OriginalRequest } from '../../src/shared/api'
import { resources, type Language } from '../../src/shared/locales'
import { activeCharacterName } from '../fixtures/active-character'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { contentSize } from '../fixtures/visual'
import { navigate } from '../fixtures/navigation'

/*
 * Yuki's own computer task book (2026-11-14) §7, failure cases written before the code:
 * P1 The panel lists only the person's snapshots, or hides the daily one or Yuki's, or shows
 *    a snapshot still being taken as one that can be restored.
 * P2 "建立快照" sends a payload whose fingerprint differs from the Bot's, so a later check of
 *    the original request reports a conflict instead of its result.
 * P3 "還原到此" restores at once, without saying the whole computer goes back, that chats and
 *    memories stay, that what was done on websites stays, and what will be interrupted.
 * P4 The restore runs but HOME is not the snapshot's (the marker written after it survives).
 * P5 A fourth snapshot is listed beside the three kept instead of replacing the oldest.
 * P6 The status line keeps saying nothing about resting after the idle minutes, or says it
 *    while the display is already resting.
 * P7 The copy is missing or falls back to another language in zh-Hans or English, or the
 *    sheets lose contrast in the dark appearance.
 */

interface Snapshot {
  id: string
  request_id: string
  state: 'creating' | 'ready' | 'failed'
  source: 'daily' | 'yuki' | 'person'
  note: string | null
}
interface Facts {
  display: string
  snapshots: Snapshot[]
  restores: { request_id: string; snapshot_id: string; state: string }[]
  snapshot_images: string[]
  marker: string | null
}

/** Sheets emerge with a spring: capture them settled. */
async function settled(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          animation.effect?.getTiming().iterations === Infinity,
      ),
  )
}
async function appearance(app: ElectronApplication, page: Page, language: Language, dark: boolean) {
  await page.evaluate((language) => window.yuki.preferences({ language }), language)
  await app.evaluate(({ nativeTheme }, dark) => {
    nativeTheme.themeSource = dark ? 'dark' : 'light'
  }, dark)
  await expect(page.locator('html')).toHaveAttribute('data-theme', dark ? 'dark' : 'light')
  await expect(page.locator('html')).toHaveAttribute('lang', language)
}

test(
  'the computer page lists, takes and restores whole-computer snapshots through the real Manager, in three languages',
  { tag: '@unix-manager' },
  async () => {
    test.setTimeout(240000)
    const rig = await yukiFixture({ computer: true, character: true })
    const app = await rig.launch('computer-snapshots')
    const facts = async () => (await (await fetch(`${rig.base}/__test/computer`)).json()) as Facts
    const post = (path: string, body: unknown) =>
      fetch(`${rig.base}/__test/computer/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const evidence: Record<string, unknown> = {}
    let success = false
    try {
      const page = await app.firstWindow()
      await pairUI(page, rig.base, await rig.code())
      const name = await activeCharacterName(page)
      const { characterId } = await currentConnection(page)
      await contentSize(app, page, 1440, 900)
      await navigate(page, `${name} 的電腦`)
      await expect(page.getByRole('button', { name: '截圖存檔' })).toBeEnabled()
      // P6: the Manager's own setting, while the display is awake.
      await expect(page.getByText('閒置 30 分鐘後自動休眠', { exact: false })).toBeVisible()

      // The fixture Manager has no daily schedule (interval 0): the list starts empty.
      await post('marker', { text: '快照前的家目錄' })
      await page.getByRole('button', { name: '快照', exact: true }).click()
      const sheet = page.getByRole('dialog', { name: '快照', exact: true })
      await expect(sheet.getByText('還沒有快照', { exact: true })).toBeVisible()
      await expect(
        sheet.getByText('整台電腦（系統與家目錄）的還原點，保留最近 3 份', { exact: false }),
      ).toBeVisible()

      // P1: a snapshot being taken is listed, and only a ready one can be restored.
      await post('snapshot-delay', { seconds: 2 })
      await sheet.getByLabel('備註', { exact: true }).fill('安裝新軟體前')
      await sheet.getByRole('button', { name: '建立快照', exact: true }).click()
      const taking = sheet.getByRole('group').filter({ hasText: '你 · 正在建立… · 安裝新軟體前' })
      await expect(taking).toBeVisible()
      await expect(taking.getByRole('button')).toHaveCount(0)
      await expect(sheet.getByRole('button', { name: '建立快照', exact: true })).toBeDisabled()
      const mine = sheet.getByRole('group').filter({ hasText: '安裝新軟體前' })
      await expect(mine.getByRole('button', { name: '還原到此', exact: true })).toBeVisible()
      await post('snapshot-delay', { seconds: 0 })
      const person = (await facts()).snapshots.find((item) => item.source === 'person')!
      expect(person).toMatchObject({ state: 'ready', note: '安裝新軟體前' })
      await settled(page)
      await page.screenshot({ path: test.info().outputPath('snapshots-zh-Hant-light.png') })

      // P2: the original request the Bot recorded carries the Desktop's own fingerprint.
      const receipts = async () =>
        page.evaluate(async (id) => {
          const items = await window.yuki.client.computerCommands(id)
          if (!items.ok) throw Error(items.code)
          return Promise.all(
            items.value.map(async (item: ComputerCommandItem) => ({
              item,
              original: await window.yuki.client.read<OriginalRequest>(id, {
                kind: 'request',
                requestId: item.requestId,
              }),
            })),
          )
        }, characterId)
      for (const { item, original } of await receipts()) {
        expect(item.problem).toBeNull()
        expect(original.ok && original.value.found && original.value.payload_hash).toBe(
          item.payloadHash,
        )
      }

      // P3, P4: confirm, then the whole computer — HOME included — is the snapshot's again.
      await post('marker', { text: '快照後才寫的內容' })
      await mine.getByRole('button', { name: '還原到此', exact: true }).click()
      const confirm = page.getByRole('dialog', { name: /^把電腦還原到 .+？$/ })
      for (const text of [
        '整台電腦會回到那個時間：之後安裝的軟體、改動的檔案和瀏覽器登入都會消失，正在執行的命令會被中斷。',
        '聊天和記憶不受影響。',
        '在網站上已經做過的事（例如發文、修改密碼）不會撤回。',
        '如果想保留現在的狀態，請先建立一份快照。',
      ])
        await expect(confirm.getByText(text, { exact: true })).toBeVisible()
      await settled(page)
      await page.screenshot({ path: test.info().outputPath('restore-confirm-zh-Hant-light.png') })
      await confirm.getByRole('button', { name: '還原', exact: true }).click()
      await expect(confirm).toHaveCount(0)
      await expect
        .poll(async () => (await facts()).restores.map((item) => [item.snapshot_id, item.state]))
        .toEqual([[person.id, 'done']])
      expect((await facts()).marker).toBe('快照前的家目錄')
      await expect(page.getByText(/^正在把電腦還原到/)).toHaveCount(0)
      await expect(page.getByRole('button', { name: '截圖存檔' })).toBeEnabled()
      for (const { item, original } of await receipts())
        expect(original.ok && original.value.found && original.value.payload_hash).toBe(
          item.payloadHash,
        )

      // P5: three more snapshots; the fourth replaces the oldest, three stay listed.
      await page.getByRole('button', { name: '快照', exact: true }).click()
      for (const note of ['第二份', '第三份', '第四份']) {
        await sheet.getByLabel('備註', { exact: true }).fill(note)
        await sheet.getByRole('button', { name: '建立快照', exact: true }).click()
        await expect(
          sheet
            .getByRole('group')
            .filter({ hasText: note })
            .getByRole('button', { name: '還原到此', exact: true }),
        ).toBeVisible()
      }
      await expect(sheet.getByRole('group')).toHaveCount(3)
      await expect(sheet.getByText('安裝新軟體前', { exact: false })).toHaveCount(0)
      const kept = await facts()
      expect(
        kept.snapshots.filter((item) => item.state === 'ready').map((item) => item.note),
      ).toEqual(expect.arrayContaining(['第二份', '第三份', '第四份']))
      expect(kept.snapshots.filter((item) => item.state === 'ready')).toHaveLength(3)
      await sheet.getByRole('button', { name: '關閉', exact: true }).click()
      evidence.kept = kept

      // P7: the panel and the confirmation in each language, light and dark.
      for (const language of ['zh-Hant', 'zh-Hans', 'en'] as const) {
        const words = resources[language].computer
        for (const dark of [false, true]) {
          await appearance(app, page, language, dark)
          await page.getByRole('button', { name: words.snapshots.title, exact: true }).click()
          const panel = page.getByRole('dialog', { name: words.snapshots.title, exact: true })
          await expect(
            panel.getByRole('button', { name: words.snapshots.create, exact: true }),
          ).toBeEnabled()
          const tag = `${language}-${dark ? 'dark' : 'light'}`
          await settled(page)
          await page.screenshot({ path: test.info().outputPath(`snapshots-${tag}.png`) })
          await panel
            .getByRole('button', { name: words.snapshots.restore, exact: true })
            .first()
            .click()
          const restore = page.getByRole('dialog').filter({ hasText: words.snapshots.confirmKept })
          await expect(
            restore.getByText(words.snapshots.confirmSites, { exact: true }),
          ).toBeVisible()
          await settled(page)
          await page.screenshot({ path: test.info().outputPath(`restore-confirm-${tag}.png`) })
          await restore
            .getByRole('button', { name: resources[language].common.action.cancel })
            .click()
          await panel
            .getByRole('button', { name: resources[language].common.action.close, exact: true })
            .click()
          await expect(panel).toHaveCount(0)
          const idle = words.idleSleep_other.replace('{{count}}', '30')
          await expect(page.getByText(idle, { exact: false })).toBeVisible()
          await settled(page)
          await page.screenshot({ path: test.info().outputPath(`computer-${tag}.png`) })
        }
      }
      await appearance(app, page, 'zh-Hant', false)
      expect((await facts()).restores).toHaveLength(1)
      evidence.final = await facts()
      success = true
    } finally {
      evidence.facts = await facts().catch((error) => String(error))
      await writeFile(
        test.info().outputPath('computer-snapshots.json'),
        JSON.stringify(evidence, null, 2),
      )
      await app.close()
      await rig.close(success)
    }
  },
)

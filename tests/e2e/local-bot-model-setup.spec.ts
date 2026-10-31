import { expect, test } from '@playwright/test'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
import { isolatedDesktop } from '../fixtures/isolated-desktop'
import { currentConnection } from '../fixtures/backend'
import { runDocker } from '../../src/main/local-bot'
import type { Me } from '../../src/shared/api'

test('real local deployment reads the image catalog and opens model purposes after original pairing', async () => {
  test.skip(
    process.env.YUKI_TEST_DOCKER !== '1',
    'Requires the explicitly selected isolated Docker deployment job',
  )
  test.setTimeout(180000)
  const root = await mkdtemp(join(tmpdir(), 'yuki-local-ui-e2e-')),
    directory = join(root, '本機 Yuki'),
    desktop = await isolatedDesktop(root),
    app = await desktop.launch('desktop')
  let success = false
  const owned = relative(resolve(tmpdir()), resolve(root))
  if (isAbsolute(owned) || owned.startsWith('..') || !owned.startsWith('yuki-local-ui-e2e-'))
    throw Error('Unexpected local UI test root')
  const port = await new Promise<number>((done) => {
    const socket = createServer()
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address()
      const value = typeof address === 'object' && address ? address.port : 0
      socket.close(() => done(value))
    })
  })
  try {
    await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    }, directory)
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '在本機部署 Yuki', exact: true }).click()
    await page.getByRole('button', { name: '選擇目錄', exact: true }).click()
    await page.getByLabel('Yuki 的名稱', { exact: true }).fill('本機模型驗收 Yuki')
    await page.getByLabel('你的名稱', { exact: true }).fill('本機管理員')
    await page
      .getByLabel('服務預設', { exact: true })
      .selectOption({ label: '自訂（OpenAI 相容）' })
    await page.getByLabel('服務位址', { exact: true }).fill('http://host.docker.internal:19999/v1')
    await page.getByLabel('模型 ID', { exact: true }).fill('isolated-model')
    await page.getByLabel('本機連接埠', { exact: true }).fill(String(port))
    await page.screenshot({ path: test.info().outputPath('local-model-setup-form.png') })
    await page.getByRole('button', { name: '開始部署', exact: true }).click()
    await expect(page.getByRole('tab', { name: '模型', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('tab', { name: '用途', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const original = await currentConnection(page),
      proof = await page.evaluate(
        async (id) => ({
          me: await window.yuki.client.read<Me>(id, { kind: 'me' }),
          bundle: await window.yuki.client.models.read(id),
          installation: await window.yuki.localBot.state(),
          presets: await window.yuki.localBot.presets(),
        }),
        original.characterId,
      )
    expect(proof.me.ok && proof.me.value.is_superuser).toBe(true)
    expect(proof.presets.ok).toBe(true)
    expect(proof.bundle.ok).toBe(true)
    if (!proof.presets.ok || !proof.bundle.ok)
      throw Error('Expected the real image and server catalogs')
    expect(proof.bundle.value.provider_presets).toEqual(proof.presets.value)
    expect(
      proof.installation.ok && proof.installation.value.installation?.superuserRequestId,
    ).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/)
    const manifest = JSON.parse(
      await readFile(resolve('resources/local-bot/manifest.json'), 'utf-8'),
    )
    expect(proof.installation.ok && proof.installation.value.installation?.image).toBe(
      manifest.image,
    )
    await page.screenshot({ path: test.info().outputPath('local-model-setup-purposes.png') })
    await writeFile(
      test.info().outputPath('local-model-setup.json'),
      JSON.stringify({ original, manifest, proof }, null, 2),
    )
    success = true
  } finally {
    await app.close()
    if (existsSync(join(directory, 'docker-compose.yml'))) {
      const project =
        'yuki-desktop-' + createHash('sha256').update(directory).digest('hex').slice(0, 12)
      await runDocker([
        'compose',
        '--project-directory',
        directory,
        '-p',
        project,
        '-f',
        join(directory, 'docker-compose.yml'),
        '-f',
        join(directory, 'docker-compose.local.yml'),
        'down',
      ])
    }
    if (success) await rm(root, { recursive: true, force: true })
    else console.error(`Isolated local deployment evidence retained at ${root}`)
  }
})

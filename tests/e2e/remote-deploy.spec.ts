import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolatedDesktop } from '../fixtures/isolated-desktop'
import { currentConnection } from '../fixtures/backend'
import { fillSsh } from '../fixtures/ssh-host'

// "Deploy to my server" on a real, disposable Linux server: the shipped install.sh and deployment
// package, the real Yuki image, its sandbox and owner pairing, then chat through the SSH tunnel.
// The server cannot reach GitHub or ghcr.io; the operator's two commands bring the images in
// after the image-mirror hints, standing in for the person configuring a registry mirror.
interface RemoteServer {
  host: string
  port: number
  user: string
  key: string
  /** Shell commands run on this machine once the matching mirror hint is shown. */
  provideBotImage: string
  provideEnvironmentImage: string
}
const configured = process.env.YUKI_TEST_REMOTE_SSH
const server = configured ? (JSON.parse(configured) as RemoteServer) : undefined

function onServer(command: string) {
  return execFileSync(
    'ssh',
    [
      '-i',
      server!.key,
      '-p',
      String(server!.port),
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      `${server!.user}@${server!.host}`,
      command,
    ],
    { encoding: 'utf8' },
  )
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: test.info().outputPath(name) })
}

test('deploy to my server, chat through SSH, upgrade, and connect a second desktop with pair.sh', async () => {
  test.skip(!server, 'Requires YUKI_TEST_REMOTE_SSH: a disposable Linux server for this run')
  test.setTimeout(40 * 60 * 1000)
  const root = await mkdtemp(join(tmpdir(), 'yuki-remote-deploy-'))
  const desktop = await isolatedDesktop(root)
  let app = await desktop.launch('first')
  let success = false
  try {
    let page = await app.firstWindow()
    await shot(page, '01-welcome.png')
    await page.getByRole('button', { name: '部署到我的伺服器', exact: true }).click()
    await fillSsh(page, {
      address: `${server!.user}@${server!.host}`,
      port: server!.port,
      key: server!.key,
    })
    await shot(page, '02-server.png')
    await page.getByRole('button', { name: '檢查主機', exact: true }).click()
    await expect(page.getByLabel('主機指紋', { exact: true })).toHaveValue(/^SHA256:/, {
      timeout: 30000,
    })
    await shot(page, '03-fingerprint.png')
    await page.getByRole('button', { name: '確認指紋並檢查環境', exact: true }).click()
    await expect(page.getByText('Docker 已安裝', { exact: false })).toBeVisible({ timeout: 60000 })
    await shot(page, '04-environment.png')

    await page.getByRole('button', { name: '下一步：準備 Yuki 映像', exact: true }).click()
    await expect(page.getByText('請為伺服器配置 Docker 映像加速器', { exact: false })).toBeVisible({
      timeout: 5 * 60 * 1000,
    })
    await shot(page, '05-image-mirror-hint.png')
    execFileSync('sh', ['-c', server!.provideBotImage], { stdio: 'inherit' })
    await page.getByRole('button', { name: '重試這一步', exact: true }).click()

    await page.getByLabel('Yuki 的名稱', { exact: true }).fill('雲端 Yuki')
    await page.getByLabel('你的名稱', { exact: true }).fill('伺服器主人')
    await page
      .getByLabel('服務預設', { exact: true })
      .selectOption({ label: '自訂（OpenAI 相容）' })
    await page.getByLabel('服務位址', { exact: true }).fill('http://host.docker.internal:19999/v1')
    await page.getByLabel('模型 ID', { exact: true }).fill('isolated-model')
    await page.getByLabel('Yuki 的電腦', { exact: true }).selectOption('lite')
    await shot(page, '06-model.png')
    await page.getByRole('button', { name: '開始部署', exact: true }).click()
    await expect(page.getByText('請為伺服器配置 Docker 映像加速器', { exact: false })).toBeVisible({
      timeout: 10 * 60 * 1000,
    })
    await shot(page, '07-install-mirror-hint.png')
    execFileSync('sh', ['-c', server!.provideEnvironmentImage], { stdio: 'inherit' })
    await page.getByRole('button', { name: '重試這一步', exact: true }).click()
    await expect(page.locator('[data-character-session] [data-region="toolbar"]')).toBeVisible({
      timeout: 20 * 60 * 1000,
    })
    const first = await currentConnection(page)
    expect(first.transport?.kind).toBe('ssh')
    await shot(page, '08-chat.png')

    // One deployment, one owner Person, even though the first install run failed after .env.
    const directory = first.transport?.kind === 'ssh' ? first.transport.directory : ''
    const owners = onServer(
      `cd '${directory}' && sudo -n docker compose exec -T bot python -c "import sqlite3; db = sqlite3.connect('/app/data/yuki.db'); print(db.execute('SELECT count(*) FROM persons').fetchone()[0])"`,
    ).trim()
    const deployments = onServer(
      "sudo -n docker ps --filter label=com.docker.compose.service=bot --format '{{.Names}}' | wc -l",
    ).trim()
    expect(deployments).toBe('1')

    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '連線', exact: true }).click()
    await shot(page, '09-connection-settings.png')
    await page.getByRole('button', { name: '升級伺服器上的 Yuki', exact: true }).click()
    await expect(page.getByText('伺服器上的 Yuki 已升級', { exact: false })).toBeVisible({
      timeout: 15 * 60 * 1000,
    })
    await page.getByRole('button', { name: '查看伺服器日誌', exact: true }).click()
    await expect(page.getByText('bot-1', { exact: false }).first()).toBeVisible({ timeout: 60000 })
    await page.waitForTimeout(800)
    await shot(page, '10-upgrade-and-logs.png')
    await app.close()

    // Another desktop reaches the same Yuki over SSH; pair.sh gives the code, nobody copies it.
    app = await desktop.launch('second')
    page = await app.firstWindow()
    await page.getByRole('button', { name: '連接已有 Yuki', exact: true }).click()
    await page.getByRole('button', { name: '通過 SSH 連接', exact: true }).click()
    await fillSsh(page, {
      address: `${server!.user}@${server!.host}`,
      port: server!.port,
      key: server!.key,
    })
    await shot(page, '11-ssh-connect.png')
    await page.getByRole('button', { name: '檢查主機', exact: true }).click()
    await page.getByRole('button', { name: '確認指紋並連接', exact: true }).click()
    await expect(page.locator('[data-character-session] [data-region="toolbar"]')).toBeVisible({
      timeout: 120000,
    })
    const second = await currentConnection(page)
    expect(second.characterId).toBe(first.characterId)
    expect(second.personId).toBe(first.personId)
    await shot(page, '12-second-desktop-chat.png')
    await writeFile(
      test.info().outputPath('remote-deploy.json'),
      JSON.stringify({ first, second, owners, deployments }, null, 2),
    )
    expect(owners).toBe('1')
    success = true
  } finally {
    await app.close().catch(() => {})
    if (success) await rm(root, { recursive: true, force: true })
    else console.error(`Remote deployment evidence retained at ${root}`)
  }
})

import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isolatedDesktop } from '../fixtures/isolated-desktop'
import { currentConnection, yukiFixture } from '../fixtures/backend'
import { fillSsh, sshHost } from '../fixtures/ssh-host'

// Failure cases 22, 23 and 25 and the 3.3 environment steps of the usability task book, against a
// scripted server: what each step does on failure and on retry. The real installer, images and
// pairing on a real Linux server are remote-deploy.spec.ts.
const password = 'server root password ' + randomUUID()
const apiKey = 'sk-remote-deploy-' + randomUUID()
const resources = resolve('resources/local-bot')

async function bundled() {
  const manifest = JSON.parse(await readFile(join(resources, 'manifest.json'), 'utf8')) as {
    version: string
  }
  return {
    version: manifest.version,
    installer: await readFile(join(resources, 'server/install.sh')),
    bundle: await readFile(join(resources, `server/yuki-${manifest.version}-deploy.tar.gz`)),
  }
}
async function filesContaining(root: string, needle: Buffer): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) found.push(...(await filesContaining(path, needle)))
    else if (entry.isFile() && (await readFile(path)).includes(needle)) found.push(path)
  }
  return found
}

test('a non-root account that needs a sudo password is refused with an explicit explanation', async () => {
  const host = await sshHost({
    user: 'ubuntu',
    password,
    exec(command) {
      if (command.includes('/proc/meminfo'))
        return {
          stdout:
            'uid=1000\nhome=/home/ubuntu\nsudo=no\nos=Linux\narch=x86_64\nmemory=3900\ndisk=40000\ndocker=yes\n',
        }
      return { code: 127, stderr: `unexpected: ${command}` }
    },
  })
  const root = await mkdtemp(join(tmpdir(), 'yuki-remote-sudo-'))
  const app = await (await isolatedDesktop(root)).launch('sudo')
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '部署到我的伺服器', exact: true }).click()
    await fillSsh(page, { address: 'ubuntu@127.0.0.1', port: host.port, password })
    await page.getByRole('button', { name: '檢查主機', exact: true }).click()
    await page.getByRole('button', { name: '確認指紋並檢查環境', exact: true }).click()
    await expect(page.getByText('這個帳號執行 sudo 需要輸入密碼', { exact: false })).toBeVisible({
      timeout: 30000,
    })
    await expect(
      page.getByRole('button', { name: '下一步：準備 Yuki 映像', exact: true }),
    ).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('deploy-sudo-password.png') })
    expect(host.execs.some((item) => item.command.includes('install.sh'))).toBe(false)
  } finally {
    await app.close()
    await host.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('deploy to my server: Docker install, image pull and installer failures each retry from their own step', async () => {
  test.setTimeout(240000)
  const rig = await yukiFixture({ basePath: '' })
  const { version, installer, bundle } = await bundled()
  const ready = await rig.state()
  const server = {
    docker: false,
    image: false,
    environmentImage: false,
    env: false,
    // install.sh's own .env records: the owner it was told to create, and the one it created.
    ownerName: '',
    owner: '',
    owners: 0,
    uploads: new Map<string, Buffer>(),
  }
  const host = await sshHost({
    user: 'root',
    password,
    async exec(command, input) {
      if (command.includes('/proc/meminfo'))
        return {
          stdout: `uid=0\nhome=/root\nos=Linux\narch=x86_64\nmemory=3900\ndisk=40000\ndocker=${server.docker ? 'yes' : 'no'}\n`,
        }
      if (command.includes('get.docker.com')) {
        if (!command.includes('--mirror Aliyun'))
          return {
            code: 1,
            stderr:
              'curl: (28) Failed to connect to download.docker.com port 443 after 130000 ms: Timeout was reached\n',
          }
        server.docker = true
        return { stdout: 'Docker installed\n' }
      }
      if (command.includes('provider-presets')) {
        if (!server.image)
          return {
            code: 125,
            stderr:
              'docker: Error response from daemon: Get "https://ghcr.io/v2/": net/http: request canceled while waiting for connection\n',
          }
        return {
          stdout: JSON.stringify([
            {
              display_name: '自訂（OpenAI 相容）',
              protocol: 'chat_completions',
              provider: 'openai_compatible',
              default_base_url: 'https://example.invalid/v1',
              api_key_env_suggestion: 'LLM_API_KEY',
              docs_url: '',
              embedding_defaults: null,
              embedding_provider: null,
              supports_embedding: false,
              supports_model_listing: false,
            },
          ]),
        }
      }
      if (command.startsWith('cat > ') || command.includes(' cat > ')) {
        const path = /cat > '([^']+)'/.exec(command)![1]!
        server.uploads.set(path, input)
        return {}
      }
      if (command.includes('install.sh')) {
        // As install.sh since 7094d76a: a first run records the owner's name in .env; any run
        // that finds the name and no owner creates the owner, under the request ID it recorded.
        if (!server.env) server.ownerName = /--owner-name '([^']*)'/.exec(command)?.[1] ?? ''
        server.env = true
        if (!server.environmentImage)
          return {
            code: 1,
            stdout: `Pulling ghcr.io/yuanyeyoutao/yuki-environment:${version}\n`,
            stderr:
              'Error response from daemon: Get "https://ghcr.io/v2/": dial tcp: i/o timeout\n',
          }
        if (server.ownerName && !server.owner) {
          server.owner = ready.owner_person_id
          server.owners += 1
        }
        return { stdout: `Yuki ${version} is running in /root/yuki\n` }
      }
      if (command.includes('deploy/pair.sh'))
        return server.owner
          ? { stdout: `  Pairing code: ${await rig.code()}\n` }
          : { code: 1, stderr: 'No owner is recorded in .env\n' }
      if (command.includes('YUKI_PORT')) return { stdout: `${rig.port}\n` }
      if (command.includes('id -u')) return { stdout: 'uid=0\nhome=/root\n' }
      if (command.includes('compose logs')) return { stdout: 'bot-1  | Yuki is ready\n' }
      if (command.includes('rm -f')) return {}
      return { code: 127, stderr: `unexpected: ${command}` }
    },
  })
  const app = await rig.launch('deploy')
  let success = false
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '部署到我的伺服器', exact: true }).click()
    // Without a user name the server's root account is meant.
    await fillSsh(page, { address: '127.0.0.1', port: host.port, password })
    await page.getByRole('button', { name: '檢查主機', exact: true }).click()
    await expect(page.getByLabel('主機指紋', { exact: true })).toHaveValue(host.fingerprint)
    await page.screenshot({ path: test.info().outputPath('steps-01-fingerprint.png') })
    await page.getByRole('button', { name: '確認指紋並檢查環境', exact: true }).click()

    // Docker is missing: install it; the official source fails, its raw error is shown, and a
    // domestic mirror is used only once the person asks for it.
    await page.getByRole('button', { name: '安裝 Docker', exact: true }).click()
    await expect(
      page.getByText('Failed to connect to download.docker.com', { exact: false }),
    ).toBeVisible({ timeout: 30000 })
    await expect(page.getByText('國內軟體源', { exact: false }).first()).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('steps-02-docker-failed.png') })
    expect(host.execs.filter((item) => item.command.includes('--mirror Aliyun'))).toEqual([])
    await page.getByRole('button', { name: '改用國內軟體源重試', exact: true }).click()
    await expect(page.getByText('Docker 已安裝', { exact: false })).toBeVisible({ timeout: 30000 })

    // 23: the image cannot be pulled; the person is told to configure a registry mirror and
    // retries this step after doing so.
    await page.getByRole('button', { name: '下一步：準備 Yuki 映像', exact: true }).click()
    await expect(page.getByText('請為伺服器配置 Docker 映像加速器', { exact: false })).toBeVisible({
      timeout: 30000,
    })
    await page.screenshot({ path: test.info().outputPath('steps-03-image-mirror.png') })
    server.image = true
    await page.getByRole('button', { name: '重試這一步', exact: true }).click()

    await page.getByLabel('Yuki 的名稱', { exact: true }).fill('伺服器上的 Yuki')
    await page.getByLabel('你的名稱', { exact: true }).fill('伺服器主人')
    await page.getByLabel('服務位址', { exact: true }).fill('https://models.example.invalid/v1')
    await page.getByLabel('金鑰', { exact: true }).fill(apiKey)
    await page.getByLabel('模型 ID', { exact: true }).fill('remote-model')
    // 3.9 GiB recommends the headless browser profile.
    await expect(page.getByLabel('Yuki 的電腦', { exact: true })).toHaveValue('headless')
    await page.screenshot({ path: test.info().outputPath('steps-04-model.png') })
    await page.getByRole('button', { name: '開始部署', exact: true }).click()
    await expect(page.getByText('請為伺服器配置 Docker 映像加速器', { exact: false })).toBeVisible({
      timeout: 30000,
    })
    await page.screenshot({ path: test.info().outputPath('steps-05-install-mirror.png') })

    // 22: the first run created .env before failing; running install.sh again with the same
    // owner name lets it create the owner once. Desktop creates no owner and writes no .env.
    server.environmentImage = true
    await page.getByRole('button', { name: '重試這一步', exact: true }).click()
    await expect(page.locator('[data-character-session] [data-region="toolbar"]')).toBeVisible({
      timeout: 60000,
    })
    await page.screenshot({ path: test.info().outputPath('steps-06-chat.png') })
    const connection = await currentConnection(page)
    expect(connection.transport).toMatchObject({
      kind: 'ssh',
      user: 'root',
      directory: '/root/yuki',
      remotePort: rig.port,
    })
    expect(connection.personId).toBe(ready.owner_person_id)
    expect(server.owner).toBe(ready.owner_person_id)
    expect(server.owners).toBe(1)
    expect(server.ownerName).toBe('伺服器主人')
    const ownHands = host.execs.filter((item) =>
      /desktop-pair|\btee\b|YUKI_OWNER_PERSON_ID=/.test(item.command),
    )
    expect(ownHands).toEqual([])

    // 25: exactly the installer and package Desktop ships, for its own backend version; the
    // server is never asked to reach GitHub.
    const uploaded = [...server.uploads.entries()]
    expect(uploaded.find(([path]) => path.endsWith('/install.sh'))?.[1].equals(installer)).toBe(
      true,
    )
    expect(
      uploaded
        .find(([path]) => path.endsWith(`/yuki-${version}-deploy.tar.gz`))?.[1]
        .equals(bundle),
    ).toBe(true)
    const installs = host.execs.filter((item) => item.command.includes(' --yes '))
    expect(installs).toHaveLength(2)
    for (const item of installs) {
      expect(item.command).toContain("--owner-name '伺服器主人'")
      expect(item.command).toContain(`--version '${version}'`)
      expect(item.command).toContain(`yuki-${version}-deploy.tar.gz`)
      expect(item.command).toContain("--profile 'headless'")
    }
    expect(host.execs.some((item) => /github\.com/.test(item.command))).toBe(false)
    // The answers file with the model key is removed after each run.
    expect(
      host.execs.filter((item) => item.command.includes('rm -f')).length,
    ).toBeGreaterThanOrEqual(2)

    // Running the deployment again keeps the same owner and the same single connection.
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '連線', exact: true }).click()
    await page.getByRole('button', { name: '升級伺服器上的 Yuki', exact: true }).click()
    await expect(page.getByText('伺服器上的 Yuki 已升級', { exact: false })).toBeVisible({
      timeout: 60000,
    })
    await page.getByRole('button', { name: '查看伺服器日誌', exact: true }).click()
    await expect(page.getByText('bot-1  | Yuki is ready', { exact: false })).toBeVisible({
      timeout: 30000,
    })
    await page.screenshot({ path: test.info().outputPath('steps-07-manage.png') })
    expect(server.owners).toBe(1)
    expect(host.execs.filter((item) => item.command.includes('desktop-pair'))).toEqual([])
    const listed = await page.evaluate(() => window.yuki.client.connections())
    expect(listed.ok && listed.value.map((item) => item.characterId)).toEqual([
      connection.characterId,
    ])

    await app.close()
    expect(await filesContaining(join(rig.root, 'deploy'), Buffer.from(password))).toEqual([])
    expect(await filesContaining(join(rig.root, 'deploy'), Buffer.from(apiKey))).toEqual([])
    await writeFile(
      test.info().outputPath('steps.json'),
      JSON.stringify({ connection, commands: host.execs.map((item) => item.command) }, null, 2),
    )
    success = true
  } finally {
    await app.close().catch(() => {})
    await host.stop().catch(() => {})
    await rig.close(success)
  }
})

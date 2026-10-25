import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentConnector } from '../../src/main/agent-connector'

const temporary: string[] = []
afterEach(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true })
})

it('reads connection state without auditing unused app files, but refuses to publish an incomplete runtime', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yuki-connector-reading-'))
  temporary.push(directory)
  const bundle = join(directory, 'bundle')
  await mkdir(bundle)
  await writeFile(join(bundle, 'python.exe'), 'runtime fixture')
  await writeFile(
    join(bundle, 'manifest.json'),
    JSON.stringify({
      version: '0.3.5',
      protocol: 3,
      platform: process.platform,
      arch: process.arch,
      executable: 'python.exe',
      arguments: [],
      files: [
        {
          path: 'python.exe',
          sha256: createHash('sha256').update('runtime fixture').digest('hex'),
        },
        { path: 'pip/t64-arm.exe', sha256: '0'.repeat(64) },
      ],
    }),
  )
  const set = vi.fn()
  const authorize = vi.fn()
  const admission = vi.fn()
  const connector = new AgentConnector(
    {
      root: join(directory, 'managed'),
      bundledRuntime: bundle,
      store: { get: () => undefined, set },
      authorize,
      admission,
    },
    async () => JSON.stringify({ paired: false }),
  )

  await expect(connector.state()).resolves.toEqual({ available: false, bundled: true })
  await expect(connector.install()).rejects.toMatchObject({ code: 'connector_runtime_invalid' })
  expect(set).not.toHaveBeenCalled()
  expect(authorize).not.toHaveBeenCalled()
  expect(admission).not.toHaveBeenCalled()
})

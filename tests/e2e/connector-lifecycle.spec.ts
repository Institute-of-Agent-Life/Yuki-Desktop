import { expect, test } from '@playwright/test'
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  unlink,
  symlink,
  copyFile,
  open,
} from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isolatedDesktop } from '../fixtures/isolated-desktop'

test('Desktop owns one managed Connector through upgrade, concurrent start/stop, tray and quit without OS autostart', async () => {
  test.setTimeout(120000)
  const root = await mkdtemp(join(tmpdir(), 'yuki-connector-lifetime-'))
  const directory = join(root, 'original-data')
  await mkdir(directory)
  const config = JSON.stringify({ device_id: 'original-device', token: 'fixture-only-token' })
  await writeFile(join(directory, 'config.json'), config)
  await writeFile(join(directory, 'journal.sqlite3'), 'original execution and receipt fixture')
  await writeFile(join(directory, 'legacy-service'), 'installed')
  const executable = join(root, 'connector.cjs')
  await writeFile(
    executable,
    `const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(process.argv.indexOf('--data-dir')), dir = args[1];
const file = path.join(dir, 'process-events.jsonl');
const event = value => fs.appendFileSync(file, JSON.stringify(value) + '\\n');
if(args.includes('status')) {
  const status = () => { if(fs.existsSync(path.join(dir,'fail-status'))) {process.exitCode=5;return}; process.stdout.write(JSON.stringify({paired:true,device_id:'original-device',server:'https://fixture.invalid',instances:[],service:{installed:fs.existsSync(path.join(dir,'legacy-service')),running:false}})); };
  if (fs.existsSync(path.join(dir, 'hold-status'))) {
    event({kind:'status-wait',pid:process.pid});
    const watch = fs.watch(dir, () => {
      if (!fs.existsSync(path.join(dir, 'hold-status'))) { watch.close(); status(); }
    });
  } else status();
} else if(args.includes('service')) {
  event({kind:'service',args});
  if(args.includes('uninstall')) fs.unlinkSync(path.join(dir,'legacy-service'));
  else process.exitCode = 9;
} else if(args.includes('run') && args.includes('--desktop-stdin')) {
  event({kind:'start',pid:process.pid,args,identity:JSON.parse(fs.readFileSync(path.join(dir,'config.json'),'utf8')).device_id});
  process.stdin.resume();
  process.stdin.once('end',() => {event({kind:'eof',pid:process.pid}); process.exit(0)});
} else process.exitCode = 8;`,
  )
  const appRoot = join(root, 'app')
  await mkdir(appRoot)
  for (const name of ['out', 'resources', 'node_modules', 'tests'])
    await symlink(resolve(name), join(appRoot, name), 'junction')
  await copyFile(resolve('package.json'), join(appRoot, 'package.json'))
  const bundle = join(appRoot, '.cache', 'connector-runtime')
  await mkdir(bundle, { recursive: true })
  const node = basename(process.execPath)
  await copyFile(process.execPath, join(bundle, node))
  await writeFile(
    join(bundle, 'manifest.json'),
    JSON.stringify({
      version: '0.4.2',
      protocol: 4,
      platform: process.platform,
      arch: process.arch,
      executable: node,
      arguments: ['-e', await readFile(executable, 'utf8'), '--'],
      files: [
        {
          path: node,
          sha256: createHash('sha256')
            .update(await readFile(process.execPath))
            .digest('hex'),
        },
      ],
    }),
  )
  const fixture = await isolatedDesktop(root, { appRoot })
  let app = await fixture.launch('desktop')
  let applicationProcess = app.process()
  const events = async () => {
    try {
      return (await readFile(join(directory, 'process-events.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { kind: string; pid?: number; identity?: string })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
  try {
    await app.firstWindow()
    await app.evaluate(
      ({ app }, input) => {
        const { createRequire } = process.getBuiltinModule('node:module')
        const { join } = process.getBuiltinModule('node:path')
        const load = createRequire(join(app.getAppPath(), 'package.json'))
        const Database = load('better-sqlite3')
        const db = new Database(join(app.getPath('userData'), 'desktop.sqlite3'))
        const set = db.prepare(
          'INSERT INTO preferences VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        )
        set.run('appearance', JSON.stringify({ keepInTray: true }))
        set.run('agent-connector-installation', JSON.stringify(input))
        db.close()
      },
      {
        managed: true,
        dataDirectory: directory,
        runtime: {
          directory: root,
          executable: process.execPath,
          arguments: [executable],
          version: '0.4.0',
          protocol: 4,
          build: 'lifetime-fixture',
        },
      },
    )
    await app.close()
    await writeFile(join(directory, 'hold-status'), 'original 0.4.0 upgrade in flight')
    app = await fixture.launch('desktop')
    applicationProcess = app.process()
    let page = await app.firstWindow()
    await expect
      .poll(async () => (await events()).some((event) => event.kind === 'status-wait'))
      .toBe(true)
    await page.evaluate(() => {
      const target = window as Window & {
        concurrentStarts?: ReturnType<typeof window.yuki.connector.service>[]
      }
      target.concurrentStarts = [
        window.yuki.connector.service('start'),
        window.yuki.connector.service('start'),
      ]
    })
    await unlink(join(directory, 'hold-status'))
    await page.evaluate(async () => {
      const target = window as Window & {
        concurrentStarts?: ReturnType<typeof window.yuki.connector.service>[]
      }
      const results = await Promise.all(target.concurrentStarts!)
      if (results.some((result) => !result.ok)) throw Error('Concurrent original upgrade failed')
      const state = await window.yuki.connector.state()
      if (!state.ok || !state.value.available || state.value.version !== '0.4.2')
        throw Error('Original runtime was not upgraded')
    })
    await expect
      .poll(async () => (await events()).filter((event) => event.kind === 'start').length)
      .toBe(1)
    const first = (await events()).find((event) => event.kind === 'start')!
    expect(first.identity).toBe('original-device')
    expect((await events()).filter((event) => event.kind === 'service')).toEqual([
      { kind: 'service', args: ['--data-dir', directory, 'service', 'uninstall'] },
    ])
    await page.evaluate(async () => {
      const results = await Promise.all([
        window.yuki.connector.service('start'),
        window.yuki.connector.service('start'),
      ])
      if (results.some((result) => !result.ok)) throw Error('Explicit start failed')
    })
    expect((await events()).filter((event) => event.kind === 'start')).toHaveLength(1)
    await page.evaluate(async () => {
      const result = await window.yuki.connector.service('stop')
      if (!result.ok) throw Error(result.code)
    })
    await writeFile(join(directory, 'hold-status'), 'test controls the in-flight status read')
    const previousWaits = (await events()).filter((event) => event.kind === 'status-wait').length
    await page.evaluate(() => {
      const target = window as Window & {
        pendingStart?: ReturnType<typeof window.yuki.connector.service>
      }
      target.pendingStart = window.yuki.connector.service('start')
    })
    await expect
      .poll(async () => (await events()).filter((event) => event.kind === 'status-wait').length)
      .toBe(previousWaits + 1)
    await page.evaluate(() => {
      const target = window as Window & {
        pendingStop?: ReturnType<typeof window.yuki.connector.service>
      }
      target.pendingStop = window.yuki.connector.service('stop')
    })
    await unlink(join(directory, 'hold-status'))
    await page.evaluate(async () => {
      const target = window as Window & {
        pendingStart?: ReturnType<typeof window.yuki.connector.service>
        pendingStop?: ReturnType<typeof window.yuki.connector.service>
      }
      const results = await Promise.all([target.pendingStart, target.pendingStop])
      if (results.some((result) => !result?.ok)) throw Error('In-flight start/stop failed')
      const state = await window.yuki.connector.state()
      if (!state.ok || !state.value.available || state.value.running !== false)
        throw Error('Explicit stop did not finish the original pending start')
      const result = await window.yuki.connector.service('start')
      if (!result.ok) throw Error(result.code)
    })
    await expect
      .poll(async () => (await events()).filter((event) => event.kind === 'start').length)
      .toBe(3)
    const selectedBeforeFailure = await app.evaluate(({ app }) => {
      const load = process
        .getBuiltinModule('node:module')
        .createRequire(app.getAppPath() + '/package.json')
      const Database = load('better-sqlite3')
      const db = new Database(app.getPath('userData') + '/desktop.sqlite3')
      const value = db
        .prepare('SELECT value FROM preferences WHERE key=?')
        .get('agent-connector-installation').value as string
      const changed = JSON.parse(value)
      changed.runtime.build = 'explicit-start-needs-a-different-runtime'
      db.prepare('UPDATE preferences SET value=? WHERE key=?').run(
        JSON.stringify(changed),
        'agent-connector-installation',
      )
      db.close()
      return value
    })
    await writeFile(join(directory, 'hold-status'), 'test controls the failed original status read')
    await writeFile(join(directory, 'fail-status'), 'original start fails')
    const waitsBeforeFailure = (await events()).filter(
      (event) => event.kind === 'status-wait',
    ).length
    await page.evaluate(() => {
      const target = window as Window & {
        failedStart?: ReturnType<typeof window.yuki.connector.service>
      }
      target.failedStart = window.yuki.connector.service('start')
    })
    await expect
      .poll(async () => (await events()).filter((event) => event.kind === 'status-wait').length)
      .toBe(waitsBeforeFailure + 1)
    await page.evaluate(() => {
      const target = window as Window & {
        stopAfterFailure?: ReturnType<typeof window.yuki.connector.service>
      }
      target.stopAfterFailure = window.yuki.connector.service('stop')
    })
    await unlink(join(directory, 'hold-status'))
    const failedResults = await page.evaluate(async () => {
      const target = window as Window & {
        failedStart?: ReturnType<typeof window.yuki.connector.service>
        stopAfterFailure?: ReturnType<typeof window.yuki.connector.service>
      }
      return Promise.all([target.failedStart, target.stopAfterFailure])
    })
    expect(failedResults[0]).toMatchObject({ ok: false, code: 'connector_failed' })
    // Stop closes the original child even when the queued start failed. Its
    // state read sees the same original CLI error until the fixture releases it.
    expect(failedResults[1]).toMatchObject({ ok: false, code: 'connector_failed' })
    await expect
      .poll(async () => (await events()).filter((event) => event.kind === 'eof').length)
      .toBe(3)
    expect((await events()).filter((event) => event.kind === 'start')).toHaveLength(3)
    await unlink(join(directory, 'fail-status'))
    await app.evaluate(({ app }, value) => {
      const load = process
        .getBuiltinModule('node:module')
        .createRequire(app.getAppPath() + '/package.json')
      const Database = load('better-sqlite3')
      const db = new Database(app.getPath('userData') + '/desktop.sqlite3')
      db.prepare('UPDATE preferences SET value=? WHERE key=?').run(
        value,
        'agent-connector-installation',
      )
      db.close()
    }, selectedBeforeFailure)
    await page.evaluate(async () => {
      const result = await window.yuki.connector.service('start')
      if (!result.ok) throw Error(result.code)
    })
    await expect
      .poll(async () => (await events()).filter((event) => event.kind === 'start').length)
      .toBe(4)
    const trayProcess = (await events()).filter((event) => event.kind === 'start').at(-1)!
    await page.close()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
    expect(
      (await events()).some((event) => event.kind === 'eof' && event.pid === trayProcess.pid),
    ).toBe(false)
    await app.evaluate(({ app }) => app.emit('activate'))
    page = await app.firstWindow()
    await expect(page.locator('body')).toBeVisible()
    expect((await events()).filter((event) => event.kind === 'start')).toHaveLength(4)
    await app.close()
    await expect
      .poll(async () => (await events()).filter((event) => event.kind === 'eof').length)
      .toBe(4)
    expect(await readFile(join(directory, 'config.json'), 'utf8')).toBe(config)
    expect(await readFile(join(directory, 'journal.sqlite3'), 'utf8')).toBe(
      'original execution and receipt fixture',
    )
    await writeFile(
      test.info().outputPath('connector-lifetime.json'),
      JSON.stringify(await events(), null, 2),
    )
  } finally {
    await writeFile(
      test.info().outputPath('connector-lifetime.json'),
      JSON.stringify(await events(), null, 2),
    )
    if (applicationProcess.exitCode === null && applicationProcess.signalCode === null)
      await app.close()
  }
})

test('the real Connector observes Desktop Main crash, closes its transport and releases its original lock', async () => {
  test.setTimeout(120000)
  const bundle = process.env.YUKI_CONNECTOR_COMPAT_RUNTIME ?? resolve('.cache/connector-runtime')
  const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8')) as {
    version: string
    protocol: number
    executable: string
    arguments: string[]
  }
  const root = await mkdtemp(join(tmpdir(), 'yuki-real-connector-lifetime-'))
  const directory = join(root, 'original-data')
  await mkdir(directory)
  const log = join(root, 'websocket.jsonl')
  const python = join(bundle, manifest.executable)
  const server = spawn(
    python,
    [
      '-I',
      '-B',
      '-c',
      `
import asyncio,json,sys
from pathlib import Path
from websockets.asyncio.server import serve
log=Path(sys.argv[1])
def event(value):
    with log.open('a',encoding='utf-8') as stream: stream.write(json.dumps(value)+'\\n')
async def handler(socket):
    hello=json.loads(await socket.recv())
    event({'kind':'hello','value':hello,'authorized':socket.request.headers.get('Authorization')=='Bearer fixture-only-token'})
    await socket.wait_closed()
    event({'kind':'closed'})
async def main():
    async with serve(handler,'127.0.0.1',0) as server:
        print(json.dumps({'port':server.sockets[0].getsockname()[1]}),flush=True)
        await asyncio.Event().wait()
asyncio.run(main())
`,
      log,
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let output = ''
      server.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString()
        if (output.includes('\n'))
          resolve((JSON.parse(output.split('\n')[0]!) as { port: number }).port)
      })
      server.once('error', reject)
      server.once('exit', (code) => reject(Error(`Isolated WebSocket server exited ${code}`)))
    })
    const config = JSON.stringify({
      url: `ws://127.0.0.1:${port}/agents/v1/connect`,
      device_id: 'original-device',
      token: 'fixture-only-token',
      instances: [],
    })
    await writeFile(join(directory, 'config.json'), config)
    const execute = promisify(execFile)
    const original = JSON.parse(
      (
        await execute(
          python,
          [
            '-I',
            '-B',
            '-c',
            `
import json,sys
from pathlib import Path
from yuki_agent_connector.journal import Journal
journal=Journal(Path(sys.argv[1])/'journal.sqlite3',namespace='original-device')
try:
    journal.begin({'id':'original-unresolved-operation','action':'prompt','instance_id':'original-native','arguments':{'text':'never dispatched'}})
    print(json.dumps(journal.operation('original-unresolved-operation')))
finally: journal.close()
`,
            directory,
          ],
          { windowsHide: true },
        )
      ).stdout,
    )
    const fixture = await isolatedDesktop(root)
    let app = await fixture.launch('desktop')
    let applicationProcess = app.process()
    let crashed = false
    const events = async () => {
      try {
        return (await readFile(log, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as { kind: string })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      }
    }
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0)
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
        throw error
      }
    }
    try {
      await app.firstWindow()
      await app.evaluate(
        ({ app }, installation) => {
          const load = process
            .getBuiltinModule('node:module')
            .createRequire(app.getAppPath() + '/package.json')
          const Database = load('better-sqlite3')
          const db = new Database(app.getPath('userData') + '/desktop.sqlite3')
          db.prepare(
            'INSERT INTO preferences VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
          ).run('agent-connector-installation', JSON.stringify(installation))
          db.close()
        },
        {
          managed: true,
          dataDirectory: directory,
          runtime: {
            directory: bundle,
            executable: python,
            arguments: manifest.arguments,
            version: manifest.version,
            protocol: manifest.protocol,
            build: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
          },
        },
      )
      await app.close()
      app = await fixture.launch('desktop')
      applicationProcess = app.process()
      await app.firstWindow()
      await expect
        .poll(async () => (await events()).some((event) => event.kind === 'hello'))
        .toBe(true)
      const lock = await open(join(directory, 'connector.lock'), 'r')
      const bytes = Buffer.alloc(64)
      const read = await lock.read(bytes, 0, bytes.length, 1)
      await lock.close()
      const connectorPID = Number(bytes.subarray(0, read.bytesRead).toString('ascii'))
      expect(connectorPID).toBeGreaterThan(0)
      expect(alive(connectorPID)).toBe(true)
      const mainPID = await app.evaluate(() => process.pid)
      process.kill(mainPID, 'SIGKILL')
      crashed = true
      await expect.poll(() => alive(mainPID)).toBe(false)
      await expect.poll(() => alive(connectorPID)).toBe(false)
      const released = await execute(
        python,
        [
          '-I',
          '-B',
          '-c',
          `
import json,sys
from pathlib import Path
from yuki_agent_connector.journal import Journal
with (Path(sys.argv[1])/'connector.lock').open('r+b',buffering=0) as lock:
    if sys.platform=='win32':
        import msvcrt
        msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    else:
        import fcntl
        fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    try:
        journal=Journal(Path(sys.argv[1])/'journal.sqlite3',namespace='original-device')
        try: print(json.dumps(journal.operation('original-unresolved-operation')))
        finally: journal.close()
    finally:
        lock.seek(0)
        if sys.platform=='win32': msvcrt.locking(lock.fileno(),msvcrt.LK_UNLCK,1)
        else: fcntl.flock(lock.fileno(),fcntl.LOCK_UN)
`,
          directory,
        ],
        { windowsHide: true },
      )
      expect(JSON.parse(released.stdout)).toEqual(original)
      await expect
        .poll(async () => (await events()).some((event) => event.kind === 'closed'))
        .toBe(true)
      expect(await readFile(join(directory, 'config.json'), 'utf8')).toBe(config)
      await writeFile(
        test.info().outputPath('real-connector-crash.json'),
        JSON.stringify(
          {
            mainPID,
            connectorPID,
            events: await events(),
            original,
            lockReacquired: true,
          },
          null,
          2,
        ),
      )
    } finally {
      await writeFile(
        test.info().outputPath('real-connector-transport.json'),
        JSON.stringify(await events(), null, 2),
      )
      if (
        !crashed &&
        applicationProcess.exitCode === null &&
        applicationProcess.signalCode === null
      )
        await app.close()
    }
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const stopped = new Promise<void>((resolve) => server.once('exit', () => resolve()))
      server.kill()
      await stopped
    }
  }
})

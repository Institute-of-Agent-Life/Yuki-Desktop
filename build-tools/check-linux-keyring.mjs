import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electron from 'electron'

// Run inside the same DBus, Secret Service and display session as the Linux E2E suite.
// This is an actual safeStorage round trip across processes, not a credential mock.
if (process.platform !== 'linux') throw Error('This probe requires Linux Secret Service')
const root = mkdtempSync(join(tmpdir(), 'yuki-keyring-probe-'))
const entry = join(root, 'probe.cjs')
const result = join(root, 'result.json')
let backend = 'unknown'
let roundTrip = false
try {
  writeFileSync(
    entry,
    `
const { app, safeStorage } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const root = ${JSON.stringify(root)};
app.setName('Yuki');
fs.mkdirSync(path.join(root, 'profile'), { recursive: true });
app.setPath('userData', path.join(root, 'profile'));
app.whenReady().then(() => {
  const encryptionAvailable = safeStorage.isEncryptionAvailable();
  const backend = safeStorage.getSelectedStorageBackend();
  const available = encryptionAvailable
    && !['basic_text', 'unknown'].includes(backend);
  let roundTrip = false;
  if (available) {
    const file = path.join(root, 'cipher');
    const sample = 'Yuki isolated keyring persistence probe';
    if (process.argv.includes('--probe-write')) {
      fs.writeFileSync(file, safeStorage.encryptString(sample), { mode: 0o600 });
    } else {
      roundTrip = safeStorage.decryptString(fs.readFileSync(file)) === sample;
    }
  }
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({ backend, available, roundTrip }), { mode: 0o600 });
  app.quit();
}).catch(() => app.exit(1));
`,
    { mode: 0o600 },
  )
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== 'ELECTRON_RUN_AS_NODE'),
  )
  const run = (stage) => {
    const child = spawnSync(electron, [entry, stage], {
      env,
      stdio: 'ignore',
      timeout: 30000,
      killSignal: 'SIGKILL',
    })
    if (child.error || child.status !== 0) throw Error('Keyring probe process failed')
    return JSON.parse(readFileSync(result, 'utf8'))
  }
  const first = run('--probe-write')
  backend = first.backend
  if (first.available) {
    const second = run('--probe-read')
    roundTrip = second.available && second.backend === backend && second.roundTrip
  }
} catch {
  // Do not forward Chromium stderr, environment, ciphertext or credential material.
  roundTrip = false
} finally {
  rmSync(root, { recursive: true, force: true })
}
console.log(JSON.stringify({ backend, roundTrip }))
if (!roundTrip) process.exitCode = 1

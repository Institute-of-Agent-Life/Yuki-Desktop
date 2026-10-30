import { _electron as electron } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Real source app, isolated profile and OS-boundary adapters; no backend responses are mocked. */
export async function isolatedDesktop(
  root: string,
  options: { managedUpdates?: boolean; nativeShell?: boolean } = {},
) {
  const appRoot = resolve('.'),
    entry = join(root, options.nativeShell ? 'native-shell-entry.cjs' : 'desktop-entry.cjs')
  await writeFile(
    entry,
    `
const electron = require('electron');
const {app, clipboard, shell} = electron;
// Playwright forces weak/mock stores; exercise the platform's real credential backend.
app.commandLine.removeSwitch('password-store');
app.commandLine.removeSwitch('use-mock-keychain');
const fs = require('node:fs'), path = require('node:path');
const root = ${JSON.stringify(appRoot)};
if (process.platform === 'win32' && process.env.YUKI_E2E_BACKGROUND_WINDOWS === '1') require(path.join(root, 'tests/fixtures/background-window.cjs'));
app.getAppPath = () => root;
app.getVersion = () => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
${
  options.managedUpdates
    ? `// Update UI lifecycle simulation; no packaged installer or signing claim.
Object.defineProperty(app, 'isPackaged', { get: () => true });
if (process.platform === 'linux') process.env.APPIMAGE = path.join(process.env.YUKI_DESKTOP_DATA, 'test-only.AppImage');`
    : ''
}
app.setAsDefaultProtocolClient = () => false;
${
  options.nativeShell
    ? ''
    : `
let copied = '';
clipboard.writeText = value => { copied = value };
clipboard.readText = () => copied;
shell.openExternal = async () => {};
shell.openPath = async () => '';
shell.showItemInFolder = () => {};
`
}
fs.mkdirSync(process.env.YUKI_DESKTOP_DATA, { recursive: true });
app.setPath('userData', process.env.YUKI_DESKTOP_DATA);
${
  options.nativeShell
    ? ''
    : `
const Database = require(path.join(root, 'node_modules/better-sqlite3'));
const db = new Database(path.join(process.env.YUKI_DESKTOP_DATA, 'desktop.sqlite3'));
db.exec('CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
const row = db.prepare("SELECT value FROM preferences WHERE key='appearance'").get();
if (!row) db.prepare('INSERT INTO preferences VALUES(?,?)').run('appearance', JSON.stringify({keepInTray:false}));
db.close();
`
}
import(${JSON.stringify(pathToFileURL(join(appRoot, 'out/main/app.js')).href)});
`,
    { mode: 0o600 },
  )
  return {
    entry,
    launch: (profile: string, args: string[] = []) =>
      electron.launch({
        ...(process.env.YUKI_DESKTOP_EXECUTABLE
          ? { executablePath: process.env.YUKI_DESKTOP_EXECUTABLE }
          : {}),
        args: process.env.YUKI_DESKTOP_EXECUTABLE ? args : [entry, ...args],
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE'),
          ),
          YUKI_DESKTOP_DATA: join(root, profile),
        },
        chromiumSandbox: true,
      }),
  }
}

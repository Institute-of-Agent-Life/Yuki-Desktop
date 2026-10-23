import { _electron as electron } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Real source app, isolated profile and OS-boundary adapters; no backend responses are mocked. */
export async function isolatedDesktop(root: string) {
  const appRoot = resolve('.'),
    entry = join(root, 'desktop-entry.cjs')
  await writeFile(
    entry,
    `
const electron = require('electron');
const {app, clipboard, shell} = electron;
const fs = require('node:fs'), path = require('node:path');
const root = ${JSON.stringify(appRoot)};
app.getAppPath = () => root;
app.setAsDefaultProtocolClient = () => false;
let copied = '';
clipboard.writeText = value => { copied = value };
clipboard.readText = () => copied;
shell.openExternal = async () => {};
shell.openPath = async () => '';
shell.showItemInFolder = () => {};
fs.mkdirSync(process.env.YUKI_DESKTOP_DATA, { recursive: true });
const Database = require(path.join(root, 'node_modules/better-sqlite3'));
const db = new Database(path.join(process.env.YUKI_DESKTOP_DATA, 'desktop.sqlite3'));
db.exec('CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
const row = db.prepare("SELECT value FROM preferences WHERE key='appearance'").get();
if (!row) db.prepare('INSERT INTO preferences VALUES(?,?)').run('appearance', JSON.stringify({keepInTray:false}));
db.close();
import(${JSON.stringify(pathToFileURL(join(appRoot, 'out/main/app.js')).href)});
`,
    { mode: 0o600 },
  )
  return {
    entry,
    launch: (profile: string, args: string[] = []) =>
      electron.launch({
        args: [entry, ...args],
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

import Database from 'better-sqlite3'
import { openSync, closeSync, fsyncSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function preserve(path, content) {
  try {
    writeFileSync(path, content, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code !== 'EEXIST' || readFileSync(path, 'utf8') !== content) throw error
  }
  const descriptor = openSync(path, 'r+')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

export function convertSoulData(databasePath, source) {
  if (!['system_prompt', 'persona', 'none'].includes(source))
    throw new Error('Explicit --source system_prompt|persona|none is required')
  const path = resolve(databasePath),
    db = new Database(path, { fileMustExist: true })
  try {
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((row) => row.name),
    )
    if (!tables.has('prompt_drafts') && !tables.has('prompt_commands')) return { converted: false }
    const drafts = tables.has('prompt_drafts')
      ? db.prepare('SELECT * FROM prompt_drafts ORDER BY key').all()
      : []
    const commands = tables.has('prompt_commands')
      ? db.prepare('SELECT * FROM prompt_commands ORDER BY rowid').all()
      : []
    const selected = drafts.find((row) => row.key === source)
    if (source !== 'none' && !selected)
      throw new Error('The selected source has no local draft; no data was changed')
    const draft = selected ? JSON.parse(selected.value) : undefined
    if (draft && typeof draft.draft !== 'string')
      throw new Error('The selected draft has no original text')
    const archivePath = path + '.soul-upgrade.json'
    const archive = JSON.stringify({ drafts, commands }, null, 2) + '\n'
    preserve(archivePath, archive)
    const draftPath = draft ? path + '.soul-draft.md' : undefined
    if (draftPath) preserve(draftPath, draft.draft)
    db.transaction(() => {
      if (tables.has('prompt_drafts')) db.exec('DROP TABLE prompt_drafts')
      if (tables.has('prompt_commands')) db.exec('DROP TABLE prompt_commands')
    })()
    return { converted: true, archivePath, draftPath }
  } finally {
    db.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2),
    path = args[args.indexOf('--database') + 1],
    source = args[args.indexOf('--source') + 1]
  if (!args.includes('--database') || !args.includes('--source'))
    throw new Error(
      'Close the App, then provide --database <original outbox.sqlite3> --source system_prompt|persona|none',
    )
  console.log(JSON.stringify(convertSoulData(path, source)))
}

import Database from 'better-sqlite3'
import { defaultPreferences, type Preferences } from '../shared/desktop'

export class LocalStore {
  readonly db: Database.Database
  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    )
  }
  get<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM preferences WHERE key=?').get(key) as
      { value: string } | undefined
    return row ? (JSON.parse(row.value) as T) : undefined
  }
  set(key: string, value: unknown) {
    this.db
      .prepare(
        'INSERT INTO preferences VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, JSON.stringify(value))
  }
  preferences(): Preferences {
    const stored = { ...defaultPreferences, ...this.get<Partial<Preferences>>('appearance') }
    // 「桌面」 was a backdrop before the window's frost became a choice of its own; it drew nothing.
    if ((stored.backdrop as string) === 'desktop') stored.backdrop = 'plain'
    return stored
  }
}

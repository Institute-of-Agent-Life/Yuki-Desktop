import Database from 'better-sqlite3'
import { defaultPreferences, type CustomBackdrop, type Preferences } from '../shared/desktop'

const defaultBackdrop = { fit: 'fill', blur: 0, dim: 0 } as const

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
    const { opaque, customBackdrop, ...stored } = {
      ...defaultPreferences,
      ...this.get<
        Partial<Preferences> & { opaque?: boolean; customBackdrop?: Partial<CustomBackdrop> }
      >('appearance'),
    }
    // Before several pictures could be kept there was one, `customBackdrop`: it is the first kept,
    // and the backdrop if it was ('custom').
    if (customBackdrop?.light && !stored.customBackdrops.length)
      stored.customBackdrops = [
        { ...defaultBackdrop, ...customBackdrop, light: customBackdrop.light },
      ]
    if ((stored.backdrop as string) === 'custom')
      stored.backdrop = customBackdrop?.light ? `custom:${customBackdrop.light}` : 'plain'
    // 「桌面」 was a backdrop before the window's frost became a choice of its own; it drew nothing.
    if ((stored.backdrop as string) === 'desktop') stored.backdrop = 'plain'
    // Before transparency was a number it was frosted or opaque; opaque is 0.
    if (opaque) stored.transparency = 0
    return stored
  }
}

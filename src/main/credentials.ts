import { safeStorage } from 'electron'
import type { LocalStore } from './store'
import { ApiError } from './api/client'

export class Credentials {
  private readonly memory = new Map<string, string>()
  constructor(readonly store: LocalStore) {
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS credentials (key TEXT PRIMARY KEY, encrypted BLOB NOT NULL)',
    )
  }
  canPersist() {
    return (
      safeStorage.isEncryptionAvailable() &&
      !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
  }
  get(key: string) {
    const memory = this.memory.get(key)
    if (memory) return memory
    if (!this.canPersist()) return
    const row = this.store.db.prepare('SELECT encrypted FROM credentials WHERE key=?').get(key) as
      { encrypted: Buffer } | undefined
    if (!row) return
    try {
      const value = safeStorage.decryptString(row.encrypted)
      this.memory.set(key, value)
      return value
    } catch {
      throw new ApiError('credentials_unavailable')
    }
  }
  set(key: string, secret: string) {
    this.memory.set(key, secret)
    if (!this.canPersist()) return false
    this.store.db
      .prepare(
        'INSERT INTO credentials VALUES (?,?) ON CONFLICT(key) DO UPDATE SET encrypted=excluded.encrypted',
      )
      .run(key, safeStorage.encryptString(secret))
    return true
  }
}

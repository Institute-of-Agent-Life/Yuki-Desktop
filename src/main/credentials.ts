import { safeStorage } from 'electron'
import { watch } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { LocalStore } from './store'
import { ApiError } from './api/client'

/** Chromium batches Local State writes; its Windows key must exist before we acknowledge storage. */
export function windowsEncryptionKeyPersisted(directory: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = (error: unknown) => {
      watcher.close()
      reject(error)
    }
    const check = async () => {
      try {
        const state = JSON.parse(await readFile(join(directory, 'Local State'), 'utf8')) as {
          os_crypt?: { encrypted_key?: string }
        }
        if (state.os_crypt?.encrypted_key) {
          watcher.close()
          resolve()
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failed(error)
      }
    }
    const watcher = watch(directory, { persistent: false }, (_event, filename) => {
      if (filename === null || filename.toString() === 'Local State') void check()
    })
    watcher.on('error', failed)
    // Watch before reading so an atomic rename between setup and the first read cannot be missed.
    void check()
  })
}

export class Credentials {
  private readonly memory = new Map<string, string>()
  private persistenceReady?: Promise<void>
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
  async preparePersistence() {
    if (process.platform !== 'win32' || !this.canPersist()) return
    this.persistenceReady ??= windowsEncryptionKeyPersisted(dirname(this.store.db.name))
    try {
      await this.persistenceReady
    } catch {
      this.persistenceReady = undefined
      throw new ApiError('credentials_unavailable')
    }
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
  remove(key: string) {
    this.memory.delete(key)
    this.store.db.prepare('DELETE FROM credentials WHERE key=?').run(key)
  }
}

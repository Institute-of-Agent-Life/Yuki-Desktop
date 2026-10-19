import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, writeFile, rm } from 'node:fs/promises'
import { dirname, join, basename, extname } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { OriginalRequest, UploadDraft } from '../../shared/api'
import type { components } from '../../shared/contract.gen'
import type { Outbox } from '../outbox'
import { payloadHash } from '../outbox/fingerprint'
import { ApiClient, ApiError } from '../api/client'

type UploadResult = components['schemas']['UploadResult']
export class Uploads {
  private readonly pending = new Map<string, Promise<UploadDraft>>()
  constructor(
    readonly box: Outbox,
    readonly root: string,
  ) {
    box.db.exec(
      'CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY, value TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1)',
    )
  }
  list() {
    return (
      this.box.db.prepare('SELECT value FROM uploads WHERE active=1 ORDER BY rowid').all() as {
        value: string
      }[]
    ).map((row) => JSON.parse(row.value) as UploadDraft)
  }
  get(id: string): UploadDraft {
    const row = this.box.db.prepare('SELECT value FROM uploads WHERE id=? AND active=1').get(id) as
      { value: string } | undefined
    if (!row) throw new ApiError('not_found')
    return JSON.parse(row.value) as UploadDraft
  }
  private update(item: UploadDraft) {
    this.box.db
      .prepare(
        'INSERT INTO uploads(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(item.requestId, JSON.stringify(item))
    return item
  }
  private path(id: string) {
    return join(this.root, id + '.blob')
  }
  async stage(path: string): Promise<UploadDraft> {
    const id = randomUUID(),
      destination = this.path(id),
      hash = createHash('sha256')
    let size = 0
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    try {
      await pipeline(
        createReadStream(path),
        new Transform({
          transform(chunk: Buffer, _encoding, done) {
            hash.update(chunk)
            size += chunk.length
            done(null, chunk)
          },
        }),
        createWriteStream(destination + '.part', { mode: 0o600, flags: 'wx' }),
      )
      await rename(destination + '.part', destination)
    } finally {
      await rm(destination + '.part', { force: true })
    }
    const suffix = extname(path).toLowerCase(),
      kind = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic'].includes(suffix)
        ? 'image'
        : ['.mp4', '.webm', '.mov'].includes(suffix)
          ? 'video'
          : 'file'
    return this.create(id, basename(path), kind, hash.digest('hex'), size)
  }
  async record(bytes: Uint8Array) {
    if (!bytes.byteLength) throw new ApiError('validation_error')
    const id = randomUUID()
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await writeFile(this.path(id), bytes, { mode: 0o600, flag: 'wx' })
    return this.create(
      id,
      'voice.webm',
      'record',
      createHash('sha256').update(bytes).digest('hex'),
      bytes.byteLength,
    )
  }
  private create(
    requestId: string,
    filename: string,
    kind: UploadDraft['kind'],
    sha256: string,
    size: number,
  ) {
    if (!size) throw new ApiError('validation_error')
    return this.update({
      requestId,
      filename,
      kind,
      sha256,
      size,
      state: 'draft',
      mediaId: null,
      expiresAt: null,
      problem: null,
    })
  }
  remove(id: string) {
    this.box.db.prepare('UPDATE uploads SET active=0 WHERE id=?').run(id)
  }
  settled() {
    return Promise.allSettled(this.pending.values())
  }
  references(ids: string[]) {
    return ids.map((id) => {
      const item = this.get(id)
      if (item.state !== 'ready' || !item.mediaId) throw new ApiError('upload_pending')
      if (item.expiresAt !== null && item.expiresAt * 1000 <= Date.now())
        throw new ApiError('media_unavailable', 'expired')
      return item.mediaId
    })
  }
  upload(client: ApiClient, id: string): Promise<UploadDraft> {
    const previous = this.pending.get(id)
    if (previous) return previous
    const work = this.perform(client, id).finally(() => this.pending.delete(id))
    this.pending.set(id, work)
    return work
  }
  private async perform(client: ApiClient, id: string): Promise<UploadDraft> {
    let item = this.get(id)
    if (item.state === 'ready') return item
    const params = {
      sha256: item.sha256,
      size: item.size,
      filename: item.filename,
      kind: item.kind,
    }
    try {
      await this.box.verifyOwner(client)
      let result: UploadResult | undefined
      if (item.state !== 'draft') {
        const receipt = await client.get<OriginalRequest>(`requests/${id}`)
        if (receipt.found) {
          if (
            receipt.operation_kind !== 'client.upload' ||
            receipt.target !== this.box.owner.personId ||
            receipt.payload_hash !== payloadHash('client.upload', this.box.owner.personId, params)
          )
            throw new ApiError('request_conflict')
          if (receipt.problem_code) throw new ApiError(receipt.problem_code)
          result = receipt.result as UploadResult
        }
      }
      if (!result) {
        if (item.state === 'failed' && item.problem) throw new ApiError(item.problem)
        item = this.update({ ...item, state: 'submitted', problem: null })
        const query = new URLSearchParams({ request_id: id, ...params, size: String(item.size) })
        const stream = createReadStream(this.path(id))
        try {
          const response = await client.response(`uploads?${query}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: stream as unknown as BodyInit,
            duplex: 'half',
          } as RequestInit)
          result = ((await response.json()) as { data: UploadResult }).data
        } finally {
          stream.destroy()
        }
      }
      if (
        result.sha256 !== item.sha256 ||
        result.size !== item.size ||
        result.kind !== item.kind ||
        result.filename !== item.filename
      )
        throw new ApiError('request_conflict')
      return this.update({
        ...item,
        state: 'ready',
        mediaId: result.media_id,
        expiresAt: result.expires_at,
        problem: null,
      })
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'transport_unknown'
      return this.update({
        ...item,
        state: [
          'request_conflict',
          'not_found',
          'outbox_owner_mismatch',
          'validation_error',
        ].includes(code)
          ? 'failed'
          : item.state,
        problem: code,
      })
    }
  }
}

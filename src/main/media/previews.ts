import { randomUUID } from 'node:crypto'
import { open, type FileHandle } from 'node:fs/promises'
import type { ReadStream } from 'node:fs'
import { Readable } from 'node:stream'

interface Preview {
  owner: string
  source: string
  path: string
  file: FileHandle
  size: number
  mime: string
  streams: Set<ReadStream>
  closing?: Promise<void>
  timer?: ReturnType<typeof setTimeout>
}

/** An already authorized, verified cache file, held only for this preview's lifetime. */
export class Previews {
  private readonly items = new Map<string, Preview>()
  constructor(private readonly expired: (owner: string, id: string) => void = () => {}) {}
  async open(owner: string, source: string, path: string, mime: string, expiresAt?: number) {
    const replaced = [...this.items.values()].some(
      (item) => item.owner === owner && item.source === source && item.path !== path,
    )
    if (replaced) await this.closeSource(owner, source)
    const file = await open(path, 'r'),
      size = (await file.stat()).size,
      id = randomUUID(),
      item: Preview = { owner, source, path, file, size, mime, streams: new Set() }
    this.items.set(id, item)
    // This is a cache revalidation time, not a permanent denial. A successful
    // authorization after it has passed still permits a fresh preview.
    if (expiresAt !== undefined && expiresAt * 1000 > Date.now())
      item.timer = setTimeout(
        () => {
          void this.release(owner, id).then(() => this.expired(owner, id))
        },
        expiresAt * 1000 - Date.now(),
      )
    return { id, url: `app://desktop/__media/${id}` }
  }
  async release(owner: string, id: string) {
    const item = this.items.get(id)
    if (!item || item.owner !== owner) return
    if (item.closing) return item.closing
    clearTimeout(item.timer)
    for (const stream of item.streams) stream.destroy()
    item.closing = item.file.close().finally(() => this.items.delete(id))
    return item.closing
  }
  close(owner?: string) {
    const closing: Promise<void>[] = []
    for (const [id, item] of this.items)
      if (owner === undefined || owner === item.owner) closing.push(this.release(item.owner, id))
    return Promise.all(closing)
  }
  closeSource(owner: string, source: string) {
    const closing: Promise<void>[] = []
    for (const [id, item] of this.items)
      if (item.owner === owner && item.source === source) closing.push(this.release(owner, id))
    return Promise.all(closing)
  }
  inUse(path: string) {
    return [...this.items.values()].some((item) => item.path === path)
  }
  response(request: Request) {
    const id = new URL(request.url).pathname.slice('/__media/'.length),
      item = this.items.get(id)
    if (!item || item.closing) return new Response(null, { status: 404 })
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 })
    const headers = new Headers({
      'Content-Type': item.mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    let start = 0,
      end = item.size - 1
    const range = request.headers.get('Range')
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (match && (match[1] || match[2])) {
        if (!match[1]) start = Math.max(0, item.size - Number(match[2]))
        else {
          start = Number(match[1])
          if (match[2]) end = Math.min(end, Number(match[2]))
        }
      } else start = -1
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) {
        headers.set('Content-Range', `bytes */${item.size}`)
        return new Response(null, { status: 416, headers })
      }
      headers.set('Content-Range', `bytes ${start}-${end}/${item.size}`)
    }
    headers.set('Content-Length', String(Math.max(0, end - start + 1)))
    if (request.method === 'HEAD' || item.size === 0)
      return new Response(null, { status: range ? 206 : 200, headers })
    // Each request has its own positional stream; the held FD is shared, not its cursor.
    const stream = item.file.createReadStream({ start, end, autoClose: false })
    item.streams.add(stream)
    const abort = () => stream.destroy()
    request.signal.addEventListener('abort', abort, { once: true })
    const done = () => {
      item.streams.delete(stream)
      request.signal.removeEventListener('abort', abort)
    }
    stream.once('end', done)
    stream.once('close', done)
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status: range ? 206 : 200,
      headers,
    })
  }
}

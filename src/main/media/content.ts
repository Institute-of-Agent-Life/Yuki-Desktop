import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ApiClient } from '../api/client'
import { ApiError } from '../api/client'

async function digest(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export class ContentCache {
  constructor(readonly root: string) {}
  async clear() {
    await rm(this.root, { recursive: true, force: true })
  }
  async remove(sha256: string) {
    if (/^[a-f0-9]{64}$/.test(sha256)) await rm(join(this.root, sha256 + '.blob'), { force: true })
  }
  async download(client: ApiClient, route: string) {
    const response = await client.response(route),
      expected = response.headers.get('X-Yuki-Sha256')
    if (!expected || !/^[a-f0-9]{64}$/.test(expected) || !response.body)
      throw new ApiError('invalid_response')
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const destination = join(this.root, expected + '.blob')
    try {
      if ((await digest(destination)) === expected) {
        await response.body.cancel()
        return { path: destination, sha256: expected }
      }
    } catch {
      /* Missing or damaged disposable cache is downloaded again. */
    }
    const temporary = join(this.root, randomUUID() + '.part'),
      output = await open(temporary, 'wx', 0o600),
      hash = createHash('sha256')
    let size = 0
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk)
        size += chunk.byteLength
        await output.writeFile(chunk)
      }
      await output.close()
      const declared = response.headers.get('Content-Length')
      if (hash.digest('hex') !== expected || (declared !== null && Number(declared) !== size))
        throw new ApiError('content_hash_mismatch')
      await rename(temporary, destination)
      return { path: destination, sha256: expected }
    } finally {
      await output.close()
      await rm(temporary, { force: true })
    }
  }
  async bytes(path: string, expected: string) {
    const bytes = await readFile(path)
    if (createHash('sha256').update(bytes).digest('hex') !== expected)
      throw new ApiError('content_hash_mismatch')
    return bytes
  }
  async save(path: string, expected: string, destination: string) {
    const temporary = join(
        dirname(destination),
        `.${basename(destination)}.yuki-${randomUUID()}.part`,
      ),
      hash = createHash('sha256')
    try {
      await pipeline(
        createReadStream(path),
        new Transform({
          transform(chunk: Buffer, _encoding, done) {
            hash.update(chunk)
            done(null, chunk)
          },
        }),
        createWriteStream(temporary, { mode: 0o600, flags: 'wx' }),
      )
      if (hash.digest('hex') !== expected) throw new ApiError('content_hash_mismatch')
      await rename(temporary, destination)
    } finally {
      await rm(temporary, { force: true })
    }
  }
}

import { createHash } from 'node:crypto'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { backdropFits, type BackdropTable, type CustomBackdrop } from '../shared/desktop'
import { ApiError } from './api/client'

/*
 * Pictures of the person's own behind the conversation (docs/reports/2026-11-23-liquid-glass
 * §12). Each is kept under the SHA-256 of its bytes, so the same picture is kept once: the
 * original as it was, the smaller WebP copy the page shows, blurred copies of it, and its
 * average colour. Chromium decodes and scales pictures in the renderer (as for avatars); this
 * side keeps the files and serves them to the page under app://desktop/__backgrounds/.
 */
const id = /^[0-9a-f]{64}$/
const served = /^([0-9a-f]{64})(-blur(?:[1-9]|1\d|20))?\.(webp|json)$/
const extensions = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp', heif: 'heic' } as const

// What a picture's own bytes say it is.
function format(bytes: Uint8Array) {
  const text = (from: number, to: number) =>
    Buffer.from(bytes.subarray(from, to)).toString('latin1')
  if (text(1, 4) === 'PNG') return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
  if (text(0, 4) === 'GIF8') return 'gif'
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'webp'
  if (text(4, 8) === 'ftyp') return 'heif'
  return undefined
}

export class Backgrounds {
  constructor(readonly root: string) {}

  async store(original: Uint8Array, copy: Uint8Array, table: BackdropTable) {
    const kind = format(original)
    if (!kind || format(copy) !== 'webp') throw new ApiError('unsupported_image')
    if (!/^#[0-9a-f]{6}$/.test(table.average)) throw new ApiError('validation_error')
    const name = createHash('sha256').update(original).digest('hex')
    await mkdir(this.root, { recursive: true })
    await writeFile(join(this.root, `${name}.${extensions[kind]}`), original)
    await writeFile(join(this.root, `${name}.webp`), copy)
    await writeFile(join(this.root, `${name}.json`), JSON.stringify(table))
    return name
  }

  async blur(name: string, radius: number, copy: Uint8Array) {
    if (!id.test(name) || !Number.isInteger(radius) || radius < 1 || radius > 20)
      throw new ApiError('validation_error')
    if (format(copy) !== 'webp') throw new ApiError('unsupported_image')
    await stat(join(this.root, `${name}.webp`)).catch(() => {
      throw new ApiError('not_found')
    })
    await writeFile(join(this.root, `${name}-blur${radius}.webp`), copy)
  }

  /** The file a page asks for, if it is one of the kept pictures' served files. */
  file(name: string) {
    return served.test(name) ? join(this.root, name) : undefined
  }

  /** Whether a picture is kept, so a preference may name it. */
  async kept(name: unknown): Promise<boolean> {
    return (
      typeof name === 'string' &&
      id.test(name) &&
      (await stat(join(this.root, `${name}.webp`)).then(
        () => true,
        () => false,
      ))
    )
  }

  /**
   * The pictures of one's own a preference may keep, from those `given`: each names a kept
   * picture (its dark one too, or none), once; its other parts are taken where allowed.
   */
  async accept(given: unknown[]): Promise<CustomBackdrop[]> {
    const number = (value: unknown, max: number) =>
      typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(max, Math.round(value)))
        : 0
    const accepted: CustomBackdrop[] = []
    for (const entry of given as Partial<CustomBackdrop>[]) {
      if (
        !(await this.kept(entry?.light)) ||
        accepted.some((picture) => picture.light === entry.light)
      )
        continue
      accepted.push({
        light: entry.light!,
        ...((await this.kept(entry.dark)) ? { dark: entry.dark! } : {}),
        fit: backdropFits.includes(entry.fit!) ? entry.fit! : 'fill',
        blur: number(entry.blur, 20),
        dim: number(entry.dim, 60),
      })
    }
    return accepted
  }

  /** Removes every file but the pictures `kept` names, and of their blurs only those in use. */
  async keep(kept: CustomBackdrop[]) {
    const blurs = new Map<string, number[]>()
    for (const picture of kept)
      for (const name of [picture.light, picture.dark])
        if (name) blurs.set(name, [...(blurs.get(name) ?? []), picture.blur])
    const files = await readdir(this.root).catch(() => [] as string[])
    await Promise.all(
      files
        .filter((file) => {
          const match = /^([0-9a-f]{64})(?:-blur(\d+))?\./.exec(file)
          if (!match || !blurs.has(match[1]!)) return true
          return match[2] !== undefined && !blurs.get(match[1]!)!.includes(Number(match[2]))
        })
        .map((file) => rm(join(this.root, file), { force: true })),
    )
  }
}

import { app } from 'electron'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import type { AvatarInput } from '../shared/api'
import { ApiError } from './api/client'

export async function avatarInput(path: string): Promise<AvatarInput> {
  const bytes = await readFile(path)
  const heif =
    bytes.toString('ascii', 4, 8) === 'ftyp' &&
    ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(bytes.toString('ascii', 8, 12))
  if (process.platform === 'darwin' && (heif || /\.hei[cf]$/i.test(path))) {
    const root = await mkdtemp(join(app.getPath('temp'), 'yuki-avatar-'))
    const output = join(root, 'decoded.png')
    try {
      // macOS ImageIO supplies HEIC decoding; common image formats use Chromium.
      await promisify(execFile)('/usr/bin/sips', [
        '--setProperty',
        'format',
        'png',
        path,
        '--out',
        output,
      ])
      return {
        filename: basename(path),
        bytes: new Uint8Array(await readFile(output)),
        sourceSize: bytes.byteLength,
      }
    } catch {
      throw new ApiError('unsupported_image')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
  return { filename: basename(path), bytes: new Uint8Array(bytes) }
}

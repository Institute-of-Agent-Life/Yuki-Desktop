import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Previews } from '../../src/main/media/previews'
import { previewMime } from '../../src/shared/media'

const previews = new Previews(),
  roots: string[] = []
afterEach(async () => {
  await previews.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'yuki-range-'))
  roots.push(root)
  const path = join(root, 'content.blob')
  await writeFile(path, '0123456789')
  return previews.open('owner', 'source', path, 'video/webm')
}
it('serves real byte ranges from a held file without IPC byte copies, including suffix and HEAD', async () => {
  const { url } = await fixture()
  for (const [range, expected, fact] of [
    ['bytes=3-6', '3456', 'bytes 3-6/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=8-', '89', 'bytes 8-9/10'],
  ]) {
    const response = previews.response(new Request(url, { headers: { Range: range! } }))
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe(fact)
    expect(await response.text()).toBe(expected)
  }
  const head = previews.response(new Request(url, { method: 'HEAD' }))
  expect(head.headers.get('Content-Length')).toBe('10')
  expect(await head.text()).toBe('')
  expect(previews.response(new Request(url, { headers: { Range: 'bytes=20-' } })).status).toBe(416)
})
it('closes only owned resources on release, and expires actual source lifetimes', async () => {
  const item = await fixture()
  previews.release('other-owner', item.id)
  expect(previews.response(new Request(item.url, { method: 'HEAD' })).status).toBe(200)
  previews.release('owner', item.id)
  expect(previews.response(new Request(item.url)).status).toBe(404)
  const root = roots[0]!
  const expired = await previews.open(
    'owner',
    'source',
    join(root, 'content.blob'),
    'audio/webm',
    Date.now() / 1000 + 0.02,
  )
  await new Promise((resolve) => setTimeout(resolve, 40))
  expect(previews.response(new Request(expired.url)).status).toBe(404)
  const reauthorized = await previews.open(
    'owner',
    'source',
    join(root, 'content.blob'),
    'audio/webm',
    Date.now() / 1000 - 1,
  )
  expect(previews.response(new Request(reauthorized.url, { method: 'HEAD' })).status).toBe(200)
})
it('uses real MIME first, and recognizes audio without inventing a second binary allowlist', () => {
  expect(previewMime('voice.webm', null, 'record')).toBe('audio/webm')
  expect(previewMime('voice.webm', 'application/octet-stream', 'record')).toBe('audio/webm')
  expect(previewMime('clip.webm')).toBe('video/webm')
  expect(previewMime('clip.webm', 'audio/webm')).toBe('audio/webm')
  expect(previewMime('song.mp3')).toBe('audio/mpeg')
  expect(previewMime('document.pdf', 'application/octet-stream')).toBe('application/pdf')
})
it('revokes one exact source without closing an independently authorized source with identical bytes', async () => {
  const first = await fixture(),
    path = join(roots[0]!, 'content.blob')
  const second = await previews.open('owner', 'another-source', path, 'video/webm')
  await previews.closeSource('owner', 'source')
  expect(previews.response(new Request(first.url)).status).toBe(404)
  expect(previews.response(new Request(second.url, { method: 'HEAD' })).status).toBe(200)
  expect(previews.inUse(path)).toBe(true)
})

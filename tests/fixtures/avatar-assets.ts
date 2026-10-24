import type { Page } from '@playwright/test'

export async function avatarVariants(page: Page, id: string, sha256: string) {
  return page.evaluate(
    async ({ id, sha256 }) => {
      const files = []
      for (const size of [1024, 512, 256, 128, 64]) {
        const result = await window.yuki.client.avatarBytes(id, sha256, size)
        if (!result.ok) throw Error(result.code)
        const bytes = Uint8Array.from(result.value)
        const bitmap = await createImageBitmap(new Blob([bytes]))
        const dimensions = [bitmap.width, bitmap.height]
        bitmap.close()
        const view = new DataView(bytes.buffer)
        const metadata = []
        for (let offset = 8; offset + 12 <= bytes.length; offset += view.getUint32(offset) + 12)
          metadata.push(String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)))
        files.push({ sha256, size: String(size), dimensions, metadata })
      }
      return files
    },
    { id, sha256 },
  )
}

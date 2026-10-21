import type { AvatarInput } from '../../shared/api'

type Dimensions = { width: number; height: number }
function orientation(bytes: Uint8Array, start: number) {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const little = view.getUint16(start) === 0x4949
    if (!little && view.getUint16(start) !== 0x4d4d) return 1
    const table = start + view.getUint32(start + 4, little)
    const count = view.getUint16(table, little)
    for (let index = 0; index < count; index++) {
      const entry = table + 2 + index * 12
      if (view.getUint16(entry, little) === 0x112) return view.getUint16(entry + 8, little)
    }
  } catch {
    /* The system decoder remains the authority for malformed metadata. */
  }
  return 1
}

// Dimensions only guide decoder downsampling; unknown headers never reject an image.
export function imageDimensions(bytes: Uint8Array): Dimensions | undefined {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const ascii = (start: number, size: number) =>
      String.fromCharCode(...bytes.subarray(start, start + size))
    let width = 0,
      height = 0,
      rotation = 1
    if (view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
      width = view.getUint32(16)
      height = view.getUint32(20)
      for (let offset = 8; offset + 12 <= bytes.length;) {
        const length = view.getUint32(offset)
        if (ascii(offset + 4, 4) === 'eXIf') rotation = orientation(bytes, offset + 8)
        offset += length + 12
      }
    } else if (view.getUint16(0) === 0xffd8) {
      let offset = 2
      while (offset < bytes.length && bytes[offset] === 0xff) {
        while (bytes[offset] === 0xff) offset++
        const marker = bytes[offset++]!
        if (marker === 0xda || marker === 0xd9) break
        const length = view.getUint16(offset),
          body = offset + 2
        if (length < 2) break
        if (
          [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
            marker,
          )
        ) {
          height = view.getUint16(body + 1)
          width = view.getUint16(body + 3)
        }
        if (marker === 0xe1 && ascii(body, 6) === 'Exif\0\0')
          rotation = orientation(bytes, body + 6)
        offset += length
      }
    } else if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
      const uint24 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16)
      for (let offset = 12; offset + 8 <= bytes.length;) {
        const type = ascii(offset, 4),
          length = view.getUint32(offset + 4, true),
          body = offset + 8
        if (type === 'VP8X') {
          width = uint24(body + 4) + 1
          height = uint24(body + 7) + 1
        } else if (type === 'VP8 ' && !width) {
          width = view.getUint16(body + 6, true) & 0x3fff
          height = view.getUint16(body + 8, true) & 0x3fff
        } else if (type === 'VP8L' && !width) {
          const bits = view.getUint32(body + 1, true)
          width = (bits & 0x3fff) + 1
          height = ((bits >>> 14) & 0x3fff) + 1
        }
        if (type === 'EXIF')
          rotation = orientation(bytes, ascii(body, 6) === 'Exif\0\0' ? body + 6 : body)
        offset += 8 + length + (length % 2)
      }
    }
    if (width > 0 && height > 0)
      return rotation >= 5 && rotation <= 8 ? { width: height, height: width } : { width, height }
  } catch {
    /* Unsupported or incomplete metadata falls back to decoding. */
  }
}
export interface AvatarImage extends Dimensions {
  bitmap: ImageBitmap
  filename: string
  size: number
}
export async function decodeAvatar(input: AvatarInput): Promise<AvatarImage> {
  const dimensions = imageDimensions(input.bytes)
  const resize = (width: number, height: number) => {
    const scale = Math.min(1, 4096 / Math.min(width, height))
    return scale < 1
      ? {
          resizeWidth: Math.round(width * scale),
          resizeHeight: Math.round(height * scale),
          resizeQuality: 'high' as const,
        }
      : {}
  }
  let bitmap = await createImageBitmap(new Blob([Uint8Array.from(input.bytes)]), {
    imageOrientation: 'from-image',
    colorSpaceConversion: 'default',
    ...(dimensions ? resize(dimensions.width, dimensions.height) : {}),
  })
  const original = dimensions ?? { width: bitmap.width, height: bitmap.height }
  if (Math.min(bitmap.width, bitmap.height) > 4096) {
    const originalBitmap = bitmap
    try {
      bitmap = await createImageBitmap(
        originalBitmap,
        resize(originalBitmap.width, originalBitmap.height),
      )
    } finally {
      originalBitmap.close()
    }
  }
  return {
    ...original,
    bitmap,
    filename: input.filename,
    size: input.sourceSize ?? input.bytes.byteLength,
  }
}
export interface Pan {
  x: number
  y: number
}
export function cropPosition(width: number, height: number, zoom: number, pan: Pan) {
  const scale = Math.max(280 / width, 280 / height) * zoom
  const x = Math.max(-(width * scale - 280) / 2, Math.min((width * scale - 280) / 2, pan.x))
  const y = Math.max(-(height * scale - 280) / 2, Math.min((height * scale - 280) / 2, pan.y))
  return { x, y, scale, left: (280 - width * scale) / 2 + x, top: (280 - height * scale) / 2 + y }
}
export function cropCanvas(image: AvatarImage, zoom: number, pan: Pan, size: number) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { colorSpace: 'srgb' })!
  const { scale, left, top } = cropPosition(image.bitmap.width, image.bitmap.height, zoom, pan)
  const ratio = size / 280
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    image.bitmap,
    left * ratio,
    top * ratio,
    image.bitmap.width * scale * ratio,
    image.bitmap.height * scale * ratio,
  )
  return canvas
}
export async function croppedAvatar(image: AvatarImage, zoom: number, pan: Pan) {
  const blob = await new Promise<Blob>((resolve, reject) =>
    cropCanvas(image, zoom, pan, 1024).toBlob(
      (value) => (value ? resolve(value) : reject(new Error('無法產生頭像圖片。'))),
      'image/png',
    ),
  )
  return new Uint8Array(await blob.arrayBuffer())
}

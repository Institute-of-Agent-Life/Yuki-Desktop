import type { ElectronApplication } from '@playwright/test'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { NativeFileDialogOwner } from './windows-file-dialog'

export interface NativeCaptionButton {
  name: string
  class: string
  processId: number
  enabled: boolean
  offscreen: boolean
  rect: [number, number, number, number]
  patterns: string[]
}
export interface NativeWindowReceipt {
  processId: number
  sessionId: number
  handle: number
  physicalCoordinates: boolean
  windowDpi: number
  rect: [number, number, number, number] | null
  output: string | null
  invoked: string | null
  buttons: NativeCaptionButton[]
  method: string
}
export async function nativeWindowsControls(
  owner: NativeFileDialogOwner,
  options: { outputPath?: string; invokeName?: string; captureOnly?: boolean } = {},
): Promise<NativeWindowReceipt> {
  if (process.platform !== 'win32') throw Error('Requires a Windows interactive desktop')
  const source = await readFile(new URL('./windows-window-controls.ps1', import.meta.url), 'utf8')
  const payload = Buffer.from(JSON.stringify({ ...owner, ...options }), 'utf8').toString('base64')
  const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; $captionInput=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json; & ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(source, 'utf8').toString('base64')}')))) -ExpectedProcessId $captionInput.processId -WindowHandle $captionInput.handle -Executable $captionInput.executable -OutputPath $captionInput.outputPath -InvokeName $captionInput.invokeName -CaptureOnly:([bool]$captionInput.captureOnly)`
  const { stdout } = await promisify(execFile)(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { encoding: 'utf8', timeout: 20000, maxBuffer: 65536, windowsHide: true },
  )
  return JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) as NativeWindowReceipt
}

/** Measures caption contrast from physical native-window pixels. */
export async function captionContrast(app: ElectronApplication, receipt: NativeWindowReceipt) {
  if (!receipt.rect || !receipt.output || !receipt.physicalCoordinates)
    throw Error('Physical native capture missing')
  return app.evaluate(({ nativeImage }, receipt) => {
    const image = nativeImage.createFromPath(receipt.output!)
    const size = image.getSize()
    const bitmap = image.toBitmap({ scaleFactor: 1 })
    const [left, top, width, height] = receipt.rect!
    if (size.width !== width || size.height !== height || bitmap.length !== width * height * 4)
      throw Error('Native bitmap size differs from the physical window')
    const luminance = (rgb: number[]) => {
      const linear = rgb.map((value) => {
        const s = value / 255
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
    }
    return receipt.buttons.map((button) => {
      const [x, y, w, h] = button.rect
      const x0 = Math.ceil(x - left + w / 4),
        x1 = Math.floor(x - left + (w * 3) / 4)
      const y0 = Math.ceil(y - top + h / 4),
        y1 = Math.floor(y - top + (h * 3) / 4)
      if (x0 < 0 || y0 < 0 || x1 >= width || y1 >= height || x1 <= x0 || y1 <= y0)
        throw Error('Caption center lies outside the owned native capture')
      const samples: number[][] = [],
        colors = new Map<string, { count: number; rgb: number[] }>()
      for (let row = y0; row <= y1; row++)
        for (let col = x0; col <= x1; col++) {
          const index = (row * width + col) * 4
          const rgb = [bitmap[index + 2]!, bitmap[index + 1]!, bitmap[index]!]
          samples.push(rgb)
          const key = rgb.map((value) => Math.floor(value / 8)).join(',')
          const existing = colors.get(key)
          if (existing) existing.count++
          else colors.set(key, { count: 1, rgb })
        }
      const background = [...colors.values()].sort((a, b) => b.count - a.count)[0]!.rgb
      const bg = luminance(background)
      const contrasts = samples.map((rgb) => {
        const fg = luminance(rgb)
        return (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05)
      })
      return {
        name: button.name,
        background,
        samples: samples.length,
        maximumContrast: Math.max(...contrasts),
        legiblePixels: contrasts.filter((value) => value >= 3).length,
      }
    })
  }, receipt)
}

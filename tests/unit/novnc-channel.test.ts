import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const websockModule = pathToFileURL(
  join(process.cwd(), 'node_modules/@novnc/novnc/core/websock.js'),
).href

class CompleteChannel {
  binaryType = 'blob'
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  protocol = 'binary'
  readyState: number = WebSocket.CONNECTING
  sent: unknown[] = []
  send(data: unknown) {
    this.sent.push(data)
  }
  close() {
    this.readyState = WebSocket.CLOSED
  }
}

class SubclassedChannel extends CompleteChannel {}

afterEach(() => vi.unstubAllGlobals())

it('the actual noVNC Websock accepts a complete channel with inherited methods', async () => {
  vi.stubGlobal('window', { console })
  const { default: Websock } = await import(websockModule)
  const channel = new SubclassedChannel()
  const socket = new Websock()
  expect(() => socket.attach(channel)).not.toThrow()
  expect(channel.binaryType).toBe('arraybuffer')
})

it('the actual noVNC Websock still rejects a genuinely missing channel property', async () => {
  vi.stubGlobal('window', { console })
  const { default: Websock } = await import(websockModule)
  const channel = new CompleteChannel()
  Reflect.deleteProperty(channel, 'protocol')
  expect(() => new Websock().attach(channel)).toThrow('Raw channel missing property: protocol')
})

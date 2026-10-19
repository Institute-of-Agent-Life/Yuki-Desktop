import { ApiClient, ApiError } from './client'

export async function readStream(
  client: ApiClient,
  signal: AbortSignal,
  hint: (kind: string, data: unknown) => void,
) {
  const response = await client.response('stream?works=active', { signal })
  if (!response.body) throw new ApiError('invalid_response')
  const reader = response.body.getReader(),
    decoder = new TextDecoder()
  let buffer = '',
    event = '',
    data: string[] = []
  try {
    while (!signal.aborted) {
      const chunk = await reader.read()
      if (chunk.done) return
      buffer += decoder.decode(chunk.value, { stream: true })
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, '')
        buffer = buffer.slice(end + 1)
        if (!line) {
          if (event && data.length) hint(event, JSON.parse(data.join('\n')) as unknown)
          event = ''
          data = []
        } else if (line.startsWith('event:')) event = line.slice(6).trimStart()
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

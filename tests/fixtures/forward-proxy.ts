import { createServer, request as forward } from 'node:http'

// Faults are applied after forwarding to the real integration backend. This
// proxy has no business responses, identity, model or receipt implementation.
export async function forwardProxy(target: string, prefix: string) {
  const root = new URL(target)
  const calls: { path: string; method: string; bearer: boolean; requestId?: string }[] = []
  const faults = {
    offline: false,
    holdReceipts: false,
    holdRequestIds: new Set<string>(),
    holdResponses: new Set<string>(),
    loseNextSuffix: '',
  }
  const lostStatuses: number[] = []
  const held = new Map<string, (() => void)[]>()
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').slice(prefix.length)
    const call = {
      path,
      method: req.method ?? 'GET',
      bearer: !!req.headers.authorization,
      requestId: undefined as string | undefined,
    }
    calls.push(call)
    if (
      faults.offline ||
      (path.includes('/requests/') &&
        (faults.holdReceipts || faults.holdRequestIds.has(path.split('/').at(-1)!)))
    ) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ problem: { code: 'unavailable' } }))
      return
    }
    if (path.endsWith('/messages') || path.endsWith('/me/proactive-route')) {
      const chunks: Buffer[] = []
      req.on('data', (part) => chunks.push(Buffer.from(part)))
      req.on('end', () => {
        try {
          call.requestId = JSON.parse(Buffer.concat(chunks).toString()).request_id
        } catch {
          /* GET has no body */
        }
      })
    }
    const loseResponse =
      !!faults.loseNextSuffix && path.endsWith(faults.loseNextSuffix) && req.method !== 'GET'
    if (loseResponse) {
      faults.loseNextSuffix = ''
      faults.holdReceipts = true
    }
    const upstream = forward(
      new URL(root.pathname + path, root),
      { method: req.method, headers: { ...req.headers, host: root.host } },
      (response) => {
        if (loseResponse) {
          lostStatuses.push(response.statusCode!)
          response.resume()
          response.on('end', () => {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ problem: { code: 'unknown' } }))
          })
        } else {
          res.writeHead(response.statusCode!, response.headers)
          if (faults.holdResponses.has(path)) {
            response.pause()
            const pending = held.get(path) ?? []
            pending.push(() => response.pipe(res))
            held.set(path, pending)
          } else response.pipe(res)
        }
      },
    )
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('No proxy port')
  return {
    base: `http://127.0.0.1:${address.port}${prefix}`,
    calls,
    lostStatuses,
    held,
    releaseResponses(path: string) {
      faults.holdResponses.delete(path)
      held.get(path)?.forEach((resume) => resume())
      held.delete(path)
    },
    faults,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

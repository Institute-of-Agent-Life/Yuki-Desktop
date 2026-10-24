import { createServer, request as forward, type IncomingMessage } from 'node:http'

// Faults are applied after forwarding to the real integration backend. This
// proxy has no business responses, identity, model or receipt implementation.
export async function forwardProxy(target: string, prefix: string) {
  const root = new URL(target)
  const calls: { path: string; method: string; bearer: boolean; requestId?: string }[] = []
  const completed = new Set<(typeof calls)[number]>()
  const faults = {
    offline: false,
    holdReceipts: false,
    holdRequestIds: new Set<string>(),
    holdResponses: new Set<string>(),
    holdResponseSuffixes: new Set<string>(),
    rejectPostSuffixes: new Set<string>(),
    loseNextSuffix: '',
    loseNextReadSuffix: '',
    minDesktop: null as string | null,
  }
  const lostStatuses: number[] = []
  const held = new Map<string, (() => void)[]>()
  const responses = new Map<string, Set<IncomingMessage>>()
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').slice(prefix.length)
    const parsed = new URL(path, root)
    const call = {
      path,
      method: req.method ?? 'GET',
      bearer: !!req.headers.authorization,
      requestId: parsed.searchParams.get('request_id') ?? undefined,
    }
    calls.push(call)
    res.once('finish', () => completed.add(call))
    if (
      faults.offline ||
      (req.method === 'POST' &&
        [...faults.rejectPostSuffixes].some((suffix) => path.endsWith(suffix))) ||
      (path.includes('/requests/') &&
        (faults.holdReceipts || faults.holdRequestIds.has(path.split('/').at(-1)!)))
    ) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ problem: { code: 'unavailable' } }))
      return
    }
    if (req.method !== 'GET') {
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
    const loseRead =
      !!faults.loseNextReadSuffix &&
      parsed.pathname.endsWith(faults.loseNextReadSuffix) &&
      req.method === 'GET'
    const loseWrite =
      !!faults.loseNextSuffix &&
      parsed.pathname.endsWith(faults.loseNextSuffix) &&
      req.method !== 'GET'
    const loseResponse = loseRead || loseWrite
    if (loseRead) faults.loseNextReadSuffix = ''
    if (loseWrite) {
      faults.loseNextSuffix = ''
      faults.holdReceipts = true
    }
    const upstream = forward(
      new URL(root.pathname + path, root),
      { method: req.method, headers: { ...req.headers, host: root.host } },
      (response) => {
        const active = responses.get(path) ?? new Set<IncomingMessage>()
        active.add(response)
        responses.set(path, active)
        response.once('close', () => {
          active.delete(response)
          if (!active.size) responses.delete(path)
        })
        if (faults.minDesktop && path.endsWith('/client/v1/meta')) {
          const chunks: Buffer[] = []
          response.on('data', (part) => chunks.push(Buffer.from(part)))
          response.on('end', () => {
            const body = JSON.parse(Buffer.concat(chunks).toString())
            body.data.min_client.desktop = faults.minDesktop
            const headers = { ...response.headers }
            delete headers['content-length']
            res.writeHead(response.statusCode!, headers)
            res.end(JSON.stringify(body))
          })
        } else if (loseResponse) {
          lostStatuses.push(response.statusCode!)
          response.resume()
          response.on('end', () => {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ problem: { code: 'unknown' } }))
          })
        } else {
          res.writeHead(response.statusCode!, response.headers)
          if (
            faults.holdResponses.has(path) ||
            [...faults.holdResponseSuffixes].some((suffix) => path.endsWith(suffix))
          ) {
            response.pause()
            const pending = held.get(path) ?? []
            pending.push(() => response.pipe(res))
            held.set(path, pending)
            server.emit('held-response', path)
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
    completed,
    lostStatuses,
    held,
    waitForHeldResponse(path: string) {
      return new Promise<void>((resolve) => {
        const observed = (heldPath: string) => {
          if (heldPath !== path) return
          server.off('held-response', observed)
          resolve()
        }
        server.on('held-response', observed)
        if (held.has(path)) observed(path)
      })
    },
    pauseActive(path: string) {
      for (const response of responses.get(path) ?? []) response.pause()
    },
    resumeActive(path: string) {
      for (const response of responses.get(path) ?? []) response.resume()
    },
    releaseResponses(path: string) {
      faults.holdResponses.delete(path)
      held.get(path)?.forEach((resume) => resume())
      held.delete(path)
    },
    faults,
    close: async () => {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()))
      server.closeAllConnections()
      await closed
    },
  }
}

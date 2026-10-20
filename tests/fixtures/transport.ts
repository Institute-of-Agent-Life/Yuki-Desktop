import { createServer, request, type ClientRequest } from 'node:http'

/** A real loopback transport gate; the application and backend remain unchanged. */
export async function transportGate(base: string) {
  const target = new URL(base)
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1')
    throw Error('Transport fixtures require an explicit loopback backend')
  let offline = false
  const pending = new Set<ClientRequest>()
  const counts = { forwarded: 0, dropped: 0 }
  const server = createServer((incoming, response) => {
    if (offline) {
      counts.dropped++
      incoming.socket.destroy()
      return
    }
    counts.forwarded++
    const upstream = request(
      {
        hostname: target.hostname,
        port: target.port,
        method: incoming.method,
        path: incoming.url,
        headers: { ...incoming.headers, host: target.host },
      },
      (reply) => {
        response.writeHead(reply.statusCode ?? 502, reply.headers)
        reply.on('error', () => response.destroy())
        reply.pipe(response)
      },
    )
    pending.add(upstream)
    upstream.once('close', () => pending.delete(upstream))
    upstream.on('error', () => response.destroy())
    incoming.on('error', () => upstream.destroy())
    response.once('close', () => upstream.destroy())
    incoming.pipe(upstream)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('No loopback fixture port')
  const disconnect = () => {
    offline = true
    for (const upstream of pending) upstream.destroy()
    server.closeAllConnections()
  }
  return {
    base: `http://127.0.0.1:${address.port}${target.pathname}`,
    counts,
    disconnect,
    reconnect: () => {
      offline = false
    },
    async close() {
      disconnect()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}

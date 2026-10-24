import { ApiClient, ApiError } from './api/client'
import type { components } from '../shared/contract.gen'

export class ComputerTickets {
  private urls = new Map<string, number>()
  async issue(client: ApiClient) {
    const value = await client.post<components['schemas']['DisplayTicket']>(
      'computer/display-tickets',
      {},
    )
    const target = new URL(client.endpoint('computer/display'))
    if (value.ws_path !== target.pathname || !/^[A-Za-z0-9_-]+$/.test(value.ticket))
      throw new ApiError('invalid_response')
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
    target.searchParams.set('ticket', value.ticket)
    const url = target.toString()
    this.urls.set(url, Date.now() + 60000)
    return url
  }
  consume(url: string) {
    const now = Date.now(),
      expires = this.urls.get(url)
    this.urls.delete(url)
    for (const [key, value] of this.urls) if (value <= now) this.urls.delete(key)
    return expires !== undefined && expires > now
  }
}

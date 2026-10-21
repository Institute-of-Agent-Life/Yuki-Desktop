import type { ExecutorOperation } from '../../shared/executor'
import { ApiClient, ApiError } from '../api/client'
import type { ExecutorResult } from './journal'
import type { ExecutorTask, ExecutorTransport } from './runner'

/** This client never receives a chat device token or App entry header. */
export class ExecutorClient extends ApiClient {
  constructor(
    base: string,
    token: string,
    version = '1.0.0-beta.1',
    fetcher: typeof fetch = fetch,
  ) {
    super(base, token, undefined, version, fetcher)
  }
  endpoint(path: string) {
    return `${this.base}/executor/v1/${path}`
  }
}
const task = (value: ExecutorOperation): ExecutorTask => ({
  opId: value.op_id,
  capability: value.capability,
  params: value.params,
  state: value.state,
})
export class ExecutorProtocol implements ExecutorTransport {
  constructor(public client: ExecutorClient) {}
  async get(id: string) {
    return task(await this.client.get<ExecutorOperation>(`operations/${encodeURIComponent(id)}`))
  }
  async ack(id: string) {
    return task(
      await this.client.post<ExecutorOperation>(`operations/${encodeURIComponent(id)}/ack`, {}),
    )
  }
  async result(id: string, result: ExecutorResult) {
    return task(
      await this.client.post<ExecutorOperation>(
        `operations/${encodeURIComponent(id)}/result`,
        result,
      ),
    )
  }
  async content(operation: ExecutorTask) {
    const response = await this.client.response(
      `operations/${encodeURIComponent(operation.opId)}/content`,
    )
    if (response.headers.get('X-Yuki-Sha256') !== operation.params.version)
      throw new ApiError('content_mismatch')
    try {
      return new Uint8Array(await response.arrayBuffer())
    } catch {
      throw new ApiError('transport_unknown')
    }
  }
}

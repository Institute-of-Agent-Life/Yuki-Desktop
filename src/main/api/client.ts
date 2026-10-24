export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly reason?: string,
    readonly details?: Record<
      string,
      import('../../shared/product-models').ProductModels['schemas']['JsonValue']
    >,
  ) {
    super(code)
  }
}

export function normalizeServer(value: string) {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new ApiError('invalid_server')
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ApiError('invalid_server')
  return url.toString().replace(/\/+$/, '')
}

export class ApiClient {
  readonly base: string
  constructor(
    base: string,
    readonly token?: string,
    readonly entry?: string,
    readonly version = '1.0.0-beta.1',
    readonly fetcher: typeof fetch = fetch,
  ) {
    this.base = normalizeServer(base)
  }
  headers() {
    return {
      'X-Yuki-Client': `desktop/${this.version} (${process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux'}/${process.arch})`,
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(this.entry ? { 'X-Yuki-Entry': this.entry } : {}),
    }
  }
  endpoint(path: string) {
    return `${this.base}/client/v1/${path}`
  }
  async response(path: string, init?: RequestInit) {
    let response: Response
    try {
      response = await this.fetcher(this.endpoint(path), {
        ...init,
        headers: { ...this.headers(), ...init?.headers },
        redirect: 'error',
        signal:
          init?.signal ?? (path.startsWith('stream?') ? undefined : AbortSignal.timeout(30000)),
      })
    } catch {
      throw new ApiError('transport_unknown')
    }
    if (!response.ok) {
      let code: string | undefined
      let reason: string | undefined
      let details: ApiError['details']
      try {
        const body = (await response.json()) as {
          problem?: NonNullable<ApiError['details']> & { code?: string }
        }
        const { code: problemCode, ...facts } = body.problem ?? {}
        code = problemCode ?? code
        reason = typeof facts.reason === 'string' ? facts.reason : undefined
        details = Object.keys(facts).length ? facts : undefined
      } catch {
        /* The HTTP result contains no usable receipt. */
      }
      if (path === 'meta' && response.status === 404 && code === undefined)
        throw new ApiError('client_api_unavailable')
      throw new ApiError(code ?? 'unknown', reason, details)
    }
    return response
  }
  async get<T>(path: string): Promise<T> {
    const response = await this.response(path)
    try {
      const body = (await response.json()) as { data?: T }
      if (!Object.hasOwn(body, 'data')) throw new Error('missing_envelope')
      return body.data as T
    } catch {
      throw new ApiError('invalid_response')
    }
  }
  async post<T>(path: string, body: unknown): Promise<T> {
    return this.mutate<T>(path, body, 'POST')
  }
  async mutate<T>(
    path: string,
    body: unknown,
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  ): Promise<T> {
    const response = await this.response(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    try {
      return ((await response.json()) as { data: T }).data
    } catch {
      throw new ApiError('transport_unknown')
    }
  }
}

export class ApiError extends Error {
  constructor(readonly code: string) {
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
      let code = 'unknown'
      try {
        const body = (await response.json()) as { problem?: { code?: string } }
        code = body.problem?.code ?? code
      } catch {
        /* The HTTP result contains no usable receipt. */
      }
      throw new ApiError(code)
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
    const response = await this.response(path, {
      method: 'POST',
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

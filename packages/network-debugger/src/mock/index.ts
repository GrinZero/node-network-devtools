import { Readable, Writable } from 'node:stream'
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage, RequestOptions } from 'node:http'
import type { RequestFn } from '../core/request'

export interface LegacyMockMatcher {
  /** Exact URL, or a glob containing `*` wildcards. */
  url: string
  method?: string
  headers?: Readonly<Record<string, string>>
}

export interface LegacyMockResponse {
  status?: number
  statusText?: string
  headers?: Readonly<Record<string, string | readonly string[]>>
  body?: string
  /** Binary response body encoded as base64. Mutually exclusive with `body`. */
  bodyBase64?: string
  delayMs?: number
}

export interface LegacyMockRule {
  id?: string
  match: LegacyMockMatcher
  response: LegacyMockResponse
}

export interface LegacyMockRequest {
  url: string
  method: string
  headers: Readonly<Record<string, string | string[] | number | undefined>>
}

function globExpression(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function normalizedHeaders(headers: LegacyMockRequest['headers']): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([name, value]) => {
      if (value === undefined) return []
      return [[name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value)]]
    })
  )
}

export function findLegacyMock(
  rules: readonly LegacyMockRule[],
  request: LegacyMockRequest
): LegacyMockRule | undefined {
  const requestHeaders = normalizedHeaders(request.headers)
  return rules.find((rule) => {
    if (!rule.match.url || !globExpression(rule.match.url).test(request.url)) return false
    if (rule.match.method && rule.match.method.toUpperCase() !== request.method.toUpperCase()) {
      return false
    }
    return Object.entries(rule.match.headers ?? {}).every(
      ([name, value]) => requestHeaders[name.toLowerCase()] === value
    )
  })
}

function responseHeaders(values: LegacyMockResponse['headers']): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {}
  for (const [name, value] of Object.entries(values ?? {})) {
    headers[name.toLowerCase()] = typeof value === 'string' ? value : [...value]
  }
  return headers
}

function rawHeaders(values: IncomingHttpHeaders): string[] {
  return Object.entries(values).flatMap(([name, value]) => {
    if (value === undefined) return []
    return Array.isArray(value) ? value.flatMap((nested) => [name, nested]) : [name, String(value)]
  })
}

class MockIncomingMessage extends Readable {
  readonly statusCode: number
  readonly statusMessage: string
  readonly headers: IncomingHttpHeaders
  readonly rawHeaders: string[]
  readonly httpVersion = '1.1'
  complete = false
  private sent = false

  constructor(response: LegacyMockResponse) {
    super()
    this.statusCode = response.status ?? 200
    this.statusMessage = response.statusText ?? 'Mocked'
    this.headers = responseHeaders(response.headers)
    const body = response.bodyBase64
      ? Buffer.from(response.bodyBase64, 'base64')
      : Buffer.from(response.body ?? '')
    if (this.headers['content-length'] === undefined) {
      this.headers['content-length'] = String(body.byteLength)
    }
    this.rawHeaders = rawHeaders(this.headers)
    this.once('end', () => {
      this.complete = true
    })
    this.body = body
  }

  private readonly body: Buffer

  override _read(): void {
    if (this.sent) return
    this.sent = true
    if (this.body.length > 0) this.push(this.body)
    this.push(null)
  }
}

class MockClientRequest extends Writable {
  readonly method: string
  readonly path: string
  readonly protocol: string
  readonly host: string
  aborted = false
  private readonly headers = new Map<string, { name: string; value: string | string[] | number }>()
  private responseTimer?: ReturnType<typeof setTimeout>

  constructor(
    url: URL,
    method: string,
    headers: RequestOptions['headers'],
    private readonly mockedResponse: LegacyMockResponse
  ) {
    super()
    this.method = method
    this.path = `${url.pathname}${url.search}`
    this.protocol = url.protocol
    this.host = url.host
    for (const [name, value] of Object.entries(headers ?? {})) {
      if (value !== undefined) this.setHeader(name, value)
    }
    if (!this.hasHeader('host')) this.setHeader('host', url.host)
  }

  override _write(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    callback()
  }

  override _final(callback: (error?: Error | null) => void): void {
    const respond = () => {
      if (!this.destroyed && !this.aborted) {
        this.emit(
          'response',
          new MockIncomingMessage(this.mockedResponse) as unknown as IncomingMessage
        )
      }
      callback()
    }
    const delay = Math.max(0, this.mockedResponse.delayMs ?? 0)
    if (delay === 0) queueMicrotask(respond)
    else this.responseTimer = setTimeout(respond, delay)
  }

  setHeader(name: string, value: string | string[] | number): this {
    this.headers.set(name.toLowerCase(), { name, value })
    return this
  }

  getHeader(name: string): string | string[] | number | undefined {
    return this.headers.get(name.toLowerCase())?.value
  }

  getHeaders(): Record<string, string | string[] | number> {
    return Object.fromEntries(
      [...this.headers.entries()].map(([normalized, entry]) => [normalized, entry.value])
    )
  }

  hasHeader(name: string): boolean {
    return this.headers.has(name.toLowerCase())
  }

  removeHeader(name: string): void {
    this.headers.delete(name.toLowerCase())
  }

  flushHeaders(): void {}

  abort(): void {
    if (this.aborted) return
    this.aborted = true
    if (this.responseTimer) clearTimeout(this.responseTimer)
    this.emit('abort')
    this.destroy()
  }

  setTimeout(_timeout: number, callback?: () => void): this {
    if (callback) this.once('timeout', callback)
    return this
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (this.responseTimer) clearTimeout(this.responseTimer)
    callback(error)
  }
}

function requestUrl(
  arg1: RequestOptions | string | URL,
  options: RequestOptions | undefined,
  isHttps: boolean
): URL {
  const base =
    typeof arg1 === 'string' || arg1 instanceof URL
      ? new URL(arg1)
      : new URL(
          `${arg1.protocol ?? (isHttps ? 'https:' : 'http:')}//${arg1.hostname ?? arg1.host ?? 'localhost'}${arg1.port === undefined ? '' : `:${arg1.port}`}${arg1.path ?? '/'}`
        )
  if (options?.protocol) base.protocol = options.protocol
  if (options?.hostname || options?.host) base.hostname = String(options.hostname ?? options.host)
  if (options?.port !== undefined) base.port = String(options.port)
  if (options?.path) {
    const separator = options.path.indexOf('?')
    base.pathname = separator === -1 ? options.path : options.path.slice(0, separator)
    base.search = separator === -1 ? '' : options.path.slice(separator)
  }
  return base
}

/** Route matching `http.request`/`https.request` calls to an in-process response. */
export function mockableRequestHandler(
  actualRequest: RequestFn,
  isHttps: boolean,
  rules: readonly LegacyMockRule[]
): RequestFn {
  return function mockableRequest(
    this: unknown,
    arg1: RequestOptions | string | URL,
    arg2?: RequestOptions | ((response: IncomingMessage) => void),
    arg3?: (response: IncomingMessage) => void
  ): ClientRequest {
    const options =
      typeof arg1 === 'string' || arg1 instanceof URL
        ? typeof arg2 === 'object'
          ? arg2
          : undefined
        : arg1
    const callback = typeof arg2 === 'function' ? arg2 : arg3
    const url = requestUrl(arg1, options, isHttps)
    const method = String(options?.method ?? 'GET').toUpperCase()
    const rule = findLegacyMock(rules, {
      url: url.toString(),
      method,
      headers: (options?.headers ?? {}) as LegacyMockRequest['headers']
    })
    if (!rule) {
      const args =
        typeof arg1 === 'string' || arg1 instanceof URL
          ? typeof arg2 === 'object'
            ? [arg1, arg2, arg3]
            : [arg1, arg2]
          : [arg1, arg2]
      return Reflect.apply(actualRequest, this, args)
    }

    const request = new MockClientRequest(url, method, options?.headers, rule.response)
    if (callback) request.once('response', callback)
    return request as unknown as ClientRequest
  } as RequestFn
}

function fetchHeaders(
  request: string | URL | Request,
  options?: RequestInit
): Record<string, string> {
  const headers = new Headers(request instanceof Request ? request.headers : undefined)
  if (options?.headers) {
    new Headers(options.headers).forEach((value, name) => headers.set(name, value))
  }
  const result: Record<string, string> = {}
  headers.forEach((value, name) => (result[name] = value))
  return result
}

export function findFetchMock(
  rules: readonly LegacyMockRule[],
  request: string | URL | Request,
  options?: RequestInit
): LegacyMockRule | undefined {
  return findLegacyMock(rules, {
    url:
      typeof request === 'string'
        ? request
        : request instanceof URL
          ? request.toString()
          : request.url,
    method: String(options?.method ?? (request instanceof Request ? request.method : 'GET')),
    headers: fetchHeaders(request, options)
  })
}

export async function mockedFetchResponse(
  rule: LegacyMockRule,
  signal?: AbortSignal | null
): Promise<Response> {
  const delay = Math.max(0, rule.response.delayMs ?? 0)
  if (delay > 0) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay)
      const abort = () => {
        clearTimeout(timer)
        reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
      }
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })
    })
  }
  const status = rule.response.status ?? 200
  const configuredBody = rule.response.bodyBase64
    ? Buffer.from(rule.response.bodyBase64, 'base64')
    : (rule.response.body ?? null)
  const body = [101, 103, 204, 205, 304].includes(status) ? null : configuredBody
  return new Response(body, {
    status,
    statusText: rule.response.statusText ?? 'Mocked',
    headers: rule.response.headers as HeadersInit | undefined
  })
}

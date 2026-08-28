import { RequestDetail } from '../common'
import { findFetchMock, mockedFetchResponse, type LegacyMockRule } from '../mock'
import { headersToObject } from '../utils/map'
import type { MainProcess } from './fork'
import { getCurrentCell, setCurrentCell, type Cell } from './hooks/cell'
import { isLegacyCaptureSuppressed } from './capture-scope'

export function proxyFetch(mainProcess: MainProcess, mockRules: readonly LegacyMockRule[] = []) {
  if (!globalThis.fetch) return
  const originalFetch = globalThis.fetch
  const proxy =
    mockRules.length > 0
      ? fetchProxyFactory(originalFetch, mainProcess, mockRules)
      : fetchProxyFactory(originalFetch, mainProcess)
  globalThis.fetch = proxy

  return () => {
    if (globalThis.fetch === proxy) globalThis.fetch = originalFetch
  }
}

interface SseMessage {
  eventName: string
  eventId: string
  data: string
}

/** Incremental WHATWG event-stream parser; fields may span arbitrary chunks. */
export class SseParser {
  private buffer = ''
  private eventName = 'message'
  private eventId = ''
  private data: string[] = []
  private sawData = false

  constructor(private readonly emit: (message: SseMessage) => void) {}

  push(text: string): void {
    this.buffer += text
    this.drain(false)
  }

  finish(text = ''): void {
    this.buffer += text
    this.drain(true)
    if (this.buffer) {
      this.line(this.buffer)
      this.buffer = ''
    }
    this.dispatch()
  }

  private drain(final: boolean): void {
    while (true) {
      const match = /\r\n|\r|\n/.exec(this.buffer)
      if (!match) return
      // CRLF is one line ending even when the transport splits it across
      // chunks. Hold a trailing CR until the next chunk (or EOF) decides it.
      if (!final && match[0] === '\r' && match.index === this.buffer.length - 1) return
      const line = this.buffer.slice(0, match.index)
      this.buffer = this.buffer.slice(match.index + match[0].length)
      this.line(line)
    }
  }

  private line(line: string): void {
    if (line === '') {
      this.dispatch()
      return
    }
    if (line.startsWith(':')) return

    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    let value = separator === -1 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'event') {
      this.eventName = value || 'message'
    } else if (field === 'data') {
      this.sawData = true
      this.data.push(value)
    } else if (field === 'id' && !value.includes('\0')) {
      this.eventId = value
    }
  }

  private dispatch(): void {
    if (this.sawData) {
      this.emit({
        eventName: this.eventName || 'message',
        eventId: this.eventId,
        data: this.data.join('\n')
      })
    }
    this.eventName = 'message'
    this.data = []
    this.sawData = false
  }
}

function bodyValue(body: BodyInit | null | undefined): unknown {
  if (body === undefined || body === null) return undefined
  if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array) return body
  if (body instanceof URLSearchParams) return body.toString()
  return undefined
}

function populateFetchRequest(
  detail: RequestDetail,
  request: string | URL | Request,
  options?: RequestInit
): void {
  if (typeof request === 'string') detail.url = request
  else if (request instanceof URL) detail.url = request.toString()
  else detail.url = request.url

  detail.method = options?.method ?? (request instanceof Request ? request.method : 'GET')
  const headers = new Headers(request instanceof Request ? request.headers : undefined)
  if (options?.headers) {
    new Headers(options.headers).forEach((value, key) => headers.set(key, value))
  }
  detail.requestHeaders = headersToObject(headers)
  detail.requestData = bodyValue(options?.body)
  detail.requestStartTime = Date.now() / 1000
  detail.responseHeaders = {}
  detail.loadCallFrames()
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Fetch failed')
}

function responseInto(detail: RequestDetail, response: Response): void {
  detail.responseHeaders = headersToObject(response.headers)
  detail.responseStatusCode = response.status || 0
  ;(detail as RequestDetail & { responseStatusText?: string }).responseStatusText =
    response.statusText
}

function isEventStream(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').includes('text/event-stream')
}

async function captureEventStream(
  response: Response,
  detail: RequestDetail,
  mainProcess: MainProcess
): Promise<void> {
  const stream = response.clone().body
  if (!stream) {
    detail.responseData = Buffer.alloc(0)
    detail.responseInfo = { dataLength: 0, encodedDataLength: 0 }
    mainProcess.sendRequest('endRequest', detail)
    return
  }

  const chunks: Buffer[] = []
  const decoder = new TextDecoder()
  const parser = new SseParser((message) => {
    void mainProcess.send({
      type: 'eventSourceMessage',
      data: { requestId: detail.id, ...message }
    })
  })
  const reader = stream.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      chunks.push(Buffer.from(value))
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.finish(decoder.decode())
    const body = Buffer.concat(chunks)
    detail.responseData = body
    detail.responseInfo = { dataLength: body.length, encodedDataLength: body.length }
    detail.requestEndTime = Date.now() / 1000
    mainProcess.sendRequest('endRequest', detail)
  } catch (error) {
    detail.requestEndTime = Date.now() / 1000
    await mainProcess.send({
      type: 'requestFailed',
      data: { request: detail, errorText: failureText(error), canceled: true }
    })
  }
}

function captureResponse(
  response: Response,
  detail: RequestDetail,
  mainProcess: MainProcess
): void {
  responseInto(detail, response)
  void mainProcess.send({
    type: isEventStream(response) ? 'eventSourceResponseReceived' : 'responseReceived',
    data: detail
  })

  if (isEventStream(response)) {
    void captureEventStream(response, detail, mainProcess)
    return
  }

  void response
    .clone()
    .arrayBuffer()
    .then((arrayBuffer) => {
      const body = Buffer.from(arrayBuffer)
      detail.responseData = body
      detail.responseInfo = { dataLength: body.length, encodedDataLength: body.length }
      detail.requestEndTime = Date.now() / 1000
      mainProcess.sendRequest('endRequest', detail)
    })
    .catch(async (error) => {
      detail.requestEndTime = Date.now() / 1000
      await mainProcess.send({
        type: 'requestFailed',
        data: { request: detail, errorText: failureText(error), canceled: true }
      })
    })
}

export function fetchProxyFactory(
  fetchFn: typeof fetch,
  mainProcess: MainProcess,
  mockRules: readonly LegacyMockRule[] = []
): typeof fetch {
  return function fetchProxy(request: string | URL | Request, options?: RequestInit) {
    if (isLegacyCaptureSuppressed()) {
      return fetchFn(request as string | Request, options)
    }
    const detail = new RequestDetail()
    populateFetchRequest(detail, request, options)
    const cell: Cell = { request: detail, pipes: [], isAborted: false }
    setCurrentCell(cell)

    mainProcess.sendRequest('initRequest', detail).sendRequest('registerRequest', detail)

    const mockRule = findFetchMock(mockRules, request, options)
    const responsePromise = mockRule
      ? mockedFetchResponse(mockRule, options?.signal)
      : fetchFn(request as string | Request, options)

    return responsePromise
      .then(
        (response) => {
          captureResponse(response, detail, mainProcess)
          return response
        },
        async (error) => {
          detail.requestEndTime = Date.now() / 1000
          await mainProcess.send({
            type: 'requestFailed',
            data: { request: detail, errorText: failureText(error) }
          })
          throw error
        }
      )
      .finally(() => {
        if (getCurrentCell() === cell) setCurrentCell(null)
      })
  } as typeof fetch
}

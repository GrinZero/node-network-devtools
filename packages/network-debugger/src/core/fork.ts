import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import type { DevtoolsTarget, Diagnostic } from '../adapters/types'
import { RequestDetail, type RegisterOptions } from '../common'
import {
  LegacyBridgeClient,
  type LegacyBridgeClientDependencies,
  type DiagnosticListener,
  type FailureListener,
  type LegacyBridgeError
} from '../legacy-bridge/client'
import type {
  LegacyCaptureEvent,
  LegacyCaptureSink,
  LegacyRequestEventType,
  LegacyResponseData,
  LegacyWebSocketHandshake
} from '../legacy-bridge/contracts'
import { getCurrentCell, type Cell } from './hooks/cell'

export type RequestType = LegacyRequestEventType

type CapturedIncomingMessage = NodeJS.ReadableStream & {
  statusCode?: number
  statusMessage?: string
  headers: IncomingHttpHeaders
  httpVersion?: string
  rawHeaders?: string[]
  complete?: boolean
}

interface LegacyBridgeTransport {
  readonly ready: Promise<DevtoolsTarget>
  send(event: LegacyCaptureEvent): Promise<void>
  onDiagnostic(listener: DiagnosticListener): () => void
  onFailure(listener: FailureListener): () => void
  dispose(): Promise<void>
}

export interface MainProcessDependencies extends LegacyBridgeClientDependencies {
  bridge?: LegacyBridgeTransport
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  if (Array.isArray(value)) return value[0]
  return value === undefined ? undefined : String(value)
}

function websocketHandshake(response: unknown): LegacyWebSocketHandshake {
  const value = (response ?? {}) as Partial<IncomingMessage> & Partial<LegacyWebSocketHandshake>
  return {
    httpVersion: typeof value.httpVersion === 'string' ? value.httpVersion : '',
    statusCode: typeof value.statusCode === 'number' ? value.statusCode : 0,
    statusMessage: typeof value.statusMessage === 'string' ? value.statusMessage : '',
    rawHeaders: Array.isArray(value.rawHeaders) ? [...value.rawHeaders] : [],
    headers: value.headers && typeof value.headers === 'object' ? { ...value.headers } : {}
  }
}

/**
 * Convert the handful of historical capture call shapes at the compatibility
 * boundary, and guarantee that sockets/IncomingMessage objects never cross IPC.
 */
function normalizeCaptureEvent(input: unknown): LegacyCaptureEvent | undefined {
  if (!input || typeof input !== 'object') return undefined
  const value = input as Record<string, unknown>

  // v1 accidentally used CDP's method/params shape for this one event.
  if (value.method === 'Network.webSocketClosed') {
    const params = (value.params ?? {}) as { requestId?: unknown }
    if (typeof params.requestId !== 'string') return undefined
    return {
      type: 'Network.webSocketClosed',
      data: { requestId: params.requestId }
    }
  }

  if (typeof value.type !== 'string' || !('data' in value)) return undefined
  if (value.type === 'Network.webSocketCreated') {
    const data = value.data as Record<string, unknown>
    if (!data || typeof data.requestId !== 'string' || typeof data.url !== 'string') {
      return undefined
    }
    return {
      type: 'Network.webSocketCreated',
      data: {
        requestId: data.requestId,
        url: data.url,
        ...(data.initiator ? { initiator: data.initiator as RequestDetail['initiator'] } : {}),
        response: websocketHandshake(data.response)
      }
    }
  }

  return input as LegacyCaptureEvent
}

function requestForId(id: string, known?: RequestDetail): RequestDetail {
  if (known) return known
  const request = new RequestDetail()
  request.id = id
  return request
}

/**
 * Compatibility facade used by the existing HTTP/fetch capture patches.
 * Application-to-child transport is process IPC with advanced serialization.
 */
export class MainProcess implements LegacyCaptureSink {
  readonly ready: Promise<DevtoolsTarget>

  private readonly bridge: LegacyBridgeTransport
  private readonly requests = new Map<string, RequestDetail>()
  private readonly requestCells = new Map<string, Cell>()
  private readonly responseCleanups = new Set<() => void>()
  private disposed = false

  constructor(
    props: RegisterOptions & { key: string },
    dependencies: MainProcessDependencies = {}
  ) {
    this.bridge =
      dependencies.bridge ??
      new LegacyBridgeClient(
        {
          host: '127.0.0.1',
          targetPort: props.serverPort ?? 0,
          title: 'Node Network Devtools (Legacy)'
        },
        dependencies
      )
    this.ready = this.bridge.ready
  }

  onDiagnostic(listener: (diagnostic: Diagnostic) => void): () => void {
    return this.bridge.onDiagnostic(listener)
  }

  onFailure(listener: (error: LegacyBridgeError) => void): () => void {
    return this.bridge.onFailure(listener)
  }

  public send(event: LegacyCaptureEvent): Promise<void>
  public send(event: unknown): Promise<void>
  public send(event: unknown): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const normalized = normalizeCaptureEvent(event)
    if (!normalized) return Promise.resolve()
    const sendPromise = this.bridge.send(normalized)
    const terminalRequestId =
      normalized.type === 'requestFailed'
        ? normalized.data.request.id
        : normalized.type === 'Network.webSocketClosed'
          ? normalized.data.requestId
          : undefined
    if (terminalRequestId) {
      this.requests.delete(terminalRequestId)
      this.requestCells.delete(terminalRequestId)
    }
    return sendPromise
  }

  public sendRequest(type: RequestType, request: RequestDetail): this {
    const requestId = request.id
    let currentCell = this.requestCells.get(requestId)
    if ((type === 'initRequest' || type === 'registerRequest') && !currentCell) {
      const candidate = getCurrentCell()
      if (candidate?.request.id === requestId) {
        currentCell = candidate
        this.requestCells.set(requestId, candidate)
      }
    }

    if (currentCell?.isAborted) {
      if (type === 'endRequest') this.requestCells.delete(requestId)
      return this
    }

    let transformed = request
    if (currentCell) {
      currentCell.request = transformed
      const pipes = currentCell.pipes.filter((pipe) => pipe.type === type)
      for (const { pipe } of pipes) transformed = pipe(transformed)
      currentCell.request = transformed
    }

    if (transformed.id !== requestId && currentCell) {
      this.requestCells.delete(requestId)
      this.requestCells.set(transformed.id, currentCell)
    }
    this.requests.set(transformed.id, transformed)
    void this.send({ type, data: transformed })
    if (type === 'endRequest') {
      this.requests.delete(transformed.id)
      this.requestCells.delete(transformed.id)
    }
    return this
  }

  public responseRequest(id: string, response: CapturedIncomingMessage): void
  public responseRequest(request: RequestDetail, response: CapturedIncomingMessage): void
  public responseRequest(
    idOrRequest: string | RequestDetail,
    response: CapturedIncomingMessage
  ): void {
    if (this.disposed) return
    const id = typeof idOrRequest === 'string' ? idOrRequest : idOrRequest.id
    const request = requestForId(
      id,
      typeof idOrRequest === 'string' ? this.requests.get(id) : idOrRequest
    )
    request.responseHeaders = response.headers ?? request.responseHeaders ?? {}
    request.responseStatusCode = response.statusCode ?? request.responseStatusCode ?? 0
    ;(request as RequestDetail & { responseStatusText?: string }).responseStatusText =
      response.statusMessage
    this.requests.set(id, request)

    // responseReceived is emitted as soon as headers arrive. Body completion is
    // deliberately separate so failures never produce loadingFinished.
    void this.send({ type: 'responseReceived', data: request })

    const chunks: Buffer[] = []
    let settled = false

    const cleanup = () => {
      response.off('data', onData)
      response.off('end', onEnd)
      response.off('aborted', onAborted)
      response.off('error', onError)
      response.off('close', onClose)
      this.responseCleanups.delete(cleanup)
      this.requests.delete(id)
      this.requestCells.delete(id)
    }
    const fail = (errorText: string, canceled = false) => {
      if (settled || this.disposed) return
      settled = true
      request.requestEndTime = Date.now() / 1_000
      cleanup()
      void this.send({
        type: 'requestFailed',
        data: {
          request,
          errorText,
          ...(canceled ? { canceled: true } : {})
        }
      })
    }
    const onData = (chunk: unknown) => {
      if (settled) return
      if (Buffer.isBuffer(chunk)) chunks.push(chunk)
      else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk))
      else chunks.push(Buffer.from(String(chunk)))
    }
    const onEnd = () => {
      if (settled || this.disposed) return
      settled = true
      const rawData = Buffer.concat(chunks)
      request.requestEndTime = Date.now() / 1_000
      const data: LegacyResponseData = {
        id,
        rawData,
        statusCode: response.statusCode ?? request.responseStatusCode ?? 0,
        ...(response.statusMessage ? { statusMessage: response.statusMessage } : {}),
        headers: response.headers ?? request.responseHeaders ?? {},
        ...(headerValue(response.headers ?? {}, 'content-encoding')
          ? { contentEncoding: headerValue(response.headers ?? {}, 'content-encoding') }
          : {})
      }
      cleanup()
      void this.send({ type: 'responseData', data })
    }
    const onAborted = () => fail('The response was aborted.', true)
    const onError = (error: unknown) => fail(error instanceof Error ? error.message : String(error))
    const onClose = () => {
      if (!settled) fail('The response stream closed before completion.')
    }

    response.on('data', onData)
    response.once('end', onEnd)
    response.once('aborted', onAborted)
    response.once('error', onError)
    response.once('close', onClose)
    this.responseCleanups.add(cleanup)
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const cleanup of [...this.responseCleanups]) cleanup()
    this.responseCleanups.clear()
    this.requests.clear()
    this.requestCells.clear()
    await this.bridge.dispose()
  }
}

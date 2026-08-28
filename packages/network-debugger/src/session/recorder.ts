import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ProtocolTap } from './protocol-tap'
import { atomicWriteJson, bodyFileName, jsonStringify, resolveInside, sha256 } from './files'
import { traceContextFromHeaders } from './trace'
import {
  SESSION_SCHEMA_VERSION,
  type CdpProtocolEvent,
  type ResponseBodyResult,
  type SessionBodyIndexEntry,
  type SessionManifest,
  type SessionProtocolConnection,
  type SessionRecorderIssue,
  type SessionRecorderOptions,
  type SessionRequestIndexEntry,
  type SessionTraceIndexEntry
} from './types'

const DEFAULT_BODY_COMMAND_TIMEOUT_MS = 10_000

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function cloneRecord(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value)
  return record ? (JSON.parse(jsonStringify(record)) as Record<string, unknown>) : undefined
}

function requestIdFrom(params: Record<string, unknown>): string | undefined {
  const requestId = params.requestId
  if (typeof requestId === 'string') return requestId
  if (typeof requestId === 'number' && Number.isFinite(requestId)) return String(requestId)
  return undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/** Records standard CDP Network events into a portable, append-only session. */
export class SessionRecorder {
  readonly directory: string
  readonly target: SessionManifest['target']
  readonly tap: SessionProtocolConnection

  private readonly ownsTap: boolean
  private readonly bodyCommandTimeoutMs: number
  private readonly manifestPath: string
  private readonly eventsPath: string
  private readonly bodiesPath: string
  private readonly requestIndex = new Map<string, SessionRequestIndexEntry>()
  private readonly bodyIndex = new Map<string, SessionBodyIndexEntry>()
  private readonly traceIndex = new Map<string, SessionTraceIndexEntry>()
  private readonly issues: SessionRecorderIssue[] = []
  private readonly bodyErrors = new Set<string>()
  private readonly terminalRequests = new Set<string>()
  private readonly baseManifest: Omit<
    SessionManifest,
    'stats' | 'requestIndex' | 'bodyIndex' | 'traceIndex' | 'issues'
  >

  private eventFile?: FileHandle
  private unsubscribeEvent?: () => void
  private unsubscribeDisconnect?: () => void
  private operationQueue: Promise<void> = Promise.resolve()
  private closePromise?: Promise<void>
  private fatalError?: Error
  private acceptingEvents = true
  private sequence = 0

  private constructor(options: SessionRecorderOptions) {
    this.directory = resolve(options.directory)
    this.target = { ...options.target }
    this.tap = options.tap ?? new ProtocolTap(this.target)
    this.ownsTap = options.tap === undefined
    this.bodyCommandTimeoutMs =
      Number.isSafeInteger(options.bodyCommandTimeoutMs) && Number(options.bodyCommandTimeoutMs) > 0
        ? Number(options.bodyCommandTimeoutMs)
        : DEFAULT_BODY_COMMAND_TIMEOUT_MS
    this.manifestPath = resolve(this.directory, 'manifest.json')
    this.eventsPath = resolve(this.directory, 'events.ndjson')
    this.bodiesPath = resolve(this.directory, 'bodies')
    this.baseManifest = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: randomUUID(),
      state: 'recording',
      createdAt: new Date().toISOString(),
      target: this.target,
      files: { events: 'events.ndjson', bodies: 'bodies' }
    }
  }

  static async start(options: SessionRecorderOptions): Promise<SessionRecorder> {
    if (
      options.tap &&
      options.tap.target.webSocketDebuggerUrl !== options.target.webSocketDebuggerUrl
    ) {
      throw new Error('Session recorder target does not match the supplied ProtocolTap target.')
    }
    const recorder = new SessionRecorder(options)
    await recorder.initialize()
    return recorder
  }

  getManifest(): SessionManifest {
    return JSON.parse(jsonStringify(this.buildManifest())) as SessionManifest
  }

  close(): Promise<void> {
    if (!this.closePromise) this.closePromise = this.finish()
    return this.closePromise
  }

  private async initialize(): Promise<void> {
    let artifactsStarted = false
    try {
      await fs.mkdir(this.directory, { recursive: true })
      if ((await pathExists(this.manifestPath)) || (await pathExists(this.eventsPath))) {
        throw new Error(`Session artifacts already exist in: ${this.directory}`)
      }
      await fs.mkdir(this.bodiesPath, { recursive: true })
      this.eventFile = await fs.open(this.eventsPath, 'wx')
      artifactsStarted = true
      await this.persistManifest()

      this.unsubscribeEvent = this.tap.onEvent((event) => {
        if (!this.acceptingEvents) return
        return this.enqueue(() => this.recordEvent(event))
      })
      this.unsubscribeDisconnect = this.tap.onDisconnect((error) => {
        if (!this.acceptingEvents) return
        void this.enqueue(async () => {
          this.baseManifest.state = 'failed'
          this.addIssue('protocol-disconnect', error)
          await this.persistManifest()
        })
      })
      await this.tap.connect()
    } catch (error) {
      this.acceptingEvents = false
      this.unsubscribeEvent?.()
      this.unsubscribeDisconnect?.()
      await this.operationQueue
      if (artifactsStarted) {
        this.baseManifest.state = 'failed'
        this.baseManifest.completedAt = new Date().toISOString()
        this.addIssue('session-start', error)
        await this.eventFile?.close().catch(() => undefined)
        this.eventFile = undefined
        await this.persistManifest().catch(() => undefined)
      }
      if (this.ownsTap) await this.tap.close().catch(() => undefined)
      throw error
    }
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const scheduled = this.operationQueue.then(operation)
    this.operationQueue = scheduled.catch((error) => {
      const normalized = error instanceof Error ? error : new Error(String(error))
      if (!this.fatalError) {
        this.fatalError = normalized
        this.baseManifest.state = 'failed'
        this.addIssue('session-write', normalized)
      }
    })
    return scheduled
  }

  private async recordEvent(event: CdpProtocolEvent): Promise<void> {
    const params = cloneRecord(event.params) ?? {}
    const sequence = ++this.sequence
    const record = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sequence,
      recordedAt: new Date().toISOString(),
      method: event.method,
      params
    }
    if (!this.eventFile) throw new Error('Session event journal is not open.')
    await this.eventFile.appendFile(`${jsonStringify(record)}\n`, 'utf8')
    await this.applyNetworkEvent(event.method, params, sequence)
    await this.persistManifest()
  }

  private async applyNetworkEvent(
    method: string,
    params: Record<string, unknown>,
    sequence: number
  ): Promise<void> {
    if (!method.startsWith('Network.')) return
    const requestId = requestIdFrom(params)
    if (!requestId) return
    const request = this.ensureRequest(requestId, sequence)

    if (method === 'Network.requestWillBeSent') {
      request.requestTimestamp = finiteNumber(params.timestamp)
      request.wallTime = finiteNumber(params.wallTime)
      request.resourceType = typeof params.type === 'string' ? params.type : request.resourceType
      request.request = cloneRecord(params.request)
      const trace = traceContextFromHeaders(asRecord(params.request)?.headers)
      if (trace) {
        request.trace = trace
        this.indexTrace(requestId, trace)
      }
      return
    }

    if (method === 'Network.responseReceived') {
      request.responseTimestamp = finiteNumber(params.timestamp)
      request.resourceType = typeof params.type === 'string' ? params.type : request.resourceType
      request.response = cloneRecord(params.response)
      return
    }

    if (method === 'Network.loadingFailed') {
      if (this.terminalRequests.has(requestId)) return
      this.terminalRequests.add(requestId)
      request.finishedTimestamp = finiteNumber(params.timestamp)
      request.failure = {
        errorText:
          typeof params.errorText === 'string' ? params.errorText : 'Network request failed',
        ...(typeof params.canceled === 'boolean' ? { canceled: params.canceled } : {}),
        ...(typeof params.blockedReason === 'string' ? { blockedReason: params.blockedReason } : {})
      }
      return
    }

    if (method !== 'Network.loadingFinished' || this.terminalRequests.has(requestId)) return
    this.terminalRequests.add(requestId)
    request.finishedTimestamp = finiteNumber(params.timestamp)
    request.encodedDataLength = finiteNumber(params.encodedDataLength)
    await this.captureBody(requestId, request)
  }

  private ensureRequest(requestId: string, sequence: number): SessionRequestIndexEntry {
    const existing = this.requestIndex.get(requestId)
    if (existing) return existing
    const created: SessionRequestIndexEntry = { requestId, firstSequence: sequence }
    this.requestIndex.set(requestId, created)
    return created
  }

  private indexTrace(requestId: string, trace: NonNullable<SessionRequestIndexEntry['trace']>) {
    const existing = this.traceIndex.get(trace.traceId) ?? {
      traceId: trace.traceId,
      requestIds: [],
      spans: []
    }
    if (!existing.requestIds.includes(requestId)) existing.requestIds.push(requestId)
    if (!existing.spans.some((span) => span.requestId === requestId)) {
      existing.spans.push({
        requestId,
        parentId: trace.parentId,
        traceFlags: trace.traceFlags,
        sampled: trace.sampled,
        traceparent: trace.traceparent,
        ...(trace.tracestate ? { tracestate: trace.tracestate } : {})
      })
    }
    this.traceIndex.set(trace.traceId, existing)
  }

  private async captureBody(requestId: string, request: SessionRequestIndexEntry): Promise<void> {
    try {
      const result = await this.tap.command<ResponseBodyResult>(
        'Network.getResponseBody',
        { requestId },
        { timeoutMs: this.bodyCommandTimeoutMs }
      )
      if (!result || typeof result.body !== 'string' || typeof result.base64Encoded !== 'boolean') {
        throw new Error('Network.getResponseBody returned an invalid result.')
      }
      const body = result.base64Encoded
        ? Buffer.from(result.body, 'base64')
        : Buffer.from(result.body, 'utf8')
      const fileName = bodyFileName(requestId, body)
      const relativePath = `bodies/${fileName}`
      const absolutePath = resolveInside(this.directory, relativePath)
      try {
        await fs.writeFile(absolutePath, body, { flag: 'wx' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const existing = await fs.readFile(absolutePath)
        if (sha256(existing) !== sha256(body)) {
          throw new Error(`Existing session body does not match its content hash: ${relativePath}`)
        }
      }
      const response = request.response
      this.bodyIndex.set(requestId, {
        requestId,
        path: relativePath,
        sha256: sha256(body),
        byteLength: body.length,
        base64Encoded: result.base64Encoded,
        ...(typeof response?.mimeType === 'string' ? { mimeType: response.mimeType } : {})
      })
    } catch (error) {
      this.bodyErrors.add(requestId)
      this.addIssue('Network.getResponseBody', error, requestId)
    }
  }

  private addIssue(operation: string, error: unknown, requestId?: string): void {
    this.issues.push({
      timestamp: new Date().toISOString(),
      operation,
      message: messageFor(error),
      ...(requestId ? { requestId } : {})
    })
  }

  private buildManifest(): SessionManifest {
    return {
      ...this.baseManifest,
      stats: {
        eventCount: this.sequence,
        requestCount: this.requestIndex.size,
        bodyCount: this.bodyIndex.size,
        bodyErrorCount: this.bodyErrors.size,
        failedRequestCount: [...this.requestIndex.values()].filter((request) => request.failure)
          .length
      },
      requestIndex: Object.fromEntries(this.requestIndex),
      bodyIndex: Object.fromEntries(this.bodyIndex),
      traceIndex: Object.fromEntries(this.traceIndex),
      issues: [...this.issues]
    }
  }

  private persistManifest(): Promise<void> {
    return atomicWriteJson(this.manifestPath, this.buildManifest())
  }

  private async finish(): Promise<void> {
    this.acceptingEvents = false
    this.unsubscribeEvent?.()
    this.unsubscribeDisconnect?.()
    await this.operationQueue

    if (this.baseManifest.state === 'recording') this.baseManifest.state = 'completed'
    this.baseManifest.completedAt = new Date().toISOString()
    await this.eventFile?.close()
    this.eventFile = undefined

    let finishError = this.fatalError
    try {
      await this.persistManifest()
    } catch (error) {
      finishError = finishError ?? (error instanceof Error ? error : new Error(String(error)))
    }
    if (this.ownsTap) {
      try {
        await this.tap.close()
      } catch (error) {
        finishError = finishError ?? (error instanceof Error ? error : new Error(String(error)))
      }
    }
    if (finishError) throw finishError
  }
}

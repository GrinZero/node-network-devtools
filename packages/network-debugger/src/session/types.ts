import type { DevtoolsTarget } from '../adapters/types'

export const SESSION_SCHEMA_VERSION = 1 as const

export type CdpCommandId = number | string

export interface CdpProtocolEvent<T = Record<string, unknown>> {
  method: string
  params: T
}

export interface CdpErrorObject {
  code: number
  message: string
  data?: unknown
}

export interface ProtocolTapCommandOptions {
  timeoutMs?: number
}

export interface ProtocolTapOptions {
  connectTimeoutMs?: number
  commandTimeoutMs?: number
  closeTimeoutMs?: number
  maxPendingCommands?: number
}

export interface TraceContext {
  traceparent: string
  version: string
  traceId: string
  parentId: string
  traceFlags: string
  sampled: boolean
  tracestate?: string
}

export interface SessionFailure {
  errorText: string
  canceled?: boolean
  blockedReason?: string
}

export interface SessionRequestIndexEntry {
  requestId: string
  firstSequence: number
  requestTimestamp?: number
  wallTime?: number
  responseTimestamp?: number
  finishedTimestamp?: number
  encodedDataLength?: number
  resourceType?: string
  request?: Record<string, unknown>
  response?: Record<string, unknown>
  failure?: SessionFailure
  trace?: TraceContext
}

export interface SessionBodyIndexEntry {
  requestId: string
  path: string
  sha256: string
  byteLength: number
  base64Encoded: boolean
  mimeType?: string
}

export interface SessionTraceSpan {
  requestId: string
  parentId: string
  traceFlags: string
  sampled: boolean
  traceparent: string
  tracestate?: string
}

export interface SessionTraceIndexEntry {
  traceId: string
  requestIds: string[]
  spans: SessionTraceSpan[]
}

export interface SessionRecorderIssue {
  timestamp: string
  operation: string
  message: string
  requestId?: string
}

export interface SessionManifest {
  schemaVersion: typeof SESSION_SCHEMA_VERSION
  sessionId: string
  state: 'recording' | 'completed' | 'failed'
  createdAt: string
  completedAt?: string
  target: DevtoolsTarget
  files: {
    events: 'events.ndjson'
    bodies: 'bodies'
  }
  stats: {
    eventCount: number
    requestCount: number
    bodyCount: number
    bodyErrorCount: number
    failedRequestCount: number
  }
  requestIndex: Record<string, SessionRequestIndexEntry>
  bodyIndex: Record<string, SessionBodyIndexEntry>
  traceIndex: Record<string, SessionTraceIndexEntry>
  issues: SessionRecorderIssue[]
}

export interface SessionEventRecord<T = Record<string, unknown>> {
  schemaVersion: typeof SESSION_SCHEMA_VERSION
  sequence: number
  recordedAt: string
  method: string
  params: T
}

export interface ResponseBodyResult {
  body: string
  base64Encoded: boolean
}

export interface SessionProtocolConnection {
  readonly target: DevtoolsTarget
  readonly state: 'idle' | 'connecting' | 'open' | 'closing' | 'closed'
  connect(): Promise<unknown>
  command<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
    options?: ProtocolTapCommandOptions
  ): Promise<T>
  onEvent(listener: (event: CdpProtocolEvent) => void | Promise<void>): () => void
  onDisconnect(listener: (error: Error) => void): () => void
  close(): Promise<void>
}

export interface SessionRecorderOptions {
  directory: string
  target: DevtoolsTarget
  tap?: SessionProtocolConnection
  bodyCommandTimeoutMs?: number
}

export interface HarHeader {
  name: string
  value: string
}

export interface HarQueryParameter {
  name: string
  value: string
}

export interface HarPostData {
  mimeType: string
  text: string
}

export interface HarContent {
  size: number
  mimeType: string
  text?: string
  encoding?: 'base64'
}

export interface HarEntry {
  startedDateTime: string
  time: number
  request: {
    method: string
    url: string
    httpVersion: string
    cookies: unknown[]
    headers: HarHeader[]
    queryString: HarQueryParameter[]
    postData?: HarPostData
    headersSize: number
    bodySize: number
  }
  response: {
    status: number
    statusText: string
    httpVersion: string
    cookies: unknown[]
    headers: HarHeader[]
    content: HarContent
    redirectURL: string
    headersSize: number
    bodySize: number
  }
  cache: Record<string, never>
  timings: {
    blocked: number
    dns: number
    connect: number
    send: number
    wait: number
    receive: number
    ssl: number
  }
  _requestId: string
  _failure?: SessionFailure
  _trace?: TraceContext
}

export interface HarDocument {
  log: {
    version: '1.2'
    creator: {
      name: 'node-network-devtools'
      version: string
    }
    pages: unknown[]
    entries: HarEntry[]
  }
}

export interface HarExportResult {
  outputPath: string
  har: HarDocument
}

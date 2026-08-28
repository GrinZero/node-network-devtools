import type { HarDocument } from '../session/types'

export type ReplaySource = string | HarDocument

export interface ReplayRequest {
  index: number
  requestId?: string
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export interface ReplayOptions {
  /** Resolve and validate requests without opening a network connection. */
  dryRun?: boolean
  /** Stop after the first failed request. Defaults to false. */
  stopOnError?: boolean
  /** Per-request timeout. Defaults to 30 seconds. */
  timeoutMs?: number
  /** Test/embedding hook. The global Fetch implementation is used by default. */
  fetch?: typeof fetch
}

export interface ReplayResult {
  request: ReplayRequest
  dryRun: boolean
  ok: boolean
  status?: number
  statusText?: string
  responseHeaders?: Record<string, string>
  error?: string
  durationMs: number
}

export interface ReplayReport {
  dryRun: boolean
  startedAt: string
  completedAt: string
  requests: ReplayRequest[]
  results: ReplayResult[]
  succeeded: number
  failed: number
}

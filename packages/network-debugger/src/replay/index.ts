import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readSessionManifest } from '../session/files'
import type {
  HarDocument,
  HarEntry,
  HarHeader,
  SessionManifest,
  SessionRequestIndexEntry
} from '../session/types'
import type {
  ReplayOptions,
  ReplayReport,
  ReplayRequest,
  ReplayResult,
  ReplaySource
} from './types'

export type {
  ReplayOptions,
  ReplayReport,
  ReplayRequest,
  ReplayResult,
  ReplaySource
} from './types'

const DEFAULT_TIMEOUT_MS = 30_000
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
])
const RUNTIME_MANAGED_HEADERS = new Set(['content-length', 'host'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(String).join(', ')
  return undefined
}

/** Remove RFC hop-by-hop fields, fields named by Connection, and Fetch-owned fields. */
export function sanitizeReplayHeaders(
  headers: Iterable<readonly [string, string]>
): Record<string, string> {
  const values = [...headers]
  const connectionTokens = new Set<string>()
  for (const [name, value] of values) {
    if (name.toLowerCase() !== 'connection') continue
    for (const token of value.split(',')) {
      const normalized = token.trim().toLowerCase()
      if (normalized) connectionTokens.add(normalized)
    }
  }

  const sanitized: Record<string, string> = {}
  for (const [name, value] of values) {
    const normalized = name.trim().toLowerCase()
    if (
      !normalized ||
      HOP_BY_HOP_HEADERS.has(normalized) ||
      RUNTIME_MANAGED_HEADERS.has(normalized) ||
      connectionTokens.has(normalized)
    ) {
      continue
    }
    sanitized[name] = value
  }
  return sanitized
}

function headerPairs(value: unknown): Array<[string, string]> {
  if (Array.isArray(value)) {
    return value.flatMap((header): Array<[string, string]> => {
      if (!isRecord(header) || typeof header.name !== 'string') return []
      const stringified = stringValue(header.value)
      return stringified === undefined ? [] : [[header.name, stringified]]
    })
  }
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([name, nested]): Array<[string, string]> => {
    const stringified = stringValue(nested)
    return stringified === undefined ? [] : [[name, stringified]]
  })
}

function assertReplayUrl(url: string, index: number): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Replay request ${index} has an invalid URL: ${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Replay request ${index} uses unsupported protocol ${parsed.protocol}; only HTTP(S) can be replayed.`
    )
  }
}

function requestFromHar(entry: HarEntry, index: number): ReplayRequest {
  const method = entry.request.method.toUpperCase()
  const url = entry.request.url
  assertReplayUrl(url, index)
  const body = method === 'GET' || method === 'HEAD' ? undefined : entry.request.postData?.text
  return {
    index,
    requestId: entry._requestId,
    method,
    url,
    headers: sanitizeReplayHeaders(
      entry.request.headers.map((header: HarHeader) => [header.name, header.value] as const)
    ),
    ...(body !== undefined ? { body } : {})
  }
}

function requestFromSession(
  entry: SessionRequestIndexEntry,
  requestId: string,
  index: number
): ReplayRequest | undefined {
  const request = entry.request
  if (!request || typeof request.url !== 'string') return undefined
  const method =
    typeof request.method === 'string' && request.method ? request.method.toUpperCase() : 'GET'
  assertReplayUrl(request.url, index)
  const bodyValue = stringValue(request.postData)
  return {
    index,
    requestId,
    method,
    url: request.url,
    headers: sanitizeReplayHeaders(headerPairs(request.headers)),
    ...(method !== 'GET' && method !== 'HEAD' && bodyValue !== undefined ? { body: bodyValue } : {})
  }
}

function requestsFromManifest(manifest: SessionManifest): ReplayRequest[] {
  return Object.entries(manifest.requestIndex)
    .sort(([, left], [, right]) => left.firstSequence - right.firstSequence)
    .flatMap(([requestId, entry], index) => {
      const request = requestFromSession(entry, requestId, index)
      return request ? [request] : []
    })
    .map((request, index) => ({ ...request, index }))
}

function assertHar(value: unknown, source: string): HarDocument {
  if (!isRecord(value) || !isRecord(value.log) || !Array.isArray(value.log.entries)) {
    throw new Error(`Replay source is not a HAR 1.2 document: ${source}`)
  }
  return value as unknown as HarDocument
}

/** Load a deterministic replay plan from a Session directory or HAR document/file. */
export async function loadReplayRequests(source: ReplaySource): Promise<ReplayRequest[]> {
  if (typeof source !== 'string') {
    return source.log.entries.map(requestFromHar)
  }

  const absolute = resolve(source)
  const details = await stat(absolute)
  if (details.isDirectory()) {
    return requestsFromManifest(await readSessionManifest(absolute))
  }
  if (!details.isFile()) throw new Error(`Replay source is not a file or directory: ${absolute}`)
  const har = assertHar(JSON.parse(await readFile(absolute, 'utf8')), absolute)
  return har.log.entries.map(requestFromHar)
}

function timeoutValue(value: number | undefined): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : DEFAULT_TIMEOUT_MS
}

function headersToRecord(headers: Headers): Record<string, string> {
  const values: Record<string, string> = {}
  headers.forEach((value, name) => {
    values[name] = value
  })
  return values
}

/** Replay HTTP(S) requests, or return the exact request plan in dry-run mode. */
export async function replay(
  source: ReplaySource,
  options: ReplayOptions = {}
): Promise<ReplayReport> {
  const startedAt = new Date().toISOString()
  const requests = await loadReplayRequests(source)
  const results: ReplayResult[] = []
  const dryRun = options.dryRun === true
  const fetchImplementation = options.fetch ?? globalThis.fetch
  if (!dryRun && typeof fetchImplementation !== 'function') {
    throw new Error('Replay requires a Fetch implementation on this Node.js runtime.')
  }

  for (const request of requests) {
    const started = performance.now()
    if (dryRun) {
      results.push({ request, dryRun: true, ok: true, durationMs: 0 })
      continue
    }

    const abortController = new AbortController()
    const timer = setTimeout(() => abortController.abort(), timeoutValue(options.timeoutMs))
    timer.unref?.()
    try {
      const response = await fetchImplementation(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body !== undefined ? { body: request.body } : {}),
        redirect: 'manual',
        signal: abortController.signal
      })
      await response.arrayBuffer()
      results.push({
        request,
        dryRun: false,
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        responseHeaders: headersToRecord(response.headers),
        durationMs: performance.now() - started
      })
      if (!response.ok && options.stopOnError) break
    } catch (error) {
      results.push({
        request,
        dryRun: false,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: performance.now() - started
      })
      if (options.stopOnError) break
    } finally {
      clearTimeout(timer)
    }
  }

  const succeeded = results.filter((result) => result.ok).length
  return {
    dryRun,
    startedAt,
    completedAt: new Date().toISOString(),
    requests,
    results,
    succeeded,
    failed: results.length - succeeded
  }
}

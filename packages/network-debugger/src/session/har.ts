import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'
import { atomicWriteJson, readSessionManifest, resolveInside, sha256 } from './files'
import { sessionHeaderValue } from './trace'
import type {
  HarDocument,
  HarEntry,
  HarExportResult,
  HarHeader,
  HarQueryParameter,
  SessionBodyIndexEntry,
  SessionManifest,
  SessionRequestIndexEntry
} from './types'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value === undefined ? fallback : String(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function headersToHar(headers: unknown): HarHeader[] {
  const record = asRecord(headers)
  const output: HarHeader[] = []
  for (const [name, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      for (const nested of value) output.push({ name, value: String(nested) })
    } else if (value !== undefined && value !== null) {
      output.push({ name, value: String(value) })
    }
  }
  return output
}

function queryString(url: string): HarQueryParameter[] {
  try {
    return [...new URL(url).searchParams].map(([name, value]) => ({ name, value }))
  } catch {
    return []
  }
}

function millisecondsBetween(end: number | undefined, start: number | undefined): number {
  if (end === undefined || start === undefined) return 0
  return Math.max(0, (end - start) * 1000)
}

function timingDuration(timing: Record<string, unknown>, start: string, end: string): number {
  const startValue = finiteNumber(timing[start])
  const endValue = finiteNumber(timing[end])
  if (startValue === undefined || endValue === undefined || startValue < 0 || endValue < 0) {
    return -1
  }
  return Math.max(0, endValue - startValue)
}

function startedDateTime(request: SessionRequestIndexEntry, fallback: string): string {
  if (request.wallTime === undefined) return fallback
  const milliseconds =
    request.wallTime > 100_000_000_000 ? request.wallTime : request.wallTime * 1000
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
}

async function readIndexedBody(
  sessionDirectory: string,
  body: SessionBodyIndexEntry | undefined
): Promise<Buffer | undefined> {
  if (!body) return undefined
  const bytes = await fs.readFile(resolveInside(sessionDirectory, body.path))
  if (bytes.length !== body.byteLength || sha256(bytes) !== body.sha256) {
    throw new Error(`Session body integrity check failed for request ${body.requestId}.`)
  }
  return bytes
}

function responseProtocol(response: Record<string, unknown>): string {
  const protocol = stringValue(response.protocol)
  if (!protocol) return 'HTTP/1.1'
  if (protocol === 'h2') return 'HTTP/2'
  if (/^http\//i.test(protocol)) return protocol.toUpperCase()
  return protocol
}

async function toHarEntry(
  sessionDirectory: string,
  manifest: SessionManifest,
  indexed: SessionRequestIndexEntry
): Promise<HarEntry> {
  const request = asRecord(indexed.request)
  const response = asRecord(indexed.response)
  const requestHeaders = request.headers
  const responseHeaders = response.headers
  const url = stringValue(request.url, stringValue(response.url))
  const method = stringValue(request.method, 'GET')
  const postData = typeof request.postData === 'string' ? request.postData : undefined
  const bodyIndex = manifest.bodyIndex[indexed.requestId]
  const body = await readIndexedBody(sessionDirectory, bodyIndex)
  const responseMimeType = stringValue(
    response.mimeType,
    sessionHeaderValue(responseHeaders, 'content-type') ??
      bodyIndex?.mimeType ??
      'application/octet-stream'
  )
  const responseTimestamp = indexed.responseTimestamp
  const terminalTimestamp = indexed.finishedTimestamp ?? responseTimestamp
  const totalTime = millisecondsBetween(terminalTimestamp, indexed.requestTimestamp)
  const responseTiming = asRecord(response.timing)
  const wait = millisecondsBetween(responseTimestamp, indexed.requestTimestamp)
  const receive = millisecondsBetween(terminalTimestamp, responseTimestamp)
  const status = finiteNumber(response.status) ?? 0
  const requestBodySize = postData === undefined ? 0 : Buffer.byteLength(postData)
  const responseBodySize = body?.length ?? indexed.encodedDataLength ?? 0

  const entry: HarEntry = {
    startedDateTime: startedDateTime(indexed, manifest.createdAt),
    time: totalTime,
    request: {
      method,
      url,
      httpVersion: responseProtocol(response),
      cookies: [],
      headers: headersToHar(requestHeaders),
      queryString: queryString(url),
      ...(postData !== undefined
        ? {
            postData: {
              mimeType:
                sessionHeaderValue(requestHeaders, 'content-type') ?? 'application/octet-stream',
              text: postData
            }
          }
        : {}),
      headersSize: -1,
      bodySize: requestBodySize
    },
    response: {
      status,
      statusText: stringValue(response.statusText, indexed.failure?.errorText ?? ''),
      httpVersion: responseProtocol(response),
      cookies: [],
      headers: headersToHar(responseHeaders),
      content: {
        size: body?.length ?? indexed.encodedDataLength ?? 0,
        mimeType: responseMimeType,
        ...(body
          ? bodyIndex?.base64Encoded
            ? { text: body.toString('base64'), encoding: 'base64' as const }
            : { text: body.toString('utf8') }
          : {})
      },
      redirectURL: sessionHeaderValue(responseHeaders, 'location') ?? '',
      headersSize: -1,
      bodySize: responseBodySize
    },
    cache: {},
    timings: {
      blocked: timingDuration(responseTiming, 'proxyStart', 'proxyEnd'),
      dns: timingDuration(responseTiming, 'dnsStart', 'dnsEnd'),
      connect: timingDuration(responseTiming, 'connectStart', 'connectEnd'),
      send: timingDuration(responseTiming, 'sendStart', 'sendEnd'),
      wait,
      receive,
      ssl: timingDuration(responseTiming, 'sslStart', 'sslEnd')
    },
    _requestId: indexed.requestId,
    ...(indexed.failure ? { _failure: { ...indexed.failure } } : {}),
    ...(indexed.trace ? { _trace: { ...indexed.trace } } : {})
  }
  return entry
}

export async function buildHar(sessionDirectory: string): Promise<HarDocument> {
  const directory = resolve(sessionDirectory)
  const manifest = await readSessionManifest(directory)
  const requests = Object.values(manifest.requestIndex).sort(
    (left, right) => left.firstSequence - right.firstSequence
  )
  const entries: HarEntry[] = []
  for (const request of requests) entries.push(await toHarEntry(directory, manifest, request))
  return {
    log: {
      version: '1.2',
      creator: { name: 'node-network-devtools', version: '2' },
      pages: [],
      entries
    }
  }
}

export async function exportHar(
  sessionDirectory: string,
  outputPath = resolve(sessionDirectory, 'session.har')
): Promise<HarExportResult> {
  const absoluteOutputPath = resolve(outputPath)
  const har = await buildHar(sessionDirectory)
  await atomicWriteJson(absoluteOutputPath, har)
  return { outputPath: absoluteOutputPath, har }
}

import * as http from 'node:http'
import type { DevtoolsTarget } from '../types'
import { NodeNativeAdapterError, nativeDiagnostic } from './errors'

export interface RawInspectorTarget {
  id?: unknown
  title?: unknown
  type?: unknown
  url?: unknown
  webSocketDebuggerUrl?: unknown
  devtoolsFrontendUrl?: unknown
  devtoolsFrontendUrlCompat?: unknown
}

export interface TargetDiscoveryOptions {
  attempts?: number
  requestTimeoutMs?: number
  retryDelayMs?: number
}

export interface TargetDiscoveryDependencies {
  requestJson?: (url: string, timeoutMs: number) => Promise<unknown>
  sleep?: (milliseconds: number) => Promise<void>
}

const DEFAULT_DISCOVERY_OPTIONS: Required<TargetDiscoveryOptions> = {
  attempts: 5,
  requestTimeoutMs: 500,
  retryDelayMs: 25
}

function requestJson(url: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const request = http.get(parsed, (response) => {
      const chunks: Buffer[] = []

      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => {
        const statusCode = response.statusCode ?? 0
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`Inspector discovery returned HTTP ${statusCode}`))
          return
        }

        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch (error) {
          reject(error)
        }
      })
    })

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Inspector discovery timed out after ${timeoutMs}ms`))
    })
    request.on('error', reject)
  })
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

export function getInspectorDiscoveryUrl(webSocketUrl: string) {
  const parsed = new URL(webSocketUrl)
  // node:inspector exposes a local, non-TLS WebSocket endpoint. Supporting
  // arbitrary remote WSS proxies here would make target ownership ambiguous.
  if (parsed.protocol !== 'ws:') {
    throw new Error(`Unsupported Inspector URL protocol: ${parsed.protocol}`)
  }
  parsed.protocol = 'http:'
  parsed.pathname = '/json/list'
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function normalizeTarget(
  rawTarget: RawInspectorTarget,
  discoveryUrl: string
): DevtoolsTarget | null {
  if (!isString(rawTarget.id) || !isString(rawTarget.webSocketDebuggerUrl)) return null

  return {
    id: rawTarget.id,
    title: isString(rawTarget.title) ? rawTarget.title : 'Node.js',
    type: isString(rawTarget.type) ? rawTarget.type : 'node',
    url: isString(rawTarget.url) ? rawTarget.url : '',
    webSocketDebuggerUrl: rawTarget.webSocketDebuggerUrl,
    ...(isString(rawTarget.devtoolsFrontendUrl)
      ? { devtoolsFrontendUrl: rawTarget.devtoolsFrontendUrl }
      : {}),
    ...(isString(rawTarget.devtoolsFrontendUrlCompat)
      ? { devtoolsFrontendUrlCompat: rawTarget.devtoolsFrontendUrlCompat }
      : {}),
    discoveryUrl
  }
}

function selectTarget(payload: unknown, inspectorUrl: string, discoveryUrl: string) {
  if (!Array.isArray(payload)) return null

  const targets = payload
    .map((target) => normalizeTarget(target as RawInspectorTarget, discoveryUrl))
    .filter((target): target is DevtoolsTarget => target !== null)

  const inspectorId = new URL(inspectorUrl).pathname.replace(/^\//, '')
  return (
    targets.find((target) => target.webSocketDebuggerUrl === inspectorUrl) ??
    targets.find((target) => target.id === inspectorId) ??
    targets.find((target) => target.type === 'node') ??
    targets[0] ??
    null
  )
}

export async function discoverInspectorTarget(
  inspectorUrl: string,
  options: TargetDiscoveryOptions = {},
  dependencies: TargetDiscoveryDependencies = {}
): Promise<DevtoolsTarget> {
  const normalizedOptions = { ...DEFAULT_DISCOVERY_OPTIONS, ...options }
  const fetchJson = dependencies.requestJson ?? requestJson
  const wait = dependencies.sleep ?? sleep
  const discoveryUrl = getInspectorDiscoveryUrl(inspectorUrl)
  let lastError: unknown

  for (let attempt = 1; attempt <= normalizedOptions.attempts; attempt++) {
    try {
      const payload = await fetchJson(discoveryUrl, normalizedOptions.requestTimeoutMs)
      const target = selectTarget(payload, inspectorUrl, discoveryUrl)
      if (target) return target
      throw new Error('Inspector discovery did not return a matching Node target')
    } catch (error) {
      lastError = error
      if (attempt < normalizedOptions.attempts) {
        await wait(normalizedOptions.retryDelayMs)
      }
    }
  }

  const diagnostic = nativeDiagnostic(
    'NND_NATIVE_TARGET_DISCOVERY_FAILED',
    `Unable to discover the Node Inspector target at ${discoveryUrl}.`,
    'Verify that the Inspector endpoint is still running and retry.',
    {
      inspectorUrl,
      discoveryUrl,
      attempts: normalizedOptions.attempts,
      cause: lastError instanceof Error ? lastError.message : String(lastError)
    }
  )
  throw new NodeNativeAdapterError(diagnostic)
}

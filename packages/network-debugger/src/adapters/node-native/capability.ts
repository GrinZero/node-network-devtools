import type { CapabilityMap, NetworkCapability } from '../types'

export const NATIVE_NETWORK_INSPECTION_FLAG = '--experimental-network-inspection'

/**
 * The maximum capability set currently exposed by Node's native inspector.
 * Runtime probing may turn individual capabilities off for older Node releases.
 *
 * `requestBody` is intentionally false: Node's native HTTP/1 inspector does not
 * yet provide request bodies consistently, so the adapter must not advertise a
 * capability which only works for some transports.
 */
export const NATIVE_CAPABILITIES: CapabilityMap = Object.freeze({
  http: true,
  https: true,
  fetch: true,
  http2: true,
  responseBody: true,
  requestBody: false,
  websocketLifecycle: true,
  websocketFrames: false,
  sseMessages: false,
  initiator: true
})

export const REQUIRED_NATIVE_NETWORK_METHODS = [
  'requestWillBeSent',
  'responseReceived',
  'loadingFinished',
  'loadingFailed'
] as const

export const OPTIONAL_NATIVE_NETWORK_METHODS = [
  'dataReceived',
  'dataSent',
  'webSocketCreated',
  'webSocketHandshakeResponseReceived',
  'webSocketClosed'
] as const

export type NativeNetworkMethod =
  | (typeof REQUIRED_NATIVE_NETWORK_METHODS)[number]
  | (typeof OPTIONAL_NATIVE_NETWORK_METHODS)[number]

export type NativeNetworkApi = Partial<Record<NativeNetworkMethod, (...args: any[]) => unknown>>

export interface NodeVersion {
  major: number
  minor: number
  patch: number
}

export function parseNodeVersion(version: string): NodeVersion | null {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (!match) return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  }
}

function atLeast(version: NodeVersion, major: number, minor: number, patch = 0) {
  if (version.major !== major) return version.major > major
  if (version.minor !== minor) return version.minor > minor
  return version.patch >= patch
}

/** The flag first shipped in Node 20.18 and Node 22.6. */
export function supportsNativeNetworkInspection(version: NodeVersion | null) {
  if (!version) return false
  if (version.major === 20) return atLeast(version, 20, 18)
  if (version.major === 21) return false
  if (version.major === 22) return atLeast(version, 22, 6)
  return version.major >= 23
}

/**
 * Auto selection deliberately has a stricter, proven baseline than explicit
 * Native selection. Older supported releases remain available when requested
 * explicitly, but Auto should prefer Legacy there.
 */
export function isNativeAutoBaseline(version: NodeVersion | null) {
  if (!version) return false
  if (version.major > 24) return true
  return version.major === 24 && atLeast(version, 24, 7)
}

function supportsNativeFetch(version: NodeVersion | null) {
  if (!version) return false
  if (version.major === 22) return atLeast(version, 22, 14)
  if (version.major === 23) return atLeast(version, 23, 7)
  return version.major >= 24
}

function supportsNativeHttp2(version: NodeVersion | null) {
  if (!version) return false

  // Keep this as an explicit allowlist. A non-empty h2c lifecycle is verified on
  // Node 22.20+, while newer majors have regressed in the experimental Inspector.
  // Future majors must be verified independently instead of inheriting support.
  return version.major === 22 && atLeast(version, 22, 20)
}

/**
 * Node 22 exposes dataReceived but its Fetch getResponseBody result can be
 * empty. The public capability spans every advertised transport, so only the
 * verified Node 24+ baseline may claim complete response-body support.
 */
function supportsCompleteNativeResponseBodies(version: NodeVersion | null) {
  return version !== null && version.major >= 24
}

export function hasRequiredNativeMethods(network: NativeNetworkApi | undefined) {
  return REQUIRED_NATIVE_NETWORK_METHODS.every((method) => typeof network?.[method] === 'function')
}

export function getNativeCapabilities(
  version: NodeVersion | null,
  network: NativeNetworkApi | undefined
): CapabilityMap {
  const lifecycle = hasRequiredNativeMethods(network)
  const websocketLifecycle =
    lifecycle &&
    typeof network?.webSocketCreated === 'function' &&
    typeof network.webSocketHandshakeResponseReceived === 'function' &&
    typeof network.webSocketClosed === 'function'

  return Object.freeze({
    http: lifecycle,
    https: lifecycle,
    fetch: lifecycle && supportsNativeFetch(version),
    http2: lifecycle && supportsNativeHttp2(version),
    responseBody:
      lifecycle &&
      supportsCompleteNativeResponseBodies(version) &&
      typeof network?.dataReceived === 'function',
    // Deliberately not inferred from dataSent; HTTP/1 request bodies remain incomplete.
    requestBody: false,
    websocketLifecycle,
    websocketFrames: false,
    sseMessages: false,
    initiator: lifecycle
  })
}

export function getMissingCapabilities(
  capabilities: CapabilityMap,
  required: readonly NetworkCapability[] = []
) {
  return required.filter((capability) => capabilities[capability] !== true)
}

export function hasNativeInspectionFlag(execArgv: readonly string[]) {
  return execArgv.some(
    (argument) =>
      argument === NATIVE_NETWORK_INSPECTION_FLAG ||
      argument.startsWith(`${NATIVE_NETWORK_INSPECTION_FLAG}=`)
  )
}

export const NETWORK_CAPABILITIES = [
  'http',
  'https',
  'fetch',
  'http2',
  'responseBody',
  'requestBody',
  'websocketLifecycle',
  'websocketFrames',
  'sseMessages',
  'initiator'
] as const

export type NetworkCapability = (typeof NETWORK_CAPABILITIES)[number]
export type CapabilityMap = Readonly<Record<NetworkCapability, boolean>>
export type AdapterKind = 'native' | 'legacy'
export type AdapterMode = 'auto' | AdapterKind

export type DiagnosticLevel = 'info' | 'warn' | 'error'

export interface Diagnostic {
  code: string
  level: DiagnosticLevel
  message: string
  hint?: string
  details?: Readonly<Record<string, unknown>>
}

export interface DevtoolsTarget {
  id: string
  title: string
  type: string
  url: string
  webSocketDebuggerUrl: string
  devtoolsFrontendUrl?: string
  devtoolsFrontendUrlCompat?: string
  discoveryUrl: string
}

export interface InspectorTargetOptions {
  host?: string
  port?: number
}

export interface AdapterStartOptions {
  inspector?: InspectorTargetOptions
  requiredCapabilities?: readonly NetworkCapability[]
}

export interface AdapterProbe {
  kind: AdapterKind
  available: boolean
  /** Whether Auto mode may select this adapter as a proven default baseline. */
  autoSelectable?: boolean
  capabilities: CapabilityMap
  diagnostics: readonly Diagnostic[]
}

export interface AdapterSession {
  kind: AdapterKind
  capabilities: CapabilityMap
  target: DevtoolsTarget
  diagnostics: readonly Diagnostic[]
  /** Optional live diagnostics emitted after the initial target is ready. */
  onDiagnostic?(listener: (diagnostic: Diagnostic) => void): () => void
  /** Optional terminal backend failure emitted after initial readiness. */
  onFailure?(listener: (error: Error) => void): () => void
  dispose(): Promise<void>
}

export interface DebugAdapter {
  readonly kind: AdapterKind
  probe(options?: AdapterStartOptions): AdapterProbe | Promise<AdapterProbe>
  start(options?: AdapterStartOptions): Promise<AdapterSession>
}

export interface AdapterSelection {
  adapter: DebugAdapter
  probe: AdapterProbe
  fallbackReason?: Diagnostic
}

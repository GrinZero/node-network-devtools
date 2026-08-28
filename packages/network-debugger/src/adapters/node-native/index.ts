import * as nodeInspector from 'node:inspector'
import type {
  AdapterProbe,
  AdapterSession,
  AdapterStartOptions,
  DebugAdapter,
  Diagnostic
} from '../types'
import {
  NATIVE_CAPABILITIES,
  NATIVE_NETWORK_INSPECTION_FLAG,
  type NativeNetworkApi,
  getMissingCapabilities,
  getNativeCapabilities,
  hasNativeInspectionFlag,
  hasRequiredNativeMethods,
  isNativeAutoBaseline,
  parseNodeVersion,
  supportsNativeNetworkInspection
} from './capability'
import { NodeNativeAdapterError, nativeDiagnostic } from './errors'
import {
  discoverInspectorTarget,
  type TargetDiscoveryDependencies,
  type TargetDiscoveryOptions
} from './inspector-target'

export * from './capability'
export * from './errors'
export * from './inspector-target'

export interface InspectorDisposable {
  [key: symbol]: unknown
}

export interface NativeInspectorApi {
  url(): string | undefined
  open(port?: number, host?: string, wait?: boolean): void | InspectorDisposable
  close(): void
  Network?: NativeNetworkApi
}

export interface NodeNativeAdapterDependencies extends TargetDiscoveryDependencies {
  inspector?: NativeInspectorApi | null
  inspectorAvailable?: boolean | (() => boolean)
  execArgv?: readonly string[] | (() => readonly string[])
  nodeVersion?: string | (() => string)
  discovery?: TargetDiscoveryOptions
}

function resolveValue<T>(value: T | (() => T)): T {
  return typeof value === 'function' ? (value as () => T)() : value
}

function defaultInspectorAvailable() {
  return process.features?.inspector !== false
}

function errorDiagnostic(
  code: string,
  message: string,
  hint: string,
  details?: Readonly<Record<string, unknown>>
) {
  return nativeDiagnostic(code, message, hint, details)
}

export class NodeNativeAdapter implements DebugAdapter {
  readonly kind = 'native' as const
  private readonly dependencies: NodeNativeAdapterDependencies

  constructor(dependencies: NodeNativeAdapterDependencies = {}) {
    this.dependencies = dependencies
  }

  probe(options: AdapterStartOptions = {}): AdapterProbe {
    const diagnostics: Diagnostic[] = []
    const inspector =
      this.dependencies.inspector === undefined
        ? (nodeInspector as unknown as NativeInspectorApi)
        : this.dependencies.inspector
    const inspectorAvailable = resolveValue(
      this.dependencies.inspectorAvailable ?? defaultInspectorAvailable
    )
    const nodeVersionText = resolveValue(
      this.dependencies.nodeVersion ?? (() => process.versions.node)
    )
    const version = parseNodeVersion(nodeVersionText)
    const execArgv = resolveValue(this.dependencies.execArgv ?? (() => process.execArgv))
    const network = inspector?.Network
    const capabilities = getNativeCapabilities(version, network)

    if (!inspectorAvailable || !inspector) {
      diagnostics.push(
        errorDiagnostic(
          'NND_NATIVE_INSPECTOR_UNAVAILABLE',
          'This Node.js runtime was built without Inspector support.',
          'Use an official Node.js build with Inspector support, or select the Legacy adapter.'
        )
      )
    }

    if (!supportsNativeNetworkInspection(version)) {
      diagnostics.push(
        errorDiagnostic(
          'NND_NATIVE_RUNTIME_UNSUPPORTED',
          `Node.js ${nodeVersionText} does not support native network inspection.`,
          'Upgrade to Node.js 20.18+, 22.6+, or a newer release, or select the Legacy adapter.',
          { nodeVersion: nodeVersionText }
        )
      )
    }

    if (!hasNativeInspectionFlag(execArgv)) {
      diagnostics.push(
        errorDiagnostic(
          'NND_NATIVE_FLAG_REQUIRED',
          `Native network inspection requires ${NATIVE_NETWORK_INSPECTION_FLAG}.`,
          `Restart with: node --inspect=0 ${NATIVE_NETWORK_INSPECTION_FLAG} <entry>`,
          { execArgv: [...execArgv] }
        )
      )
    }

    if (inspector && !hasRequiredNativeMethods(network)) {
      diagnostics.push(
        errorDiagnostic(
          'NND_NATIVE_METHODS_UNAVAILABLE',
          'The required node:inspector Network methods are unavailable in this runtime.',
          'Upgrade Node.js or select the Legacy adapter.'
        )
      )
    }

    const missingCapabilities = getMissingCapabilities(capabilities, options.requiredCapabilities)
    if (missingCapabilities.length > 0) {
      diagnostics.push(
        errorDiagnostic(
          'NND_NATIVE_REQUIRED_CAPABILITY_UNAVAILABLE',
          `Native network inspection cannot provide: ${missingCapabilities.join(', ')}.`,
          'Remove the unsupported requirement or select an adapter that provides it.',
          { missingCapabilities }
        )
      )
    }

    const runtimeSupported = supportsNativeNetworkInspection(version)
    if (runtimeSupported && !isNativeAutoBaseline(version)) {
      diagnostics.push(
        nativeDiagnostic(
          'NND_NATIVE_AUTO_BASELINE_UNPROVEN',
          `Node.js ${nodeVersionText} supports explicit Native mode but is below the proven Auto baseline.`,
          'Use Node.js 24.7+ for Auto selection, or explicitly select Native mode.',
          { nodeVersion: nodeVersionText },
          'warn'
        )
      )
    }

    const available = !diagnostics.some((diagnostic) => diagnostic.level === 'error')
    return {
      kind: this.kind,
      available,
      autoSelectable: available && isNativeAutoBaseline(version),
      capabilities,
      diagnostics
    }
  }

  async start(options: AdapterStartOptions = {}): Promise<AdapterSession> {
    const probe = this.probe(options)
    if (!probe.available) {
      const diagnostic = probe.diagnostics.find((item) => item.level === 'error')!
      throw new NodeNativeAdapterError(diagnostic, probe.diagnostics)
    }

    const inspector = (
      this.dependencies.inspector === undefined
        ? (nodeInspector as unknown as NativeInspectorApi)
        : this.dependencies.inspector
    )!
    let inspectorUrl = inspector.url()
    let owned = false
    let disposable: void | InspectorDisposable = undefined

    if (!inspectorUrl) {
      const port = options.inspector?.port ?? 0
      const host = options.inspector?.host ?? '127.0.0.1'
      try {
        disposable = inspector.open(port, host, false)
        owned = true
        inspectorUrl = inspector.url()
      } catch (error) {
        const diagnostic = errorDiagnostic(
          'NND_NATIVE_TARGET_OPEN_FAILED',
          `Unable to open the Node Inspector on ${host}:${port}.`,
          'Choose another Inspector port or start Node with --inspect=0.',
          { cause: error instanceof Error ? error.message : String(error), host, port }
        )
        throw new NodeNativeAdapterError(diagnostic, [...probe.diagnostics, diagnostic])
      }

      if (!inspectorUrl) {
        this.closeOwnedInspector(inspector, disposable)
        const diagnostic = errorDiagnostic(
          'NND_NATIVE_TARGET_URL_UNAVAILABLE',
          'Node Inspector opened without publishing a target URL.',
          'Start Node with --inspect=0 and retry.'
        )
        throw new NodeNativeAdapterError(diagnostic, [...probe.diagnostics, diagnostic])
      }
    }

    try {
      const target = await discoverInspectorTarget(
        inspectorUrl,
        this.dependencies.discovery,
        this.dependencies
      )
      let disposed = false

      return {
        kind: this.kind,
        capabilities: probe.capabilities,
        target,
        diagnostics: probe.diagnostics,
        dispose: async () => {
          if (disposed) return
          disposed = true
          if (owned) this.closeOwnedInspector(inspector, disposable)
        }
      }
    } catch (error) {
      if (owned) this.closeOwnedInspector(inspector, disposable)
      throw error
    }
  }

  private closeOwnedInspector(
    inspector: NativeInspectorApi,
    disposable: void | InspectorDisposable
  ) {
    const disposeSymbol = (Symbol as unknown as { dispose?: symbol }).dispose
    const dispose = disposeSymbol && disposable?.[disposeSymbol]
    if (typeof dispose === 'function') {
      dispose.call(disposable)
      return
    }
    inspector.close()
  }
}

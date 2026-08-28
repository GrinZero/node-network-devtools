import type { RegisterOptions } from '../common'
import { LegacyAdapter } from '../adapters/legacy'
import { NodeNativeAdapter, NodeNativeAdapterError } from '../adapters/node-native'
import { AdapterSelectionError, AdapterSelector } from '../adapters/selector'
import type { AdapterMode, Diagnostic, NetworkCapability } from '../adapters/types'
import { openDevtoolsTarget } from '../target/frontend-launcher'
import { exportHar, SessionRecorder } from '../session'
import {
  createRegistrationHandle,
  type RegistrationHandle,
  type RuntimeAdapterSession
} from './registration'

export class RuntimeRegistrationError extends Error {
  constructor(
    readonly code:
      | 'NND_ALREADY_REGISTERED'
      | 'NND_INVALID_MODE'
      | 'NND_INVALID_SESSION_OPTIONS'
      | 'NND_NATIVE_MOCK_CONFLICT',
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message)
    this.name = 'RuntimeRegistrationError'
  }
}

interface NormalizedOptions {
  mode: AdapterMode
  requiredCapabilities: readonly NetworkCapability[]
  inspector: {
    host: string
    port: number
  }
  devtools: {
    open: boolean
  }
  session?: NonNullable<RegisterOptions['session']>
  legacy: {
    port?: number
    serverPort?: number
    intercept?: RegisterOptions['intercept']
    mock: NonNullable<NonNullable<RegisterOptions['legacy']>['mock']>
  }
  diagnostics: readonly Diagnostic[]
}

interface ActiveRegistration {
  key: string
  handle: RegistrationHandle
}

let activeRegistration: ActiveRegistration | undefined

function normalizeOptions(options: RegisterOptions = {}): NormalizedOptions {
  const diagnostics: Diagnostic[] = []
  const mode = options.mode ?? options.adapter ?? 'auto'
  if (!['auto', 'native', 'legacy'].includes(mode)) {
    throw new RuntimeRegistrationError('NND_INVALID_MODE', `Unknown adapter mode: ${mode}.`, {
      mode
    })
  }

  const mock = options.legacy?.mock ?? []
  if (mode === 'native' && mock.length > 0) {
    throw new RuntimeRegistrationError(
      'NND_NATIVE_MOCK_CONFLICT',
      'Request/response mocking is available only with the Legacy backend.',
      {
        mode,
        mockRuleCount: mock.length,
        hint: 'Use mode: "legacy" or mode: "auto" when legacy.mock rules are configured.'
      }
    )
  }

  if (options.session) {
    if (typeof options.session.directory !== 'string' || !options.session.directory.trim()) {
      throw new RuntimeRegistrationError(
        'NND_INVALID_SESSION_OPTIONS',
        'Session recording requires a non-empty directory.'
      )
    }
    if (
      options.session.bodyCommandTimeoutMs !== undefined &&
      (!Number.isSafeInteger(options.session.bodyCommandTimeoutMs) ||
        options.session.bodyCommandTimeoutMs <= 0)
    ) {
      throw new RuntimeRegistrationError(
        'NND_INVALID_SESSION_OPTIONS',
        'session.bodyCommandTimeoutMs must be a positive integer.'
      )
    }
    if (typeof options.session.har === 'string' && !options.session.har.trim()) {
      throw new RuntimeRegistrationError(
        'NND_INVALID_SESSION_OPTIONS',
        'session.har must be true, false, or a non-empty output path.'
      )
    }
  }

  if (options.adapter !== undefined) {
    diagnostics.push({
      code: 'NND_OPTION_ADAPTER_DEPRECATED',
      level: 'warn',
      message: 'The "adapter" option is deprecated; use "mode".',
      hint: `Replace adapter: "${options.adapter}" with mode: "${options.adapter}".`
    })
  }

  const usesLegacyTopLevelOptions =
    options.port !== undefined ||
    options.serverPort !== undefined ||
    options.intercept !== undefined ||
    options.autoOpenDevtool !== undefined
  if (usesLegacyTopLevelOptions) {
    diagnostics.push({
      code: 'NND_LEGACY_OPTIONS_DEPRECATED',
      level: 'warn',
      message: 'Top-level Legacy options are deprecated.',
      hint: 'Move capture and port settings under "legacy", and browser behavior under "devtools".'
    })
  }

  return {
    mode,
    requiredCapabilities: options.requiredCapabilities ?? options.requiredFeatures ?? [],
    inspector: {
      host: options.inspector?.host ?? '127.0.0.1',
      port: options.inspector?.port ?? 0
    },
    devtools: {
      open: options.devtools?.open ?? options.autoOpenDevtool ?? false
    },
    ...(options.session ? { session: { ...options.session } } : {}),
    legacy: {
      port: options.legacy?.port ?? options.port,
      serverPort: options.legacy?.serverPort ?? options.serverPort,
      intercept: options.legacy?.intercept ?? options.intercept,
      mock
    },
    diagnostics
  }
}

function configurationKey(options: NormalizedOptions): string {
  return JSON.stringify({
    mode: options.mode,
    requiredCapabilities: [...options.requiredCapabilities].sort(),
    inspector: options.inspector,
    devtools: options.devtools,
    session: options.session,
    legacy: options.legacy
  })
}

function uniqueDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  const seen = new Set<string>()
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.code}:${diagnostic.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function promoteForcedNativeError(error: unknown): unknown {
  if (!(error instanceof AdapterSelectionError)) return error
  const diagnostics = error.details.diagnostics
  if (!Array.isArray(diagnostics)) return error
  const nativeDiagnostics = diagnostics.filter(
    (diagnostic): diagnostic is Diagnostic =>
      typeof diagnostic === 'object' &&
      diagnostic !== null &&
      typeof (diagnostic as Diagnostic).code === 'string' &&
      typeof (diagnostic as Diagnostic).message === 'string'
  )
  const actionable = nativeDiagnostics.find((diagnostic) => diagnostic.level === 'error')
  return actionable ? new NodeNativeAdapterError(actionable, nativeDiagnostics) : error
}

async function attachSessionRecorder(
  session: RuntimeAdapterSession,
  options: NormalizedOptions['session']
): Promise<RuntimeAdapterSession> {
  if (!options) return session

  let recorder: SessionRecorder
  try {
    recorder = await SessionRecorder.start({
      directory: options.directory,
      target: session.target,
      bodyCommandTimeoutMs: options.bodyCommandTimeoutMs
    })
  } catch (error) {
    await session.dispose().catch(() => undefined)
    throw error
  }

  const manifest = recorder.getManifest()
  let disposePromise: Promise<void> | undefined
  return {
    ...session,
    diagnostics: uniqueDiagnostics([
      ...session.diagnostics,
      {
        code: 'NND_SESSION_RECORDING_STARTED',
        level: 'info',
        message: `Recording Network events to ${recorder.directory}.`,
        details: { directory: recorder.directory, sessionId: manifest.sessionId }
      }
    ]),
    recording: { directory: recorder.directory, sessionId: manifest.sessionId },
    dispose() {
      if (disposePromise) return disposePromise
      disposePromise = (async () => {
        let recordingError: unknown
        try {
          await recorder.close()
          if (options.har) {
            await exportHar(
              recorder.directory,
              typeof options.har === 'string' ? options.har : undefined
            )
          }
        } catch (error) {
          recordingError = error
        }

        let backendError: unknown
        try {
          await session.dispose()
        } catch (error) {
          backendError = error
        }
        if (recordingError) throw recordingError
        if (backendError) throw backendError
      })()
      return disposePromise
    }
  }
}

function startRuntime(options: NormalizedOptions): Promise<RuntimeAdapterSession> {
  const native = new NodeNativeAdapter()
  const legacy = new LegacyAdapter({
    port: options.legacy.port,
    serverPort: options.legacy.serverPort,
    // Browser launching is owned by the registration handle, never Legacy.
    autoOpenDevtool: false,
    intercept: options.legacy.intercept,
    mock: options.legacy.mock
  })
  const mockFallbackReason: Diagnostic | undefined =
    options.mode === 'auto' && options.legacy.mock.length > 0
      ? {
          code: 'NND_AUTO_LEGACY_MOCK_REQUIRED',
          level: 'info',
          message: 'Auto selected Legacy because request/response mocking was configured.',
          hint: 'Remove legacy.mock to allow Auto to select the Native backend.'
        }
      : undefined
  const selectionMode = mockFallbackReason ? 'legacy' : options.mode
  const selectionOptions = {
    mode: selectionMode,
    requiredCapabilities: options.requiredCapabilities,
    inspector: options.inspector
  } as const
  const startOptions = {
    requiredCapabilities: options.requiredCapabilities,
    inspector: options.inspector
  }
  const selector = new AdapterSelector([native, legacy])

  // Actual adapter probes are deliberately synchronous and side-effect-free.
  // Start the predicted adapter before the first Promise turn so the historical
  // `register(); request()` form cannot miss its first Legacy request. The
  // selector remains authoritative and verifies the prediction asynchronously.
  const nativeProbe = native.probe(startOptions)
  const legacyProbe = legacy.probe(startOptions)
  const hasRequirements = (capabilities: typeof nativeProbe.capabilities) =>
    options.requiredCapabilities.every((capability) => capabilities[capability])
  const predicted =
    selectionMode === 'native'
      ? nativeProbe.available && hasRequirements(nativeProbe.capabilities)
        ? native
        : undefined
      : selectionMode === 'legacy'
        ? legacyProbe.available && hasRequirements(legacyProbe.capabilities)
          ? legacy
          : undefined
        : nativeProbe.available &&
            nativeProbe.autoSelectable !== false &&
            hasRequirements(nativeProbe.capabilities)
          ? native
          : legacyProbe.available &&
              legacyProbe.autoSelectable !== false &&
              hasRequirements(legacyProbe.capabilities)
            ? legacy
            : undefined
  const startedSession = predicted?.start(startOptions)

  return selector
    .select(selectionOptions)
    .then(async (selection) => {
      let session
      if (predicted === selection.adapter && startedSession) {
        session = await startedSession
      } else {
        if (startedSession) await (await startedSession).dispose()
        session = await selection.adapter.start(startOptions)
      }
      const diagnostics = uniqueDiagnostics([
        ...options.diagnostics,
        ...session.diagnostics,
        ...(selection.fallbackReason ? [selection.fallbackReason] : []),
        ...(mockFallbackReason ? [mockFallbackReason] : [])
      ])

      return attachSessionRecorder(
        {
          ...session,
          diagnostics,
          fallbackReason: mockFallbackReason ?? selection.fallbackReason
        },
        options.session
      )
    })
    .catch(async (error) => {
      if (startedSession) await (await startedSession).dispose()
      throw options.mode === 'native' ? promoteForcedNativeError(error) : error
    })
}

/**
 * Register network inspection for this process.
 *
 * The return value is intentionally callable for v1 compatibility while also
 * exposing an observable asynchronous lifecycle for v2 consumers.
 */
export function register(options: RegisterOptions = {}): RegistrationHandle {
  const normalized = normalizeOptions(options)
  const key = configurationKey(normalized)

  if (activeRegistration) {
    if (activeRegistration.key === key) return activeRegistration.handle
    throw new RuntimeRegistrationError(
      'NND_ALREADY_REGISTERED',
      'Node Network Devtools is already registered with a different configuration.',
      { activeConfiguration: activeRegistration.key, requestedConfiguration: key }
    )
  }

  const session = startRuntime(normalized)
  let handle!: RegistrationHandle
  handle = createRegistrationHandle({
    session,
    openTarget: openDevtoolsTarget,
    openOnReady: normalized.devtools.open,
    onDisposed: () => {
      if (activeRegistration?.handle === handle) activeRegistration = undefined
    }
  })
  activeRegistration = { key, handle }

  void handle.ready.catch(() => {
    if (activeRegistration?.handle === handle) activeRegistration = undefined
  })
  return handle
}

/** Test-only reset for isolated module suites. */
export async function disposeActiveRegistration(): Promise<void> {
  await activeRegistration?.handle.dispose()
}

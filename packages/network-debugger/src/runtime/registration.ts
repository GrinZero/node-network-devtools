import type {
  AdapterKind,
  AdapterSession,
  CapabilityMap,
  DevtoolsTarget,
  Diagnostic
} from '../adapters/types'

export type RegistrationState = 'starting' | 'ready' | 'disposing' | 'disposed' | 'failed'

export interface ReadyInfo {
  mode: AdapterKind
  target: DevtoolsTarget
  capabilities: CapabilityMap
  diagnostics: readonly Diagnostic[]
  fallbackReason?: Diagnostic
  session?: {
    directory: string
    sessionId: string
  }
}

export interface RegistrationStatus {
  state: RegistrationState
  mode?: AdapterKind
  error?: unknown
}

export type RegistrationEvent =
  | { type: 'state'; status: RegistrationStatus }
  | { type: 'diagnostic'; diagnostic: Diagnostic }

export interface RuntimeAdapterSession extends AdapterSession {
  fallbackReason?: Diagnostic
  recording?: ReadyInfo['session']
}

export type RegistrationHandle = (() => void) & {
  readonly ready: Promise<ReadyInfo>
  status(): RegistrationStatus
  openDevtools(): Promise<void>
  dispose(): Promise<void>
  on(listener: (event: RegistrationEvent) => void): () => void
  on(type: 'state', listener: (status: RegistrationStatus) => void): () => void
  on(type: 'diagnostic', listener: (diagnostic: Diagnostic) => void): () => void
}

interface RegistrationHandleOptions {
  session: Promise<RuntimeAdapterSession>
  openTarget(target: DevtoolsTarget): Promise<void>
  openOnReady?: boolean
  onDisposed?(): void
}

export function createRegistrationHandle(options: RegistrationHandleOptions): RegistrationHandle {
  let status: RegistrationStatus = { state: 'starting' }
  let adapterSession: RuntimeAdapterSession | undefined
  let unsubscribeSessionDiagnostics: (() => void) | undefined
  let unsubscribeSessionFailure: (() => void) | undefined
  let disposePromise: Promise<void> | undefined
  const listeners = new Set<(event: RegistrationEvent) => void>()

  const emit = (event: RegistrationEvent) => {
    for (const listener of listeners) listener(event)
  }
  const updateStatus = (next: RegistrationStatus) => {
    status = next
    emit({ type: 'state', status: { ...next } })
  }

  const ready = options.session.then(
    async (session) => {
      adapterSession = session
      const info: ReadyInfo = {
        mode: session.kind,
        target: session.target,
        capabilities: session.capabilities,
        diagnostics: session.diagnostics,
        fallbackReason: session.fallbackReason,
        ...(session.recording ? { session: { ...session.recording } } : {})
      }
      updateStatus({ state: 'ready', mode: session.kind })
      for (const diagnostic of session.diagnostics) {
        emit({ type: 'diagnostic', diagnostic })
      }
      unsubscribeSessionDiagnostics = session.onDiagnostic?.((diagnostic) => {
        emit({ type: 'diagnostic', diagnostic })
      })
      unsubscribeSessionFailure = session.onFailure?.((error) => {
        if (status.state === 'ready') {
          updateStatus({ state: 'failed', mode: session.kind, error })
        }
      })
      if (options.openOnReady) await options.openTarget(session.target)
      return info
    },
    (error) => {
      updateStatus({ state: 'failed', error })
      throw error
    }
  )

  const dispose = () => {
    if (disposePromise) return disposePromise
    disposePromise = (async () => {
      if (status.state !== 'failed') {
        updateStatus({ state: 'disposing', mode: adapterSession?.kind })
      }
      try {
        const session = adapterSession ?? (await options.session)
        await session.dispose()
      } catch (error) {
        if (status.state !== 'failed') throw error
      } finally {
        unsubscribeSessionDiagnostics?.()
        unsubscribeSessionDiagnostics = undefined
        unsubscribeSessionFailure?.()
        unsubscribeSessionFailure = undefined
        updateStatus({ state: 'disposed', mode: adapterSession?.kind })
        listeners.clear()
        options.onDisposed?.()
      }
    })()
    return disposePromise
  }

  const callable = (() => {
    void dispose()
  }) as RegistrationHandle

  Object.defineProperties(callable, {
    ready: { value: ready, enumerable: true },
    status: { value: () => ({ ...status }), enumerable: true },
    openDevtools: {
      value: async () => {
        const info = await ready
        await options.openTarget(info.target)
      },
      enumerable: true
    },
    dispose: { value: dispose, enumerable: true },
    on: {
      value: (
        typeOrListener: RegistrationEvent['type'] | ((event: RegistrationEvent) => void),
        typedListener?: ((value: RegistrationStatus) => void) | ((value: Diagnostic) => void)
      ) => {
        const listener =
          typeof typeOrListener === 'function'
            ? typeOrListener
            : (event: RegistrationEvent) => {
                if (event.type !== typeOrListener) return
                if (event.type === 'state') {
                  ;(typedListener as (status: RegistrationStatus) => void)?.(event.status)
                } else {
                  ;(typedListener as (diagnostic: Diagnostic) => void)?.(event.diagnostic)
                }
              }
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      enumerable: true
    }
  })

  return callable
}

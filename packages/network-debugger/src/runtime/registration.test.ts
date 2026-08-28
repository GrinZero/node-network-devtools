import { describe, expect, test, vi } from 'vitest'
import type { RuntimeAdapterSession } from './registration'
import { createRegistrationHandle } from './registration'

function session(overrides: Partial<RuntimeAdapterSession> = {}): RuntimeAdapterSession {
  return {
    kind: 'native',
    capabilities: {
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
    },
    target: {
      id: 'target',
      title: 'Node.js',
      type: 'node',
      url: 'file:///app.mjs',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9229/target',
      devtoolsFrontendUrl: 'devtools://target',
      discoveryUrl: 'http://127.0.0.1:9229/json/list'
    },
    diagnostics: [],
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('RegistrationHandle', () => {
  test('emits typed readiness and diagnostics, then disposes once', async () => {
    const diagnostic = {
      code: 'NND_AUTO_FALLBACK',
      level: 'warn' as const,
      message: 'Using Legacy.'
    }
    const adapterSession = session({ kind: 'legacy', diagnostics: [diagnostic] })
    const stateListener = vi.fn()
    const diagnosticListener = vi.fn()
    const onDisposed = vi.fn()
    const handle = createRegistrationHandle({
      session: Promise.resolve(adapterSession),
      openTarget: vi.fn(),
      onDisposed
    })

    handle.on('state', stateListener)
    handle.on('diagnostic', diagnosticListener)
    const ready = await handle.ready

    expect(ready.mode).toBe('legacy')
    expect(stateListener).toHaveBeenCalledWith({ state: 'ready', mode: 'legacy' })
    expect(diagnosticListener).toHaveBeenCalledWith(diagnostic)

    await Promise.all([handle.dispose(), handle.dispose()])
    expect(adapterSession.dispose).toHaveBeenCalledOnce()
    expect(onDisposed).toHaveBeenCalledOnce()
  })

  test('does not launch a frontend until explicitly requested', async () => {
    const openTarget = vi.fn().mockResolvedValue(undefined)
    const adapterSession = session()
    const handle = createRegistrationHandle({
      session: Promise.resolve(adapterSession),
      openTarget
    })

    await handle.ready
    expect(openTarget).not.toHaveBeenCalled()

    await handle.openDevtools()
    expect(openTarget).toHaveBeenCalledWith(adapterSession.target)
  })

  test('supports opt-in opening without coupling disposal to the frontend', async () => {
    const openTarget = vi.fn().mockResolvedValue(undefined)
    const adapterSession = session()
    const handle = createRegistrationHandle({
      session: Promise.resolve(adapterSession),
      openTarget,
      openOnReady: true
    })

    await handle.ready
    expect(openTarget).toHaveBeenCalledOnce()
    await handle.dispose()
    expect(openTarget).toHaveBeenCalledOnce()
    expect(adapterSession.dispose).toHaveBeenCalledOnce()
  })

  test('surfaces a terminal backend failure after initial readiness', async () => {
    let fail!: (error: Error) => void
    const unsubscribe = vi.fn()
    const adapterSession = session({
      kind: 'legacy',
      onFailure(listener) {
        fail = listener
        return unsubscribe
      }
    })
    const stateListener = vi.fn()
    const handle = createRegistrationHandle({
      session: Promise.resolve(adapterSession),
      openTarget: vi.fn()
    })
    handle.on('state', stateListener)

    await handle.ready
    const error = new Error('Legacy recovery exhausted')
    fail(error)

    expect(handle.status()).toEqual({ state: 'failed', mode: 'legacy', error })
    expect(stateListener).toHaveBeenLastCalledWith({
      state: 'failed',
      mode: 'legacy',
      error
    })
    await handle.dispose()
    expect(adapterSession.dispose).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})

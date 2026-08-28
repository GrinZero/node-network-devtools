import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import http from 'http'
import https from 'https'
import type {
  AdapterProbe,
  AdapterSession,
  CapabilityMap,
  DevtoolsTarget,
  Diagnostic
} from '../adapters/types'

const mocks = vi.hoisted(() => ({
  mainProcessConstructorCalls: [] as Record<string, unknown>[],
  mainProcessDispose: vi.fn<() => Promise<void>>(),
  proxyFetch: vi.fn(),
  unsetFetch: vi.fn(),
  requestProxyFactory: vi.fn(),
  getProxyFactory: vi.fn(),
  undiciFetchProxy: vi.fn(),
  unsetUndiciFetch: vi.fn(),
  generateHash: vi.fn(),
  nativeProbe: vi.fn(),
  nativeStart: vi.fn(),
  openDevtoolsTarget: vi.fn<() => Promise<void>>(),
  sessionRecorderStart: vi.fn(),
  sessionRecorderClose: vi.fn<() => Promise<void>>(),
  exportHar: vi.fn<() => Promise<unknown>>()
}))

vi.mock('./fork', () => {
  class MainProcess {
    readonly ready: Promise<DevtoolsTarget>

    constructor(readonly options: Record<string, unknown>) {
      mocks.mainProcessConstructorCalls.push(options)
      const port = Number(options.serverPort) || 49_152
      const id = 'node-network-devtools-legacy-test'
      const authority = `127.0.0.1:${port}`
      this.ready = Promise.resolve({
        id,
        title: 'Node Network Devtools (Legacy)',
        type: 'node',
        url: '',
        webSocketDebuggerUrl: `ws://${authority}/devtools/page/${id}`,
        devtoolsFrontendUrl: `devtools://devtools/bundled/js_app.html?ws=${authority}/devtools/page/${id}`,
        discoveryUrl: `http://${authority}/json/list`
      })
    }

    send() {}

    sendRequest() {
      return this
    }

    responseRequest() {}

    dispose() {
      return mocks.mainProcessDispose()
    }

    onDiagnostic() {
      return () => undefined
    }

    onFailure() {
      return () => undefined
    }
  }

  return { MainProcess }
})

vi.mock('./fetch', () => ({ proxyFetch: mocks.proxyFetch }))
vi.mock('./request', () => ({
  requestProxyFactory: mocks.requestProxyFactory,
  getProxyFactory: mocks.getProxyFactory
}))
vi.mock('./undici', () => ({ undiciFetchProxy: mocks.undiciFetchProxy }))
vi.mock('../utils', () => ({ generateHash: mocks.generateHash }))
vi.mock('../target/frontend-launcher', () => ({
  openDevtoolsTarget: mocks.openDevtoolsTarget
}))
vi.mock('../session', () => ({
  SessionRecorder: { start: mocks.sessionRecorderStart },
  exportHar: mocks.exportHar
}))
vi.mock('../adapters/node-native', () => ({
  NodeNativeAdapterError: class NodeNativeAdapterError extends Error {
    readonly code: string
    readonly hint?: string
    readonly diagnostics: readonly Diagnostic[]

    constructor(diagnostic: Diagnostic, diagnostics: readonly Diagnostic[]) {
      super(diagnostic.message)
      this.name = 'NodeNativeAdapterError'
      this.code = diagnostic.code
      this.hint = diagnostic.hint
      this.diagnostics = diagnostics
    }
  },
  NodeNativeAdapter: class {
    readonly kind = 'native' as const
    probe = mocks.nativeProbe
    start = mocks.nativeStart
  }
}))

import { register } from './index'
import { disposeActiveRegistration, RuntimeRegistrationError } from '../runtime/controller'
import { LEGACY_CAPABILITIES } from '../adapters/legacy'

const NATIVE_CAPABILITIES: CapabilityMap = Object.freeze({
  http: true,
  https: true,
  fetch: true,
  http2: true,
  responseBody: true,
  requestBody: true,
  websocketLifecycle: true,
  websocketFrames: true,
  sseMessages: false,
  initiator: true
})

const EMPTY_CAPABILITIES: CapabilityMap = Object.freeze({
  http: false,
  https: false,
  fetch: false,
  http2: false,
  responseBody: false,
  requestBody: false,
  websocketLifecycle: false,
  websocketFrames: false,
  sseMessages: false,
  initiator: false
})

const NATIVE_TARGET: DevtoolsTarget = Object.freeze({
  id: 'native-target',
  title: 'Node.js',
  type: 'node',
  url: 'file:///fixture.js',
  webSocketDebuggerUrl: 'ws://127.0.0.1:9229/native-target',
  devtoolsFrontendUrl: 'devtools://native-target',
  discoveryUrl: 'http://127.0.0.1:9229/json/list'
})

const nativeUnavailableDiagnostic: Diagnostic = Object.freeze({
  code: 'NND_NATIVE_FLAG_REQUIRED',
  level: 'error',
  message: 'Native network inspection requires --experimental-network-inspection.',
  hint: 'Restart with: node --inspect=0 --experimental-network-inspection <entry>'
})

const nativeUnavailableProbe = (): AdapterProbe => ({
  kind: 'native',
  available: false,
  autoSelectable: false,
  capabilities: EMPTY_CAPABILITIES,
  diagnostics: [nativeUnavailableDiagnostic]
})

const nativeAvailableProbe = (): AdapterProbe => ({
  kind: 'native',
  available: true,
  autoSelectable: true,
  capabilities: NATIVE_CAPABILITIES,
  diagnostics: []
})

const nativeSession = (dispose = vi.fn<() => Promise<void>>()): AdapterSession => ({
  kind: 'native',
  capabilities: NATIVE_CAPABILITIES,
  target: NATIVE_TARGET,
  diagnostics: [],
  dispose
})

describe('core register compatibility API', () => {
  let originalHttpRequest: typeof http.request
  let originalHttpsRequest: typeof https.request
  let originalHttpGet: typeof http.get
  let originalHttpsGet: typeof https.get

  beforeEach(async () => {
    await disposeActiveRegistration()
    vi.clearAllMocks()
    mocks.mainProcessConstructorCalls.length = 0
    originalHttpRequest = http.request
    originalHttpsRequest = https.request
    originalHttpGet = http.get
    originalHttpsGet = https.get

    mocks.mainProcessDispose.mockResolvedValue(undefined)
    mocks.proxyFetch.mockReturnValue(mocks.unsetFetch)
    mocks.requestProxyFactory.mockImplementation(() => vi.fn())
    mocks.getProxyFactory.mockImplementation(() => vi.fn())
    mocks.undiciFetchProxy.mockReturnValue(mocks.unsetUndiciFetch)
    mocks.generateHash.mockReturnValue('mock-hash-key')
    mocks.nativeProbe.mockImplementation(nativeUnavailableProbe)
    mocks.nativeStart.mockImplementation(async () => nativeSession())
    mocks.openDevtoolsTarget.mockResolvedValue(undefined)
    mocks.sessionRecorderClose.mockResolvedValue(undefined)
    mocks.sessionRecorderStart.mockResolvedValue({
      directory: '/recordings/session-1',
      getManifest: () => ({ sessionId: 'session-1' }),
      close: mocks.sessionRecorderClose
    })
    mocks.exportHar.mockResolvedValue({})
  })

  afterEach(async () => {
    await disposeActiveRegistration()
    http.request = originalHttpRequest
    https.request = originalHttpsRequest
    http.get = originalHttpGet
    https.get = originalHttpsGet
  })

  test('register returns a callable handle with an observable ready lifecycle', async () => {
    const handle = register({ mode: 'legacy' })

    expect(typeof handle).toBe('function')
    expect(handle.ready).toBeInstanceOf(Promise)
    expect(handle.status()).toEqual({ state: 'starting' })
    expect(typeof handle.dispose).toBe('function')
    expect(typeof handle.openDevtools).toBe('function')
    expect(typeof handle.on).toBe('function')

    const ready = await handle.ready

    expect(handle.status()).toEqual({ state: 'ready', mode: 'legacy' })
    expect(ready).toEqual({
      mode: 'legacy',
      target: {
        id: 'node-network-devtools-legacy-test',
        title: 'Node Network Devtools (Legacy)',
        type: 'node',
        url: '',
        webSocketDebuggerUrl:
          'ws://127.0.0.1:49152/devtools/page/node-network-devtools-legacy-test',
        devtoolsFrontendUrl:
          'devtools://devtools/bundled/js_app.html?ws=127.0.0.1:49152/devtools/page/node-network-devtools-legacy-test',
        discoveryUrl: 'http://127.0.0.1:49152/json/list'
      },
      capabilities: LEGACY_CAPABILITIES,
      diagnostics: [],
      fallbackReason: undefined
    })
  })

  test('ready exposes the native mode, target, and capabilities', async () => {
    const disposeNative = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const session = nativeSession(disposeNative)
    mocks.nativeProbe.mockImplementation(nativeAvailableProbe)
    mocks.nativeStart.mockResolvedValue(session)

    const handle = register({
      mode: 'native',
      requiredCapabilities: ['http', 'fetch', 'http2']
    })

    await expect(handle.ready).resolves.toEqual({
      mode: 'native',
      target: NATIVE_TARGET,
      capabilities: NATIVE_CAPABILITIES,
      diagnostics: [],
      fallbackReason: undefined
    })
    expect(mocks.nativeStart).toHaveBeenCalledWith({
      requiredCapabilities: ['http', 'fetch', 'http2'],
      inspector: { host: '127.0.0.1', port: 0 }
    })
    expect(mocks.mainProcessConstructorCalls).toHaveLength(0)

    await handle.dispose()
    expect(disposeNative).toHaveBeenCalledOnce()
  })

  test('auto exposes a structured fallback when native is unavailable', async () => {
    const handle = register({
      mode: 'auto',
      requiredCapabilities: ['fetch', 'responseBody']
    })

    const ready = await handle.ready

    expect(ready.mode).toBe('legacy')
    expect(ready.capabilities).toEqual(LEGACY_CAPABILITIES)
    expect(ready.fallbackReason).toEqual({
      code: 'NND_AUTO_FALLBACK',
      level: 'warn',
      message: 'Native adapter cannot satisfy this selection; using legacy adapter.',
      hint: 'Use mode "native" to fail instead of falling back.',
      details: {
        from: 'native',
        to: 'legacy',
        reason: 'unavailable',
        requiredCapabilities: ['fetch', 'responseBody'],
        diagnosticCodes: ['NND_NATIVE_FLAG_REQUIRED'],
        diagnostics: [nativeUnavailableDiagnostic]
      }
    })
    expect(ready.diagnostics).toEqual([ready.fallbackReason])
    expect(mocks.nativeStart).not.toHaveBeenCalled()
  })

  test('forced native publishes the actionable Native error and releases active state', async () => {
    const failed = register({ mode: 'native' })

    await expect(failed.ready).rejects.toMatchObject({
      name: 'NodeNativeAdapterError',
      code: 'NND_NATIVE_FLAG_REQUIRED',
      message: 'Native network inspection requires --experimental-network-inspection.',
      hint: 'Restart with: node --inspect=0 --experimental-network-inspection <entry>'
    })
    expect(failed.status()).toMatchObject({ state: 'failed' })

    await failed.dispose()
    expect(failed.status()).toEqual({ state: 'disposed', mode: undefined })

    const replacement = register({ mode: 'legacy' })
    await expect(replacement.ready).resolves.toMatchObject({ mode: 'legacy' })
  })

  test('rejects Native plus Mock synchronously with a stable capability conflict', () => {
    expect(() =>
      register({
        mode: 'native',
        legacy: {
          mock: [
            {
              match: { url: 'https://example.test/*' },
              response: { status: 200, body: 'mocked' }
            }
          ]
        }
      })
    ).toThrowError(
      expect.objectContaining({
        name: 'RuntimeRegistrationError',
        code: 'NND_NATIVE_MOCK_CONFLICT',
        message: 'Request/response mocking is available only with the Legacy backend.'
      })
    )
    expect(mocks.nativeStart).not.toHaveBeenCalled()
    expect(mocks.mainProcessConstructorCalls).toHaveLength(0)
  })

  test('Auto selects Legacy and exposes a structured reason when Mock is configured', async () => {
    mocks.nativeProbe.mockImplementation(nativeAvailableProbe)
    const mock = [
      {
        id: 'fixture',
        match: { url: 'https://example.test/*' },
        response: { status: 200, body: 'mocked' }
      }
    ] as const

    const handle = register({ mode: 'auto', legacy: { mock } })
    const ready = await handle.ready

    expect(ready.mode).toBe('legacy')
    expect(ready.fallbackReason).toEqual({
      code: 'NND_AUTO_LEGACY_MOCK_REQUIRED',
      level: 'info',
      message: 'Auto selected Legacy because request/response mocking was configured.',
      hint: 'Remove legacy.mock to allow Auto to select the Native backend.'
    })
    expect(ready.diagnostics).toContainEqual(ready.fallbackReason)
    expect(mocks.nativeStart).not.toHaveBeenCalled()
    expect(mocks.proxyFetch).toHaveBeenCalledWith(expect.anything(), mock)
  })

  test('records a Session for either backend and exports HAR before backend disposal', async () => {
    const handle = register({
      mode: 'legacy',
      session: {
        directory: '/recordings/session-1',
        bodyCommandTimeoutMs: 2500,
        har: '/recordings/session-1.har'
      }
    })

    const ready = await handle.ready
    expect(mocks.sessionRecorderStart).toHaveBeenCalledWith({
      directory: '/recordings/session-1',
      target: ready.target,
      bodyCommandTimeoutMs: 2500
    })
    expect(ready.session).toEqual({
      directory: '/recordings/session-1',
      sessionId: 'session-1'
    })
    expect(ready.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'NND_SESSION_RECORDING_STARTED' })
    )

    await handle.dispose()
    expect(mocks.sessionRecorderClose).toHaveBeenCalledOnce()
    expect(mocks.exportHar).toHaveBeenCalledWith(
      '/recordings/session-1',
      '/recordings/session-1.har'
    )
    expect(mocks.sessionRecorderClose.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.exportHar.mock.invocationCallOrder[0]
    )
    expect(mocks.exportHar.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.mainProcessDispose.mock.invocationCallOrder[0]
    )
  })

  test('releases the backend when Session startup fails', async () => {
    mocks.sessionRecorderStart.mockRejectedValueOnce(new Error('recording directory exists'))
    const handle = register({
      mode: 'legacy',
      session: { directory: '/recordings/existing' }
    })

    await expect(handle.ready).rejects.toThrow('recording directory exists')
    expect(mocks.mainProcessDispose).toHaveBeenCalledOnce()
  })

  test('explicit legacy activates old capture options and restores every patch', async () => {
    const handle = register({
      mode: 'legacy',
      port: 8080,
      serverPort: 8081,
      autoOpenDevtool: true,
      intercept: {
        fetch: true,
        normal: true,
        undici: { fetch: true }
      }
    })

    const ready = await handle.ready

    expect(new URL(ready.target.webSocketDebuggerUrl).port).toBe('8081')
    expect(ready.target.discoveryUrl).toBe('http://127.0.0.1:8081/json/list')

    expect(mocks.generateHash).toHaveBeenCalledWith(
      JSON.stringify({ port: 8080, serverPort: 8081, autoOpenDevtool: false })
    )
    expect(mocks.mainProcessConstructorCalls).toEqual([
      {
        port: 8080,
        serverPort: 8081,
        autoOpenDevtool: false,
        key: 'mock-hash-key'
      }
    ])
    expect(mocks.proxyFetch).toHaveBeenCalledOnce()
    expect(mocks.requestProxyFactory).toHaveBeenCalledTimes(2)
    expect(mocks.requestProxyFactory).toHaveBeenNthCalledWith(
      1,
      originalHttpRequest,
      false,
      expect.anything()
    )
    expect(mocks.requestProxyFactory).toHaveBeenNthCalledWith(
      2,
      originalHttpsRequest,
      true,
      expect.anything()
    )
    expect(mocks.undiciFetchProxy).toHaveBeenCalledOnce()
    expect(http.request).not.toBe(originalHttpRequest)
    expect(https.request).not.toBe(originalHttpsRequest)
    expect(mocks.openDevtoolsTarget).toHaveBeenCalledOnce()
    expect(mocks.openDevtoolsTarget).toHaveBeenCalledWith(ready.target)
    expect(ready.diagnostics).toContainEqual({
      code: 'NND_LEGACY_OPTIONS_DEPRECATED',
      level: 'warn',
      message: 'Top-level Legacy options are deprecated.',
      hint: 'Move capture and port settings under "legacy", and browser behavior under "devtools".'
    })

    await handle.dispose()

    expect(mocks.unsetFetch).toHaveBeenCalledOnce()
    expect(mocks.unsetUndiciFetch).toHaveBeenCalledOnce()
    expect(mocks.mainProcessDispose).toHaveBeenCalledOnce()
    expect(http.request).toBe(originalHttpRequest)
    expect(https.request).toBe(originalHttpsRequest)
  })

  test('legacy namespaced options also activate configured interceptors', async () => {
    const handle = register({
      mode: 'legacy',
      legacy: {
        port: 7070,
        serverPort: 7071,
        intercept: {
          fetch: false,
          normal: false,
          undici: { fetch: true }
        }
      }
    })

    await handle.ready

    expect(mocks.mainProcessConstructorCalls[0]).toMatchObject({
      port: 7070,
      serverPort: 7071,
      autoOpenDevtool: false
    })
    expect(mocks.proxyFetch).not.toHaveBeenCalled()
    expect(mocks.requestProxyFactory).not.toHaveBeenCalled()
    expect(mocks.undiciFetchProxy).toHaveBeenCalledOnce()
    expect(http.request).toBe(originalHttpRequest)
    expect(https.request).toBe(originalHttpsRequest)
  })

  test('the same normalized configuration returns one idempotent handle', async () => {
    const first = register({
      mode: 'legacy',
      requiredCapabilities: ['responseBody', 'fetch'],
      legacy: { port: 6000, serverPort: 6001 }
    })
    const second = register({
      mode: 'legacy',
      requiredCapabilities: ['fetch', 'responseBody'],
      legacy: { port: 6000, serverPort: 6001 }
    })

    expect(second).toBe(first)
    await first.ready
    expect(mocks.mainProcessConstructorCalls).toHaveLength(1)
    expect(mocks.proxyFetch).toHaveBeenCalledOnce()
  })

  test('a conflicting active configuration fails synchronously with a stable error', async () => {
    const active = register({ mode: 'legacy', legacy: { port: 6000 } })

    expect(() => register({ mode: 'legacy', legacy: { port: 6001 } })).toThrowError(
      expect.objectContaining({
        name: 'RuntimeRegistrationError',
        code: 'NND_ALREADY_REGISTERED',
        message: 'Node Network Devtools is already registered with a different configuration.'
      })
    )
    expect(() => register({ mode: 'native' })).toThrow(RuntimeRegistrationError)

    await active.ready
    expect(mocks.mainProcessConstructorCalls).toHaveLength(1)
  })

  test('callable cleanup and async dispose share one idempotent cleanup', async () => {
    const handle = register({ mode: 'legacy' })
    await handle.ready

    expect(handle()).toBeUndefined()
    await Promise.all([handle.dispose(), handle.dispose()])

    expect(mocks.unsetFetch).toHaveBeenCalledOnce()
    expect(mocks.mainProcessDispose).toHaveBeenCalledOnce()
    expect(handle.status()).toEqual({ state: 'disposed', mode: 'legacy' })

    await handle.dispose()
    expect(mocks.mainProcessDispose).toHaveBeenCalledOnce()
  })

  test('browser opening defaults to false and remains explicitly callable', async () => {
    const handle = register({ mode: 'legacy' })
    const ready = await handle.ready

    expect(mocks.mainProcessConstructorCalls[0]).toMatchObject({ autoOpenDevtool: false })
    expect(mocks.openDevtoolsTarget).not.toHaveBeenCalled()

    await handle.openDevtools()
    expect(mocks.openDevtoolsTarget).toHaveBeenCalledOnce()
    expect(mocks.openDevtoolsTarget).toHaveBeenCalledWith(ready.target)
  })
})

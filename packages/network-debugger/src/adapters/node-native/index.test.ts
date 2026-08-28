import { describe, expect, test, vi } from 'vitest'
import type { NativeNetworkApi } from './capability'
import { NodeNativeAdapter, NodeNativeAdapterError, type NativeInspectorApi } from './index'

const inspectorUrl = 'ws://127.0.0.1:9229/target-id'

function createNetwork(overrides: NativeNetworkApi = {}): NativeNetworkApi {
  return {
    requestWillBeSent: vi.fn(),
    responseReceived: vi.fn(),
    loadingFinished: vi.fn(),
    loadingFailed: vi.fn(),
    dataReceived: vi.fn(),
    dataSent: vi.fn(),
    webSocketCreated: vi.fn(),
    webSocketHandshakeResponseReceived: vi.fn(),
    webSocketClosed: vi.fn(),
    ...overrides
  }
}

function descriptor(url = inspectorUrl) {
  return [
    {
      id: 'target-id',
      title: 'node[123]',
      type: 'node',
      url: 'file:///app.js',
      webSocketDebuggerUrl: url,
      devtoolsFrontendUrl: 'devtools://native-target'
    }
  ]
}

function createInspector(initialUrl: string | null = inspectorUrl) {
  let currentUrl = initialUrl ?? undefined
  const inspector: NativeInspectorApi = {
    url: vi.fn(() => currentUrl),
    open: vi.fn(() => {
      currentUrl = inspectorUrl
    }),
    close: vi.fn(),
    Network: createNetwork()
  }
  return inspector
}

function createAdapter(
  inspector: NativeInspectorApi | null,
  overrides: ConstructorParameters<typeof NodeNativeAdapter>[0] = {}
) {
  return new NodeNativeAdapter({
    inspector,
    inspectorAvailable: inspector !== null,
    execArgv: ['--experimental-network-inspection'],
    nodeVersion: '24.8.0',
    requestJson: vi.fn().mockResolvedValue(descriptor()),
    ...overrides
  })
}

describe('NodeNativeAdapter probe', () => {
  test('reports a supported runtime as available and Auto-selectable', () => {
    const probe = createAdapter(createInspector()).probe()
    expect(probe.available).toBe(true)
    expect(probe.autoSelectable).toBe(true)
    expect(probe.diagnostics).toEqual([])
  })

  test('reports missing Inspector support with a stable code', () => {
    const probe = createAdapter(null).probe()
    expect(probe.available).toBe(false)
    expect(probe.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'NND_NATIVE_INSPECTOR_UNAVAILABLE' })
    )
  })

  test('reports an unsupported runtime', () => {
    const probe = createAdapter(createInspector(), { nodeVersion: '18.20.0' }).probe()
    expect(probe.available).toBe(false)
    expect(probe.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'NND_NATIVE_RUNTIME_UNSUPPORTED' })
    )
  })

  test('requires the experimental flag', () => {
    const probe = createAdapter(createInspector(), { execArgv: [] }).probe()
    expect(probe.available).toBe(false)
    expect(probe.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'NND_NATIVE_FLAG_REQUIRED',
        hint: expect.stringContaining('--experimental-network-inspection')
      })
    )
  })

  test('requires the native lifecycle methods', () => {
    const inspector = createInspector()
    inspector.Network = { requestWillBeSent: vi.fn() }
    const probe = createAdapter(inspector).probe()
    expect(probe.available).toBe(false)
    expect(probe.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'NND_NATIVE_METHODS_UNAVAILABLE' })
    )
  })

  test('validates required capabilities', () => {
    const probe = createAdapter(createInspector()).probe({
      requiredCapabilities: ['websocketFrames', 'requestBody']
    })
    expect(probe.available).toBe(false)
    expect(probe.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'NND_NATIVE_REQUIRED_CAPABILITY_UNAVAILABLE',
        details: { missingCapabilities: ['websocketFrames', 'requestBody'] }
      })
    )
  })

  test('keeps older supported runtimes explicit-only', () => {
    const probe = createAdapter(createInspector(), { nodeVersion: '22.20.0' }).probe()
    expect(probe.available).toBe(true)
    expect(probe.autoSelectable).toBe(false)
    expect(probe.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'NND_NATIVE_AUTO_BASELINE_UNPROVEN',
        level: 'warn'
      })
    )
  })
})

describe('NodeNativeAdapter start and ownership', () => {
  test('forced start exposes the first actionable probe error', async () => {
    const adapter = createAdapter(createInspector(), { execArgv: [] })
    await expect(adapter.start()).rejects.toMatchObject<NodeNativeAdapterError>({
      code: 'NND_NATIVE_FLAG_REQUIRED',
      hint: expect.stringContaining('--experimental-network-inspection')
    })
  })

  test('reuses an existing target without opening or closing it', async () => {
    const inspector = createInspector()
    const requestJson = vi.fn().mockResolvedValue(descriptor())
    const session = await createAdapter(inspector, { requestJson }).start()

    expect(inspector.open).not.toHaveBeenCalled()
    expect(session.target.webSocketDebuggerUrl).toBe(inspectorUrl)
    expect(requestJson).toHaveBeenCalledWith('http://127.0.0.1:9229/json/list', 500)

    await session.dispose()
    expect(inspector.close).not.toHaveBeenCalled()
  })

  test('opens an OS-assigned target and disposes only its owned handle', async () => {
    const inspector = createInspector(null)
    const disposeSymbol = (Symbol as unknown as { dispose?: symbol }).dispose ?? Symbol('dispose')
    const dispose = vi.fn()
    ;(inspector.open as ReturnType<typeof vi.fn>).mockImplementation(() => {
      ;(inspector.url as ReturnType<typeof vi.fn>).mockReturnValue(inspectorUrl)
      return { [disposeSymbol]: dispose }
    })

    const originalSymbolDispose = (Symbol as unknown as { dispose?: symbol }).dispose
    if (!originalSymbolDispose) {
      Object.defineProperty(Symbol, 'dispose', { value: disposeSymbol, configurable: true })
    }

    try {
      const session = await createAdapter(inspector).start({
        inspector: { host: 'localhost', port: 0 }
      })
      expect(inspector.open).toHaveBeenCalledWith(0, 'localhost', false)

      await session.dispose()
      await session.dispose()
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(inspector.close).not.toHaveBeenCalled()
    } finally {
      if (!originalSymbolDispose) {
        delete (Symbol as unknown as { dispose?: symbol }).dispose
      }
    }
  })

  test('closes an owned Inspector when target discovery fails', async () => {
    const inspector = createInspector(null)
    const adapter = createAdapter(inspector, {
      requestJson: vi.fn().mockRejectedValue(new Error('connection refused')),
      discovery: { attempts: 1 }
    })

    await expect(adapter.start()).rejects.toMatchObject({
      code: 'NND_NATIVE_TARGET_DISCOVERY_FAILED'
    })
    expect(inspector.close).toHaveBeenCalledTimes(1)
  })

  test('does not close a reused Inspector when target discovery fails', async () => {
    const inspector = createInspector()
    const adapter = createAdapter(inspector, {
      requestJson: vi.fn().mockRejectedValue(new Error('connection refused')),
      discovery: { attempts: 1 }
    })

    await expect(adapter.start()).rejects.toMatchObject({
      code: 'NND_NATIVE_TARGET_DISCOVERY_FAILED'
    })
    expect(inspector.open).not.toHaveBeenCalled()
    expect(inspector.close).not.toHaveBeenCalled()
  })

  test('closes an owned Inspector that does not publish a URL', async () => {
    const inspector = createInspector(null)
    ;(inspector.open as ReturnType<typeof vi.fn>).mockImplementation(() => undefined)

    await expect(createAdapter(inspector).start()).rejects.toMatchObject({
      code: 'NND_NATIVE_TARGET_URL_UNAVAILABLE'
    })
    expect(inspector.close).toHaveBeenCalledTimes(1)
  })

  test('reports Inspector open failures with a stable code', async () => {
    const inspector = createInspector(null)
    ;(inspector.open as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('address in use')
    })

    await expect(createAdapter(inspector).start()).rejects.toMatchObject({
      code: 'NND_NATIVE_TARGET_OPEN_FAILED',
      hint: expect.stringContaining('--inspect=0')
    })
  })
})

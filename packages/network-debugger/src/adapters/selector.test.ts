import { describe, expect, test, vi } from 'vitest'
import { AdapterSelectionError, AdapterSelector, type AdapterSelectionErrorCode } from './selector'
import {
  NETWORK_CAPABILITIES,
  type AdapterKind,
  type AdapterProbe,
  type CapabilityMap,
  type DebugAdapter,
  type Diagnostic,
  type NetworkCapability
} from './types'

const capabilities = (
  enabled: readonly NetworkCapability[] = NETWORK_CAPABILITIES
): CapabilityMap => {
  const enabledSet = new Set(enabled)
  return Object.fromEntries(
    NETWORK_CAPABILITIES.map((capability) => [capability, enabledSet.has(capability)])
  ) as unknown as CapabilityMap
}

const diagnostic = (code: string): Diagnostic => ({
  code,
  level: 'warn',
  message: code
})

const adapter = (
  kind: AdapterKind,
  probe: AdapterProbe | (() => AdapterProbe | Promise<AdapterProbe>)
): DebugAdapter => ({
  kind,
  probe: vi.fn(typeof probe === 'function' ? probe : () => probe),
  start: vi.fn(async () => ({
    kind,
    capabilities: capabilities(),
    target: {
      id: kind,
      title: kind,
      type: 'node',
      url: 'file://',
      webSocketDebuggerUrl: `ws://127.0.0.1/${kind}`,
      discoveryUrl: 'http://127.0.0.1/json/list'
    },
    diagnostics: [],
    dispose: async () => {}
  })) as DebugAdapter['start']
})

const probe = (
  kind: AdapterKind,
  options: {
    available?: boolean
    enabled?: readonly NetworkCapability[]
    diagnostics?: readonly Diagnostic[]
    autoSelectable?: boolean
  } = {}
): AdapterProbe => ({
  kind,
  available: options.available ?? true,
  ...(options.autoSelectable === undefined ? {} : { autoSelectable: options.autoSelectable }),
  capabilities: capabilities(options.enabled),
  diagnostics: options.diagnostics ?? []
})

const expectSelectionError = async (
  promise: Promise<unknown>,
  code: AdapterSelectionErrorCode
): Promise<AdapterSelectionError> => {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterSelectionError)
    expect((error as AdapterSelectionError).code).toBe(code)
    return error as AdapterSelectionError
  }
  throw new Error(`Expected ${code}`)
}

describe('AdapterSelector', () => {
  test('auto prefers a capable native adapter and does not probe legacy', async () => {
    const native = adapter('native', probe('native'))
    const legacy = adapter('legacy', probe('legacy'))

    const selection = await new AdapterSelector([legacy, native]).select({
      mode: 'auto',
      requiredCapabilities: ['fetch', 'responseBody']
    })

    expect(selection).toEqual({
      adapter: native,
      probe: probe('native')
    })
    expect(native.probe).toHaveBeenCalledOnce()
    expect(native.probe).toHaveBeenCalledWith({
      requiredCapabilities: ['fetch', 'responseBody']
    })
    expect(legacy.probe).not.toHaveBeenCalled()
  })

  test('auto is the default mode and supports a synchronous probe', async () => {
    const nativeProbe = probe('native')
    const native = adapter('native', () => nativeProbe)

    const selection = await new AdapterSelector([native]).select()

    expect(selection.adapter).toBe(native)
    expect(selection.probe).toBe(nativeProbe)
    expect(selection.fallbackReason).toBeUndefined()
  })

  test('supports an asynchronous probe and forwards inspector options', async () => {
    const nativeProbe = probe('native')
    const native = adapter('native', async () => nativeProbe)

    const selection = await new AdapterSelector([native]).select({
      mode: 'native',
      inspector: { host: '127.0.0.1', port: 9230 }
    })

    expect(selection.probe).toBe(nativeProbe)
    expect(native.probe).toHaveBeenCalledWith({
      inspector: { host: '127.0.0.1', port: 9230 }
    })
  })

  test('normalizes duplicate and unordered required capabilities deterministically', async () => {
    const native = adapter('native', probe('native'))

    await new AdapterSelector([native]).select({
      mode: 'native',
      requiredCapabilities: ['responseBody', 'http', 'responseBody']
    })

    expect(native.probe).toHaveBeenCalledWith({
      requiredCapabilities: ['http', 'responseBody']
    })
  })

  test('forced native fails with a stable unavailable error when not registered', async () => {
    const error = await expectSelectionError(
      new AdapterSelector([]).select({ mode: 'native' }),
      'NND_ADAPTER_UNAVAILABLE'
    )

    expect(error.message).toBe('Adapter "native" is not registered.')
    expect(error.details).toEqual({
      kind: 'native',
      requiredCapabilities: [],
      reason: 'not_registered'
    })
  })

  test('forced native fails with a stable unavailable error and retains diagnostics', async () => {
    const native = adapter(
      'native',
      probe('native', {
        available: false,
        diagnostics: [diagnostic('NND_NATIVE_FLAG_MISSING')]
      })
    )

    const error = await expectSelectionError(
      new AdapterSelector([native]).select({ mode: 'native' }),
      'NND_ADAPTER_UNAVAILABLE'
    )

    expect(error.message).toBe('Adapter "native" is unavailable.')
    expect(error.details).toEqual({
      kind: 'native',
      requiredCapabilities: [],
      reason: 'unavailable',
      diagnosticCodes: ['NND_NATIVE_FLAG_MISSING'],
      diagnostics: [diagnostic('NND_NATIVE_FLAG_MISSING')]
    })
  })

  test('forced legacy fails with missing capabilities in canonical order', async () => {
    const legacy = adapter(
      'legacy',
      probe('legacy', {
        enabled: ['https']
      })
    )

    const error = await expectSelectionError(
      new AdapterSelector([legacy]).select({
        mode: 'legacy',
        requiredCapabilities: ['responseBody', 'http', 'fetch']
      }),
      'NND_ADAPTER_CAPABILITY_MISSING'
    )

    expect(error.message).toBe(
      'Adapter "legacy" does not provide required capabilities: http, fetch, responseBody.'
    )
    expect(error.details).toEqual({
      kind: 'legacy',
      requiredCapabilities: ['http', 'fetch', 'responseBody'],
      reason: 'missing_capabilities',
      missingCapabilities: ['http', 'fetch', 'responseBody'],
      diagnosticCodes: []
    })
  })

  test('forced mode wraps a rejected probe in a stable error', async () => {
    const native = adapter('native', async () => {
      throw new Error('probe exploded')
    })

    const error = await expectSelectionError(
      new AdapterSelector([native]).select({ mode: 'native' }),
      'NND_ADAPTER_PROBE_FAILED'
    )

    expect(error.message).toBe('Adapter "native" probe failed: probe exploded.')
    expect(error.details).toEqual({
      kind: 'native',
      requiredCapabilities: [],
      reason: 'probe_failed',
      error: 'probe exploded'
    })
  })

  test('forced mode rejects a probe whose kind does not match its adapter', async () => {
    const native = adapter('native', probe('legacy'))

    const error = await expectSelectionError(
      new AdapterSelector([native]).select({ mode: 'native' }),
      'NND_INVALID_ADAPTER_PROBE'
    )

    expect(error.details).toEqual({
      kind: 'native',
      requiredCapabilities: [],
      reason: 'invalid_probe',
      error: 'Expected "native", received "legacy".'
    })
  })

  test('auto falls back when native is unavailable with a deterministic diagnostic', async () => {
    const native = adapter(
      'native',
      probe('native', {
        available: false,
        diagnostics: [diagnostic('NND_NATIVE_FLAG_MISSING')]
      })
    )
    const legacyProbe = probe('legacy')
    const legacy = adapter('legacy', legacyProbe)

    const selection = await new AdapterSelector([native, legacy]).select({
      requiredCapabilities: ['fetch']
    })

    expect(selection.adapter).toBe(legacy)
    expect(selection.probe).toBe(legacyProbe)
    expect(selection.fallbackReason).toEqual({
      code: 'NND_AUTO_FALLBACK',
      level: 'warn',
      message: 'Native adapter cannot satisfy this selection; using legacy adapter.',
      hint: 'Use mode "native" to fail instead of falling back.',
      details: {
        from: 'native',
        to: 'legacy',
        reason: 'unavailable',
        requiredCapabilities: ['fetch'],
        diagnosticCodes: ['NND_NATIVE_FLAG_MISSING'],
        diagnostics: [diagnostic('NND_NATIVE_FLAG_MISSING')]
      }
    })
  })

  test('auto falls back when native is available but not auto-selectable', async () => {
    const baselineDiagnostic = diagnostic('NND_NATIVE_AUTO_BASELINE_UNMET')
    const nativeProbe = probe('native', {
      autoSelectable: false,
      diagnostics: [baselineDiagnostic]
    })
    const native = adapter('native', nativeProbe)
    const legacy = adapter('legacy', probe('legacy'))

    const selection = await new AdapterSelector([native, legacy]).select({
      requiredCapabilities: ['http', 'fetch']
    })

    expect(selection.adapter).toBe(legacy)
    expect(selection.fallbackReason?.details).toEqual({
      from: 'native',
      to: 'legacy',
      reason: 'not_auto_selectable',
      requiredCapabilities: ['http', 'fetch'],
      diagnosticCodes: ['NND_NATIVE_AUTO_BASELINE_UNMET'],
      diagnostics: [baselineDiagnostic]
    })
  })

  test('forced native ignores autoSelectable while still enforcing capabilities', async () => {
    const nativeProbe = probe('native', {
      autoSelectable: false,
      enabled: ['http'],
      diagnostics: [diagnostic('NND_NATIVE_AUTO_BASELINE_UNMET')]
    })
    const native = adapter('native', nativeProbe)

    const selection = await new AdapterSelector([native]).select({
      mode: 'native',
      requiredCapabilities: ['http']
    })

    expect(selection).toEqual({ adapter: native, probe: nativeProbe })
  })

  test('auto falls back when native lacks requirements and explains which ones', async () => {
    const native = adapter(
      'native',
      probe('native', {
        enabled: ['http']
      })
    )
    const legacy = adapter('legacy', probe('legacy'))

    const selection = await new AdapterSelector([native, legacy]).select({
      requiredCapabilities: ['responseBody', 'http', 'fetch']
    })

    expect(selection.adapter).toBe(legacy)
    expect(selection.fallbackReason?.details).toEqual({
      from: 'native',
      to: 'legacy',
      reason: 'missing_capabilities',
      requiredCapabilities: ['http', 'fetch', 'responseBody'],
      missingCapabilities: ['fetch', 'responseBody'],
      diagnosticCodes: []
    })
  })

  test('auto falls back when native is not registered', async () => {
    const legacy = adapter('legacy', probe('legacy'))

    const selection = await new AdapterSelector([legacy]).select()

    expect(selection.adapter).toBe(legacy)
    expect(selection.fallbackReason?.details).toEqual({
      from: 'native',
      to: 'legacy',
      reason: 'not_registered',
      requiredCapabilities: []
    })
  })

  test('auto falls back after a native probe failure', async () => {
    const native = adapter('native', () => {
      throw 'synchronous failure'
    })
    const legacy = adapter('legacy', probe('legacy'))

    const selection = await new AdapterSelector([native, legacy]).select()

    expect(selection.adapter).toBe(legacy)
    expect(selection.fallbackReason?.details).toEqual({
      from: 'native',
      to: 'legacy',
      reason: 'probe_failed',
      requiredCapabilities: [],
      error: 'synchronous failure'
    })
  })

  test('auto fails explicitly with deterministic attempts when neither adapter is capable', async () => {
    const native = adapter(
      'native',
      probe('native', {
        available: false,
        diagnostics: [diagnostic('NND_NATIVE_UNAVAILABLE')]
      })
    )
    const legacy = adapter(
      'legacy',
      probe('legacy', {
        enabled: ['http']
      })
    )

    const error = await expectSelectionError(
      new AdapterSelector([legacy, native]).select({
        requiredCapabilities: ['fetch', 'responseBody']
      }),
      'NND_NO_CAPABLE_ADAPTER'
    )

    expect(error.message).toBe(
      'No available adapter satisfies required capabilities: fetch, responseBody.'
    )
    expect(error.details).toEqual({
      requiredCapabilities: ['fetch', 'responseBody'],
      attempts: [
        {
          kind: 'native',
          reason: 'unavailable',
          diagnosticCodes: ['NND_NATIVE_UNAVAILABLE'],
          diagnostics: [diagnostic('NND_NATIVE_UNAVAILABLE')]
        },
        {
          kind: 'legacy',
          reason: 'missing_capabilities',
          missingCapabilities: ['fetch', 'responseBody'],
          diagnosticCodes: []
        }
      ]
    })
  })

  test('auto does not select a legacy adapter that explicitly opts out', async () => {
    const legacyDiagnostic = diagnostic('NND_LEGACY_AUTO_DISABLED')
    const legacy = adapter(
      'legacy',
      probe('legacy', {
        autoSelectable: false,
        diagnostics: [legacyDiagnostic]
      })
    )

    const error = await expectSelectionError(
      new AdapterSelector([legacy]).select(),
      'NND_NO_CAPABLE_ADAPTER'
    )

    expect(error.details).toEqual({
      requiredCapabilities: [],
      attempts: [
        { kind: 'native', reason: 'not_registered' },
        {
          kind: 'legacy',
          reason: 'not_auto_selectable',
          diagnosticCodes: ['NND_LEGACY_AUTO_DISABLED'],
          diagnostics: [legacyDiagnostic]
        }
      ]
    })
  })

  test('auto reports no available adapter when none are registered', async () => {
    const error = await expectSelectionError(
      new AdapterSelector([]).select(),
      'NND_NO_CAPABLE_ADAPTER'
    )

    expect(error.message).toBe('No available adapter satisfies required capabilities: (none).')
    expect(error.details).toEqual({
      requiredCapabilities: [],
      attempts: [
        { kind: 'native', reason: 'not_registered' },
        { kind: 'legacy', reason: 'not_registered' }
      ]
    })
  })

  test('constructor rejects duplicate adapter kinds deterministically', () => {
    const first = adapter('native', probe('native'))
    const second = adapter('native', probe('native'))

    expect(() => new AdapterSelector([first, second])).toThrowError(
      expect.objectContaining({
        code: 'NND_DUPLICATE_ADAPTER',
        message: 'Adapter "native" is registered more than once.',
        details: { kind: 'native' }
      })
    )
  })

  test('selection never starts an adapter', async () => {
    const native = adapter('native', probe('native'))

    await new AdapterSelector([native]).select({ mode: 'native' })

    expect(native.start).not.toHaveBeenCalled()
  })
})

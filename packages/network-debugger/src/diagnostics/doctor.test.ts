import { describe, expect, it, vi } from 'vitest'
import type {
  AdapterKind,
  AdapterProbe,
  CapabilityMap,
  DebugAdapter,
  Diagnostic
} from '../adapters/types'
import type { ConfigResolution, ResolvedNndConfig } from '../config'
import { formatDoctorReport } from './format'
import { runDoctor } from './doctor'

const noCapabilities: CapabilityMap = {
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
}

const legacyCapabilities: CapabilityMap = {
  ...noCapabilities,
  http: true,
  https: true,
  fetch: true,
  responseBody: true,
  requestBody: true
}

function probe(
  kind: AdapterKind,
  available: boolean,
  capabilities: CapabilityMap,
  diagnostics: readonly Diagnostic[] = [],
  autoSelectable = true
): AdapterProbe {
  return { kind, available, autoSelectable, capabilities, diagnostics }
}

function adapter(kind: AdapterKind, implementation: () => AdapterProbe): DebugAdapter {
  return {
    kind,
    probe: vi.fn(implementation),
    start: vi.fn(() => Promise.reject(new Error('doctor never starts adapters')))
  }
}

function resolution(mode: ResolvedNndConfig['mode']): ConfigResolution {
  return {
    config: {
      mode,
      open: false,
      wait: true,
      watch: false,
      runner: 'node',
      inspector: { host: '127.0.0.1', port: 0 },
      requiredCapabilities: [],
      legacy: {}
    },
    sources: { env: [], cli: [] }
  }
}

describe('doctor diagnostics', () => {
  it('reports Auto fallback without treating the usable result as a failure', async () => {
    const nativeDiagnostic: Diagnostic = {
      code: 'NND_NATIVE_FLAG_REQUIRED',
      level: 'error',
      message: 'flag missing',
      hint: 'enable it'
    }
    const report = await runDoctor({
      nodeVersion: '24.16.0',
      packageVersion: '1.2.3',
      execArgv: [],
      inspectorAvailable: true,
      inspector: { url: () => undefined, open: () => undefined, close: () => undefined },
      nativeAdapter: adapter('native', () =>
        probe('native', false, noCapabilities, [nativeDiagnostic], false)
      ),
      legacyAdapter: adapter('legacy', () => probe('legacy', true, legacyCapabilities)),
      resolve: vi.fn(async () => resolution('auto'))
    })

    expect(report.ok).toBe(true)
    expect(report.selection).toMatchObject({ requested: 'auto', selected: 'legacy' })
    expect(report.selection.fallbackReason).toMatchObject({ code: 'NND_AUTO_FALLBACK' })
    expect(report.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'NND_DOCTOR_NODE_VERSION',
        'NND_DOCTOR_PACKAGE_VERSION',
        'NND_DOCTOR_CONFIG_DEFAULTS',
        'NND_NATIVE_FLAG_REQUIRED',
        'NND_AUTO_FALLBACK',
        'NND_DOCTOR_SELECTED_LEGACY'
      ])
    )
  })

  it('fails forced Native selection with stable selection details', async () => {
    const report = await runDoctor({
      packageVersion: '1.2.3',
      nativeAdapter: adapter('native', () => probe('native', false, noCapabilities)),
      legacyAdapter: adapter('legacy', () => probe('legacy', true, legacyCapabilities)),
      resolve: vi.fn(async () => resolution('native'))
    })

    expect(report.ok).toBe(false)
    expect(report.selection).toMatchObject({
      requested: 'native',
      errorCode: 'NND_ADAPTER_UNAVAILABLE'
    })
    expect(report.diagnostics.at(-1)).toMatchObject({
      code: 'NND_DOCTOR_SELECTION_FAILED',
      level: 'error'
    })
  })

  it('bounded-waits and retries a forced probe', async () => {
    let calls = 0
    let time = 0
    const native = adapter('native', () => {
      calls += 1
      return calls <= 2
        ? probe('native', false, noCapabilities)
        : probe('native', true, legacyCapabilities)
    })
    const report = await runDoctor({
      packageVersion: '1.2.3',
      nativeAdapter: native,
      legacyAdapter: adapter('legacy', () => probe('legacy', true, legacyCapabilities)),
      resolve: vi.fn(async () => resolution('native')),
      probeWaitMs: 100,
      probeIntervalMs: 25,
      now: () => time,
      sleep: vi.fn(async (milliseconds) => {
        time += milliseconds
      })
    })

    expect(report.ok).toBe(true)
    expect(report.selection.selected).toBe('native')
    expect(calls).toBeGreaterThanOrEqual(3)
    expect(time).toBeLessThanOrEqual(100)
  })

  it('waits before committing an Auto fallback when Native may become available', async () => {
    let calls = 0
    let time = 0
    const native = adapter('native', () => {
      calls += 1
      return calls <= 2
        ? probe('native', false, noCapabilities)
        : probe('native', true, legacyCapabilities)
    })
    const report = await runDoctor({
      packageVersion: '1.2.3',
      nativeAdapter: native,
      legacyAdapter: adapter('legacy', () => probe('legacy', true, legacyCapabilities)),
      resolve: vi.fn(async () => resolution('auto')),
      probeWaitMs: 100,
      probeIntervalMs: 25,
      now: () => time,
      sleep: vi.fn(async (milliseconds) => {
        time += milliseconds
      })
    })

    expect(report.ok).toBe(true)
    expect(report.selection.selected).toBe('native')
    expect(time).toBe(25)
  })

  it('preserves config errors in JSON and human formats', async () => {
    const report = await runDoctor({
      packageVersion: '1.2.3',
      nativeAdapter: adapter('native', () => probe('native', false, noCapabilities)),
      legacyAdapter: adapter('legacy', () => probe('legacy', true, legacyCapabilities)),
      resolve: vi.fn(async () => {
        throw Object.assign(new Error('broken config'), { code: 'CUSTOM' })
      })
    })

    expect(report.ok).toBe(false)
    const json = JSON.parse(formatDoctorReport(report, true)) as typeof report
    expect(json.schemaVersion).toBe(1)
    expect(json.ok).toBe(false)
    expect(formatDoctorReport(report)).toContain('NND_CONFIG_LOAD_FAILED')
  })
})

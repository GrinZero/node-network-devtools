import {
  NETWORK_CAPABILITIES,
  type AdapterKind,
  type AdapterMode,
  type AdapterProbe,
  type AdapterSelection,
  type AdapterStartOptions,
  type DebugAdapter,
  type Diagnostic,
  type NetworkCapability
} from './types'

export interface AdapterSelectionOptions extends AdapterStartOptions {
  /**
   * `auto` prefers the native adapter and falls back to legacy only when the
   * native adapter is unavailable or cannot provide every required capability.
   *
   * @default 'auto'
   */
  mode?: AdapterMode
}

export type AdapterSelectionErrorCode =
  | 'NND_DUPLICATE_ADAPTER'
  | 'NND_ADAPTER_UNAVAILABLE'
  | 'NND_ADAPTER_PROBE_FAILED'
  | 'NND_ADAPTER_CAPABILITY_MISSING'
  | 'NND_INVALID_ADAPTER_PROBE'
  | 'NND_NO_CAPABLE_ADAPTER'

export type AdapterSelectionFailureReason =
  | 'not_registered'
  | 'probe_failed'
  | 'unavailable'
  | 'not_auto_selectable'
  | 'missing_capabilities'
  | 'invalid_probe'

export interface AdapterSelectionAttempt {
  kind: AdapterKind
  reason: AdapterSelectionFailureReason
  missingCapabilities?: readonly NetworkCapability[]
  diagnosticCodes?: readonly string[]
  diagnostics?: readonly Diagnostic[]
  error?: string
}

export class AdapterSelectionError extends Error {
  readonly code: AdapterSelectionErrorCode
  readonly details: Readonly<Record<string, unknown>>
  readonly cause?: unknown

  constructor(
    code: AdapterSelectionErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    cause?: unknown
  ) {
    super(message)
    this.name = 'AdapterSelectionError'
    this.code = code
    this.details = details
    this.cause = cause
  }
}

interface SuccessfulProbe {
  adapter: DebugAdapter
  probe: AdapterProbe
}

interface FailedProbe {
  adapter?: DebugAdapter
  attempt: AdapterSelectionAttempt
}

type ProbeResult = SuccessfulProbe | FailedProbe

const isSuccessfulProbe = (result: ProbeResult): result is SuccessfulProbe => 'probe' in result

const normalizeRequiredCapabilities = (
  capabilities: readonly NetworkCapability[] | undefined
): readonly NetworkCapability[] => {
  if (!capabilities?.length) return []

  const requested = new Set(capabilities)
  return NETWORK_CAPABILITIES.filter((capability) => requested.has(capability))
}

const getMissingCapabilities = (
  probe: AdapterProbe,
  requiredCapabilities: readonly NetworkCapability[]
): readonly NetworkCapability[] =>
  requiredCapabilities.filter((capability) => !probe.capabilities[capability])

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}

const diagnosticCodes = (probe: AdapterProbe): readonly string[] =>
  probe.diagnostics.map((diagnostic) => diagnostic.code)

/**
 * Selects a runtime adapter without starting it.
 *
 * Selection is deliberately deterministic: adapters are addressed by kind,
 * `auto` always probes native first, and capability lists use the canonical
 * NETWORK_CAPABILITIES order.
 */
export class AdapterSelector {
  private readonly adapters: ReadonlyMap<AdapterKind, DebugAdapter>

  constructor(adapters: readonly DebugAdapter[]) {
    const byKind = new Map<AdapterKind, DebugAdapter>()

    for (const adapter of adapters) {
      if (byKind.has(adapter.kind)) {
        throw new AdapterSelectionError(
          'NND_DUPLICATE_ADAPTER',
          `Adapter "${adapter.kind}" is registered more than once.`,
          { kind: adapter.kind }
        )
      }
      byKind.set(adapter.kind, adapter)
    }

    this.adapters = byKind
  }

  async select(options: AdapterSelectionOptions = {}): Promise<AdapterSelection> {
    const mode = options.mode ?? 'auto'
    const requiredCapabilities = normalizeRequiredCapabilities(options.requiredCapabilities)
    const probeOptions: AdapterStartOptions = {
      ...(options.inspector ? { inspector: options.inspector } : {}),
      ...(requiredCapabilities.length > 0 ? { requiredCapabilities } : {})
    }

    if (mode === 'native' || mode === 'legacy') {
      return this.selectForced(mode, requiredCapabilities, probeOptions)
    }

    return this.selectAuto(requiredCapabilities, probeOptions)
  }

  private async selectForced(
    kind: AdapterKind,
    requiredCapabilities: readonly NetworkCapability[],
    probeOptions: AdapterStartOptions
  ): Promise<AdapterSelection> {
    const result = await this.probe(kind, requiredCapabilities, probeOptions)

    if (isSuccessfulProbe(result)) {
      return {
        adapter: result.adapter,
        probe: result.probe
      }
    }

    const { attempt } = result
    const details = {
      ...attempt,
      requiredCapabilities
    }

    switch (attempt.reason) {
      case 'not_registered':
        throw new AdapterSelectionError(
          'NND_ADAPTER_UNAVAILABLE',
          `Adapter "${kind}" is not registered.`,
          details
        )
      case 'unavailable':
        throw new AdapterSelectionError(
          'NND_ADAPTER_UNAVAILABLE',
          `Adapter "${kind}" is unavailable.`,
          details
        )
      case 'missing_capabilities':
        throw new AdapterSelectionError(
          'NND_ADAPTER_CAPABILITY_MISSING',
          `Adapter "${kind}" does not provide required capabilities: ${attempt.missingCapabilities!.join(', ')}.`,
          details
        )
      case 'not_auto_selectable':
        // This result is only produced by auto-mode probes.
        throw new AdapterSelectionError(
          'NND_ADAPTER_UNAVAILABLE',
          `Adapter "${kind}" is not eligible for automatic selection.`,
          details
        )
      case 'invalid_probe':
        throw new AdapterSelectionError(
          'NND_INVALID_ADAPTER_PROBE',
          `Adapter "${kind}" returned a probe for a different adapter kind.`,
          details
        )
      case 'probe_failed':
        throw new AdapterSelectionError(
          'NND_ADAPTER_PROBE_FAILED',
          `Adapter "${kind}" probe failed: ${attempt.error}.`,
          details,
          attempt.error
        )
    }
  }

  private async selectAuto(
    requiredCapabilities: readonly NetworkCapability[],
    probeOptions: AdapterStartOptions
  ): Promise<AdapterSelection> {
    const nativeResult = await this.probe('native', requiredCapabilities, probeOptions, true)

    if (isSuccessfulProbe(nativeResult)) {
      return {
        adapter: nativeResult.adapter,
        probe: nativeResult.probe
      }
    }

    const legacyResult = await this.probe('legacy', requiredCapabilities, probeOptions, true)

    if (isSuccessfulProbe(legacyResult)) {
      return {
        adapter: legacyResult.adapter,
        probe: legacyResult.probe,
        fallbackReason: this.createFallbackDiagnostic(nativeResult.attempt, requiredCapabilities)
      }
    }

    const attempts = [nativeResult.attempt, legacyResult.attempt]
    const requirementText = requiredCapabilities.length ? requiredCapabilities.join(', ') : '(none)'

    throw new AdapterSelectionError(
      'NND_NO_CAPABLE_ADAPTER',
      `No available adapter satisfies required capabilities: ${requirementText}.`,
      {
        requiredCapabilities,
        attempts
      }
    )
  }

  private async probe(
    kind: AdapterKind,
    requiredCapabilities: readonly NetworkCapability[],
    options: AdapterStartOptions,
    requireAutoSelectable = false
  ): Promise<ProbeResult> {
    const adapter = this.adapters.get(kind)

    if (!adapter) {
      return {
        attempt: {
          kind,
          reason: 'not_registered'
        }
      }
    }

    let probe: AdapterProbe
    try {
      probe = await adapter.probe(options)
    } catch (error) {
      return {
        adapter,
        attempt: {
          kind,
          reason: 'probe_failed',
          error: errorMessage(error)
        }
      }
    }

    if (probe.kind !== kind) {
      return {
        adapter,
        attempt: {
          kind,
          reason: 'invalid_probe',
          error: `Expected "${kind}", received "${probe.kind}".`
        }
      }
    }

    if (!probe.available) {
      return {
        adapter,
        attempt: {
          kind,
          reason: 'unavailable',
          diagnosticCodes: diagnosticCodes(probe),
          ...(probe.diagnostics.length ? { diagnostics: probe.diagnostics } : {})
        }
      }
    }

    if (requireAutoSelectable && probe.autoSelectable === false) {
      return {
        adapter,
        attempt: {
          kind,
          reason: 'not_auto_selectable',
          diagnosticCodes: diagnosticCodes(probe),
          ...(probe.diagnostics.length ? { diagnostics: probe.diagnostics } : {})
        }
      }
    }

    const missingCapabilities = getMissingCapabilities(probe, requiredCapabilities)
    if (missingCapabilities.length > 0) {
      return {
        adapter,
        attempt: {
          kind,
          reason: 'missing_capabilities',
          missingCapabilities,
          diagnosticCodes: diagnosticCodes(probe),
          ...(probe.diagnostics.length ? { diagnostics: probe.diagnostics } : {})
        }
      }
    }

    return { adapter, probe }
  }

  private createFallbackDiagnostic(
    attempt: AdapterSelectionAttempt,
    requiredCapabilities: readonly NetworkCapability[]
  ): Diagnostic {
    return {
      code: 'NND_AUTO_FALLBACK',
      level: 'warn',
      message: 'Native adapter cannot satisfy this selection; using legacy adapter.',
      hint: 'Use mode "native" to fail instead of falling back.',
      details: {
        from: 'native',
        to: 'legacy',
        reason: attempt.reason,
        requiredCapabilities,
        ...(attempt.missingCapabilities
          ? { missingCapabilities: attempt.missingCapabilities }
          : {}),
        ...(attempt.diagnosticCodes ? { diagnosticCodes: attempt.diagnosticCodes } : {}),
        ...(attempt.diagnostics ? { diagnostics: attempt.diagnostics } : {}),
        ...(attempt.error ? { error: attempt.error } : {})
      }
    }
  }
}

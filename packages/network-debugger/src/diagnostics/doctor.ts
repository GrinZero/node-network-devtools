import { readFileSync } from 'node:fs'
import * as nodeInspector from 'node:inspector'
import { dirname, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LegacyAdapter } from '../adapters/legacy'
import {
  NodeNativeAdapter,
  OPTIONAL_NATIVE_NETWORK_METHODS,
  REQUIRED_NATIVE_NETWORK_METHODS,
  hasNativeInspectionFlag,
  type NativeInspectorApi,
  type NodeNativeAdapterDependencies
} from '../adapters/node-native'
import { AdapterSelector } from '../adapters/selector'
import type { AdapterProbe, DebugAdapter, Diagnostic, NetworkCapability } from '../adapters/types'
import {
  NndConfigError,
  resolveConfig,
  type ConfigResolution,
  type ResolveConfigOptions,
  type ResolvedNndConfig
} from '../config'

export const DOCTOR_SCHEMA_VERSION = 1

export interface DoctorNetworkMethods {
  required: readonly string[]
  optional: readonly string[]
  available: readonly string[]
  missingRequired: readonly string[]
}

export interface DoctorSelection {
  requested: ResolvedNndConfig['mode']
  selected?: 'native' | 'legacy'
  fallbackReason?: Diagnostic
  errorCode?: string
  error?: string
}

export interface DoctorReport {
  schemaVersion: typeof DOCTOR_SCHEMA_VERSION
  ok: boolean
  nodeVersion: string
  packageVersion: string
  inspectorAvailable: boolean
  experimentalFlag: boolean
  networkMethods: DoctorNetworkMethods
  capabilities: Readonly<Record<NetworkCapability, boolean>>
  native: AdapterProbe
  config?: ConfigResolution
  selection: DoctorSelection
  diagnostics: readonly Diagnostic[]
}

export interface DoctorOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  config?: ResolveConfigOptions['cli']
  configFile?: ResolveConfigOptions['configFile']
  /** Retry a failed forced-mode probe for at most this many milliseconds. */
  probeWaitMs?: number
  probeIntervalMs?: number
  nodeVersion?: string
  packageVersion?: string
  execArgv?: readonly string[]
  inspector?: NativeInspectorApi | null
  inspectorAvailable?: boolean
  nativeAdapter?: DebugAdapter
  legacyAdapter?: DebugAdapter
  resolve?: (options?: ResolveConfigOptions) => Promise<ConfigResolution>
  sleep?: (milliseconds: number) => Promise<void>
  now?: () => number
}

function diagnostic(
  code: string,
  level: Diagnostic['level'],
  message: string,
  hint?: string,
  details?: Readonly<Record<string, unknown>>
): Diagnostic {
  return {
    code,
    level,
    message,
    ...(hint ? { hint } : {}),
    ...(details ? { details } : {})
  }
}

function packageVersionFrom(start: string): string | undefined {
  let directory = start
  const root = parse(directory).root
  while (directory !== root) {
    try {
      const value = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as {
        name?: unknown
        version?: unknown
      }
      if (value.name === 'node-network-devtools' && typeof value.version === 'string') {
        return value.version
      }
    } catch {
      // Keep walking: installed and source layouts place this module at
      // different depths.
    }
    directory = dirname(directory)
  }
  return undefined
}

export function detectPackageVersion(moduleUrl: string = import.meta.url): string {
  try {
    return packageVersionFrom(dirname(fileURLToPath(moduleUrl))) ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function methodReport(inspector: NativeInspectorApi | null): DoctorNetworkMethods {
  const network = inspector?.Network
  const required = [...REQUIRED_NATIVE_NETWORK_METHODS]
  const optional = [...OPTIONAL_NATIVE_NETWORK_METHODS]
  const available = [...required, ...optional].filter(
    (method) => typeof network?.[method as keyof typeof network] === 'function'
  )
  return {
    required,
    optional,
    available,
    missingRequired: required.filter((method) => !available.includes(method))
  }
}

function configErrorDiagnostic(error: unknown): Diagnostic {
  if (error instanceof NndConfigError) {
    return diagnostic(
      error.code,
      'error',
      error.message,
      'Fix the configuration and rerun nnd doctor.',
      {
        ...error.details
      }
    )
  }
  return diagnostic(
    'NND_CONFIG_LOAD_FAILED',
    'error',
    error instanceof Error ? error.message : String(error),
    'Fix the configuration and rerun nnd doctor.'
  )
}

function selectionErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code: unknown }).code)
  }
  return 'NND_DOCTOR_SELECTION_FAILED'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface SelectionAttempt {
  native: AdapterProbe
  selection: DoctorSelection
  selectionDiagnostic: Diagnostic
}

async function inspectSelection(
  nativeAdapter: DebugAdapter,
  legacyAdapter: DebugAdapter,
  config: ResolvedNndConfig
): Promise<SelectionAttempt> {
  const options = {
    mode: config.mode,
    requiredCapabilities: config.requiredCapabilities,
    inspector: config.inspector
  } as const
  const native = await nativeAdapter.probe(options)
  try {
    const selected = await new AdapterSelector([nativeAdapter, legacyAdapter]).select(options)
    return {
      native,
      selection: {
        requested: config.mode,
        selected: selected.adapter.kind,
        ...(selected.fallbackReason ? { fallbackReason: selected.fallbackReason } : {})
      },
      selectionDiagnostic: diagnostic(
        `NND_DOCTOR_SELECTED_${selected.adapter.kind.toUpperCase()}`,
        selected.fallbackReason ? 'warn' : 'info',
        `Selected ${selected.adapter.kind} adapter${selected.fallbackReason ? ' via Auto fallback' : ''}.`,
        undefined,
        { requested: config.mode, selected: selected.adapter.kind }
      )
    }
  } catch (error) {
    const code = selectionErrorCode(error)
    const message = errorMessage(error)
    return {
      native,
      selection: {
        requested: config.mode,
        errorCode: code,
        error: message
      },
      selectionDiagnostic: diagnostic(
        'NND_DOCTOR_SELECTION_FAILED',
        'error',
        message,
        config.mode === 'native'
          ? 'Enable the experimental flag and use a supported Node.js runtime, or choose Auto/Legacy.'
          : 'Review adapter diagnostics and required capabilities.',
        { code, requested: config.mode }
      )
    }
  }
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds))

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const env = options.env ?? process.env
  const nodeVersion = options.nodeVersion ?? process.versions.node
  const packageVersion = options.packageVersion ?? detectPackageVersion()
  const execArgv = options.execArgv ?? process.execArgv
  const inspector =
    options.inspector === undefined
      ? (nodeInspector as unknown as NativeInspectorApi)
      : options.inspector
  const inspectorAvailable =
    options.inspectorAvailable ?? (process.features?.inspector !== false && inspector !== null)
  const methods = methodReport(inspector)
  const diagnostics: Diagnostic[] = [
    diagnostic('NND_DOCTOR_NODE_VERSION', 'info', `Node.js ${nodeVersion}.`, undefined, {
      nodeVersion
    }),
    diagnostic(
      'NND_DOCTOR_PACKAGE_VERSION',
      packageVersion === 'unknown' ? 'warn' : 'info',
      `node-network-devtools ${packageVersion}.`,
      packageVersion === 'unknown' ? 'Run doctor from an installed package.' : undefined,
      { packageVersion }
    )
  ]

  let resolution: ConfigResolution | undefined
  try {
    resolution = await (options.resolve ?? resolveConfig)({
      cwd: options.cwd,
      env,
      cli: options.config,
      configFile: options.configFile
    })
    diagnostics.push(
      resolution.sources.configFile
        ? diagnostic(
            'NND_DOCTOR_CONFIG_LOADED',
            'info',
            `Loaded configuration from ${resolution.sources.configFile}.`,
            undefined,
            { sources: resolution.sources }
          )
        : diagnostic(
            'NND_DOCTOR_CONFIG_DEFAULTS',
            'info',
            'No config file found; using environment and defaults.',
            undefined,
            { sources: resolution.sources }
          )
    )
  } catch (error) {
    diagnostics.push(configErrorDiagnostic(error))
  }

  const effectiveConfig: ResolvedNndConfig = resolution?.config ?? {
    mode: options.config?.mode ?? 'auto',
    open: false,
    wait: true,
    watch: false,
    runner: 'node',
    inspector: { host: '127.0.0.1', port: 0 },
    requiredCapabilities: options.config?.requiredCapabilities ?? [],
    legacy: {}
  }
  const nativeDependencies: NodeNativeAdapterDependencies = {
    inspector,
    inspectorAvailable,
    execArgv,
    nodeVersion
  }
  const nativeAdapter = options.nativeAdapter ?? new NodeNativeAdapter(nativeDependencies)
  const legacyAdapter = options.legacyAdapter ?? new LegacyAdapter()
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const waitMs = Math.max(0, options.probeWaitMs ?? 0)
  const interval = Math.max(1, options.probeIntervalMs ?? 100)
  const deadline = now() + waitMs
  let attempt = await inspectSelection(nativeAdapter, legacyAdapter, effectiveConfig)

  const shouldRetry = () =>
    !attempt.selection.selected ||
    (effectiveConfig.mode === 'auto' &&
      attempt.selection.selected === 'legacy' &&
      attempt.selection.fallbackReason !== undefined)

  while (shouldRetry() && now() < deadline) {
    await sleep(Math.min(interval, Math.max(0, deadline - now())))
    attempt = await inspectSelection(nativeAdapter, legacyAdapter, effectiveConfig)
  }

  diagnostics.push(...attempt.native.diagnostics)
  if (attempt.selection.fallbackReason) diagnostics.push(attempt.selection.fallbackReason)
  diagnostics.push(attempt.selectionDiagnostic)

  return {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    ok: Boolean(resolution && attempt.selection.selected),
    nodeVersion,
    packageVersion,
    inspectorAvailable,
    experimentalFlag: hasNativeInspectionFlag(execArgv),
    networkMethods: methods,
    capabilities: attempt.native.capabilities,
    native: attempt.native,
    ...(resolution ? { config: resolution } : {}),
    selection: attempt.selection,
    diagnostics
  }
}

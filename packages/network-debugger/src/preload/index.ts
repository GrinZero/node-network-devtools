import type { RegisterOptions } from '../common'
import { register as runtimeRegister } from '../runtime/controller'
import type { RegistrationHandle } from '../runtime/registration'
import {
  NND_PRELOAD_CONFIG_ENV,
  parsePreloadConfig,
  resolveConfig,
  toRegisterOptions,
  type ConfigResolution,
  type ResolveConfigOptions
} from '../config'

const PRELOAD_STATE = Symbol.for('node-network-devtools.preload.state')

interface PreloadState {
  promise: Promise<RegistrationHandle>
  handle?: RegistrationHandle
}

export interface PreloadDependencies {
  env?: NodeJS.ProcessEnv
  cwd?: string
  globalObject?: typeof globalThis
  register?: (options?: RegisterOptions) => RegistrationHandle
  resolve?: (options?: ResolveConfigOptions) => Promise<ConfigResolution>
}

export const NND_PRELOAD_REPORT_ENV = 'NND_PRELOAD_REPORT'
export const NND_READY_PREFIX = '[nnd:ready] '
export const NND_PRELOAD_PROCESS_ENV = 'NND_PRELOAD_PROCESS'

/**
 * Claim the current OS process as the preload root. Descendants inherit the
 * marker and skip the side effect even though Node also inherits `execArgv`.
 */
export function claimPreloadProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env[NND_PRELOAD_PROCESS_ENV] === 'claimed') return false
  env[NND_PRELOAD_PROCESS_ENV] = 'claimed'
  return true
}

function stateOn(globalObject: typeof globalThis): PreloadState | undefined {
  return (globalObject as unknown as Record<PropertyKey, unknown>)[PRELOAD_STATE] as
    | PreloadState
    | undefined
}

function setState(globalObject: typeof globalThis, state: PreloadState): void {
  Object.defineProperty(globalObject, PRELOAD_STATE, {
    value: state,
    configurable: true,
    enumerable: false,
    writable: true
  })
}

/**
 * Register network inspection exactly once for this JavaScript realm.
 *
 * The CLI serializes its already-resolved configuration into the environment,
 * allowing `register()` to run synchronously during module evaluation. Direct
 * `--import node-network-devtools/register` usage falls back to config discovery.
 */
export function preload(dependencies: PreloadDependencies = {}): Promise<RegistrationHandle> {
  const globalObject = dependencies.globalObject ?? globalThis
  const existing = stateOn(globalObject)
  if (existing) return existing.promise

  const env = dependencies.env ?? process.env
  const register = dependencies.register ?? runtimeRegister
  const resolve = dependencies.resolve ?? resolveConfig
  const state = {} as PreloadState

  const serialized = env[NND_PRELOAD_CONFIG_ENV]
  if (serialized) {
    try {
      const handle = register(toRegisterOptions(parsePreloadConfig(serialized)))
      state.handle = handle
      state.promise = handle.ready.then(() => handle)
    } catch (error) {
      state.promise = Promise.reject(error)
    }
  } else {
    state.promise = resolve({ cwd: dependencies.cwd, env }).then(({ config }) => {
      const handle = register(toRegisterOptions(config))
      state.handle = handle
      return handle.ready.then(() => handle)
    })
  }

  // A failed import may be retried after configuration is corrected.
  void state.promise.catch(() => {
    if (stateOn(globalObject) === state) {
      delete (globalObject as unknown as Record<PropertyKey, unknown>)[PRELOAD_STATE]
    }
  })
  setState(globalObject, state)
  return state.promise
}

export function getPreloadHandle(
  globalObject: typeof globalThis = globalThis
): RegistrationHandle | undefined {
  return stateOn(globalObject)?.handle
}

/** Test and embedding hook; normal consumers should dispose the handle instead. */
export function resetPreloadState(globalObject: typeof globalThis = globalThis): void {
  delete (globalObject as unknown as Record<PropertyKey, unknown>)[PRELOAD_STATE]
}

export function formatPreloadError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'NND_PRELOAD_FAILED'
  const message = error instanceof Error ? error.message : String(error)
  return `[nnd:${code}] ${message}`
}

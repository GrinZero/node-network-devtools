import type { InterceptOptions } from '../common'
import type { AdapterMode, NetworkCapability } from '../adapters/types'
import type { LegacyMockRule } from '../mock'

export type NndRunner = 'node' | 'tsx'

/** Values accepted by nnd.config.mjs/cjs/json and explicit CLI overrides. */
export interface NndConfig {
  mode?: AdapterMode
  open?: boolean
  wait?: boolean
  watch?: boolean
  runner?: NndRunner
  inspector?: {
    host?: string
    port?: number
  }
  requiredCapabilities?: readonly NetworkCapability[]
  session?: {
    directory: string
    bodyCommandTimeoutMs?: number
    har?: boolean | string
  }
  legacy?: {
    port?: number
    serverPort?: number
    intercept?: InterceptOptions
    mock?: readonly LegacyMockRule[]
  }
}

export interface ResolvedNndConfig {
  mode: AdapterMode
  open: boolean
  wait: boolean
  watch: boolean
  runner: NndRunner
  inspector: {
    host: string
    port: number
  }
  requiredCapabilities: readonly NetworkCapability[]
  session?: {
    directory: string
    bodyCommandTimeoutMs?: number
    har?: boolean | string
  }
  legacy: {
    port?: number
    serverPort?: number
    intercept?: InterceptOptions
    mock?: readonly LegacyMockRule[]
  }
}

export interface ConfigSources {
  configFile?: string
  env: readonly string[]
  cli: readonly string[]
}

export interface ConfigResolution {
  config: ResolvedNndConfig
  sources: ConfigSources
}

export interface ResolveConfigOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  cli?: NndConfig
  /** Explicit file path. `false` disables config-file discovery. */
  configFile?: string | false
}

export const DEFAULT_NND_CONFIG: Readonly<ResolvedNndConfig> = Object.freeze({
  mode: 'auto',
  open: false,
  wait: true,
  watch: false,
  runner: 'node',
  inspector: Object.freeze({ host: '127.0.0.1', port: 0 }),
  requiredCapabilities: Object.freeze([]),
  legacy: Object.freeze({})
})

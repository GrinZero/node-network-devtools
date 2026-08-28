import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { NETWORK_CAPABILITIES, type NetworkCapability } from '../adapters/types'
import { NndConfigError } from './errors'
import {
  DEFAULT_NND_CONFIG,
  type ConfigResolution,
  type NndConfig,
  type NndRunner,
  type ResolveConfigOptions,
  type ResolvedNndConfig
} from './types'

const CONFIG_NAMES = ['nnd.config.mjs', 'nnd.config.cjs', 'nnd.config.json'] as const
const MODES = new Set(['auto', 'native', 'legacy'])
const RUNNERS = new Set<NndRunner>(['node', 'tsx'])
const CAPABILITIES = new Set<string>(NETWORK_CAPABILITIES)

const hasOwn = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key)

function invalid(
  message: string,
  details: Readonly<Record<string, unknown>> = {},
  source: 'config' | 'env' = 'config'
): never {
  throw new NndConfigError(
    source === 'env' ? 'NND_CONFIG_ENV_INVALID' : 'NND_CONFIG_INVALID',
    message,
    details
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertBoolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== 'boolean')
    invalid(`Configuration field "${field}" must be a boolean.`, { field, value })
}

function assertPort(value: unknown, field: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 65_535) {
    invalid(`Configuration field "${field}" must be an integer from 0 to 65535.`, {
      field,
      value
    })
  }
}

function validateMockRules(value: unknown, sourcePath?: string): void {
  if (!Array.isArray(value)) {
    invalid('Configuration field "legacy.mock" must be an array.', {
      field: 'legacy.mock',
      value,
      sourcePath
    })
  }
  for (const [index, rule] of value.entries()) {
    if (
      !isRecord(rule) ||
      !isRecord(rule.match) ||
      typeof rule.match.url !== 'string' ||
      rule.match.url.length === 0 ||
      !isRecord(rule.response)
    ) {
      invalid(`Configuration field "legacy.mock[${index}]" is invalid.`, {
        field: `legacy.mock[${index}]`,
        value: rule,
        sourcePath
      })
    }
    if (rule.match.method !== undefined && typeof rule.match.method !== 'string') {
      invalid(`Configuration field "legacy.mock[${index}].match.method" must be a string.`, {
        field: `legacy.mock[${index}].match.method`,
        value: rule.match.method,
        sourcePath
      })
    }
    if (rule.match.headers !== undefined && !isRecord(rule.match.headers)) {
      invalid(`Configuration field "legacy.mock[${index}].match.headers" must be an object.`, {
        field: `legacy.mock[${index}].match.headers`,
        value: rule.match.headers,
        sourcePath
      })
    }
    if (rule.response.body !== undefined && typeof rule.response.body !== 'string') {
      invalid(`Configuration field "legacy.mock[${index}].response.body" must be a string.`, {
        field: `legacy.mock[${index}].response.body`,
        value: rule.response.body,
        sourcePath
      })
    }
    if (rule.response.bodyBase64 !== undefined && typeof rule.response.bodyBase64 !== 'string') {
      invalid(`Configuration field "legacy.mock[${index}].response.bodyBase64" must be a string.`, {
        field: `legacy.mock[${index}].response.bodyBase64`,
        value: rule.response.bodyBase64,
        sourcePath
      })
    }
    if (rule.response.body !== undefined && rule.response.bodyBase64 !== undefined) {
      invalid(
        `Configuration field "legacy.mock[${index}].response" cannot define both body and bodyBase64.`,
        { field: `legacy.mock[${index}].response`, sourcePath }
      )
    }
  }
}

function validateConfig(value: unknown, sourcePath?: string): NndConfig {
  if (!isRecord(value)) {
    return invalid('NND configuration must export an object.', { sourcePath })
  }

  const config = value as Record<string, unknown>
  if (config.mode !== undefined && (typeof config.mode !== 'string' || !MODES.has(config.mode))) {
    invalid('Configuration field "mode" must be auto, native, or legacy.', {
      field: 'mode',
      value: config.mode,
      sourcePath
    })
  }
  if (config.runner !== undefined && !RUNNERS.has(config.runner as NndRunner)) {
    invalid('Configuration field "runner" must be node or tsx.', {
      field: 'runner',
      value: config.runner,
      sourcePath
    })
  }
  for (const field of ['open', 'wait', 'watch'] as const) {
    if (config[field] !== undefined) assertBoolean(config[field], field)
  }

  if (config.inspector !== undefined) {
    if (!isRecord(config.inspector)) {
      invalid('Configuration field "inspector" must be an object.', {
        field: 'inspector',
        value: config.inspector,
        sourcePath
      })
    }
    if (config.inspector.host !== undefined && typeof config.inspector.host !== 'string') {
      invalid('Configuration field "inspector.host" must be a string.', {
        field: 'inspector.host',
        value: config.inspector.host,
        sourcePath
      })
    }
    if (config.inspector.host === '') {
      invalid('Configuration field "inspector.host" cannot be empty.', {
        field: 'inspector.host',
        sourcePath
      })
    }
    if (config.inspector.port !== undefined) assertPort(config.inspector.port, 'inspector.port')
  }

  if (config.requiredCapabilities !== undefined) {
    if (
      !Array.isArray(config.requiredCapabilities) ||
      config.requiredCapabilities.some(
        (capability) => typeof capability !== 'string' || !CAPABILITIES.has(capability)
      )
    ) {
      invalid('Configuration field "requiredCapabilities" contains an unknown capability.', {
        field: 'requiredCapabilities',
        value: config.requiredCapabilities,
        allowed: [...NETWORK_CAPABILITIES],
        sourcePath
      })
    }
  }

  if (config.session !== undefined) {
    if (!isRecord(config.session)) {
      invalid('Configuration field "session" must be an object.', {
        field: 'session',
        value: config.session,
        sourcePath
      })
    }
    if (typeof config.session.directory !== 'string' || !config.session.directory.trim()) {
      invalid('Configuration field "session.directory" must be a non-empty string.', {
        field: 'session.directory',
        value: config.session.directory,
        sourcePath
      })
    }
    if (
      config.session.bodyCommandTimeoutMs !== undefined &&
      (!Number.isSafeInteger(config.session.bodyCommandTimeoutMs) ||
        (config.session.bodyCommandTimeoutMs as number) <= 0)
    ) {
      invalid('Configuration field "session.bodyCommandTimeoutMs" must be a positive integer.', {
        field: 'session.bodyCommandTimeoutMs',
        value: config.session.bodyCommandTimeoutMs,
        sourcePath
      })
    }
    if (
      config.session.har !== undefined &&
      typeof config.session.har !== 'boolean' &&
      (typeof config.session.har !== 'string' || !config.session.har.trim())
    ) {
      invalid('Configuration field "session.har" must be a boolean or non-empty path.', {
        field: 'session.har',
        value: config.session.har,
        sourcePath
      })
    }
  }

  if (config.legacy !== undefined) {
    if (!isRecord(config.legacy)) {
      invalid('Configuration field "legacy" must be an object.', {
        field: 'legacy',
        value: config.legacy,
        sourcePath
      })
    }
    if (config.legacy.port !== undefined) assertPort(config.legacy.port, 'legacy.port')
    if (config.legacy.serverPort !== undefined) {
      assertPort(config.legacy.serverPort, 'legacy.serverPort')
    }
    if (config.legacy.intercept !== undefined && !isRecord(config.legacy.intercept)) {
      invalid('Configuration field "legacy.intercept" must be an object.', {
        field: 'legacy.intercept',
        value: config.legacy.intercept,
        sourcePath
      })
    }
    if (config.legacy.mock !== undefined) {
      validateMockRules(config.legacy.mock, sourcePath)
    }
  }

  return config as unknown as NndConfig
}

function resolveConfigPath(cwd: string, requested: string): string {
  return isAbsolute(requested) ? requested : resolve(cwd, requested)
}

export function findConfigFile(cwd: string): string | undefined {
  for (const name of CONFIG_NAMES) {
    const candidate = resolve(cwd, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

export async function loadConfigFile(path: string): Promise<NndConfig> {
  if (!existsSync(path)) {
    throw new NndConfigError(
      'NND_CONFIG_NOT_FOUND',
      `NND configuration file was not found: ${path}`,
      {
        path
      }
    )
  }

  try {
    let value: unknown
    if (path.endsWith('.json')) {
      value = JSON.parse(readFileSync(path, 'utf8'))
    } else if (path.endsWith('.cjs')) {
      const requireFromConfig = createRequire(resolve(path, '..', '__nnd_loader__.cjs'))
      const resolved = requireFromConfig.resolve(path)
      delete requireFromConfig.cache[resolved]
      const loaded = requireFromConfig(resolved) as unknown
      value = isRecord(loaded) && hasOwn(loaded, 'default') ? loaded.default : loaded
    } else if (path.endsWith('.mjs')) {
      const url = `${pathToFileURL(path).href}?nnd=${Date.now()}`
      const loaded = (await import(/* @vite-ignore */ url)) as { default?: unknown }
      value = hasOwn(loaded, 'default') ? loaded.default : loaded
    } else {
      invalid('NND configuration files must use .mjs, .cjs, or .json.', { path })
    }
    return validateConfig(value, path)
  } catch (error) {
    if (error instanceof NndConfigError) throw error
    throw new NndConfigError(
      'NND_CONFIG_LOAD_FAILED',
      `Unable to load NND configuration: ${path}`,
      { path, cause: error instanceof Error ? error.message : String(error) },
      error
    )
  }
}

function parseBoolean(value: string, key: string): boolean {
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return invalid(`Environment variable ${key} must be true or false.`, { key, value }, 'env')
}

function parsePort(value: string, key: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    return invalid(
      `Environment variable ${key} must be an integer from 0 to 65535.`,
      {
        key,
        value
      },
      'env'
    )
  }
  return port
}

function parseCapabilities(value: string, key: string): readonly NetworkCapability[] {
  const capabilities = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const unknown = capabilities.filter((capability) => !CAPABILITIES.has(capability))
  if (unknown.length > 0) {
    return invalid(
      `Environment variable ${key} contains unknown capabilities: ${unknown.join(', ')}.`,
      {
        key,
        unknown,
        allowed: [...NETWORK_CAPABILITIES]
      },
      'env'
    )
  }
  return [...new Set(capabilities)] as NetworkCapability[]
}

interface EnvironmentConfig {
  config: NndConfig
  keys: string[]
}

function configFromEnvironment(env: NodeJS.ProcessEnv): EnvironmentConfig {
  const config: NndConfig = {}
  const keys: string[] = []
  const use = (key: string, apply: (value: string) => void) => {
    const value = env[key]
    if (value === undefined || value === '') return
    keys.push(key)
    apply(value)
  }

  use('NND_MODE', (value) => {
    if (!MODES.has(value)) {
      invalid(
        'Environment variable NND_MODE must be auto, native, or legacy.',
        {
          key: 'NND_MODE',
          value
        },
        'env'
      )
    }
    config.mode = value as NndConfig['mode']
  })
  use('NND_OPEN', (value) => (config.open = parseBoolean(value, 'NND_OPEN')))
  use('NND_WAIT', (value) => (config.wait = parseBoolean(value, 'NND_WAIT')))
  use('NND_WATCH', (value) => (config.watch = parseBoolean(value, 'NND_WATCH')))
  use('NND_RUNNER', (value) => {
    if (!RUNNERS.has(value as NndRunner)) {
      invalid(
        'Environment variable NND_RUNNER must be node or tsx.',
        {
          key: 'NND_RUNNER',
          value
        },
        'env'
      )
    }
    config.runner = value as NndRunner
  })
  use('NND_INSPECTOR_HOST', (value) => {
    if (!value.trim()) {
      invalid(
        'Environment variable NND_INSPECTOR_HOST cannot be empty.',
        {
          key: 'NND_INSPECTOR_HOST'
        },
        'env'
      )
    }
    config.inspector = { ...config.inspector, host: value }
  })
  use('NND_INSPECTOR_PORT', (value) => {
    config.inspector = { ...config.inspector, port: parsePort(value, 'NND_INSPECTOR_PORT') }
  })
  use('NND_REQUIRED_CAPABILITIES', (value) => {
    config.requiredCapabilities = parseCapabilities(value, 'NND_REQUIRED_CAPABILITIES')
  })
  use('NND_LEGACY_PORT', (value) => {
    config.legacy = { ...config.legacy, port: parsePort(value, 'NND_LEGACY_PORT') }
  })
  use('NND_LEGACY_SERVER_PORT', (value) => {
    config.legacy = {
      ...config.legacy,
      serverPort: parsePort(value, 'NND_LEGACY_SERVER_PORT')
    }
  })

  return { config, keys }
}

function mergeConfig(base: NndConfig, override: NndConfig): NndConfig {
  return {
    ...base,
    ...override,
    inspector:
      base.inspector || override.inspector
        ? { ...base.inspector, ...override.inspector }
        : undefined,
    session: override.session ?? base.session,
    legacy:
      base.legacy || override.legacy
        ? {
            ...base.legacy,
            ...override.legacy,
            intercept:
              base.legacy?.intercept || override.legacy?.intercept
                ? { ...base.legacy?.intercept, ...override.legacy?.intercept }
                : undefined,
            mock: override.legacy?.mock ?? base.legacy?.mock
          }
        : undefined
  }
}

function explicitKeys(config: NndConfig): string[] {
  const keys: string[] = []
  for (const key of [
    'mode',
    'open',
    'wait',
    'watch',
    'runner',
    'requiredCapabilities',
    'session'
  ] as const) {
    if (config[key] !== undefined) keys.push(key)
  }
  if (config.inspector !== undefined) keys.push('inspector')
  if (config.legacy !== undefined) keys.push('legacy')
  return keys
}

function finalize(config: NndConfig): ResolvedNndConfig {
  const merged = mergeConfig(DEFAULT_NND_CONFIG, config)
  return {
    mode: merged.mode!,
    open: merged.open!,
    wait: merged.wait!,
    watch: merged.watch!,
    runner: merged.runner!,
    inspector: {
      host: merged.inspector!.host!,
      port: merged.inspector!.port!
    },
    requiredCapabilities: [...(merged.requiredCapabilities ?? [])],
    ...(merged.session
      ? {
          session: {
            directory: merged.session.directory,
            ...(merged.session.bodyCommandTimeoutMs !== undefined
              ? { bodyCommandTimeoutMs: merged.session.bodyCommandTimeoutMs }
              : {}),
            ...(merged.session.har !== undefined ? { har: merged.session.har } : {})
          }
        }
      : {}),
    legacy: {
      ...(merged.legacy?.port !== undefined ? { port: merged.legacy.port } : {}),
      ...(merged.legacy?.serverPort !== undefined ? { serverPort: merged.legacy.serverPort } : {}),
      ...(merged.legacy?.intercept !== undefined
        ? { intercept: { ...merged.legacy.intercept } }
        : {}),
      ...(merged.legacy?.mock !== undefined ? { mock: [...merged.legacy.mock] } : {})
    }
  }
}

export async function resolveConfig(options: ResolveConfigOptions = {}): Promise<ConfigResolution> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const env = options.env ?? process.env
  const requestedConfig = options.configFile ?? env.NND_CONFIG
  const configPath =
    requestedConfig === false
      ? undefined
      : typeof requestedConfig === 'string' && requestedConfig !== ''
        ? resolveConfigPath(cwd, requestedConfig)
        : findConfigFile(cwd)
  const fileConfig = configPath ? await loadConfigFile(configPath) : {}
  const environment = configFromEnvironment(env)
  const cliConfig = options.cli ? validateConfig(options.cli) : {}
  const config = finalize(mergeConfig(mergeConfig(fileConfig, environment.config), cliConfig))

  return {
    config,
    sources: {
      ...(configPath ? { configFile: configPath } : {}),
      env: environment.keys,
      cli: explicitKeys(cliConfig)
    }
  }
}

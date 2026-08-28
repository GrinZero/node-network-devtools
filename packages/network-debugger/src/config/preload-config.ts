import type { RegisterOptions } from '../common'
import { NndConfigError } from './errors'
import type { ResolvedNndConfig } from './types'

export const NND_PRELOAD_CONFIG_ENV = 'NND_PRELOAD_CONFIG'

export function toRegisterOptions(config: ResolvedNndConfig): RegisterOptions {
  return {
    mode: config.mode,
    requiredCapabilities: config.requiredCapabilities,
    inspector: config.inspector,
    devtools: { open: false },
    ...(config.session ? { session: config.session } : {}),
    legacy: config.legacy
  }
}

export function serializePreloadConfig(config: ResolvedNndConfig): string {
  return JSON.stringify(config)
}

export function parsePreloadConfig(value: string): ResolvedNndConfig {
  try {
    const parsed = JSON.parse(value) as ResolvedNndConfig
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !['auto', 'native', 'legacy'].includes(parsed.mode) ||
      typeof parsed.open !== 'boolean' ||
      typeof parsed.wait !== 'boolean' ||
      typeof parsed.watch !== 'boolean' ||
      !['node', 'tsx'].includes(parsed.runner) ||
      !parsed.inspector ||
      typeof parsed.inspector.host !== 'string' ||
      !Number.isInteger(parsed.inspector.port) ||
      !Array.isArray(parsed.requiredCapabilities) ||
      (parsed.session !== undefined &&
        (!parsed.session ||
          typeof parsed.session !== 'object' ||
          typeof parsed.session.directory !== 'string' ||
          !parsed.session.directory.trim() ||
          (parsed.session.bodyCommandTimeoutMs !== undefined &&
            (!Number.isSafeInteger(parsed.session.bodyCommandTimeoutMs) ||
              parsed.session.bodyCommandTimeoutMs <= 0)) ||
          (parsed.session.har !== undefined &&
            typeof parsed.session.har !== 'boolean' &&
            (typeof parsed.session.har !== 'string' || !parsed.session.har.trim()))))
    ) {
      throw new Error('serialized configuration has an invalid shape')
    }
    return parsed
  } catch (error) {
    throw new NndConfigError(
      'NND_CONFIG_ENV_INVALID',
      `${NND_PRELOAD_CONFIG_ENV} does not contain a valid resolved configuration.`,
      { cause: error instanceof Error ? error.message : String(error) },
      error
    )
  }
}

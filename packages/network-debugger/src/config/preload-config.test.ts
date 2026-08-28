import { describe, expect, it } from 'vitest'
import { parsePreloadConfig, serializePreloadConfig, toRegisterOptions } from './preload-config'
import type { ResolvedNndConfig } from './types'

const config: ResolvedNndConfig = {
  mode: 'native',
  open: true,
  wait: false,
  watch: true,
  runner: 'tsx',
  inspector: { host: '127.0.0.1', port: 0 },
  requiredCapabilities: ['responseBody'],
  session: { directory: '.nnd/session', bodyCommandTimeoutMs: 2500, har: true },
  legacy: { port: 5000 }
}

describe('preload configuration transport', () => {
  it('round trips resolved config and excludes CLI-owned frontend opening', () => {
    expect(parsePreloadConfig(serializePreloadConfig(config))).toEqual(config)
    expect(toRegisterOptions(config)).toEqual({
      mode: 'native',
      requiredCapabilities: ['responseBody'],
      inspector: { host: '127.0.0.1', port: 0 },
      devtools: { open: false },
      session: { directory: '.nnd/session', bodyCommandTimeoutMs: 2500, har: true },
      legacy: { port: 5000 }
    })
  })

  it('reports malformed serialized environment values with a stable code', () => {
    expect(() => parsePreloadConfig('{')).toThrowError(
      expect.objectContaining({ code: 'NND_CONFIG_ENV_INVALID' })
    )
    expect(() => parsePreloadConfig(JSON.stringify({ mode: 'wat' }))).toThrowError(
      expect.objectContaining({ code: 'NND_CONFIG_ENV_INVALID' })
    )
    expect(() => parsePreloadConfig(JSON.stringify({ ...config, session: {} }))).toThrowError(
      expect.objectContaining({ code: 'NND_CONFIG_ENV_INVALID' })
    )
  })
})

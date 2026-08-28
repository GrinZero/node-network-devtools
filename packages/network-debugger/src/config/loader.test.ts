import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NndConfigError } from './errors'
import { findConfigFile, loadConfigFile, resolveConfig } from './loader'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'nnd-config-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('NND config loader', () => {
  it('merges defaults, file, environment, and CLI in documented precedence', async () => {
    const cwd = temporaryDirectory()
    writeFileSync(
      join(cwd, 'nnd.config.json'),
      JSON.stringify({
        mode: 'legacy',
        open: true,
        wait: false,
        runner: 'tsx',
        inspector: { host: 'file-host', port: 1111 },
        requiredCapabilities: ['requestBody'],
        session: { directory: '.nnd/session', har: true },
        legacy: { port: 5000, serverPort: 5001 }
      })
    )

    const result = await resolveConfig({
      cwd,
      env: {
        NND_MODE: 'native',
        NND_OPEN: 'false',
        NND_INSPECTOR_PORT: '2222',
        NND_WATCH: 'true'
      },
      cli: {
        mode: 'auto',
        wait: true,
        inspector: { host: 'cli-host' },
        requiredCapabilities: ['responseBody']
      }
    })

    expect(result.config).toEqual({
      mode: 'auto',
      open: false,
      wait: true,
      watch: true,
      runner: 'tsx',
      inspector: { host: 'cli-host', port: 2222 },
      requiredCapabilities: ['responseBody'],
      session: { directory: '.nnd/session', har: true },
      legacy: { port: 5000, serverPort: 5001 }
    })
    expect(result.sources.configFile).toBe(join(cwd, 'nnd.config.json'))
    expect(result.sources.env).toEqual(['NND_MODE', 'NND_OPEN', 'NND_WATCH', 'NND_INSPECTOR_PORT'])
    expect(result.sources.cli).toEqual(['mode', 'wait', 'requiredCapabilities', 'inspector'])
  })

  it('loads mjs, cjs, and json configuration files', async () => {
    const cwd = temporaryDirectory()
    const mjs = join(cwd, 'one.mjs')
    const cjs = join(cwd, 'two.cjs')
    const json = join(cwd, 'three.json')
    writeFileSync(mjs, 'export default { mode: "native", open: true }\n')
    writeFileSync(cjs, 'module.exports = { runner: "tsx", watch: true }\n')
    writeFileSync(json, JSON.stringify({ inspector: { port: 42 } }))

    await expect(loadConfigFile(mjs)).resolves.toMatchObject({ mode: 'native', open: true })
    await expect(loadConfigFile(cjs)).resolves.toMatchObject({ runner: 'tsx', watch: true })
    await expect(loadConfigFile(json)).resolves.toMatchObject({ inspector: { port: 42 } })
  })

  it('discovers config names deterministically and supports explicit nested paths', async () => {
    const cwd = temporaryDirectory()
    writeFileSync(join(cwd, 'nnd.config.json'), '{}')
    writeFileSync(join(cwd, 'nnd.config.cjs'), 'module.exports = {}\n')
    writeFileSync(join(cwd, 'nnd.config.mjs'), 'export default {}\n')
    expect(findConfigFile(cwd)).toBe(join(cwd, 'nnd.config.mjs'))

    const nested = join(cwd, 'configs')
    mkdirSync(nested)
    writeFileSync(join(nested, 'custom.json'), JSON.stringify({ mode: 'legacy' }))
    await expect(
      resolveConfig({ cwd, env: {}, configFile: 'configs/custom.json' })
    ).resolves.toMatchObject({ config: { mode: 'legacy' } })
  })

  it('can disable file discovery', async () => {
    const cwd = temporaryDirectory()
    writeFileSync(join(cwd, 'nnd.config.json'), JSON.stringify({ open: true }))
    const result = await resolveConfig({ cwd, env: {}, configFile: false })
    expect(result.config.open).toBe(false)
    expect(result.sources.configFile).toBeUndefined()
  })

  it('preserves serializable Legacy mock rules and rejects ambiguous bodies', async () => {
    const cwd = temporaryDirectory()
    const configPath = join(cwd, 'mock.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        mode: 'auto',
        legacy: {
          mock: [
            {
              match: { url: 'https://example.test/*', method: 'POST' },
              response: { status: 201, bodyBase64: 'AAEC/w==' }
            }
          ]
        }
      })
    )
    await expect(resolveConfig({ cwd, env: {}, configFile: configPath })).resolves.toMatchObject({
      config: {
        legacy: {
          mock: [
            {
              match: { url: 'https://example.test/*', method: 'POST' },
              response: { status: 201, bodyBase64: 'AAEC/w==' }
            }
          ]
        }
      }
    })

    writeFileSync(
      configPath,
      JSON.stringify({
        legacy: {
          mock: [{ match: { url: '*' }, response: { body: 'text', bodyBase64: 'dGV4dA==' } }]
        }
      })
    )
    await expect(loadConfigFile(configPath)).rejects.toMatchObject({
      code: 'NND_CONFIG_INVALID'
    })
  })

  it('uses stable actionable errors for missing, invalid, and malformed config', async () => {
    const cwd = temporaryDirectory()
    await expect(loadConfigFile(join(cwd, 'missing.json'))).rejects.toMatchObject({
      code: 'NND_CONFIG_NOT_FOUND'
    })

    writeFileSync(join(cwd, 'bad.json'), '{ nope')
    await expect(loadConfigFile(join(cwd, 'bad.json'))).rejects.toMatchObject({
      code: 'NND_CONFIG_LOAD_FAILED'
    })

    writeFileSync(join(cwd, 'shape.json'), JSON.stringify({ runner: 'deno' }))
    await expect(loadConfigFile(join(cwd, 'shape.json'))).rejects.toMatchObject({
      code: 'NND_CONFIG_INVALID'
    })

    await expect(
      resolveConfig({ cwd, configFile: false, env: { NND_OPEN: 'maybe' } })
    ).rejects.toBeInstanceOf(NndConfigError)
    await expect(
      resolveConfig({ cwd, configFile: false, env: { NND_OPEN: 'maybe' } })
    ).rejects.toMatchObject({
      code: 'NND_CONFIG_ENV_INVALID'
    })
  })
})

import { describe, expect, it } from 'vitest'
import { parseCliArgs } from './args'

describe('CLI argument parsing', () => {
  it('parses the documented dev syntax and preserves application arguments', () => {
    expect(
      parseCliArgs([
        'dev',
        '--open',
        '--no-wait',
        '--watch',
        '--runner',
        'tsx',
        '--mode=native',
        '--inspect-port',
        '0',
        '--require=responseBody',
        'src/app.ts',
        '--',
        '--port',
        '3000'
      ])
    ).toEqual({
      command: 'dev',
      entry: 'src/app.ts',
      applicationArgs: ['--port', '3000'],
      config: {
        open: true,
        wait: false,
        watch: true,
        runner: 'tsx',
        mode: 'native',
        inspector: { port: 0 },
        requiredCapabilities: ['responseBody']
      }
    })
  })

  it('parses doctor JSON, config, and bounded probe wait', () => {
    expect(
      parseCliArgs([
        'doctor',
        '--json',
        '--probe-wait=1500',
        '--config',
        'custom.mjs',
        '--mode',
        'legacy'
      ])
    ).toEqual({
      command: 'doctor',
      json: true,
      probeWaitMs: 1500,
      configFile: 'custom.mjs',
      config: { mode: 'legacy' }
    })
  })

  it('returns help and version commands', () => {
    expect(parseCliArgs([])).toEqual({ command: 'help' })
    expect(parseCliArgs(['--version'])).toEqual({ command: 'version' })
  })

  it('parses replay dry-run and execution controls', () => {
    expect(
      parseCliArgs([
        'replay',
        '--dry-run',
        '--json',
        '--stop-on-error',
        '--timeout=2500',
        '.nnd/session'
      ])
    ).toEqual({
      command: 'replay',
      source: '.nnd/session',
      dryRun: true,
      stopOnError: true,
      timeoutMs: 2500,
      json: true
    })
  })

  it('uses stable errors for missing entries and invalid flags', () => {
    expect(() => parseCliArgs(['dev', '--open'])).toThrowError(
      expect.objectContaining({ code: 'NND_CLI_USAGE' })
    )
    expect(() => parseCliArgs(['dev', '--runner', 'bun', 'app.js'])).toThrowError(
      expect.objectContaining({ code: 'NND_CLI_INVALID_OPTION' })
    )
    expect(() => parseCliArgs(['doctor', '--probe-wait', '-1'])).toThrowError(
      expect.objectContaining({ code: 'NND_CLI_INVALID_OPTION' })
    )
    expect(() => parseCliArgs(['replay', '--dry-run'])).toThrowError(
      expect.objectContaining({ code: 'NND_CLI_USAGE' })
    )
  })
})

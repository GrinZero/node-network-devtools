import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import type { DevtoolsTarget } from '../adapters/types'
import type { ResolvedNndConfig } from '../config'
import { NND_PRELOAD_CONFIG_ENV } from '../config'
import { NND_READY_PREFIX } from '../preload'
import {
  InspectorUrlParser,
  ReadyMessageParser,
  buildDevCommand,
  runDevCommand,
  shouldLaunchInspector,
  type DevCommand
} from './dev'

function config(overrides: Partial<ResolvedNndConfig> = {}): ResolvedNndConfig {
  return {
    mode: 'auto',
    open: false,
    wait: true,
    watch: false,
    runner: 'node',
    inspector: { host: '127.0.0.1', port: 0 },
    requiredCapabilities: [],
    legacy: {},
    ...overrides
  }
}

function fakeChild() {
  const child = new EventEmitter() as ChildProcess
  Object.assign(child, {
    stderr: new PassThrough(),
    kill: vi.fn(() => true)
  })
  return child
}

const target = (url: string): DevtoolsTarget => ({
  id: url.split('/').at(-1)!,
  title: 'target',
  type: 'node',
  url: '',
  webSocketDebuggerUrl: url,
  discoveryUrl: 'http://127.0.0.1/json/list',
  devtoolsFrontendUrl: `devtools://devtools/bundled/inspector.html?ws=${url.slice(5)}`
})

function command(overrides: Partial<DevCommand> = {}): DevCommand {
  return {
    executable: '/node',
    args: ['app.js'],
    cwd: '/project',
    env: {},
    open: false,
    wait: false,
    ...overrides
  }
}

const nativeRuntime = {
  nodeVersion: '24.7.0',
  inspectorAvailable: true,
  inspectorNetwork: {
    requestWillBeSent: vi.fn(),
    responseReceived: vi.fn(),
    loadingFinished: vi.fn(),
    loadingFailed: vi.fn()
  }
} as const

describe('dev command construction', () => {
  it('injects native flags and the absolute preload URL without changing NODE_OPTIONS', () => {
    const built = buildDevCommand({
      entry: 'src/app.ts',
      applicationArgs: ['--port', '3000'],
      config: config({ open: true, watch: true, runner: 'tsx' }),
      cwd: '/project',
      env: { NODE_OPTIONS: '--trace-warnings' },
      execPath: '/usr/bin/node',
      preloadUrl: 'file:///package/dist/register.mjs',
      ...nativeRuntime
    })

    expect(built).toMatchObject({
      executable: '/usr/bin/node',
      cwd: '/project',
      open: true,
      wait: true
    })
    expect(built.args).toEqual([
      '--experimental-network-inspection',
      '--inspect-wait=127.0.0.1:0',
      '--watch',
      '--import=file:///package/dist/register.mjs',
      '--import=tsx',
      'src/app.ts',
      '--port',
      '3000'
    ])
    expect(built.env.NODE_OPTIONS).toBe('--trace-warnings')
    expect(built.env.NODE_OPTIONS).not.toContain('experimental-network-inspection')
    expect(JSON.parse(built.env[NND_PRELOAD_CONFIG_ENV]!)).toMatchObject({ mode: 'auto' })
  })

  it('uses --inspect for no-wait and omits all Inspector flags for forced Legacy', () => {
    expect(
      buildDevCommand({
        entry: 'app.js',
        config: config({ wait: false }),
        preloadUrl: 'file:///register.mjs',
        ...nativeRuntime
      }).args
    ).toEqual([
      '--experimental-network-inspection',
      '--inspect=127.0.0.1:0',
      '--import=file:///register.mjs',
      'app.js'
    ])

    const legacy = buildDevCommand({
      entry: 'app.js',
      config: config({ mode: 'legacy', wait: true }),
      preloadUrl: 'file:///register.mjs'
    })
    expect(legacy.args).toEqual(['--import=file:///register.mjs', 'app.js'])
    expect(legacy.wait).toBe(false)
  })

  it('starts Auto directly on Legacy when the native baseline or requirements are unmet', () => {
    const oldRuntime = buildDevCommand({
      entry: 'app.js',
      config: config(),
      nodeVersion: '18.20.8',
      preloadUrl: 'file:///register.mjs'
    })
    expect(oldRuntime.args).toEqual(['--import=file:///register.mjs', 'app.js'])
    expect(oldRuntime.wait).toBe(false)

    const missingCapability = buildDevCommand({
      entry: 'app.js',
      config: config({ requiredCapabilities: ['requestBody'] }),
      nodeVersion: '24.16.0',
      inspectorNetwork: {
        requestWillBeSent: vi.fn(),
        responseReceived: vi.fn(),
        loadingFinished: vi.fn(),
        loadingFailed: vi.fn(),
        dataReceived: vi.fn()
      },
      preloadUrl: 'file:///register.mjs'
    })
    expect(missingCapability.args).toEqual(['--import=file:///register.mjs', 'app.js'])
    expect(missingCapability.wait).toBe(false)
  })

  it('uses the shared Native Auto baseline at Node 18/20/24.6/24.7 boundaries', () => {
    const network = {
      requestWillBeSent: vi.fn(),
      responseReceived: vi.fn(),
      loadingFinished: vi.fn(),
      loadingFailed: vi.fn(),
      dataReceived: vi.fn()
    }
    for (const nodeVersion of ['18.20.8', '20.19.5', '24.6.0']) {
      expect(shouldLaunchInspector(config(), { nodeVersion, inspectorNetwork: network })).toBe(
        false
      )
    }
    expect(
      shouldLaunchInspector(config(), {
        nodeVersion: '24.7.0',
        inspectorNetwork: network,
        inspectorAvailable: true
      })
    ).toBe(true)
    expect(
      shouldLaunchInspector(config(), {
        nodeVersion: '24.7.0',
        inspectorNetwork: network,
        inspectorAvailable: false
      })
    ).toBe(false)
  })

  it('rejects forced Native before spawn when the runtime does not recognize the flag', () => {
    for (const nodeVersion of ['18.20.8', '20.17.0', '21.7.3', '22.5.1']) {
      expect(() =>
        buildDevCommand({
          entry: 'app.js',
          config: config({ mode: 'native' }),
          nodeVersion,
          preloadUrl: 'file:///register.mjs'
        })
      ).toThrowError(
        expect.objectContaining({
          code: 'NND_CLI_NATIVE_UNSUPPORTED',
          message: expect.stringContaining('use --mode auto/legacy')
        })
      )
    }
  })

  it('injects forced Native flags at the Node 20.18 and 22.6 support boundaries', () => {
    for (const nodeVersion of ['20.18.0', '22.6.0']) {
      const native = buildDevCommand({
        entry: 'app.js',
        config: config({ mode: 'native' }),
        nodeVersion,
        preloadUrl: 'file:///register.mjs'
      })
      expect(native.args.slice(0, 2)).toEqual([
        '--experimental-network-inspection',
        '--inspect-wait=127.0.0.1:0'
      ])
    }
  })
})

describe('stderr protocol parsers', () => {
  it('waits for a complete Debugger listening line across chunks', () => {
    const parser = new InspectorUrlParser()
    expect(parser.push('Debugger listening on ws://127.0.0.1:1234/')).toEqual([])
    expect(parser.push('abc\nFor help, see docs\n')).toEqual(['ws://127.0.0.1:1234/abc'])
    expect(
      parser.push(`${NND_READY_PREFIX}{"target":{"webSocketDebuggerUrl":"ws://wrong"}}\n`)
    ).toEqual([])
  })

  it('parses split ready messages and ignores malformed data', () => {
    const parser = new ReadyMessageParser()
    const ready = {
      mode: 'legacy',
      target: target('ws://127.0.0.1:5271'),
      capabilities: { http: true }
    }
    const line = `${NND_READY_PREFIX}${JSON.stringify(ready)}\n`
    expect(parser.push(line.slice(0, 20))).toEqual([])
    expect(parser.push(line.slice(20))).toEqual([ready])
    expect(parser.push(`${NND_READY_PREFIX}{nope}\n`)).toEqual([])
  })
})

describe('dev child lifecycle', () => {
  it('forwards parent signals, maps signal exit codes, and removes listeners', async () => {
    const child = fakeChild()
    const signals = new EventEmitter()
    const result = runDevCommand(command(), {
      spawn: vi.fn(() => child),
      stderr: { write: vi.fn(() => true) },
      signals
    })

    signals.emit('SIGINT')
    expect(child.kill).toHaveBeenCalledWith('SIGINT')
    child.emit('exit', null, 'SIGINT')
    await expect(result).resolves.toBe(130)
    expect(signals.listenerCount('SIGINT')).toBe(0)
    expect(signals.listenerCount('SIGTERM')).toBe(0)
    expect(signals.listenerCount('SIGHUP')).toBe(0)
  })

  it('prints an actionable status when default wait has no automatic frontend', async () => {
    const child = fakeChild()
    const stderr = { write: vi.fn(() => true) }
    const result = runDevCommand(command({ wait: true }), {
      spawn: vi.fn(() => child),
      stderr,
      signals: new EventEmitter()
    })
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('NND_WAITING_FOR_FRONTEND'))
    child.emit('exit', 0, null)
    await expect(result).resolves.toBe(0)
  })

  it('opens the preliminary waiting target once, then a different fallback ready target', async () => {
    const child = fakeChild()
    const openInspector = vi.fn(async () => undefined)
    const openTarget = vi.fn(async () => undefined)
    const result = runDevCommand(command({ open: true, wait: true }), {
      spawn: vi.fn(() => child),
      stderr: { write: vi.fn(() => true) },
      signals: new EventEmitter(),
      openInspector,
      openTarget
    })
    const nativeUrl = 'ws://127.0.0.1:1234/native'
    child.stderr!.emit('data', `Debugger listening on ${nativeUrl}\n`)
    child.stderr!.emit(
      'data',
      `${NND_READY_PREFIX}${JSON.stringify({
        mode: 'native',
        target: target(nativeUrl),
        capabilities: { http: true }
      })}\n`
    )
    const legacyTarget = target('ws://127.0.0.1:5271/legacy')
    child.stderr!.emit(
      'data',
      `${NND_READY_PREFIX}${JSON.stringify({
        mode: 'legacy',
        target: legacyTarget,
        capabilities: { http: true }
      })}\n`
    )

    await Promise.resolve()
    expect(openInspector).toHaveBeenCalledTimes(1)
    expect(openInspector).toHaveBeenCalledWith(nativeUrl)
    expect(openTarget).toHaveBeenCalledTimes(1)
    expect(openTarget).toHaveBeenCalledWith(legacyTarget)
    child.emit('exit', 0, null)
    await expect(result).resolves.toBe(0)
  })

  it('opens only the authoritative ready target in Legacy/no-wait mode', async () => {
    const child = fakeChild()
    const openInspector = vi.fn(async () => undefined)
    const openTarget = vi.fn(async () => undefined)
    const result = runDevCommand(command({ open: true, wait: false }), {
      spawn: vi.fn(() => child),
      stderr: { write: vi.fn(() => true) },
      signals: new EventEmitter(),
      openInspector,
      openTarget
    })
    const readyTarget = target('ws://127.0.0.1:5271/legacy')
    child.stderr!.emit('data', `Debugger listening on ws://127.0.0.1:1234/native\n`)
    child.stderr!.emit(
      'data',
      `${NND_READY_PREFIX}${JSON.stringify({
        mode: 'legacy',
        target: readyTarget,
        capabilities: { http: true }
      })}\n`
    )
    await Promise.resolve()

    expect(openInspector).not.toHaveBeenCalled()
    expect(openTarget).toHaveBeenCalledWith(readyTarget)
    child.emit('exit', 0, null)
    await expect(result).resolves.toBe(0)
  })

  it('returns one and terminates the child when frontend launch fails', async () => {
    const child = fakeChild()
    const result = runDevCommand(command({ open: true, wait: false }), {
      spawn: vi.fn(() => child),
      stderr: { write: vi.fn(() => true) },
      signals: new EventEmitter(),
      openTarget: vi.fn(async () => {
        throw new Error('browser failed')
      })
    })
    child.stderr!.emit(
      'data',
      `${NND_READY_PREFIX}${JSON.stringify({
        mode: 'native',
        target: target('ws://127.0.0.1:1234/native'),
        capabilities: { http: true }
      })}\n`
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.emit('exit', null, 'SIGTERM')
    await expect(result).resolves.toBe(1)
  })
})

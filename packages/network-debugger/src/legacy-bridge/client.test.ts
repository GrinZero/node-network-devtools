import { EventEmitter } from 'node:events'
import type { ChildProcess, ForkOptions } from 'node:child_process'
import { describe, expect, test, vi } from 'vitest'
import type { DevtoolsTarget } from '../adapters/types'
import type { LegacyCaptureEvent, LegacyChildMessage } from './contracts'
import {
  LEGACY_BRIDGE_OPTIONS_ENV,
  LegacyBridgeClient,
  sanitizeLegacyEnvironment,
  sanitizeLegacyExecArgv,
  tokenizeNodeOptions
} from './client'

class FakeChild extends EventEmitter {
  pid = 42_000
  connected = true
  killed = false
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly sent: unknown[] = []
  readonly signals: Array<NodeJS.Signals | number | undefined> = []
  readonly sendCallbacks: Array<(error: Error | null) => void> = []
  refCalls = 0
  unrefCalls = 0
  channelRefCalls = 0
  channelUnrefCalls = 0
  readonly channel = {
    ref: () => {
      this.channelRefCalls += 1
    },
    unref: () => {
      this.channelUnrefCalls += 1
    }
  }

  constructor(
    private readonly autoDisposeAck = true,
    private readonly manualSendCallbacks = false
  ) {
    super()
  }

  send(message: unknown, callback?: (error: Error | null) => void): boolean {
    if (!this.connected) throw new Error('disconnected')
    this.sent.push(message)
    if (
      this.autoDisposeAck &&
      message &&
      typeof message === 'object' &&
      'type' in message &&
      (message as { type: unknown }).type === 'dispose'
    ) {
      queueMicrotask(() => {
        this.emit('message', { type: 'disposed' } satisfies LegacyChildMessage)
        this.exitCode = 0
        this.emit('exit', 0, null)
      })
    }
    if (callback) {
      this.sendCallbacks.push(callback)
      if (!this.manualSendCallbacks) queueMicrotask(() => callback(null))
    }
    return true
  }

  disconnect(): void {
    this.connected = false
  }

  ref(): void {
    this.refCalls += 1
  }

  unref(): void {
    this.unrefCalls += 1
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.signals.push(signal)
    this.killed = true
    this.connected = false
    if (signal === 'SIGKILL') {
      this.signalCode = 'SIGKILL'
      queueMicrotask(() => this.emit('exit', null, 'SIGKILL'))
    }
    return true
  }

  child(): ChildProcess {
    return this as unknown as ChildProcess
  }
}

function target(port: number): DevtoolsTarget {
  return {
    id: 'legacy',
    title: 'Legacy',
    type: 'node',
    url: '',
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/legacy`,
    discoveryUrl: `http://127.0.0.1:${port}/json/list`
  }
}

function ready(child: FakeChild, port: number): void {
  child.emit('message', { type: 'ready', target: target(port) } satisfies LegacyChildMessage)
}

function harness(
  overrides: {
    maxRestarts?: number
    queueLimit?: number
    autoDisposeAck?: boolean
    shutdownGraceMs?: number
    shutdownForceMs?: number
    recoveryForceKillMs?: number
    manualSendCallbacks?: boolean
  } = {}
) {
  const children: FakeChild[] = []
  const calls: Array<{ modulePath: string; args: string[]; options: ForkOptions }> = []
  const fork = vi.fn((modulePath: string, args: string[], options: ForkOptions) => {
    const child = new FakeChild(overrides.autoDisposeAck, overrides.manualSendCallbacks)
    children.push(child)
    calls.push({ modulePath, args, options })
    return child.child()
  })
  const client = new LegacyBridgeClient(
    { host: '127.0.0.1', targetPort: 0 },
    {
      fork,
      childEntry: '/fixture/fork.js',
      execArgv: [
        '--inspect-wait=127.0.0.1:0',
        '--experimental-network-inspection',
        '--watch',
        '--import=/project/dist/register.mjs',
        '--import',
        'safe-observer',
        '--max-old-space-size=2048'
      ],
      env: {
        NODE_OPTIONS: '--trace-warnings --import="/project/dist/register.mjs" --require safe-hook'
      },
      maxRestarts: overrides.maxRestarts,
      queueLimit: overrides.queueLimit,
      shutdownGraceMs: overrides.shutdownGraceMs,
      shutdownForceMs: overrides.shutdownForceMs,
      recoveryForceKillMs: overrides.recoveryForceKillMs
    }
  )
  return { client, children, calls, fork }
}

describe('LegacyBridgeClient', () => {
  test('forks synchronously with advanced IPC and sanitized child flags/environment', async () => {
    const { client, children, calls } = harness()

    expect(children).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      modulePath: '/fixture/fork.js',
      args: [],
      options: {
        serialization: 'advanced',
        execArgv: ['--import', 'safe-observer', '--max-old-space-size=2048'],
        stdio: ['inherit', 'inherit', 'inherit', 'ipc']
      }
    })
    expect(calls[0].options.env?.NODE_OPTIONS).toBe('--trace-warnings --require safe-hook')
    expect(JSON.parse(calls[0].options.env?.[LEGACY_BRIDGE_OPTIONS_ENV] ?? '{}')).toMatchObject({
      host: '127.0.0.1',
      targetPort: 0
    })
    await client.dispose()
  })

  test('queues an immutable first event until ready and preserves Buffer values', async () => {
    const { client, children } = harness()
    const rawData = Buffer.from('original')
    const event: LegacyCaptureEvent = {
      type: 'responseData',
      data: { id: 'request-1', rawData, statusCode: 200, headers: {} }
    }

    await client.send(event)
    rawData.fill(0)
    expect(children[0].sent).toEqual([])

    ready(children[0], 43101)
    await expect(client.ready).resolves.toMatchObject({ webSocketDebuggerUrl: expect.any(String) })
    expect(children[0].sent).toHaveLength(1)
    const sent = children[0].sent[0] as {
      type: 'capture'
      event: Extract<LegacyCaptureEvent, { type: 'responseData' }>
    }
    expect(sent.type).toBe('capture')
    expect(Buffer.isBuffer(sent.event.data.rawData)).toBe(true)
    expect(sent.event.data.rawData.toString()).toBe('original')
    await client.dispose()
  })

  test('releases ready child references and restores them for explicit disposal', async () => {
    const { client, children } = harness()
    const child = children[0]

    expect(child.unrefCalls).toBe(0)
    expect(child.channelUnrefCalls).toBe(0)
    ready(child, 43108)
    await client.ready
    expect(child.unrefCalls).toBe(1)
    expect(child.channelUnrefCalls).toBe(1)

    const disposing = client.dispose()
    expect(child.refCalls).toBe(1)
    expect(child.channelRefCalls).toBe(1)
    await disposing
  })

  test('bounds startup capture while preserving the earliest request event', async () => {
    const { client, children } = harness({ queueLimit: 1 })
    const diagnostics: string[] = []
    client.onDiagnostic((diagnostic) => diagnostics.push(diagnostic.code))
    const first = { type: 'initRequest', data: { id: 'first' } } as LegacyCaptureEvent
    const overflow = { type: 'initRequest', data: { id: 'overflow' } } as LegacyCaptureEvent

    await client.send(first)
    await client.send(overflow)
    ready(children[0], 43102)

    const sent = children[0].sent[0] as { event: { data: { id: string } } }
    expect(sent.event.data.id).toBe('first')
    expect(diagnostics).toContain('NND_LEGACY_CAPTURE_QUEUE_FULL')
    await client.dispose()
  })

  test('recovers on the original target port and flushes events captured during restart', async () => {
    const { client, children, calls } = harness()
    const diagnostics: string[] = []
    client.onDiagnostic((diagnostic) => diagnostics.push(diagnostic.code))
    ready(children[0], 43103)
    await client.ready

    children[0].emit('exit', 1, null)
    expect(children).toHaveLength(2)
    expect(JSON.parse(calls[1].options.env?.[LEGACY_BRIDGE_OPTIONS_ENV] ?? '{}').targetPort).toBe(
      43103
    )
    expect(JSON.parse(calls[1].options.env?.[LEGACY_BRIDGE_OPTIONS_ENV] ?? '{}').targetId).toBe(
      JSON.parse(calls[0].options.env?.[LEGACY_BRIDGE_OPTIONS_ENV] ?? '{}').targetId
    )
    await client.send({ type: 'initRequest', data: { id: 'during-restart' } } as LegacyCaptureEvent)
    expect(children[1].sent).toEqual([])

    ready(children[1], 43103)
    expect((children[1].sent[0] as any).event.data.id).toBe('during-restart')
    expect(diagnostics).toEqual(
      expect.arrayContaining(['NND_LEGACY_CHILD_RESTARTING', 'NND_LEGACY_CHILD_RECOVERED'])
    )
    await client.dispose()
  })

  test('waits for an errored child to exit before rebinding instead of exhausting retries', async () => {
    const { client, children, calls } = harness({ recoveryForceKillMs: 50 })
    ready(children[0], 43106)
    await client.ready
    const first = children[0]

    first.emit('error', new Error('ipc failure while process is still alive'))
    expect(first.signals).toEqual(['SIGTERM'])
    expect(children).toHaveLength(1)
    await client.send({
      type: 'initRequest',
      data: { id: 'held-until-exit' }
    } as LegacyCaptureEvent)

    first.emit('exit', 1, null)
    expect(children).toHaveLength(2)
    expect(JSON.parse(calls[1].options.env?.[LEGACY_BRIDGE_OPTIONS_ENV] ?? '{}').targetPort).toBe(
      43106
    )
    expect(children[1].sent).toEqual([])
    ready(children[1], 43106)
    expect((children[1].sent[0] as any).event.data.id).toBe('held-until-exit')
    await client.dispose()
  })

  test('requeues async send callback failures in order and starts only one recovery', async () => {
    const { client, children } = harness({
      manualSendCallbacks: true,
      recoveryForceKillMs: 50
    })
    const diagnostics: string[] = []
    client.onDiagnostic((diagnostic) => diagnostics.push(diagnostic.code))
    ready(children[0], 43107)
    await client.ready
    const first = children[0]

    await client.send({ type: 'initRequest', data: { id: 'send-a' } } as LegacyCaptureEvent)
    await client.send({ type: 'initRequest', data: { id: 'send-b' } } as LegacyCaptureEvent)
    expect(first.sendCallbacks).toHaveLength(2)

    first.sendCallbacks[0](new Error('first async send failed'))
    first.sendCallbacks[1](new Error('second async send failed'))
    expect(first.signals).toEqual(['SIGTERM'])
    expect(first.listenerCount('exit')).toBe(1)
    expect(children).toHaveLength(1)

    first.emit('exit', 1, null)
    expect(children).toHaveLength(2)
    expect(diagnostics.filter((code) => code === 'NND_LEGACY_CHILD_RESTARTING')).toHaveLength(1)
    ready(children[1], 43107)
    const replayedIds = children[1].sent
      .filter((message: any) => message.type === 'capture')
      .map((message: any) => message.event.data.id)
    expect(replayedIds).toEqual(['send-a', 'send-b'])
    await client.dispose()
  })

  test('rejects initial ready after exactly three bounded restart attempts', async () => {
    const { client, children } = harness({ maxRestarts: 3 })
    const diagnostics: string[] = []
    const onFailure = vi.fn()
    client.onDiagnostic((diagnostic) => diagnostics.push(diagnostic.code))
    client.onFailure(onFailure)
    for (let index = 0; index < 4; index += 1) {
      children[index].emit('exit', 1, null)
    }

    expect(children).toHaveLength(4)
    await expect(client.ready).rejects.toMatchObject({
      code: 'NND_LEGACY_CHILD_START_FAILED'
    })
    expect(diagnostics.filter((code) => code === 'NND_LEGACY_CHILD_RESTARTING')).toHaveLength(3)
    expect(diagnostics.at(-1)).toBe('NND_LEGACY_CHILD_START_FAILED')
    expect(onFailure).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NND_LEGACY_CHILD_START_FAILED' })
    )
    const replayedFailure = vi.fn()
    client.onFailure(replayedFailure)
    expect(replayedFailure).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NND_LEGACY_CHILD_START_FAILED' })
    )
  })

  test('forwards and replays structured diagnostics reported by the child', async () => {
    const { client, children } = harness()
    children[0].emit('message', {
      type: 'diagnostic',
      diagnostic: {
        code: 'NND_LEGACY_CHILD_NOTICE',
        level: 'warn',
        message: 'child notice',
        details: { generation: 1 }
      }
    } satisfies LegacyChildMessage)

    const listener = vi.fn()
    client.onDiagnostic(listener)
    expect(listener).toHaveBeenCalledWith({
      code: 'NND_LEGACY_CHILD_NOTICE',
      level: 'warn',
      message: 'child notice',
      details: { generation: 1 }
    })
    await client.dispose()
  })

  test('never silently accepts a changed target during recovery', async () => {
    const { client, children } = harness({ maxRestarts: 1 })
    const diagnostics: string[] = []
    const onFailure = vi.fn()
    client.onDiagnostic((diagnostic) => diagnostics.push(diagnostic.code))
    client.onFailure(onFailure)
    ready(children[0], 43104)
    await client.ready
    children[0].emit('exit', 1, null)

    ready(children[1], 43105)
    // A mismatched child must fully exit before the fixed port can be retried.
    children[1].emit('exit', 1, null)
    expect(children).toHaveLength(2)
    expect(diagnostics).toEqual(
      expect.arrayContaining(['NND_LEGACY_TARGET_CHANGED', 'NND_LEGACY_CHILD_RECOVERY_FAILED'])
    )
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NND_LEGACY_CHILD_RECOVERY_FAILED' })
    )
    await client.dispose()
  })

  test('dispose clears queued work/listeners and cannot trigger a restart', async () => {
    const { client, children } = harness()
    await client.send({ type: 'initRequest', data: { id: 'queued' } } as LegacyCaptureEvent)
    const first = children[0]

    await client.dispose()
    expect(first.sent).toContainEqual({ type: 'dispose' })
    expect(first.connected).toBe(false)
    expect(first.signals).toEqual([])
    expect(first.listenerCount('message')).toBe(0)
    first.emit('exit', 1, null)
    await client.send({ type: 'initRequest', data: { id: 'ignored' } } as LegacyCaptureEvent)
    expect(children).toHaveLength(1)
  })

  test('uses bounded SIGTERM/SIGKILL fallback and waits for child exit without an ack', async () => {
    const { client, children } = harness({
      autoDisposeAck: false,
      shutdownGraceMs: 5,
      shutdownForceMs: 10
    })
    const first = children[0]

    let resolved = false
    const disposing = client.dispose().then(() => {
      resolved = true
    })
    first.emit('disconnect')
    await Promise.resolve()
    expect(resolved).toBe(false)
    await disposing

    expect(first.sent).toContainEqual({ type: 'dispose' })
    expect(first.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(first.listenerCount('exit')).toBe(0)
    expect(first.listenerCount('message')).toBe(0)
  })
})

describe('Legacy child option sanitization', () => {
  test('removes inspector/watch/project preload/tsx while keeping unrelated flags', () => {
    expect(
      sanitizeLegacyExecArgv([
        '--inspect',
        '--inspect-port',
        '9229',
        '--experimental-network-inspection',
        '--watch-path=src',
        '--watch-kill-signal',
        'SIGTERM',
        '--import=node-network-devtools/register',
        '--loader',
        'tsx',
        '--require=safe-hook',
        '--trace-warnings'
      ])
    ).toEqual(['--require=safe-hook', '--trace-warnings'])
  })

  test('tokenizes quoted NODE_OPTIONS and sanitizes a copy without mutating the parent', () => {
    const env = {
      NODE_OPTIONS: '--import="/some path/dist/register.mjs" --require "safe hook"'
    }
    expect(tokenizeNodeOptions(env.NODE_OPTIONS)).toEqual([
      '--import=/some path/dist/register.mjs',
      '--require',
      'safe hook'
    ])
    const child = sanitizeLegacyEnvironment(env)
    expect(child.NODE_OPTIONS).toBe('--require "safe hook"')
    expect(env.NODE_OPTIONS).toContain('register.mjs')
  })

  test.each([
    [['-e', 'console.log("short eval")', '--trace-warnings']],
    [['--eval', 'console.log("long eval")', '--trace-warnings']],
    [['-e=console.log("equals eval")', '--trace-warnings']],
    [['--eval=console.log("equals eval")', '--trace-warnings']],
    [['-econsole.log("attached eval")', '--trace-warnings']],
    [['-p', 'process.version', '--trace-warnings']],
    [['--print', 'process.version', '--trace-warnings']],
    [['-p=process.version', '--trace-warnings']],
    [['--print=process.version', '--trace-warnings']],
    [['-pprocess.version', '--trace-warnings']],
    [['--input-type', 'module', '--trace-warnings']],
    [['--input-type=module', '--trace-warnings']]
  ])('removes parent-only string input options from %j', (execArgv) => {
    expect(sanitizeLegacyExecArgv(execArgv)).toEqual(['--trace-warnings'])
  })

  test('preserves Windows path separators while still handling quoted spaces', () => {
    const nodeOptions = String.raw`--require="C:\Program Files\safe\hook.cjs" --import=C:\repo\node-network-devtools\dist\register.mjs --trace-warnings`
    expect(tokenizeNodeOptions(nodeOptions)).toEqual([
      String.raw`--require=C:\Program Files\safe\hook.cjs`,
      String.raw`--import=C:\repo\node-network-devtools\dist\register.mjs`,
      '--trace-warnings'
    ])

    const child = sanitizeLegacyEnvironment({ NODE_OPTIONS: nodeOptions })
    expect(child.NODE_OPTIONS).not.toContain('register.mjs')
    expect(tokenizeNodeOptions(child.NODE_OPTIONS ?? '')).toEqual([
      String.raw`--require=C:\Program Files\safe\hook.cjs`,
      '--trace-warnings'
    ])
  })
})

import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'
import type { RequestCenter } from '../fork/request-center'
import type { DevtoolsTarget } from '../adapters/types'
import type { LegacyBridgeHostProcess } from './host'
import { runLegacyBridgeHost } from './host'
import { LEGACY_BRIDGE_OPTIONS_ENV } from './client'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

class FakeHostProcess extends EventEmitter implements LegacyBridgeHostProcess {
  connected = true
  readonly sent: unknown[] = []
  readonly exit = vi.fn((_code?: number) => undefined)
  readonly env = {
    [LEGACY_BRIDGE_OPTIONS_ENV]: JSON.stringify({
      host: '127.0.0.1',
      targetPort: 0,
      targetId: 'stable-legacy-target',
      title: 'Stable Legacy'
    })
  }

  send(message: unknown): boolean {
    this.sent.push(message)
    return true
  }

  disconnect(): void {
    this.connected = false
  }
}

const target: DevtoolsTarget = {
  id: 'legacy',
  title: 'Legacy',
  type: 'node',
  url: '',
  webSocketDebuggerUrl: 'ws://127.0.0.1:43110/devtools/page/legacy',
  discoveryUrl: 'http://127.0.0.1:43110/json/list'
}

describe('runLegacyBridgeHost', () => {
  test('starts RequestCenter, routes capture in order, and closes on parent dispose', async () => {
    const processLike = new FakeHostProcess()
    const readiness = deferred<DevtoolsTarget>()
    const center = {
      ready: readiness.promise,
      handleCaptureEvent: vi.fn(),
      close: vi.fn(async () => undefined)
    }
    const createCenter = vi.fn(() => center as unknown as RequestCenter)
    const loadPlugins = vi.fn()
    const running = runLegacyBridgeHost({ process: processLike, createCenter, loadPlugins })

    processLike.emit('message', {
      type: 'capture',
      event: { type: 'initRequest', data: { id: 'before-ready' } }
    })
    await Promise.resolve()
    expect(center.handleCaptureEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'initRequest' })
    )

    readiness.resolve(target)
    await running
    expect(createCenter).toHaveBeenCalledWith({
      serverPort: 0,
      targetId: 'stable-legacy-target',
      title: 'Stable Legacy',
      autoOpenDevtool: false
    })
    expect(loadPlugins).toHaveBeenCalledWith(center)
    expect(processLike.sent).toContainEqual({ type: 'ready', target })

    processLike.emit('message', { type: 'dispose' })
    await vi.waitFor(() => expect(center.close).toHaveBeenCalledOnce())
    expect(processLike.sent).toContainEqual({ type: 'disposed' })
    expect(processLike.connected).toBe(false)
    expect(processLike.listenerCount('message')).toBe(0)
    expect(processLike.listenerCount('disconnect')).toBe(0)
    expect(processLike.exit).toHaveBeenCalledWith(0)
  })

  test('closes and exits when the parent IPC channel disappears', async () => {
    const processLike = new FakeHostProcess()
    const center = {
      ready: Promise.resolve(target),
      handleCaptureEvent: vi.fn(),
      close: vi.fn(async () => undefined)
    }

    await runLegacyBridgeHost({
      process: processLike,
      createCenter: () => center as unknown as RequestCenter,
      loadPlugins: vi.fn()
    })
    processLike.connected = false
    processLike.emit('disconnect')

    await vi.waitFor(() => expect(center.close).toHaveBeenCalledOnce())
    expect(processLike.sent).not.toContainEqual({ type: 'disposed' })
    expect(processLike.exit).toHaveBeenCalledWith(0)
    expect(processLike.listenerCount('message')).toBe(0)
    expect(processLike.listenerCount('disconnect')).toBe(0)
  })

  test('sends a structured startup diagnostic and closes when target bind fails', async () => {
    const processLike = new FakeHostProcess()
    const center = {
      ready: Promise.reject(new Error('address in use')),
      handleCaptureEvent: vi.fn(),
      close: vi.fn(async () => undefined)
    }

    await expect(
      runLegacyBridgeHost({
        process: processLike,
        createCenter: () => center as unknown as RequestCenter,
        loadPlugins: vi.fn()
      })
    ).rejects.toThrow('address in use')
    expect(processLike.sent).toContainEqual({
      type: 'diagnostic',
      diagnostic: expect.objectContaining({ code: 'NND_LEGACY_TARGET_START_FAILED' })
    })
    expect(center.close).toHaveBeenCalledOnce()
    expect(processLike.listenerCount('disconnect')).toBe(0)
  })
})

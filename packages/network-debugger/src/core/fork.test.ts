import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'
import type { DevtoolsTarget, Diagnostic } from '../adapters/types'
import { RequestDetail } from '../common'
import type { LegacyBridgeError } from '../legacy-bridge/client'
import type { LegacyCaptureEvent } from '../legacy-bridge/contracts'
import { MainProcess } from './fork'
import { setCurrentCell } from './hooks/cell'

const target: DevtoolsTarget = {
  id: 'legacy',
  title: 'Legacy',
  type: 'node',
  url: '',
  webSocketDebuggerUrl: 'ws://127.0.0.1:43120/devtools/page/legacy',
  discoveryUrl: 'http://127.0.0.1:43120/json/list'
}

function bridgeHarness() {
  const events: LegacyCaptureEvent[] = []
  const listeners = new Set<(diagnostic: Diagnostic) => void>()
  const failureListeners = new Set<(error: LegacyBridgeError) => void>()
  const bridge = {
    ready: Promise.resolve(target),
    send: vi.fn(async (event: LegacyCaptureEvent) => {
      events.push(event)
    }),
    onDiagnostic: vi.fn((listener: (diagnostic: Diagnostic) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    onFailure: vi.fn((listener: (error: LegacyBridgeError) => void) => {
      failureListeners.add(listener)
      return () => failureListeners.delete(listener)
    }),
    dispose: vi.fn(async () => undefined)
  }
  const main = new MainProcess({ key: 'compat-key', port: 5270, serverPort: 0 }, { bridge })
  return { main, bridge, events, listeners, failureListeners }
}

function request(id = 'request-1'): RequestDetail {
  const detail = new RequestDetail()
  detail.id = id
  detail.url = 'http://example.test/'
  detail.method = 'GET'
  detail.requestHeaders = {}
  return detail
}

class FakeResponse extends EventEmitter {
  statusCode = 200
  statusMessage = 'OK'
  headers = { 'content-type': 'text/plain', 'content-encoding': 'gzip' }
  complete = false
}

describe('MainProcess IPC compatibility facade', () => {
  test('exposes ready/diagnostics and keeps the chainable sendRequest API', async () => {
    const { main, bridge, events, listeners, failureListeners } = bridgeHarness()
    const detail = request()
    const onFailure = vi.fn()
    main.onFailure(onFailure)
    expect(failureListeners.has(onFailure)).toBe(true)
    const diagnosticListener = vi.fn()

    expect(main.onDiagnostic(diagnosticListener)).toEqual(expect.any(Function))
    expect(listeners.has(diagnosticListener)).toBe(true)
    expect(main.sendRequest('initRequest', detail)).toBe(main)
    expect(main.sendRequest('registerRequest', detail)).toBe(main)
    await expect(main.ready).resolves.toEqual(target)
    expect(events.map((event) => event.type)).toEqual(['initRequest', 'registerRequest'])

    await main.dispose()
    expect(bridge.dispose).toHaveBeenCalledOnce()
  })

  test('binds pipes and abort state by request id across concurrent async lifecycles', async () => {
    const { main, events } = bridgeHarness()
    const first = request('concurrent-a')
    const second = request('concurrent-b')
    const firstCell = {
      request: first,
      isAborted: false,
      pipes: [
        {
          type: 'updateRequest' as const,
          pipe: (detail: RequestDetail) => Object.assign(new RequestDetail(detail), { method: 'A' })
        }
      ]
    }
    const secondCell = {
      request: second,
      isAborted: false,
      pipes: [
        {
          type: 'updateRequest' as const,
          pipe: (detail: RequestDetail) => Object.assign(new RequestDetail(detail), { method: 'B' })
        }
      ]
    }

    setCurrentCell(firstCell)
    main.sendRequest('initRequest', first)
    setCurrentCell(secondCell)
    main.sendRequest('initRequest', second)
    // The global cell now belongs to B; A must still use its own pipe/state.
    main.sendRequest('updateRequest', first)
    firstCell.isAborted = true
    main.sendRequest('updateRequest', first)
    main.sendRequest('updateRequest', second)
    setCurrentCell(null)

    const updates = events.filter(
      (event): event is Extract<LegacyCaptureEvent, { type: 'updateRequest' }> =>
        event.type === 'updateRequest'
    )
    expect(updates.map((event) => [event.data.id, event.data.method])).toEqual([
      ['concurrent-a', 'A'],
      ['concurrent-b', 'B']
    ])
    await main.dispose()
  })

  test('strips IncomingMessage/socket state from the WebSocket handshake event', async () => {
    const { main, events } = bridgeHarness()
    const response = Object.assign(new EventEmitter(), {
      httpVersion: '1.1',
      statusCode: 101,
      statusMessage: 'Switching Protocols',
      rawHeaders: ['Upgrade', 'websocket'],
      headers: { upgrade: 'websocket' },
      socket: { live: true }
    })

    await main.send({
      type: 'Network.webSocketCreated',
      data: { requestId: 'ws-1', url: 'ws://example.test/', response }
    } as any)

    expect(events).toEqual([
      {
        type: 'Network.webSocketCreated',
        data: {
          requestId: 'ws-1',
          url: 'ws://example.test/',
          response: {
            httpVersion: '1.1',
            statusCode: 101,
            statusMessage: 'Switching Protocols',
            rawHeaders: ['Upgrade', 'websocket'],
            headers: { upgrade: 'websocket' }
          }
        }
      }
    ])
    expect((events[0] as any).data.response.socket).toBeUndefined()
    await main.dispose()
  })

  test('normalizes the historical method/params WebSocket close shape', async () => {
    const { main, events } = bridgeHarness()
    await main.send({
      method: 'Network.webSocketClosed',
      params: { requestId: 'ws-2', timestamp: 123 }
    })
    expect(events).toEqual([{ type: 'Network.webSocketClosed', data: { requestId: 'ws-2' } }])
    await main.dispose()
  })

  test('emits responseReceived immediately and responseData with a real Buffer only on end', async () => {
    const { main, events } = bridgeHarness()
    const detail = request('success')
    main.sendRequest('registerRequest', detail)
    const response = new FakeResponse()

    main.responseRequest('success', response as any)
    expect(events.map((event) => event.type)).toEqual(['registerRequest', 'responseReceived'])
    expect(events[1].data as RequestDetail & { responseStatusText?: string }).toMatchObject({
      responseStatusCode: 200,
      responseStatusText: 'OK'
    })

    response.emit('data', Buffer.from('hello '))
    response.emit('data', new Uint8Array(Buffer.from('world')))
    response.complete = true
    response.emit('end')
    response.emit('close')

    expect(events.map((event) => event.type)).toEqual([
      'registerRequest',
      'responseReceived',
      'responseData'
    ])
    const result = events[2] as Extract<LegacyCaptureEvent, { type: 'responseData' }>
    expect(Buffer.isBuffer(result.data.rawData)).toBe(true)
    expect(result.data.rawData.toString()).toBe('hello world')
    expect(detail.requestEndTime).toBeGreaterThan(1_000_000_000)
    expect(detail.requestEndTime).toBeLessThan(10_000_000_000)
    expect(result.data).toMatchObject({
      id: 'success',
      statusCode: 200,
      statusMessage: 'OK',
      contentEncoding: 'gzip'
    })
    await main.dispose()
  })

  test.each([
    ['aborted', undefined, true],
    ['error', new Error('socket reset'), false],
    ['close', undefined, false]
  ] as const)(
    '%s emits requestFailed exactly once and never responseData',
    async (eventName, error, canceled) => {
      const { main, events } = bridgeHarness()
      const detail = request(eventName)
      main.sendRequest('registerRequest', detail)
      const response = new FakeResponse()
      // Real IncomingMessage consumers may keep their own error listener after
      // MainProcess removes only the listener it owns.
      response.on('error', () => undefined)
      main.responseRequest(detail, response as any)

      if (error) response.emit(eventName, error)
      else response.emit(eventName)
      response.emit('error', new Error('duplicate'))
      response.emit('close')

      expect(events.map((event) => event.type)).toEqual([
        'registerRequest',
        'responseReceived',
        'requestFailed'
      ])
      const failed = events[2] as Extract<LegacyCaptureEvent, { type: 'requestFailed' }>
      expect(failed.data.request.id).toBe(eventName)
      expect(failed.data.request.requestEndTime).toBeLessThan(10_000_000_000)
      expect(Boolean(failed.data.canceled)).toBe(canceled)
      expect(events.some((event) => event.type === 'responseData')).toBe(false)
      await main.dispose()
    }
  )

  test('dispose removes active response listeners and ignores later stream events', async () => {
    const { main, bridge, events } = bridgeHarness()
    const detail = request('dispose')
    main.sendRequest('registerRequest', detail)
    const response = new FakeResponse()
    main.responseRequest(detail, response as any)

    await main.dispose()
    expect(response.listenerCount('data')).toBe(0)
    expect(response.listenerCount('end')).toBe(0)
    response.emit('data', Buffer.from('ignored'))
    response.emit('end')
    expect(events.map((event) => event.type)).toEqual(['registerRequest', 'responseReceived'])
    expect(bridge.dispose).toHaveBeenCalledOnce()
  })
})

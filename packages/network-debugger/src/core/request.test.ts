import { EventEmitter } from 'node:events'
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http'
import type { Socket } from 'node:net'
import { deserialize, serialize } from 'node:v8'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { MainProcess } from './fork'
import { getProxyFactory, requestProxyFactory, type RequestFn } from './request'
import { withoutLegacyCapture } from './capture-scope'
import PerMessageDeflate from './ws/permessage-deflate'

interface JournalEntry {
  transport: 'request' | 'event' | 'response'
  type: string
  data: any
}

interface MockClientRequest extends ClientRequest {
  protocol: string
  host: string
  destroyed: boolean
}

function snapshot<T>(value: T): T {
  return deserialize(serialize(value)) as T
}

function createMainProcess() {
  const journal: JournalEntry[] = []
  const mainProcess: Record<string, any> = {}
  mainProcess.sendRequest = vi.fn((type: string, data: unknown) => {
    journal.push({ transport: 'request', type, data: snapshot(data) })
    return mainProcess
  })
  mainProcess.send = vi.fn(async (event: { type: string; data: unknown }) => {
    journal.push({ transport: 'event', type: event.type, data: snapshot(event.data) })
  })
  mainProcess.responseRequest = vi.fn((request: unknown, response: IncomingMessage) => {
    journal.push({
      transport: 'response',
      type: 'responseRequest',
      data: { request: snapshot(request), response }
    })
  })
  return { journal, mainProcess: mainProcess as MainProcess }
}

function createClientRequest(
  overrides: Partial<{
    protocol: string
    host: string
    path: string
    method: string
    headers: Record<string, string | string[] | number>
  }> = {}
): MockClientRequest {
  const request = new EventEmitter() as MockClientRequest
  const headers: Record<string, string | string[] | number> = {
    host: overrides.host ?? 'example.test',
    ...(overrides.headers ?? {})
  }
  request.protocol = overrides.protocol ?? 'http:'
  request.host = overrides.host ?? 'example.test'
  request.path = overrides.path ?? '/'
  request.method = overrides.method ?? 'GET'
  request.destroyed = false
  request.getHeader = vi.fn((name: string) => {
    const key = Object.keys(headers).find(
      (candidate) => candidate.toLowerCase() === name.toLowerCase()
    )
    return key ? headers[key] : undefined
  })
  request.getHeaders = vi.fn(() => ({ ...headers }))
  request.setHeader = vi.fn((name: string, value: string | string[] | number) => {
    const existing = Object.keys(headers).find(
      (candidate) => candidate.toLowerCase() === name.toLowerCase()
    )
    if (existing) delete headers[existing]
    headers[name] = value
    return request
  }) as ClientRequest['setHeader']
  request.removeHeader = vi.fn((name: string) => {
    const existing = Object.keys(headers).find(
      (candidate) => candidate.toLowerCase() === name.toLowerCase()
    )
    if (existing) delete headers[existing]
  })
  request.write = vi.fn(() => true) as ClientRequest['write']
  request.end = vi.fn(() => request) as ClientRequest['end']
  request.abort = vi.fn()
  return request
}

function createResponse(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  const response = new EventEmitter() as IncomingMessage
  response.statusCode = overrides.statusCode ?? 200
  response.statusMessage = overrides.statusMessage ?? 'OK'
  response.headers = overrides.headers ?? { 'content-type': 'application/json' }
  response.rawHeaders = overrides.rawHeaders ?? ['Content-Type', 'application/json']
  response.httpVersion = overrides.httpVersion ?? '1.1'
  return response
}

function createSocket(): Socket {
  const socket = new EventEmitter() as Socket
  socket.write = vi.fn(() => true) as Socket['write']
  socket.end = vi.fn(() => socket) as Socket['end']
  socket.destroy = vi.fn(() => socket) as Socket['destroy']
  return socket
}

function createActualRequest(request: ClientRequest) {
  let responseCallback: ((response: IncomingMessage) => void) | undefined
  const actualRequest = vi.fn((...args: unknown[]) => {
    const candidate = args.at(-1)
    if (typeof candidate === 'function') {
      responseCallback = candidate as (response: IncomingMessage) => void
    }
    return request
  }) as unknown as RequestFn
  return {
    actualRequest,
    respond(response: IncomingMessage) {
      expect(responseCallback).toBeTypeOf('function')
      responseCallback!(response)
    }
  }
}

function websocketFrame(
  payload: Buffer,
  opcode: 1 | 2,
  masked: boolean,
  compressed = false
): Buffer {
  if (payload.length >= 126) throw new Error('test helper only supports short frames')
  const first = 0x80 | (compressed ? 0x40 : 0) | opcode
  if (!masked) return Buffer.concat([Buffer.from([first, payload.length]), payload])

  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44])
  const encoded = Buffer.alloc(payload.length)
  for (let index = 0; index < payload.length; index += 1) {
    encoded[index] = payload[index] ^ mask[index % mask.length]
  }
  return Buffer.concat([Buffer.from([first, 0x80 | payload.length]), mask, encoded])
}

function compress(extension: PerMessageDeflate, payload: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    extension.compress(payload, true, (error, result) => {
      if (error) reject(error)
      else if (!result) reject(new Error('permessage-deflate returned no payload'))
      else resolve(result)
    })
  })
}

describe('http request capture', () => {
  beforeEach(() => vi.clearAllMocks())

  test('bypasses internal debugger transports without emitting capture events', () => {
    const request = createClientRequest({ path: '/devtools/page/internal' })
    const { actualRequest } = createActualRequest(request)
    const { journal, mainProcess } = createMainProcess()
    const callback = vi.fn()
    const proxy = requestProxyFactory.call(undefined, actualRequest, false, mainProcess)

    const returned = withoutLegacyCapture(() =>
      proxy('http://127.0.0.1:43100/devtools/page/internal', callback)
    )

    expect(returned).toBe(request)
    expect(actualRequest).toHaveBeenCalledWith(
      'http://127.0.0.1:43100/devtools/page/internal',
      callback
    )
    expect(journal).toEqual([])
  })

  test('uses the actual ClientRequest origin, path, method, headers, and seconds timestamp', () => {
    const request = createClientRequest({
      protocol: 'http:',
      host: '127.0.0.1:43891',
      path: '/actual?query=1',
      method: 'POST',
      headers: { 'x-runtime': 'yes' }
    })
    const { actualRequest } = createActualRequest(request)
    const { journal, mainProcess } = createMainProcess()
    const before = Date.now() / 1000

    requestProxyFactory.call(
      undefined,
      actualRequest,
      false,
      mainProcess
    )('http://placeholder.invalid/stale', { method: 'GET' })
    const after = Date.now() / 1000

    const detail = journal[0].data
    expect(detail).toMatchObject({
      url: 'http://127.0.0.1:43891/actual?query=1',
      method: 'POST',
      requestHeaders: { host: '127.0.0.1:43891', 'x-runtime': 'yes' }
    })
    expect(detail.requestStartTime).toBeGreaterThanOrEqual(before)
    expect(detail.requestStartTime).toBeLessThanOrEqual(after)
    expect(detail.requestStartTime).toBeLessThan(10_000_000_000)
    expect(actualRequest).toHaveBeenCalledWith(
      'http://placeholder.invalid/stale',
      { method: 'GET' },
      expect.any(Function)
    )
  })

  test('registers lazily once at end with every written body chunk and late headers', () => {
    const request = createClientRequest({ method: 'POST', path: '/upload' })
    const originalWrite = request.write
    const originalEnd = request.end
    const { actualRequest } = createActualRequest(request)
    const { journal, mainProcess } = createMainProcess()
    const captured = requestProxyFactory.call(
      undefined,
      actualRequest,
      false,
      mainProcess
    )({
      hostname: 'example.test',
      path: '/upload',
      method: 'POST'
    })

    captured.write('first-', 'utf8')
    captured.write(Buffer.from('second-'))
    captured.setHeader('X-Late', 'visible')
    expect(journal.map(({ type }) => type)).toEqual(['initRequest'])

    captured.end('third')
    captured.end()

    expect(journal.map(({ type }) => type)).toEqual(['initRequest', 'registerRequest'])
    const registered = journal[1].data
    expect(Buffer.from(registered.requestData).toString()).toBe('first-second-third')
    expect(registered.requestHeaders).toMatchObject({ 'X-Late': 'visible' })
    expect(originalWrite).toHaveBeenCalledTimes(2)
    expect(originalEnd).toHaveBeenCalledTimes(2)
  })

  test('registers before delegating an early response and preserves response metadata', () => {
    const request = createClientRequest({ path: '/resource' })
    const harness = createActualRequest(request)
    const { journal, mainProcess } = createMainProcess()
    const callback = vi.fn()
    requestProxyFactory.call(
      undefined,
      harness.actualRequest,
      false,
      mainProcess
    )({ hostname: 'example.test', path: '/resource' }, callback)
    const response = createResponse({
      statusCode: 202,
      statusMessage: 'Accepted',
      headers: { 'content-type': 'text/plain', 'x-response': 'ready' }
    })

    harness.respond(response)

    expect(journal.map(({ type }) => type)).toEqual([
      'initRequest',
      'registerRequest',
      'responseRequest'
    ])
    expect(journal.at(-1)!.data.request).toMatchObject({
      responseStatusCode: 202,
      responseStatusText: 'Accepted',
      responseHeaders: { 'content-type': 'text/plain', 'x-response': 'ready' }
    })
    expect(journal.at(-1)!.data.response).toBe(response)
    expect(callback).toHaveBeenCalledWith(response)
  })

  test('reports a pre-response error only as requestFailed and only once', () => {
    const request = createClientRequest({ path: '/failure' })
    const { actualRequest } = createActualRequest(request)
    const { journal, mainProcess } = createMainProcess()
    requestProxyFactory.call(
      undefined,
      actualRequest,
      false,
      mainProcess
    )({
      hostname: 'example.test',
      path: '/failure'
    })

    request.emit('error', new Error('socket refused'))
    request.emit('abort')

    expect(journal.map(({ type }) => type)).toEqual([
      'initRequest',
      'registerRequest',
      'requestFailed'
    ])
    const failure = journal.at(-1)!.data
    expect(failure).toMatchObject({ errorText: 'socket refused', canceled: false })
    expect(failure.request.requestEndTime).toBeLessThan(10_000_000_000)
  })

  test('treats an early destroyed close as canceled but ignores close after response headers', () => {
    const early = createClientRequest({ path: '/early-close' })
    const { actualRequest: earlyActual } = createActualRequest(early)
    const earlyMain = createMainProcess()
    requestProxyFactory.call(
      undefined,
      earlyActual,
      false,
      earlyMain.mainProcess
    )({
      hostname: 'example.test',
      path: '/early-close'
    })
    early.destroyed = true
    early.emit('close')
    expect(earlyMain.journal.map(({ type }) => type)).toEqual([
      'initRequest',
      'registerRequest',
      'requestFailed'
    ])
    expect(earlyMain.journal.at(-1)!.data.canceled).toBe(true)

    const completed = createClientRequest({ path: '/has-headers' })
    const completedHarness = createActualRequest(completed)
    const completedMain = createMainProcess()
    requestProxyFactory.call(
      undefined,
      completedHarness.actualRequest,
      false,
      completedMain.mainProcess
    )({ hostname: 'example.test', path: '/has-headers' })
    completedHarness.respond(createResponse())
    completed.destroyed = true
    completed.emit('close')
    expect(completedMain.journal.some(({ type }) => type === 'requestFailed')).toBe(false)
  })

  test('get delegates to request and ends it, triggering lazy registration', () => {
    const request = createClientRequest({ path: '/get' })
    const proxiedRequest = vi.fn(() => request) as unknown as RequestFn

    const returned = getProxyFactory(proxiedRequest)('http://example.test/get')

    expect(returned).toBe(request)
    expect(proxiedRequest).toHaveBeenCalledWith('http://example.test/get')
    expect(request.end).toHaveBeenCalledOnce()
  })
})

describe('WebSocket request capture', () => {
  beforeEach(() => vi.clearAllMocks())

  function createWebSocketHarness() {
    const request = createClientRequest({
      protocol: 'http:',
      host: '127.0.0.1:43917',
      path: '/socket?token=dynamic',
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': 'test-key'
      }
    })
    const actual = createActualRequest(request)
    const capture = createMainProcess()
    const returned = requestProxyFactory.call(
      undefined,
      actual.actualRequest,
      false,
      capture.mainProcess
    )({ hostname: 'stale.invalid', path: '/wrong', headers: { Upgrade: 'websocket' } })
    return { request, returned, ...actual, ...capture }
  }

  test('uses the dynamic ws URL and never registers a normal HTTP request', () => {
    const { returned, journal } = createWebSocketHarness()

    returned.end()

    expect(journal.map(({ type }) => type)).toEqual(['initRequest'])
    expect(journal[0].data.url).toBe('ws://127.0.0.1:43917/socket?token=dynamic')
  })

  test('emits a serializable handshake DTO for loopback application traffic', () => {
    const { request, journal } = createWebSocketHarness()
    const socket = createSocket()
    const response = createResponse({
      statusCode: 101,
      statusMessage: 'Switching Protocols',
      headers: { upgrade: 'websocket', connection: 'Upgrade' },
      rawHeaders: ['Upgrade', 'websocket', 'Connection', 'Upgrade']
    })

    request.emit('upgrade', response, socket, Buffer.alloc(0))
    request.destroyed = true
    request.emit('close')

    expect(journal.map(({ type }) => type)).toEqual(['initRequest', 'Network.webSocketCreated'])
    const created = journal.at(-1)!.data
    expect(created).toMatchObject({
      requestId: journal[0].data.id,
      url: 'ws://127.0.0.1:43917/socket?token=dynamic',
      response: {
        httpVersion: '1.1',
        statusCode: 101,
        statusMessage: 'Switching Protocols',
        rawHeaders: ['Upgrade', 'websocket', 'Connection', 'Upgrade'],
        headers: { upgrade: 'websocket', connection: 'Upgrade' }
      }
    })
    expect(Object.keys(created).sort()).toEqual(['initiator', 'requestId', 'response', 'url'])
    expect(() => JSON.stringify(created)).not.toThrow()
  })

  test('emits text, binary, and one close DTO with the correct frame encoding', async () => {
    const { request, journal } = createWebSocketHarness()
    const socket = createSocket()
    request.emit('upgrade', createResponse({ statusCode: 101 }), socket, Buffer.alloc(0))

    socket.emit('data', websocketFrame(Buffer.from('server text'), 1, false))
    socket.write(websocketFrame(Buffer.from([0, 255, 16]), 2, true))
    socket.emit('end')
    socket.emit('close')

    await vi.waitFor(() => expect(journal).toHaveLength(5))

    expect(journal.map(({ type }) => type)).toEqual([
      'initRequest',
      'Network.webSocketCreated',
      'Network.webSocketFrameReceived',
      'Network.webSocketFrameSent',
      'Network.webSocketClosed'
    ])
    expect(journal[2].data.response).toEqual({
      payloadData: 'server text',
      opcode: 1,
      mask: false
    })
    expect(journal[3].data.response).toEqual({
      payloadData: Buffer.from([0, 255, 16]).toString('base64'),
      opcode: 2,
      mask: true
    })
    expect(journal.filter(({ type }) => type === 'Network.webSocketClosed')).toHaveLength(1)
  })

  test('decodes negotiated permessage-deflate frames in both directions', async () => {
    const { request, journal } = createWebSocketHarness()
    const socket = createSocket()
    const negotiated = {
      server_no_context_takeover: [true],
      client_no_context_takeover: [true]
    }
    const response = createResponse({
      statusCode: 101,
      headers: {
        upgrade: 'websocket',
        connection: 'Upgrade',
        'sec-websocket-extensions':
          'permessage-deflate; server_no_context_takeover; client_no_context_takeover'
      }
    })
    request.emit('upgrade', response, socket, Buffer.alloc(0))

    const serverExtension = new PerMessageDeflate(
      { serverNoContextTakeover: true, clientNoContextTakeover: true },
      true
    )
    serverExtension.accept([structuredClone(negotiated)])
    const clientExtension = new PerMessageDeflate(
      { serverNoContextTakeover: true, clientNoContextTakeover: true },
      false
    )
    clientExtension.accept([structuredClone(negotiated)])

    const receivedPayload = Buffer.from('compressed server text')
    const sentPayload = Buffer.from([0, 255, 16, 32, 64])
    socket.emit(
      'data',
      websocketFrame(await compress(serverExtension, receivedPayload), 1, false, true)
    )
    const sentFrame = websocketFrame(await compress(clientExtension, sentPayload), 2, true, true)
    const applicationFrame = Buffer.from(sentFrame)
    socket.write(sentFrame)
    expect(sentFrame).toEqual(applicationFrame)

    await vi.waitFor(() => {
      expect(journal.filter(({ type }) => type.includes('webSocketFrame'))).toHaveLength(2)
    })
    expect(journal.at(-2)?.data.response).toEqual({
      payloadData: receivedPayload.toString(),
      opcode: 1,
      mask: false
    })
    expect(journal.at(-1)?.data.response).toEqual({
      payloadData: sentPayload.toString('base64'),
      opcode: 2,
      mask: true
    })

    socket.emit('close')
    serverExtension.cleanup()
    clientExtension.cleanup()
  })

  test('contains asynchronous Receiver errors instead of crashing application I/O', async () => {
    const { request, journal } = createWebSocketHarness()
    const socket = createSocket()
    request.emit('upgrade', createResponse({ statusCode: 101 }), socket, Buffer.alloc(0))

    // RSV1 without a negotiated extension is invalid and fails through the
    // Writable callback, not through the synchronous write() call.
    socket.emit('data', websocketFrame(Buffer.from('invalid'), 1, false, true))
    await new Promise((resolve) => setImmediate(resolve))

    expect(journal.map(({ type }) => type)).toEqual(['initRequest', 'Network.webSocketCreated'])
    expect(() => socket.emit('close')).not.toThrow()
  })
})

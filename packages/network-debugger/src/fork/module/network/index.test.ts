import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RequestDetail } from '../../../common'
import { CDP_ERROR_CODES } from '../../devtool'
import type { DevtoolMessageListener } from '../../request-center'
import { networkPlugin, toMimeType, type NetworkPluginCore } from './index'

const handlers = new Map<string, DevtoolMessageListener<any>[]>()
const send = vi.fn().mockResolvedValue(undefined)
let timestamp = 100
let plugin: NetworkPluginCore
let fixtureDir = ''

function request(overrides: Partial<RequestDetail> = {}) {
  const detail = new RequestDetail()
  detail.url = 'http://127.0.0.1:43123/api?source=dynamic'
  detail.method = 'GET'
  detail.requestHeaders = {}
  detail.responseHeaders = {}
  detail.responseInfo = {}
  detail.requestStartTime = 1_787_891_800.25
  Object.assign(detail, overrides)
  return detail
}

function loadPlugin() {
  const core = {
    on(method: string, listener: DevtoolMessageListener<any>) {
      const list = handlers.get(method) ?? []
      list.push(listener)
      handlers.set(method, list)
      return () => undefined
    },
    usePlugin: vi.fn()
  }
  return networkPlugin({
    devtool: {
      send,
      timestamp: 0,
      getTimestamp: () => (timestamp += 0.25),
      updateTimestamp: () => undefined
    },
    core,
    plugins: [networkPlugin]
  })
}

function handler(method: string) {
  const listener = handlers.get(method)?.[0]
  if (!listener) throw new Error(`Missing handler ${method}`)
  return listener
}

function messages() {
  return send.mock.calls.map(([message]) => message as Record<string, any>)
}

function methods() {
  return messages().map((message) => message.method)
}

beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
  timestamp = 100
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nnd-network-plugin-'))
  plugin = loadPlugin()
})

afterEach(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true })
})

describe('networkPlugin v2 lifecycle', () => {
  test('registers capture and asynchronous CDP command handlers', () => {
    expect(networkPlugin.id).toBe('network')
    expect([...handlers.keys()]).toEqual(
      expect.arrayContaining([
        'initRequest',
        'registerRequest',
        'updateRequest',
        'responseReceived',
        'responseData',
        'requestFailed',
        'endRequest',
        'eventSourceResponseReceived',
        'eventSourceMessage',
        'Network.getResponseBody',
        'Network.getRequestPostData'
      ])
    )
    expect(plugin.requestCount()).toBe(0)
  })

  test('preserves the real dynamic-origin URL and emits second-based timestamps', async () => {
    const detail = request({
      method: 'POST',
      requestHeaders: { 'content-type': 'application/json' },
      requestData: Buffer.from('{"ok":true}'),
      // Accept old millisecond inputs at the bridge boundary.
      requestStartTime: 1_787_891_800_250
    })

    await handler('registerRequest')({ data: detail })

    const event = messages()[0]
    expect(event).toMatchObject({
      method: 'Network.requestWillBeSent',
      params: {
        documentURL: 'http://127.0.0.1:43123/api?source=dynamic',
        wallTime: 1_787_891_800.25,
        request: {
          url: 'http://127.0.0.1:43123/api?source=dynamic',
          method: 'POST',
          postData: '{"ok":true}',
          hasPostData: true
        }
      }
    })
    expect(event.params.timestamp).toBeGreaterThan(0)
    expect(event.params.timestamp).toBeLessThan(10_000_000_000)
    expect(event.params.wallTime).toBeLessThan(10_000_000_000)
  })

  test('emits responseReceived before data and the successful terminal event exactly once', async () => {
    const detail = request({
      responseStatusCode: 201,
      responseStatusText: 'Created',
      responseHeaders: { 'content-type': 'application/json; charset=utf-8' },
      responseData: Buffer.from('{"created":true}'),
      responseInfo: { dataLength: 16, encodedDataLength: 16 }
    })

    await handler('registerRequest')({ data: detail })
    await handler('responseReceived')({ data: detail })
    await handler('endRequest')({ data: detail })
    await handler('endRequest')({ data: detail })

    expect(methods()).toEqual([
      'Network.requestWillBeSent',
      'Network.responseReceived',
      'Network.dataReceived',
      'Network.loadingFinished'
    ])
    expect(messages()[1]).toMatchObject({
      params: {
        type: 'Other',
        response: {
          status: 201,
          statusText: 'Created',
          mimeType: 'application/json',
          charset: 'utf-8'
        }
      }
    })
    const timestamps = messages()
      .map((message) => message.params?.timestamp)
      .filter((value): value is number => typeof value === 'number')
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b))
  })

  test('a pre-response failure emits only requestWillBeSent then loadingFailed', async () => {
    const detail = request()

    await handler('requestFailed')({
      data: {
        request: detail,
        errorText: 'ECONNREFUSED',
        canceled: true,
        blockedReason: 'other'
      }
    })

    expect(methods()).toEqual(['Network.requestWillBeSent', 'Network.loadingFailed'])
    expect(messages()[1]).toMatchObject({
      params: {
        errorText: 'ECONNREFUSED',
        canceled: true,
        blockedReason: 'other'
      }
    })
    expect(methods()).not.toContain('Network.loadingFinished')
    expect(methods()).not.toContain('Network.responseReceived')
  })

  test('a post-header failure keeps responseReceived but never emits loadingFinished', async () => {
    const detail = request({
      responseStatusCode: 502,
      responseStatusText: 'Bad Gateway',
      responseHeaders: { 'content-type': 'text/plain' }
    })

    await handler('registerRequest')({ data: detail })
    await handler('requestFailed')({ data: { request: detail, errorText: 'stream reset' } })

    expect(methods()).toEqual([
      'Network.requestWillBeSent',
      'Network.responseReceived',
      'Network.loadingFailed'
    ])
    expect(methods()).not.toContain('Network.loadingFinished')
  })

  test('decodes compressed response DTOs and exposes body through async result', async () => {
    const detail = request()
    const body = Buffer.from('compressed response')
    await handler('registerRequest')({ data: detail })
    await handler('responseData')({
      data: {
        id: detail.id,
        rawData: zlib.gzipSync(body),
        statusCode: 200,
        statusMessage: 'OK',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        contentEncoding: 'gzip'
      }
    })
    const result = vi.fn().mockResolvedValue(undefined)
    const error = vi.fn().mockResolvedValue(undefined)

    await handler('Network.getResponseBody')({
      data: { requestId: detail.id },
      id: 0,
      result,
      error
    })

    expect(methods()).toEqual([
      'Network.requestWillBeSent',
      'Network.responseReceived',
      'Network.dataReceived',
      'Network.loadingFinished'
    ])
    expect(result).toHaveBeenCalledWith({ body: 'compressed response', base64Encoded: false })
    expect(error).not.toHaveBeenCalled()
  })

  test('returns standard command errors for invalid or unfinished body requests', async () => {
    const detail = request()
    await handler('initRequest')({ data: detail })
    const error = vi.fn().mockResolvedValue(undefined)

    await handler('Network.getResponseBody')({ data: {}, error })
    expect(error).toHaveBeenLastCalledWith(
      CDP_ERROR_CODES.INVALID_PARAMS,
      'requestId must be a string.'
    )

    await handler('Network.getResponseBody')({ data: { requestId: detail.id }, error })
    expect(error).toHaveBeenLastCalledWith(
      CDP_ERROR_CODES.SERVER_ERROR,
      `No finished request with id ${detail.id}.`
    )
  })

  test('returns captured post data or a server error through command callbacks', async () => {
    const withBody = request({ requestData: new Uint8Array(Buffer.from('a=1')) })
    const withoutBody = request()
    await handler('initRequest')({ data: withBody })
    await handler('initRequest')({ data: withoutBody })
    const result = vi.fn().mockResolvedValue(undefined)
    const error = vi.fn().mockResolvedValue(undefined)

    await handler('Network.getRequestPostData')({
      data: { requestId: withBody.id },
      result,
      error
    })
    await handler('Network.getRequestPostData')({
      data: { requestId: withoutBody.id },
      result,
      error
    })

    expect(result).toHaveBeenCalledWith({ postData: 'a=1' })
    expect(error).toHaveBeenCalledWith(
      CDP_ERROR_CODES.SERVER_ERROR,
      `No request body for ${withoutBody.id}.`
    )
  })

  test('emits SSE response, messages, and terminal events in protocol order', async () => {
    const detail = request({
      responseStatusCode: 200,
      responseStatusText: 'OK',
      responseHeaders: { 'content-type': 'text/event-stream; charset=utf-8' },
      responseData: Buffer.from('event: update\ndata: one\n\n'),
      responseInfo: { dataLength: 25, encodedDataLength: 25 }
    })

    await handler('registerRequest')({ data: detail })
    await handler('eventSourceResponseReceived')({ data: detail })
    await handler('eventSourceMessage')({
      data: { requestId: detail.id, eventName: 'update', eventId: '42', data: 'one\ntwo' }
    })
    await handler('endRequest')({ data: detail })

    expect(methods()).toEqual([
      'Network.requestWillBeSent',
      'Network.responseReceived',
      'Network.eventSourceMessageReceived',
      'Network.dataReceived',
      'Network.loadingFinished'
    ])
    expect(messages()[1].params.type).toBe('EventSource')
    expect(messages()[2].params).toMatchObject({
      eventName: 'update',
      eventId: '42',
      data: 'one\ntwo'
    })
  })

  test('lazily registers and announces an initiator script before its request', async () => {
    const scriptPath = path.join(fixtureDir, 'initiator.js')
    fs.writeFileSync(scriptPath, 'export const initiator = true')
    const detail = request({
      initiator: {
        type: 'script',
        stack: {
          callFrames: [
            {
              functionName: 'callApi',
              url: scriptPath,
              lineNumber: 1,
              columnNumber: 2
            }
          ]
        }
      }
    })

    await handler('registerRequest')({ data: detail })
    await handler('registerRequest')({ data: detail })

    expect(methods()).toEqual(['Debugger.scriptParsed', 'Network.requestWillBeSent'])
    expect(messages()[0].params).toMatchObject({
      scriptId: '1',
      scriptLanguage: 'JavaScript'
    })
    expect(detail.initiator!.stack.callFrames[0].scriptId).toBe('1')
    expect(plugin.resourceService.getLocalScriptList()).toHaveLength(1)
  })

  test.each([
    ['image/png', 'Image'],
    ['application/javascript', 'Script'],
    ['text/css', 'Stylesheet'],
    ['text/html', 'Document'],
    ['application/octet-stream', 'Other']
  ])('maps %s responses to %s', async (contentType, type) => {
    const detail = request({
      responseStatusCode: 200,
      responseHeaders: { 'content-type': contentType }
    })
    await handler('responseReceived')({ data: detail })
    expect(
      messages().find((message) => message.method === 'Network.responseReceived')?.params.type
    ).toBe(type)
  })
})

describe('toMimeType', () => {
  test.each([
    ['application/json; charset=utf-8', 'application/json'],
    ['text/plain', 'text/plain'],
    ['', 'text/plain']
  ])('normalizes %j', (input, expected) => {
    expect(toMimeType(input)).toBe(expected)
  })
})

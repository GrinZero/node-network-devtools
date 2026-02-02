import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import type { ClientRequest, IncomingMessage, RequestOptions } from 'http'
import type { Socket } from 'net'
import { RequestDetail } from '../common'
import { requestProxyFactory } from './request'
import type { MainProcess } from './fork'

// Mock MainProcess 接口
interface MockMainProcess {
  sendRequest: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  responseRequest: ReturnType<typeof vi.fn>
}

// 创建 mock MainProcess
function createMockMainProcess(): {
  mockMainProcess: MockMainProcess
  mockSendRequest: ReturnType<typeof vi.fn>
  mockSend: ReturnType<typeof vi.fn>
  mockResponseRequest: ReturnType<typeof vi.fn>
} {
  const mockSendRequest = vi.fn().mockReturnThis()
  const mockSend = vi.fn().mockResolvedValue(undefined)
  const mockResponseRequest = vi.fn()

  return {
    mockMainProcess: {
      sendRequest: mockSendRequest,
      send: mockSend,
      responseRequest: mockResponseRequest
    },
    mockSendRequest,
    mockSend,
    mockResponseRequest
  }
}

// 创建 Mock ClientRequest - 返回具有必要属性的对象
function createMockClientRequest() {
  const emitter = new EventEmitter()
  const writeFn = vi.fn().mockReturnValue(true)
  const setHeaderFn = vi.fn()

  // 将 EventEmitter 方法和 mock 方法合并
  const mockRequest = {
    ...emitter,
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    write: writeFn,
    end: vi.fn(),
    setHeader: setHeaderFn,
    getHeader: vi.fn(),
    removeHeader: vi.fn(),
    abort: vi.fn(),
    destroyed: false
  }

  return mockRequest
}

// 创建 Mock IncomingMessage
function createMockIncomingMessage(
  options: {
    statusCode?: number
    headers?: Record<string, string>
  } = {}
) {
  const { statusCode = 200, headers = {} } = options
  const emitter = new EventEmitter()

  const mockResponse = {
    ...emitter,
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    statusCode,
    headers,
    httpVersion: '1.1',
    complete: true,
    rawHeaders: [] as string[],
    trailers: {},
    rawTrailers: [] as string[]
  }

  return mockResponse
}

// 创建 Mock Socket
function createMockSocket() {
  const emitter = new EventEmitter()
  const writeFn = vi.fn().mockReturnValue(true)
  const readFn = vi.fn().mockReturnValue(null)

  const mockSocket = {
    ...emitter,
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    addListener: emitter.addListener.bind(emitter),
    write: writeFn,
    end: vi.fn(),
    destroy: vi.fn(),
    read: readFn,
    destroyed: false,
    readable: true,
    writable: true
  }

  return mockSocket
}

describe('core/request.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('requestProxyFactory 函数', () => {
    describe('参数解析', () => {
      test('处理字符串 URL 参数 (url, options, callback)', () => {
        const mockRequest = createMockClientRequest()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const callback = vi.fn()
        proxyFn('http://example.com/api', { method: 'GET' }, callback)

        // 验证 initRequest 被调用
        expect(mockSendRequest).toHaveBeenCalledWith(
          'initRequest',
          expect.objectContaining({
            url: 'http://example.com/api',
            method: 'GET'
          })
        )
      })

      test('处理 URL 对象参数', () => {
        const mockRequest = createMockClientRequest()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const url = new URL('http://example.com/api')
        proxyFn(url, { method: 'POST' })

        expect(mockSendRequest).toHaveBeenCalledWith(
          'initRequest',
          expect.objectContaining({
            url: 'http://example.com/api',
            method: 'POST'
          })
        )
      })

      test('处理 RequestOptions 参数 (options, callback)', () => {
        const mockRequest = createMockClientRequest()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/api',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }
        proxyFn(options)

        expect(mockSendRequest).toHaveBeenCalledWith(
          'initRequest',
          expect.objectContaining({
            url: 'http://example.com/api',
            method: 'POST'
          })
        )
      })

      test('处理 HTTPS 请求', () => {
        const mockRequest = createMockClientRequest()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          true, // isHttps = true
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/api',
          method: 'GET'
        }
        proxyFn(options)

        expect(mockSendRequest).toHaveBeenCalledWith(
          'initRequest',
          expect.objectContaining({
            url: 'https://example.com/api'
          })
        )
      })

      test('使用 host 替代 hostname', () => {
        const mockRequest = createMockClientRequest()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          host: 'example.com',
          path: '/api',
          method: 'GET'
        }
        proxyFn(options)

        expect(mockSendRequest).toHaveBeenCalledWith(
          'initRequest',
          expect.objectContaining({
            url: 'http://example.com/api'
          })
        )
      })
    })

    describe('请求头处理', () => {
      test('记录请求头', () => {
        const mockRequest = createMockClientRequest()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/api',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer token'
          }
        }
        proxyFn(options)

        expect(mockSendRequest).toHaveBeenCalledWith(
          'initRequest',
          expect.objectContaining({
            requestHeaders: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer token'
            }
          })
        )
      })

      test('setHeader 方法代理 - 单个值', () => {
        const mockRequest = createMockClientRequest()
        const originalSetHeader = mockRequest.setHeader
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        // 需要传递 headers 以初始化 requestHeaders
        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/api',
          method: 'POST',
          headers: {}
        }
        const request = proxyFn(options)

        // 调用代理后的 setHeader
        request.setHeader('X-Custom-Header', 'custom-value')

        // 验证原始 setHeader 被调用
        expect(originalSetHeader).toHaveBeenCalledWith('X-Custom-Header', 'custom-value')
      })

      test('setHeader 方法代理 - 数组值', () => {
        const mockRequest = createMockClientRequest()
        const originalSetHeader = mockRequest.setHeader
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        // 需要传递 headers 以初始化 requestHeaders
        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/api',
          method: 'POST',
          headers: {}
        }
        const request = proxyFn(options)

        // 调用代理后的 setHeader，传入数组
        request.setHeader('Set-Cookie', ['cookie1=value1', 'cookie2=value2'])

        // 验证原始 setHeader 被调用
        expect(originalSetHeader).toHaveBeenCalledWith('Set-Cookie', [
          'cookie1=value1',
          'cookie2=value2'
        ])
      })
    })

    describe('请求体处理', () => {
      test('write 方法代理 - JSON 数据', () => {
        const mockRequest = createMockClientRequest()
        const originalWrite = mockRequest.write
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/api',
          method: 'POST'
        }
        const request = proxyFn(options)

        const jsonData = JSON.stringify({ key: 'value' })
        request.write(jsonData)

        // 验证原始 write 被调用
        expect(originalWrite).toHaveBeenCalledWith(jsonData)
      })

      test('write 方法代理 - 非 JSON 数据', () => {
        const mockRequest = createMockClientRequest()
        const originalWrite = mockRequest.write
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/api',
          method: 'POST'
        }
        const request = proxyFn(options)

        const rawData = 'plain text data'
        request.write(rawData)

        // 验证原始 write 被调用
        expect(originalWrite).toHaveBeenCalledWith(rawData)
      })

      test('write 方法代理 - Buffer 数据', () => {
        const mockRequest = createMockClientRequest()
        const originalWrite = mockRequest.write
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/api',
          method: 'POST'
        }
        const request = proxyFn(options)

        const bufferData = Buffer.from('buffer data')
        request.write(bufferData)

        // 验证原始 write 被调用
        expect(originalWrite).toHaveBeenCalledWith(bufferData)
      })
    })

    describe('普通 HTTP 请求处理', () => {
      test('非 WebSocket 请求发送 registerRequest', () => {
        const mockRequest = createMockClientRequest()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/api',
          method: 'GET'
        }
        proxyFn(options)

        // 验证 registerRequest 被调用
        expect(mockSendRequest).toHaveBeenCalledWith('registerRequest', expect.any(RequestDetail))
      })

      test('响应回调正确处理', () => {
        const mockRequest = createMockClientRequest()
        const mockResponse = createMockIncomingMessage({
          statusCode: 200,
          headers: { 'content-type': 'application/json' }
        })

        let capturedCallback: ((res: IncomingMessage) => void) | undefined
        const mockActualRequestHandler = vi
          .fn()
          .mockImplementation(
            (_options: RequestOptions, callback: (res: IncomingMessage) => void) => {
              capturedCallback = callback
              return mockRequest
            }
          )
        const { mockMainProcess, mockResponseRequest } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const userCallback = vi.fn()
        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/api',
          method: 'GET'
        }
        proxyFn(options, userCallback)

        // 模拟响应
        expect(capturedCallback).toBeDefined()
        capturedCallback!(mockResponse as IncomingMessage)

        // 验证用户回调被调用
        expect(userCallback).toHaveBeenCalledWith(mockResponse)
        // 验证 responseRequest 被调用
        expect(mockResponseRequest).toHaveBeenCalled()
      })

      test('没有用户回调时也能正常处理响应', () => {
        const mockRequest = createMockClientRequest()
        const mockResponse = createMockIncomingMessage({ statusCode: 200 })

        let capturedCallback: ((res: IncomingMessage) => void) | undefined
        const mockActualRequestHandler = vi
          .fn()
          .mockImplementation(
            (_options: RequestOptions, callback: (res: IncomingMessage) => void) => {
              capturedCallback = callback
              return mockRequest
            }
          )
        const { mockMainProcess, mockResponseRequest } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/api',
          method: 'GET'
        }
        // 不传递回调
        proxyFn(options)

        // 模拟响应
        expect(capturedCallback).toBeDefined()
        capturedCallback!(mockResponse as IncomingMessage)

        // 验证 responseRequest 被调用
        expect(mockResponseRequest).toHaveBeenCalled()
      })
    })

    describe('错误处理', () => {
      test('请求错误时发送 endRequest', () => {
        const mockRequest = createMockClientRequest()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/api',
          method: 'GET'
        }
        proxyFn(options)

        // 模拟错误事件
        mockRequest.emit('error', new Error('Connection refused'))

        // 验证 endRequest 被调用，且状态码为 0
        expect(mockSendRequest).toHaveBeenCalledWith(
          'endRequest',
          expect.objectContaining({
            responseStatusCode: 0
          })
        )
      })

      test('请求错误时记录结束时间', () => {
        const mockRequest = createMockClientRequest()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const beforeTime = Date.now()
        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/api',
          method: 'GET'
        }
        proxyFn(options)

        // 模拟错误事件
        mockRequest.emit('error', new Error('Connection refused'))
        const afterTime = Date.now()

        // 获取 endRequest 调用的参数
        const endRequestCall = mockSendRequest.mock.calls.find((call) => call[0] === 'endRequest')
        expect(endRequestCall).toBeDefined()
        const requestDetail = endRequestCall![1] as RequestDetail
        expect(requestDetail.requestEndTime).toBeGreaterThanOrEqual(beforeTime)
        expect(requestDetail.requestEndTime).toBeLessThanOrEqual(afterTime)
      })
    })

    describe('WebSocket 请求处理', () => {
      test('WebSocket 请求 URL 转换为 ws:// 协议', () => {
        const mockRequest = createMockClientRequest()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/',
          method: 'GET',
          headers: {
            Upgrade: 'websocket',
            Connection: 'Upgrade'
          }
        }
        proxyFn(options)

        // 验证 URL 被转换为 ws://
        expect(mockSendRequest).toHaveBeenCalledWith(
          'initRequest',
          expect.objectContaining({
            url: expect.stringMatching(/^ws:\/\//)
          })
        )
      })

      test('HTTPS WebSocket 请求 URL 转换为 wss:// 协议', () => {
        const mockRequest = createMockClientRequest()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          true, // isHttps = true
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/',
          method: 'GET',
          headers: {
            Upgrade: 'websocket',
            Connection: 'Upgrade'
          }
        }
        proxyFn(options)

        // 验证 URL 被转换为 wss://
        expect(mockSendRequest).toHaveBeenCalledWith(
          'initRequest',
          expect.objectContaining({
            url: expect.stringMatching(/^wss:\/\//)
          })
        )
      })

      test('WebSocket 请求不发送 registerRequest', () => {
        const mockRequest = createMockClientRequest()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/',
          method: 'GET',
          headers: {
            Upgrade: 'websocket'
          }
        }
        proxyFn(options)

        // 验证 registerRequest 没有被调用
        const registerRequestCalls = mockSendRequest.mock.calls.filter(
          (call) => call[0] === 'registerRequest'
        )
        expect(registerRequestCalls.length).toBe(0)
      })

      test('WebSocket upgrade 事件处理 - 发送 webSocketCreated', async () => {
        const mockRequest = createMockClientRequest()
        const mockResponse = createMockIncomingMessage({ statusCode: 101 })
        const mockSocket = createMockSocket()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess, mockSend } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/ws',
          method: 'GET',
          headers: {
            Upgrade: 'websocket'
          }
        }
        proxyFn(options)

        // 模拟 upgrade 事件
        mockRequest.emit('upgrade', mockResponse, mockSocket, Buffer.alloc(0))

        // 等待异步操作
        await new Promise((resolve) => setTimeout(resolve, 10))

        // 验证 webSocketCreated 消息被发送
        expect(mockSend).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'Network.webSocketCreated'
          })
        )
      })

      test('WebSocket 隐藏请求不发送消息', async () => {
        const mockRequest = createMockClientRequest()
        const mockResponse = createMockIncomingMessage({ statusCode: 101 })
        const mockSocket = createMockSocket()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess, mockSend } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        // 使用 localhost 的隐藏 URL
        const options: RequestOptions = {
          hostname: 'localhost',
          path: '/',
          method: 'GET',
          headers: {
            Upgrade: 'websocket'
          }
        }
        proxyFn(options)

        // 模拟 upgrade 事件
        mockRequest.emit('upgrade', mockResponse, mockSocket, Buffer.alloc(0))

        // 等待异步操作
        await new Promise((resolve) => setTimeout(resolve, 10))

        // 验证 webSocketCreated 消息没有被发送
        const webSocketCreatedCalls = mockSend.mock.calls.filter(
          (call) => call[0]?.type === 'Network.webSocketCreated'
        )
        expect(webSocketCreatedCalls.length).toBe(0)
      })
    })

    describe('WebSocket 帧处理', () => {
      test('WebSocket socket close 事件发送 webSocketClosed', async () => {
        const mockRequest = createMockClientRequest()
        const mockResponse = createMockIncomingMessage({ statusCode: 101 })
        const mockSocket = createMockSocket()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess, mockSend } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/ws',
          method: 'GET',
          headers: {
            Upgrade: 'websocket'
          }
        }
        proxyFn(options)

        // 模拟 upgrade 事件
        mockRequest.emit('upgrade', mockResponse, mockSocket, Buffer.alloc(0))

        // 等待异步操作
        await new Promise((resolve) => setTimeout(resolve, 10))

        // 模拟 socket close 事件
        mockSocket.emit('close')

        // 等待异步操作
        await new Promise((resolve) => setTimeout(resolve, 10))

        // 验证 webSocketClosed 消息被发送
        expect(mockSend).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'Network.webSocketClosed'
          })
        )
      })

      test('WebSocket socket end 事件正确处理', async () => {
        const mockRequest = createMockClientRequest()
        const mockResponse = createMockIncomingMessage({ statusCode: 101 })
        const mockSocket = createMockSocket()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/ws',
          method: 'GET',
          headers: {
            Upgrade: 'websocket'
          }
        }
        proxyFn(options)

        // 模拟 upgrade 事件
        mockRequest.emit('upgrade', mockResponse, mockSocket, Buffer.alloc(0))

        // 等待异步操作
        await new Promise((resolve) => setTimeout(resolve, 10))

        // 模拟 socket end 事件 - 不应该抛出错误
        expect(() => mockSocket.emit('end')).not.toThrow()
      })
    })

    describe('原始请求处理器调用', () => {
      test('字符串 URL 参数正确传递给原始处理器', () => {
        const mockRequest = createMockClientRequest()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const callback = vi.fn()
        proxyFn('http://example.com/api', { method: 'POST' }, callback)

        // 验证原始处理器被调用，参数正确
        expect(mockActualRequestHandler).toHaveBeenCalledWith(
          'http://example.com/api',
          { method: 'POST' },
          expect.any(Function)
        )
      })

      test('RequestOptions 参数正确传递给原始处理器', () => {
        const mockRequest = createMockClientRequest()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/api',
          method: 'GET'
        }
        proxyFn(options)

        // 验证原始处理器被调用，参数正确
        expect(mockActualRequestHandler).toHaveBeenCalledWith(options, expect.any(Function))
      })

      test('返回代理后的 ClientRequest', () => {
        const mockRequest = createMockClientRequest()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/api',
          method: 'GET'
        }
        const result = proxyFn(options)

        // 验证返回的是代理后的请求对象
        expect(result).toBeDefined()
        expect(typeof result.write).toBe('function')
        expect(typeof result.setHeader).toBe('function')
      })
    })

    describe('调用栈加载', () => {
      test('请求创建时加载调用栈', () => {
        const mockRequest = createMockClientRequest()
        const mockActualRequestHandler = vi.fn().mockReturnValue(mockRequest)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/api',
          method: 'GET'
        }
        proxyFn(options)

        // 获取 initRequest 调用的参数
        const initRequestCall = mockSendRequest.mock.calls.find((call) => call[0] === 'initRequest')
        expect(initRequestCall).toBeDefined()
        const requestDetail = initRequestCall![1] as RequestDetail

        // 验证 RequestDetail 实例被创建
        expect(requestDetail).toBeInstanceOf(RequestDetail)
      })
    })

    describe('响应头处理', () => {
      test('响应头正确记录到 RequestDetail', () => {
        const mockRequest = createMockClientRequest()
        const responseHeaders = {
          'content-type': 'application/json',
          'x-custom-header': 'custom-value'
        }
        const mockResponse = createMockIncomingMessage({
          statusCode: 200,
          headers: responseHeaders
        })

        let capturedCallback: ((res: IncomingMessage) => void) | undefined
        const mockActualRequestHandler = vi
          .fn()
          .mockImplementation(
            (_options: RequestOptions, callback: (res: IncomingMessage) => void) => {
              capturedCallback = callback
              return mockRequest
            }
          )
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = requestProxyFactory.call(
          null,
          mockActualRequestHandler,
          false,
          mockMainProcess as never
        )

        const options: RequestOptions = {
          hostname: 'example.com',
          path: '/api',
          method: 'GET'
        }
        proxyFn(options)

        // 模拟响应
        expect(capturedCallback).toBeDefined()
        capturedCallback!(mockResponse as IncomingMessage)

        // 获取 initRequest 调用的参数，验证 responseHeaders 被设置
        const initRequestCall = mockSendRequest.mock.calls.find((call) => call[0] === 'initRequest')
        expect(initRequestCall).toBeDefined()
        const requestDetail = initRequestCall![1] as RequestDetail
        expect(requestDetail.responseHeaders).toEqual(responseHeaders)
      })
    })
  })
})

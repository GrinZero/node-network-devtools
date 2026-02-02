import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { RequestDetail } from '../../../common'
import type { DevtoolMessageListener } from '../../request-center'
import type { IncomingMessage } from 'http'

// 使用 vi.hoisted 确保变量在 mock 提升时可用
const { mockCoreOn, mockDevtoolSend, registeredHandlers, mockUsePlugin, mockGetRequest } =
  vi.hoisted(() => {
    const handlers = new Map<string, DevtoolMessageListener<unknown>[]>()
    return {
      mockCoreOn: vi.fn((type: string, fn: DevtoolMessageListener<unknown>) => {
        if (!handlers.has(type)) {
          handlers.set(type, [])
        }
        handlers.get(type)!.push(fn)
        return () => {
          const list = handlers.get(type)
          if (list) {
            const index = list.indexOf(fn)
            if (index > -1) {
              list.splice(index, 1)
            }
          }
        }
      }),
      mockDevtoolSend: vi.fn().mockResolvedValue(undefined),
      registeredHandlers: handlers,
      mockUsePlugin: vi.fn(),
      mockGetRequest: vi.fn()
    }
  })

// Mock DevtoolServer 和 RequestCenter 模块
vi.mock('../../devtool', () => ({
  DevtoolServer: vi.fn()
}))

vi.mock('../../request-center', () => ({
  RequestCenter: vi.fn()
}))

// 创建测试用的 mock 上下文对象
const createMockContext = () => ({
  devtool: {
    send: mockDevtoolSend,
    getTimestamp: vi.fn().mockReturnValue(Date.now() / 1000),
    updateTimestamp: vi.fn(),
    timestamp: 0
  },
  core: {
    on: mockCoreOn,
    usePlugin: mockUsePlugin
  },
  plugins: []
})

// 创建测试用的 RequestDetail
function createTestRequest(overrides: Partial<RequestDetail> = {}): RequestDetail {
  const request = new RequestDetail()
  request.id = overrides.id || 'ws-test-request-id'
  request.url = overrides.url || 'ws://example.com/socket'
  request.method = overrides.method || 'GET'
  request.requestHeaders = overrides.requestHeaders || {
    Upgrade: 'websocket',
    Connection: 'Upgrade',
    'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ=='
  }
  request.initiator = overrides.initiator || {
    type: 'script',
    stack: {
      callFrames: [
        {
          columnNumber: 10,
          functionName: 'connect',
          lineNumber: 20,
          url: 'file:///path/to/app.js'
        }
      ]
    }
  }
  return request
}

// 创建 mock IncomingMessage
function createMockIncomingMessage(
  overrides: Partial<{
    statusCode: number
    statusMessage: string
    httpVersion: string
    rawHeaders: string[]
  }>
): IncomingMessage {
  return {
    statusCode: overrides.statusCode ?? 101,
    statusMessage: overrides.statusMessage ?? 'Switching Protocols',
    httpVersion: overrides.httpVersion ?? '1.1',
    rawHeaders: overrides.rawHeaders ?? [
      'Upgrade',
      'websocket',
      'Connection',
      'Upgrade',
      'Sec-WebSocket-Accept',
      's3pPLMBiTxaQ9kYGzzhZRbK+xOo='
    ]
  } as IncomingMessage
}

describe('fork/module/websocket/index.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registeredHandlers.clear()

    // 设置 mockUsePlugin 返回 network 插件的 mock
    mockUsePlugin.mockReturnValue({
      getRequest: mockGetRequest,
      resourceService: {
        getScriptSource: vi.fn(),
        getLocalScriptList: vi.fn().mockReturnValue([]),
        getScriptIdByUrl: vi.fn()
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('websocketPlugin', () => {
    test('插件具有正确的 id', async () => {
      const { websocketPlugin } = await import('./index')

      expect(websocketPlugin.id).toBe('websocket')
    })

    test('插件使用 network 插件', async () => {
      const { websocketPlugin } = await import('./index')

      const context = createMockContext()
      ;(websocketPlugin as Function)(context)

      expect(mockUsePlugin).toHaveBeenCalledWith('network')
    })

    test('插件注册所有 WebSocket 相关处理器', async () => {
      const { websocketPlugin } = await import('./index')

      const context = createMockContext()
      ;(websocketPlugin as Function)(context)

      expect(mockCoreOn).toHaveBeenCalledWith('Network.webSocketCreated', expect.any(Function))
      expect(mockCoreOn).toHaveBeenCalledWith('Network.webSocketFrameSent', expect.any(Function))
      expect(mockCoreOn).toHaveBeenCalledWith(
        'Network.webSocketFrameReceived',
        expect.any(Function)
      )
      expect(mockCoreOn).toHaveBeenCalledWith('Network.webSocketClosed', expect.any(Function))
    })
  })

  describe('Network.webSocketCreated 处理器', () => {
    test('发送 WebSocket 创建和握手消息序列', async () => {
      const { websocketPlugin } = await import('./index')

      const testRequest = createTestRequest({ id: 'ws-created-test' })
      mockGetRequest.mockReturnValue(testRequest)

      const context = createMockContext()
      ;(websocketPlugin as Function)(context)

      const webSocketCreatedHandlers = registeredHandlers.get('Network.webSocketCreated')
      expect(webSocketCreatedHandlers).toBeDefined()

      const mockResponse = createMockIncomingMessage({})

      await webSocketCreatedHandlers![0]({
        data: {
          requestId: 'ws-created-test',
          url: 'ws://example.com/socket',
          initiator: testRequest.initiator,
          response: mockResponse
        },
        id: undefined
      })

      // 验证发送了 webSocketCreated
      expect(mockDevtoolSend).toHaveBeenCalledWith({
        method: 'Network.webSocketCreated',
        params: expect.objectContaining({
          url: 'ws://example.com/socket',
          requestId: 'ws-created-test'
        })
      })

      // 验证发送了 webSocketWillSendHandshakeRequest
      expect(mockDevtoolSend).toHaveBeenCalledWith({
        method: 'Network.webSocketWillSendHandshakeRequest',
        params: expect.objectContaining({
          requestId: 'ws-created-test',
          request: expect.objectContaining({
            headers: testRequest.requestHeaders
          })
        })
      })

      // 验证发送了 webSocketHandshakeResponseReceived
      expect(mockDevtoolSend).toHaveBeenCalledWith({
        method: 'Network.webSocketHandshakeResponseReceived',
        params: expect.objectContaining({
          requestId: 'ws-created-test',
          response: expect.objectContaining({
            status: 101,
            statusText: 'Switching Protocols'
          })
        })
      })
    })

    test('没有 requestId 时不处理', async () => {
      const { websocketPlugin } = await import('./index')

      const context = createMockContext()
      ;(websocketPlugin as Function)(context)

      const webSocketCreatedHandlers = registeredHandlers.get('Network.webSocketCreated')

      await webSocketCreatedHandlers![0]({
        data: {
          requestId: '',
          url: 'ws://example.com/socket',
          initiator: { type: 'script', stack: { callFrames: [] } },
          response: createMockIncomingMessage({})
        },
        id: undefined
      })

      expect(mockDevtoolSend).not.toHaveBeenCalled()
    })

    test('请求不存在时不处理', async () => {
      const { websocketPlugin } = await import('./index')

      mockGetRequest.mockReturnValue(undefined)

      const context = createMockContext()
      ;(websocketPlugin as Function)(context)

      const webSocketCreatedHandlers = registeredHandlers.get('Network.webSocketCreated')

      await webSocketCreatedHandlers![0]({
        data: {
          requestId: 'non-existent-request',
          url: 'ws://example.com/socket',
          initiator: { type: 'script', stack: { callFrames: [] } },
          response: createMockIncomingMessage({})
        },
        id: undefined
      })

      expect(mockDevtoolSend).not.toHaveBeenCalled()
    })

    test('正确解析响应头', async () => {
      const { websocketPlugin } = await import('./index')

      const testRequest = createTestRequest({ id: 'ws-headers-test' })
      mockGetRequest.mockReturnValue(testRequest)

      const context = createMockContext()
      ;(websocketPlugin as Function)(context)

      const webSocketCreatedHandlers = registeredHandlers.get('Network.webSocketCreated')

      const mockResponse = createMockIncomingMessage({
        rawHeaders: [
          'Upgrade',
          'websocket',
          'Connection',
          'Upgrade',
          'Sec-WebSocket-Accept',
          'test-accept-key',
          'X-Custom-Header',
          'custom-value'
        ]
      })

      await webSocketCreatedHandlers![0]({
        data: {
          requestId: 'ws-headers-test',
          url: 'ws://example.com/socket',
          initiator: testRequest.initiator,
          response: mockResponse
        },
        id: undefined
      })

      expect(mockDevtoolSend).toHaveBeenCalledWith({
        method: 'Network.webSocketHandshakeResponseReceived',
        params: expect.objectContaining({
          response: expect.objectContaining({
            headers: expect.objectContaining({
              Upgrade: 'websocket',
              Connection: 'Upgrade',
              'Sec-WebSocket-Accept': 'test-accept-key',
              'X-Custom-Header': 'custom-value'
            })
          })
        })
      })
    })
  })

  describe('Network.webSocketFrameSent 处理器', () => {
    test('发送 WebSocket 帧发送消息', async () => {
      const { websocketPlugin } = await import('./index')

      const context = createMockContext()
      ;(websocketPlugin as Function)(context)

      const webSocketFrameSentHandlers = registeredHandlers.get('Network.webSocketFrameSent')
      expect(webSocketFrameSentHandlers).toBeDefined()

      await webSocketFrameSentHandlers![0]({
        data: {
          requestId: 'ws-frame-sent-test',
          response: {
            payloadData: 'Hello, WebSocket!',
            opcode: 1,
            mask: true
          }
        },
        id: undefined
      })

      expect(mockDevtoolSend).toHaveBeenCalledWith({
        method: 'Network.webSocketFrameSent',
        params: expect.objectContaining({
          requestId: 'ws-frame-sent-test',
          response: {
            payloadData: 'Hello, WebSocket!',
            opcode: 1,
            mask: true
          }
        })
      })
    })

    test('没有 requestId 时不发送', async () => {
      const { websocketPlugin } = await import('./index')

      const context = createMockContext()
      ;(websocketPlugin as Function)(context)

      const webSocketFrameSentHandlers = registeredHandlers.get('Network.webSocketFrameSent')

      await webSocketFrameSentHandlers![0]({
        data: {
          requestId: '',
          response: {
            payloadData: 'test',
            opcode: 1,
            mask: true
          }
        },
        id: undefined
      })

      expect(mockDevtoolSend).not.toHaveBeenCalled()
    })

    test('发送二进制帧数据', async () => {
      const { websocketPlugin } = await import('./index')

      const context = createMockContext()
      ;(websocketPlugin as Function)(context)

      const webSocketFrameSentHandlers = registeredHandlers.get('Network.webSocketFrameSent')

      await webSocketFrameSentHandlers![0]({
        data: {
          requestId: 'ws-binary-frame-test',
          response: {
            payloadData: 'SGVsbG8gV29ybGQ=', // base64 encoded
            opcode: 2, // binary frame
            mask: true
          }
        },
        id: undefined
      })

      expect(mockDevtoolSend).toHaveBeenCalledWith({
        method: 'Network.webSocketFrameSent',
        params: expect.objectContaining({
          response: expect.objectContaining({
            opcode: 2
          })
        })
      })
    })
  })

  describe('Network.webSocketFrameReceived 处理器', () => {
    test('发送 WebSocket 帧接收消息', async () => {
      const { websocketPlugin } = await import('./index')

      const context = createMockContext()
      ;(websocketPlugin as Function)(context)

      const webSocketFrameReceivedHandlers = registeredHandlers.get(
        'Network.webSocketFrameReceived'
      )
      expect(webSocketFrameReceivedHandlers).toBeDefined()

      await webSocketFrameReceivedHandlers![0]({
        data: {
          requestId: 'ws-frame-received-test',
          response: {
            payloadData: 'Response from server',
            opcode: 1,
            mask: false
          }
        },
        id: undefined
      })

      expect(mockDevtoolSend).toHaveBeenCalledWith({
        method: 'Network.webSocketFrameReceived',
        params: expect.objectContaining({
          requestId: 'ws-frame-received-test',
          response: {
            payloadData: 'Response from server',
            opcode: 1,
            mask: false
          }
        })
      })
    })

    test('没有 requestId 时不发送', async () => {
      const { websocketPlugin } = await import('./index')

      const context = createMockContext()
      ;(websocketPlugin as Function)(context)

      const webSocketFrameReceivedHandlers = registeredHandlers.get(
        'Network.webSocketFrameReceived'
      )

      await webSocketFrameReceivedHandlers![0]({
        data: {
          requestId: '',
          response: {
            payloadData: 'test',
            opcode: 1,
            mask: false
          }
        },
        id: undefined
      })

      expect(mockDevtoolSend).not.toHaveBeenCalled()
    })
  })

  describe('Network.webSocketClosed 处理器', () => {
    test('发送 WebSocket 关闭消息', async () => {
      const { websocketPlugin } = await import('./index')

      const context = createMockContext()
      ;(websocketPlugin as Function)(context)

      const webSocketClosedHandlers = registeredHandlers.get('Network.webSocketClosed')
      expect(webSocketClosedHandlers).toBeDefined()

      await webSocketClosedHandlers![0]({
        data: {
          requestId: 'ws-closed-test',
          response: {
            payloadData: '',
            opcode: 8, // close frame
            mask: false
          }
        },
        id: undefined
      })

      expect(mockDevtoolSend).toHaveBeenCalledWith({
        method: 'Network.webSocketClosed',
        params: expect.objectContaining({
          requestId: 'ws-closed-test'
        })
      })
    })

    test('没有 requestId 时不发送', async () => {
      const { websocketPlugin } = await import('./index')

      const context = createMockContext()
      ;(websocketPlugin as Function)(context)

      const webSocketClosedHandlers = registeredHandlers.get('Network.webSocketClosed')

      await webSocketClosedHandlers![0]({
        data: {
          requestId: '',
          response: {
            payloadData: '',
            opcode: 8,
            mask: false
          }
        },
        id: undefined
      })

      expect(mockDevtoolSend).not.toHaveBeenCalled()
    })
  })

  describe('WebSocketFrameSent 接口', () => {
    test('帧数据包含所有必要字段', async () => {
      const { websocketPlugin } = await import('./index')

      const context = createMockContext()
      ;(websocketPlugin as Function)(context)

      const webSocketFrameSentHandlers = registeredHandlers.get('Network.webSocketFrameSent')

      const frameData = {
        requestId: 'interface-test',
        response: {
          payloadData: 'test payload',
          opcode: 1,
          mask: true
        }
      }

      await webSocketFrameSentHandlers![0]({
        data: frameData,
        id: undefined
      })

      expect(mockDevtoolSend).toHaveBeenCalledWith({
        method: 'Network.webSocketFrameSent',
        params: expect.objectContaining({
          requestId: 'interface-test',
          response: expect.objectContaining({
            payloadData: 'test payload',
            opcode: 1,
            mask: true
          })
        })
      })
    })
  })

  describe('WebSocketCreated 接口', () => {
    test('创建数据包含所有必要字段', async () => {
      const { websocketPlugin } = await import('./index')

      const testRequest = createTestRequest({
        id: 'ws-interface-test',
        url: 'ws://example.com/test'
      })
      mockGetRequest.mockReturnValue(testRequest)

      const context = createMockContext()
      ;(websocketPlugin as Function)(context)

      const webSocketCreatedHandlers = registeredHandlers.get('Network.webSocketCreated')

      const createdData = {
        requestId: 'ws-interface-test',
        url: 'ws://example.com/test',
        initiator: {
          type: 'script',
          stack: {
            callFrames: [
              {
                columnNumber: 5,
                functionName: 'initWebSocket',
                lineNumber: 100,
                url: 'file:///app/main.js'
              }
            ]
          }
        },
        response: createMockIncomingMessage({})
      }

      await webSocketCreatedHandlers![0]({
        data: createdData,
        id: undefined
      })

      expect(mockDevtoolSend).toHaveBeenCalledWith({
        method: 'Network.webSocketCreated',
        params: expect.objectContaining({
          url: 'ws://example.com/test',
          requestId: 'ws-interface-test',
          initiator: testRequest.initiator
        })
      })
    })
  })
})

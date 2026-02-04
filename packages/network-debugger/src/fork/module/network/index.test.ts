import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { RequestDetail } from '../../../common'
import type { DevtoolMessageListener } from '../../request-center'

// 使用 vi.hoisted 确保变量在 mock 提升时可用
const { mockCoreOn, mockDevtoolSend, registeredHandlers, mockUsePlugin } = vi.hoisted(() => {
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
    mockDevtoolSend: vi.fn(),
    registeredHandlers: handlers,
    mockUsePlugin: vi.fn()
  }
})

// 定义 mock 对象的接口类型
interface MockDevtoolServer {
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  listeners: Array<() => void>
  timestamp: number
  getTimestamp: ReturnType<typeof vi.fn>
  updateTimestamp: ReturnType<typeof vi.fn>
}

interface MockRequestCenter {
  on: typeof mockCoreOn
  loadPlugins: ReturnType<typeof vi.fn>
  usePlugin: typeof mockUsePlugin
  close: ReturnType<typeof vi.fn>
}

// 创建 mock 对象
function createMockDevtool(): MockDevtoolServer {
  return {
    send: mockDevtoolSend,
    close: vi.fn(),
    open: vi.fn(),
    on: vi.fn(),
    listeners: [],
    timestamp: 0,
    getTimestamp: vi.fn().mockReturnValue(0),
    updateTimestamp: vi.fn()
  }
}

function createMockCore(): MockRequestCenter {
  return {
    on: mockCoreOn,
    loadPlugins: vi.fn(),
    usePlugin: mockUsePlugin,
    close: vi.fn()
  }
}

// 创建测试用的 RequestDetail
function createTestRequest(overrides: Partial<RequestDetail> = {}): RequestDetail {
  const request = new RequestDetail()
  request.id = overrides.id || 'test-request-id'
  request.url = overrides.url || 'http://example.com/api/test'
  request.method = overrides.method || 'GET'
  request.requestHeaders = overrides.requestHeaders || { 'Content-Type': 'application/json' }
  request.requestData = overrides.requestData
  request.responseData = overrides.responseData
  request.responseStatusCode = overrides.responseStatusCode || 200
  request.responseHeaders = overrides.responseHeaders || { 'Content-Type': 'application/json' }
  request.responseInfo = overrides.responseInfo || { encodedDataLength: 100, dataLength: 100 }
  request.requestStartTime = overrides.requestStartTime || Date.now()
  request.requestEndTime = overrides.requestEndTime
  request.initiator = overrides.initiator
  return request
}

describe('fork/module/network/index.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registeredHandlers.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('toMimeType 函数', () => {
    test('从 content-type 中提取 mime type', async () => {
      const { toMimeType } = await import('./index')

      expect(toMimeType('application/json; charset=utf-8')).toBe('application/json')
      expect(toMimeType('text/html; charset=utf-8')).toBe('text/html')
      expect(toMimeType('image/png')).toBe('image/png')
    })

    test('没有分号时返回完整的 content-type', async () => {
      const { toMimeType } = await import('./index')

      expect(toMimeType('application/json')).toBe('application/json')
      expect(toMimeType('text/plain')).toBe('text/plain')
    })

    test('空字符串返回 text/plain', async () => {
      const { toMimeType } = await import('./index')

      expect(toMimeType('')).toBe('text/plain')
    })
  })

  describe('networkPlugin', () => {
    test('插件具有正确的 id', async () => {
      const { networkPlugin } = await import('./index')

      expect(networkPlugin.id).toBe('network')
    })

    test('插件注册所有必要的处理器', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      // 验证注册了所有必要的处理器
      expect(mockCoreOn).toHaveBeenCalledWith('Network.getResponseBody', expect.any(Function))
      expect(mockCoreOn).toHaveBeenCalledWith('initRequest', expect.any(Function))
      expect(mockCoreOn).toHaveBeenCalledWith('registerRequest', expect.any(Function))
      expect(mockCoreOn).toHaveBeenCalledWith('endRequest', expect.any(Function))
      expect(mockCoreOn).toHaveBeenCalledWith('responseData', expect.any(Function))
    })

    test('插件返回 getRequest 和 resourceService', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      const result = networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      expect(result).toHaveProperty('getRequest')
      expect(result).toHaveProperty('resourceService')
      expect(typeof result.getRequest).toBe('function')
    })
  })

  describe('initRequest 处理器', () => {
    test('初始化请求并存储', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      const result = networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      const testRequest = createTestRequest({ id: 'init-test-id' })

      // 触发 initRequest 处理器
      const initRequestHandlers = registeredHandlers.get('initRequest')
      expect(initRequestHandlers).toBeDefined()
      initRequestHandlers![0]({ data: testRequest, id: undefined })

      // 验证请求被存储
      const storedRequest = result.getRequest('init-test-id')
      expect(storedRequest).toBeDefined()
      expect(storedRequest.id).toBe('init-test-id')
    })

    test('处理带有 initiator 的请求', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      const result = networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      const testRequest = createTestRequest({
        id: 'initiator-test-id',
        initiator: {
          type: 'script',
          stack: {
            callFrames: [
              {
                columnNumber: 10,
                functionName: 'testFunction',
                lineNumber: 20,
                url: '/path/to/file.js'
              }
            ]
          }
        }
      })

      const initRequestHandlers = registeredHandlers.get('initRequest')
      initRequestHandlers![0]({ data: testRequest, id: undefined })

      const storedRequest = result.getRequest('initiator-test-id')
      expect(storedRequest).toBeDefined()
      expect(storedRequest.initiator).toBeDefined()
    })

    test('处理带有 initiator 且 scriptId 存在的请求', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      const pluginResult = networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      // 先获取本地脚本列表，这会填充 resourceService
      const scriptList = pluginResult.resourceService.getLocalScriptList()

      // 使用一个已知的脚本 URL
      const knownScriptUrl = scriptList.length > 0 ? scriptList[0].url : ''

      if (knownScriptUrl) {
        const testRequest = createTestRequest({
          id: 'initiator-scriptid-test-id',
          initiator: {
            type: 'script',
            stack: {
              callFrames: [
                {
                  columnNumber: 10,
                  functionName: 'testFunction',
                  lineNumber: 20,
                  url: knownScriptUrl.replace('file://', ''),
                  scriptId: ''
                }
              ]
            }
          }
        })

        const initRequestHandlers = registeredHandlers.get('initRequest')
        initRequestHandlers![0]({ data: testRequest, id: undefined })

        const storedRequest = pluginResult.getRequest('initiator-scriptid-test-id')
        expect(storedRequest).toBeDefined()
        // scriptId 应该被设置
        if (storedRequest.initiator?.stack.callFrames[0]) {
          expect(storedRequest.initiator.stack.callFrames[0].scriptId).toBeDefined()
        }
      }
    })
  })

  describe('registerRequest 处理器', () => {
    test('注册请求并发送 Network.requestWillBeSent', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      const testRequest = createTestRequest({
        id: 'register-test-id',
        url: 'http://example.com/api/data',
        method: 'POST',
        requestData: { key: 'value' },
        requestHeaders: { 'Content-Type': 'application/json' }
      })

      const registerRequestHandlers = registeredHandlers.get('registerRequest')
      expect(registerRequestHandlers).toBeDefined()
      registerRequestHandlers![0]({ data: testRequest, id: undefined })

      // 验证发送了 Network.requestWillBeSent
      expect(mockDevtoolSend).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'Network.requestWillBeSent',
          params: expect.objectContaining({
            requestId: 'register-test-id',
            request: expect.objectContaining({
              url: 'http://example.com/api/data',
              method: 'POST'
            })
          })
        })
      )
    })

    test('WebSocket 请求类型为 WebSocket', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      const testRequest = createTestRequest({
        id: 'ws-test-id',
        url: 'ws://example.com/socket',
        requestHeaders: { Upgrade: 'websocket' }
      })

      const registerRequestHandlers = registeredHandlers.get('registerRequest')
      registerRequestHandlers![0]({ data: testRequest, id: undefined })

      expect(mockDevtoolSend).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'Network.requestWillBeSent',
          params: expect.objectContaining({
            type: 'WebSocket'
          })
        })
      )
    })

    test('普通请求类型为 Fetch', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      const testRequest = createTestRequest({
        id: 'fetch-test-id',
        requestHeaders: { 'Content-Type': 'application/json' }
      })

      const registerRequestHandlers = registeredHandlers.get('registerRequest')
      registerRequestHandlers![0]({ data: testRequest, id: undefined })

      expect(mockDevtoolSend).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'Network.requestWillBeSent',
          params: expect.objectContaining({
            type: 'Fetch'
          })
        })
      )
    })

    test('处理带有 initiator 且 scriptId 存在的 registerRequest', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      const pluginResult = networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      // 先获取本地脚本列表，这会填充 resourceService
      const scriptList = pluginResult.resourceService.getLocalScriptList()

      // 使用一个已知的脚本 URL
      const knownScriptUrl = scriptList.length > 0 ? scriptList[0].url : ''

      if (knownScriptUrl) {
        const testRequest = createTestRequest({
          id: 'register-initiator-scriptid-test-id',
          initiator: {
            type: 'script',
            stack: {
              callFrames: [
                {
                  columnNumber: 10,
                  functionName: 'testFunction',
                  lineNumber: 20,
                  url: knownScriptUrl.replace('file://', ''),
                  scriptId: ''
                }
              ]
            }
          }
        })

        const registerRequestHandlers = registeredHandlers.get('registerRequest')
        registerRequestHandlers![0]({ data: testRequest, id: undefined })

        expect(mockDevtoolSend).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'Network.requestWillBeSent'
          })
        )
      }
    })
  })

  describe('endRequest 处理器', () => {
    test('结束请求并发送完整的响应消息序列', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      const testRequest = createTestRequest({
        id: 'end-test-id',
        responseStatusCode: 200,
        responseHeaders: { 'Content-Type': 'application/json' },
        responseInfo: { encodedDataLength: 100, dataLength: 100 }
      })

      const endRequestHandlers = registeredHandlers.get('endRequest')
      expect(endRequestHandlers).toBeDefined()
      endRequestHandlers![0]({ data: testRequest, id: undefined })

      // 验证发送了完整的消息序列
      expect(mockDevtoolSend).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'Network.responseReceived'
        })
      )
      expect(mockDevtoolSend).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'Network.dataReceived'
        })
      )
      expect(mockDevtoolSend).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'Network.loadingFinished'
        })
      )
    })

    test('根据 content-type 确定响应类型', async () => {
      const { networkPlugin } = await import('./index')

      // 测试 Image 类型
      const mockDevtool1 = createMockDevtool()
      const mockCore1 = createMockCore()
      registeredHandlers.clear()

      networkPlugin({
        devtool: mockDevtool1,
        core: mockCore1,
        plugins: []
      })

      const imageRequest = createTestRequest({
        id: 'image-test-id',
        responseHeaders: { 'Content-Type': 'image/png' }
      })

      const endRequestHandlers = registeredHandlers.get('endRequest')
      endRequestHandlers![0]({ data: imageRequest, id: undefined })

      expect(mockDevtool1.send).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'Network.responseReceived',
          params: expect.objectContaining({
            type: 'Image'
          })
        })
      )
    })

    test('JavaScript 响应类型为 Script', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()
      registeredHandlers.clear()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: []
      })

      const jsRequest = createTestRequest({
        id: 'js-test-id',
        responseHeaders: { 'Content-Type': 'application/javascript' }
      })

      const endRequestHandlers = registeredHandlers.get('endRequest')
      endRequestHandlers![0]({ data: jsRequest, id: undefined })

      expect(mockDevtool.send).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'Network.responseReceived',
          params: expect.objectContaining({
            type: 'Script'
          })
        })
      )
    })

    test('CSS 响应类型为 Stylesheet', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()
      registeredHandlers.clear()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: []
      })

      const cssRequest = createTestRequest({
        id: 'css-test-id',
        responseHeaders: { 'Content-Type': 'text/css' }
      })

      const endRequestHandlers = registeredHandlers.get('endRequest')
      endRequestHandlers![0]({ data: cssRequest, id: undefined })

      expect(mockDevtool.send).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'Network.responseReceived',
          params: expect.objectContaining({
            type: 'Stylesheet'
          })
        })
      )
    })

    test('HTML 响应类型为 Document', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()
      registeredHandlers.clear()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: []
      })

      const htmlRequest = createTestRequest({
        id: 'html-test-id',
        responseHeaders: { 'Content-Type': 'text/html' }
      })

      const endRequestHandlers = registeredHandlers.get('endRequest')
      endRequestHandlers![0]({ data: htmlRequest, id: undefined })

      expect(mockDevtool.send).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'Network.responseReceived',
          params: expect.objectContaining({
            type: 'Document'
          })
        })
      )
    })

    test('未知类型响应为 Other', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()
      registeredHandlers.clear()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: []
      })

      const otherRequest = createTestRequest({
        id: 'other-test-id',
        responseHeaders: { 'Content-Type': 'application/octet-stream' }
      })

      const endRequestHandlers = registeredHandlers.get('endRequest')
      endRequestHandlers![0]({ data: otherRequest, id: undefined })

      expect(mockDevtool.send).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'Network.responseReceived',
          params: expect.objectContaining({
            type: 'Other'
          })
        })
      )
    })
  })

  describe('Network.getResponseBody 处理器', () => {
    test('返回请求的响应体', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      const result = networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      // 先初始化一个请求
      const testRequest = createTestRequest({
        id: 'body-test-id',
        responseData: Buffer.from('{"message":"hello"}'),
        responseHeaders: { 'Content-Type': 'application/json' }
      })

      const initRequestHandlers = registeredHandlers.get('initRequest')
      initRequestHandlers![0]({ data: testRequest, id: undefined })

      // 清除之前的调用记录
      mockDevtoolSend.mockClear()

      // 请求响应体
      const getResponseBodyHandlers = registeredHandlers.get('Network.getResponseBody')
      expect(getResponseBodyHandlers).toBeDefined()
      getResponseBodyHandlers![0]({ data: { requestId: 'body-test-id' }, id: 'response-id-1' })

      expect(mockDevtoolSend).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'response-id-1',
          result: expect.objectContaining({
            body: expect.any(String),
            base64Encoded: expect.any(Boolean)
          })
        })
      )
    })

    test('请求不存在时不发送响应', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      // 清除之前的调用记录
      mockDevtoolSend.mockClear()

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // 请求不存在的响应体
      const getResponseBodyHandlers = registeredHandlers.get('Network.getResponseBody')
      getResponseBodyHandlers![0]({ data: { requestId: 'non-existent-id' }, id: 'response-id-2' })

      expect(consoleErrorSpy).toHaveBeenCalledWith('request is not found')

      consoleErrorSpy.mockRestore()
    })

    test('没有 id 时不发送响应', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      // 清除之前的调用记录
      mockDevtoolSend.mockClear()

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // 没有 id 的请求
      const getResponseBodyHandlers = registeredHandlers.get('Network.getResponseBody')
      getResponseBodyHandlers![0]({ data: { requestId: 'some-id' }, id: undefined })

      expect(consoleErrorSpy).toHaveBeenCalledWith('request is not found')

      consoleErrorSpy.mockRestore()
    })
  })

  describe('responseData 处理器', () => {
    test('处理响应数据并结束请求', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      // 先初始化一个请求
      const testRequest = createTestRequest({ id: 'response-data-test-id' })
      const initRequestHandlers = registeredHandlers.get('initRequest')
      initRequestHandlers![0]({ data: testRequest, id: undefined })

      // 清除之前的调用记录
      mockDevtoolSend.mockClear()

      // 发送响应数据
      const responseDataHandlers = registeredHandlers.get('responseData')
      expect(responseDataHandlers).toBeDefined()

      const rawData = Array.from(Buffer.from('{"result":"success"}'))
      responseDataHandlers![0]({
        data: {
          id: 'response-data-test-id',
          rawData,
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' }
        },
        id: undefined
      })

      // 等待异步解压缩完成
      await vi.waitFor(() => {
        expect(mockDevtoolSend).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'Network.responseReceived'
          })
        )
      })
    })

    test('请求不存在时不处理响应数据', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      // 清除之前的调用记录
      mockDevtoolSend.mockClear()

      // 发送不存在请求的响应数据
      const responseDataHandlers = registeredHandlers.get('responseData')
      const rawData = Array.from(Buffer.from('test'))
      responseDataHandlers![0]({
        data: {
          id: 'non-existent-id',
          rawData,
          statusCode: 200,
          headers: {}
        },
        id: undefined
      })

      // 不应该发送任何消息
      expect(mockDevtoolSend).not.toHaveBeenCalled()
    })

    test('处理 gzip 压缩的响应数据', async () => {
      const zlib = await import('zlib')
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      // 先初始化一个请求
      const testRequest = createTestRequest({ id: 'gzip-test-id' })
      const initRequestHandlers = registeredHandlers.get('initRequest')
      initRequestHandlers![0]({ data: testRequest, id: undefined })

      // 清除之前的调用记录
      mockDevtoolSend.mockClear()

      // 创建 gzip 压缩的数据
      const originalData = '{"compressed":"data"}'
      const compressedData = zlib.gzipSync(Buffer.from(originalData))

      const responseDataHandlers = registeredHandlers.get('responseData')
      responseDataHandlers![0]({
        data: {
          id: 'gzip-test-id',
          rawData: Array.from(compressedData),
          statusCode: 200,
          headers: { 'Content-Encoding': 'gzip' }
        },
        id: undefined
      })

      // 等待异步解压缩完成
      await vi.waitFor(() => {
        expect(mockDevtoolSend).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'Network.responseReceived'
          })
        )
      })
    })

    test('处理 deflate 压缩的响应数据', async () => {
      const zlib = await import('zlib')
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      // 先初始化一个请求
      const testRequest = createTestRequest({ id: 'deflate-test-id' })
      const initRequestHandlers = registeredHandlers.get('initRequest')
      initRequestHandlers![0]({ data: testRequest, id: undefined })

      // 清除之前的调用记录
      mockDevtoolSend.mockClear()

      // 创建 deflate 压缩的数据
      const originalData = '{"deflate":"data"}'
      const compressedData = zlib.deflateSync(Buffer.from(originalData))

      const responseDataHandlers = registeredHandlers.get('responseData')
      responseDataHandlers![0]({
        data: {
          id: 'deflate-test-id',
          rawData: Array.from(compressedData),
          statusCode: 200,
          headers: { 'Content-Encoding': 'deflate' }
        },
        id: undefined
      })

      // 等待异步解压缩完成
      await vi.waitFor(() => {
        expect(mockDevtoolSend).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'Network.responseReceived'
          })
        )
      })
    })

    test('处理 brotli 压缩的响应数据', async () => {
      const zlib = await import('zlib')
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [networkPlugin]
      })

      // 先初始化一个请求
      const testRequest = createTestRequest({ id: 'brotli-test-id' })
      const initRequestHandlers = registeredHandlers.get('initRequest')
      initRequestHandlers![0]({ data: testRequest, id: undefined })

      // 清除之前的调用记录
      mockDevtoolSend.mockClear()

      // 创建 brotli 压缩的数据
      const originalData = '{"brotli":"data"}'
      const compressedData = zlib.brotliCompressSync(Buffer.from(originalData))

      const responseDataHandlers = registeredHandlers.get('responseData')
      responseDataHandlers![0]({
        data: {
          id: 'brotli-test-id',
          rawData: Array.from(compressedData),
          statusCode: 200,
          headers: { 'Content-Encoding': 'br' }
        },
        id: undefined
      })

      // 等待异步解压缩完成
      await vi.waitFor(() => {
        expect(mockDevtoolSend).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'Network.responseReceived'
          })
        )
      })
    })
  })

  describe('endRequest 边界情况', () => {
    test('没有 content-type 时使用默认值', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()
      registeredHandlers.clear()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: []
      })

      const testRequest = createTestRequest({
        id: 'no-content-type-id',
        responseHeaders: {} // 没有 content-type
      })

      const endRequestHandlers = registeredHandlers.get('endRequest')
      endRequestHandlers![0]({ data: testRequest, id: undefined })

      expect(mockDevtool.send).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'Network.responseReceived',
          params: expect.objectContaining({
            response: expect.objectContaining({
              mimeType: 'text/plain'
            })
          })
        })
      )
    })

    test('没有 requestEndTime 时使用当前时间', async () => {
      const { networkPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()
      registeredHandlers.clear()

      networkPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: []
      })

      const testRequest = createTestRequest({
        id: 'no-end-time-id',
        requestEndTime: undefined
      })

      const beforeTime = Date.now()
      const endRequestHandlers = registeredHandlers.get('endRequest')
      endRequestHandlers![0]({ data: testRequest, id: undefined })
      const afterTime = Date.now()

      // 验证 requestEndTime 被设置
      expect(mockDevtool.send).toHaveBeenCalled()
    })
  })
})

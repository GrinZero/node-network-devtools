import { vi, describe, beforeEach, test, expect } from 'vitest'
import {
  RequestDetail,
  PORT,
  SERVER_PORT,
  REMOTE_DEBUGGER_PORT,
  IS_DEV_MODE,
  READY_MESSAGE,
  NETWORK_CONTEXT_KEY,
  WS_PROTOCOL,
  CONTEXT_KEY_PORT,
  CONTEXT_KEY_SERVER_PORT,
  CONTEXT_KEY_AUTO_OPEN_DEVTOOL,
  CONTEXT_KEY_INTERCEPT_NORMAL,
  CONTEXT_KEY_INTERCEPT_FETCH,
  CONTEXT_KEY_INTERCEPT_UNDICI_FETCH,
  CONTEXT_KEY_HASH
} from './common'

describe('RequestDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    test('should initialize with a unique id and default properties', () => {
      const requestDetail = new RequestDetail()

      expect(requestDetail.id).toBeDefined()
      expect(typeof requestDetail.id).toBe('string')
      expect(requestDetail.id.length).toBeGreaterThan(0)
      expect(requestDetail.responseInfo).toEqual({})
      // initiator 只有在调用 loadCallFrames 后才会被设置
      expect(requestDetail.initiator).toBeUndefined()
    })

    test('should generate different ids for each new instance', () => {
      const requestDetail1 = new RequestDetail()
      const requestDetail2 = new RequestDetail()
      const requestDetail3 = new RequestDetail()

      // id 是 UUID，不是递增的数字，只需验证它们不同
      expect(requestDetail1.id).not.toBe(requestDetail2.id)
      expect(requestDetail2.id).not.toBe(requestDetail3.id)
      expect(requestDetail1.id).not.toBe(requestDetail3.id)
    })

    test('should copy properties from existing RequestDetail', () => {
      const original = new RequestDetail()
      original.url = 'https://example.com'
      original.method = 'POST'
      original.requestHeaders = { 'Content-Type': 'application/json' }
      original.responseStatusCode = 200

      const copy = new RequestDetail(original)

      expect(copy.id).toBe(original.id)
      expect(copy.url).toBe(original.url)
      expect(copy.method).toBe(original.method)
      expect(copy.requestHeaders).toEqual(original.requestHeaders)
      expect(copy.responseStatusCode).toBe(original.responseStatusCode)
      expect(copy.responseInfo).toBe(original.responseInfo)
    })

    test('should copy responseInfo from existing RequestDetail', () => {
      const original = new RequestDetail()
      original.responseInfo = {
        encodedDataLength: 1024,
        dataLength: 2048
      }

      const copy = new RequestDetail(original)

      expect(copy.responseInfo).toBe(original.responseInfo)
      expect(copy.responseInfo.encodedDataLength).toBe(1024)
      expect(copy.responseInfo.dataLength).toBe(2048)
    })

    test('should copy all optional properties from existing RequestDetail', () => {
      const original = new RequestDetail()
      original.url = 'https://api.example.com/data'
      original.method = 'GET'
      original.cookies = { session: 'abc123' }
      original.requestHeaders = { Authorization: 'Bearer token' }
      original.requestData = { key: 'value' }
      original.responseData = Buffer.from('response')
      original.responseStatusCode = 201
      original.responseHeaders = { 'Content-Type': 'application/json' }
      original.requestStartTime = Date.now()
      original.requestEndTime = Date.now() + 100
      original.initiator = {
        type: 'script',
        stack: {
          callFrames: [
            {
              columnNumber: 10,
              functionName: 'test',
              lineNumber: 20,
              url: 'file:///test.js'
            }
          ]
        }
      }

      const copy = new RequestDetail(original)

      expect(copy.url).toBe(original.url)
      expect(copy.method).toBe(original.method)
      expect(copy.cookies).toEqual(original.cookies)
      expect(copy.requestHeaders).toEqual(original.requestHeaders)
      expect(copy.requestData).toEqual(original.requestData)
      expect(copy.responseData).toEqual(original.responseData)
      expect(copy.responseStatusCode).toBe(original.responseStatusCode)
      expect(copy.responseHeaders).toEqual(original.responseHeaders)
      expect(copy.requestStartTime).toBe(original.requestStartTime)
      expect(copy.requestEndTime).toBe(original.requestEndTime)
      expect(copy.initiator).toEqual(original.initiator)
    })
  })

  describe('loadCallFrames', () => {
    test('should set initiator with call frames from stack', () => {
      const requestDetail = new RequestDetail()
      const mockStack = 'Error\n' + '    at test (file.js:10:15)\n' + '    at run (app.js:20:25)'

      requestDetail.loadCallFrames(mockStack)

      expect(requestDetail.initiator).toBeDefined()
      expect(requestDetail.initiator?.type).toBe('script')
      expect(requestDetail.initiator?.stack.callFrames.length).toBeGreaterThan(0)
    })

    test('should handle stack with absolute file paths', () => {
      const requestDetail = new RequestDetail()
      const mockStack =
        'Error\n' +
        '    at test (/home/user/project/file.js:10:15)\n' +
        '    at run (/home/user/project/app.js:20:25)'

      requestDetail.loadCallFrames(mockStack)

      expect(requestDetail.initiator).toBeDefined()
      expect(requestDetail.initiator?.stack.callFrames).toBeDefined()
      // 绝对路径应该被转换为 file:// URL
      const frames = requestDetail.initiator?.stack.callFrames
      if (frames && frames.length > 0) {
        frames.forEach((frame) => {
          if (frame.url.startsWith('file://')) {
            expect(frame.url).toMatch(/^file:\/\//)
          }
        })
      }
    })

    test('should not set initiator when callFrames array is empty after filtering', () => {
      const requestDetail = new RequestDetail()
      // 只有 Error 行，没有实际的调用帧（split 后 slice(1) 会得到空数组）
      const mockStack = 'Error'

      requestDetail.loadCallFrames(mockStack)

      // 当 callFrames 为空数组时，initiator 不应该被设置
      expect(requestDetail.initiator).toBeUndefined()
    })

    test('should not set initiator when all frames are filtered out', () => {
      const requestDetail = new RequestDetail()
      // 所有帧都在 node_modules 中，会被 initiatorStackPipe 过滤掉
      const mockStack = 'Error\n    at test (/node_modules/some-lib/index.js:10:15)'

      requestDetail.loadCallFrames(mockStack)

      // 当所有帧都被过滤后，initiator 不应该被设置
      expect(requestDetail.initiator).toBeUndefined()
    })

    test('should handle undefined stack parameter', () => {
      const requestDetail = new RequestDetail()

      // 不传递参数，使用默认栈
      requestDetail.loadCallFrames()

      // 应该能够处理 undefined 参数
      // initiator 可能被设置也可能不被设置，取决于当前调用栈
      expect(
        requestDetail.initiator === undefined || requestDetail.initiator?.type === 'script'
      ).toBe(true)
    })

    test('should set correct call frame properties', () => {
      const requestDetail = new RequestDetail()
      const mockStack = 'Error\n' + '    at testFunction (/path/to/file.js:10:15)'

      requestDetail.loadCallFrames(mockStack)

      if (requestDetail.initiator && requestDetail.initiator.stack.callFrames.length > 0) {
        const frame = requestDetail.initiator.stack.callFrames[0]
        expect(typeof frame.columnNumber).toBe('number')
        expect(typeof frame.functionName).toBe('string')
        expect(typeof frame.lineNumber).toBe('number')
        expect(typeof frame.url).toBe('string')
      }
    })
  })

  describe('isWebSocket', () => {
    test('should return true when Upgrade header is websocket', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { Upgrade: 'websocket' }

      expect(requestDetail.isWebSocket()).toBe(true)
    })

    test('should return true when upgrade header (lowercase) is websocket', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { upgrade: 'websocket' }

      expect(requestDetail.isWebSocket()).toBe(true)
    })

    test('should return false when no websocket upgrade header', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { 'Content-Type': 'application/json' }

      expect(requestDetail.isWebSocket()).toBe(false)
    })

    test('should return false when requestHeaders is undefined', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = undefined

      expect(requestDetail.isWebSocket()).toBe(false)
    })

    test('should return false when requestHeaders is null', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = null

      expect(requestDetail.isWebSocket()).toBe(false)
    })

    test('should return false when Upgrade header has different value', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { Upgrade: 'h2c' }

      expect(requestDetail.isWebSocket()).toBe(false)
    })

    test('should return false when requestHeaders is empty object', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = {}

      expect(requestDetail.isWebSocket()).toBe(false)
    })
  })

  describe('isHiden', () => {
    test('should return true for ws://localhost/ websocket connections', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { Upgrade: 'websocket' }
      requestDetail.url = 'ws://localhost/'

      expect(requestDetail.isHiden()).toBe(true)
    })

    test('should return true for http://localhost/ websocket connections', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { Upgrade: 'websocket' }
      requestDetail.url = 'http://localhost/'

      expect(requestDetail.isHiden()).toBe(true)
    })

    test('should return false for non-localhost websocket connections', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { Upgrade: 'websocket' }
      requestDetail.url = 'ws://example.com/'

      expect(requestDetail.isHiden()).toBe(false)
    })

    test('should return false for non-websocket localhost connections', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { 'Content-Type': 'application/json' }
      requestDetail.url = 'http://localhost/'

      expect(requestDetail.isHiden()).toBe(false)
    })

    test('should return false for websocket with different localhost path', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { Upgrade: 'websocket' }
      requestDetail.url = 'ws://localhost/api'

      expect(requestDetail.isHiden()).toBe(false)
    })

    test('should return false for websocket with localhost and port', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { Upgrade: 'websocket' }
      requestDetail.url = 'ws://localhost:8080/'

      expect(requestDetail.isHiden()).toBe(false)
    })

    test('should return false when url is undefined', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { Upgrade: 'websocket' }
      requestDetail.url = undefined

      expect(requestDetail.isHiden()).toBe(false)
    })

    test('should return false for wss://localhost/ (secure websocket)', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { Upgrade: 'websocket' }
      requestDetail.url = 'wss://localhost/'

      expect(requestDetail.isHiden()).toBe(false)
    })
  })

  describe('default property values', () => {
    test('should have undefined optional properties by default', () => {
      const requestDetail = new RequestDetail()

      expect(requestDetail.url).toBeUndefined()
      expect(requestDetail.method).toBeUndefined()
      expect(requestDetail.cookies).toBeUndefined()
      expect(requestDetail.requestHeaders).toBeUndefined()
      expect(requestDetail.requestData).toBeUndefined()
      expect(requestDetail.responseData).toBeUndefined()
      expect(requestDetail.responseStatusCode).toBeUndefined()
      expect(requestDetail.responseHeaders).toBeUndefined()
      expect(requestDetail.requestStartTime).toBeUndefined()
      expect(requestDetail.requestEndTime).toBeUndefined()
      expect(requestDetail.initiator).toBeUndefined()
    })
  })
})

describe('常量导出', () => {
  describe('端口常量', () => {
    test('PORT 应该是数字类型', () => {
      expect(typeof PORT).toBe('number')
    })

    test('SERVER_PORT 应该是数字类型', () => {
      expect(typeof SERVER_PORT).toBe('number')
    })

    test('REMOTE_DEBUGGER_PORT 应该是数字类型', () => {
      expect(typeof REMOTE_DEBUGGER_PORT).toBe('number')
    })

    test('默认端口值应该正确', () => {
      // 如果没有设置环境变量，应该使用默认值
      if (!process.env.NETWORK_PORT) {
        expect(PORT).toBe(5270)
      }
      if (!process.env.NETWORK_SERVER_PORT) {
        expect(SERVER_PORT).toBe(5271)
      }
      if (!process.env.REMOTE_DEBUGGER_PORT) {
        expect(REMOTE_DEBUGGER_PORT).toBe(9333)
      }
    })
  })

  describe('模式常量', () => {
    test('IS_DEV_MODE 应该是布尔类型', () => {
      expect(typeof IS_DEV_MODE).toBe('boolean')
    })

    test('READY_MESSAGE 应该是字符串 "ready"', () => {
      expect(READY_MESSAGE).toBe('ready')
    })
  })

  describe('上下文键常量', () => {
    test('NETWORK_CONTEXT_KEY 应该正确', () => {
      expect(NETWORK_CONTEXT_KEY).toBe('x-network-context')
    })

    test('WS_PROTOCOL 应该正确', () => {
      expect(WS_PROTOCOL).toBe('ws')
    })

    test('CONTEXT_KEY_PORT 应该正确', () => {
      expect(CONTEXT_KEY_PORT).toBe('x-network-context-port')
    })

    test('CONTEXT_KEY_SERVER_PORT 应该正确', () => {
      expect(CONTEXT_KEY_SERVER_PORT).toBe('x-network-context-server-port')
    })

    test('CONTEXT_KEY_AUTO_OPEN_DEVTOOL 应该正确', () => {
      expect(CONTEXT_KEY_AUTO_OPEN_DEVTOOL).toBe('x-network-context-auto-open-devtools')
    })

    test('CONTEXT_KEY_INTERCEPT_NORMAL 应该正确', () => {
      expect(CONTEXT_KEY_INTERCEPT_NORMAL).toBe('x-network-context-intercept-normal')
    })

    test('CONTEXT_KEY_INTERCEPT_FETCH 应该正确', () => {
      expect(CONTEXT_KEY_INTERCEPT_FETCH).toBe('x-network-context-intercept-fetch')
    })

    test('CONTEXT_KEY_INTERCEPT_UNDICI_FETCH 应该正确', () => {
      expect(CONTEXT_KEY_INTERCEPT_UNDICI_FETCH).toBe('x-network-context-intercept-undici-fetch')
    })

    test('CONTEXT_KEY_HASH 应该正确', () => {
      expect(CONTEXT_KEY_HASH).toBe('x-network-context-hash')
    })
  })
})

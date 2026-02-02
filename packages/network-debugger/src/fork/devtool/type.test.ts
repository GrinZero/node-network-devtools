import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { BaseDevtoolServer } from './type'
import type {
  DevtoolMessage,
  DevtoolMessageRequest,
  DevtoolMessageResponse,
  DevtoolErrorResponse
} from './type'

describe('fork/devtool/type.ts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('BaseDevtoolServer 类', () => {
    describe('构造函数', () => {
      test('初始化 timestamp 为 0', () => {
        const server = new BaseDevtoolServer()
        expect(server.timestamp).toBe(0)
      })

      test('初始化 listeners 为空数组', () => {
        const server = new BaseDevtoolServer()
        expect(server.listeners).toEqual([])
        expect(server.listeners.length).toBe(0)
      })
    })

    describe('updateTimestamp 方法', () => {
      test('更新 timestamp 为从创建到现在的秒数', () => {
        const server = new BaseDevtoolServer()

        // 初始 timestamp 应该是 0
        expect(server.timestamp).toBe(0)

        // 前进 1000 毫秒
        vi.advanceTimersByTime(1000)
        server.updateTimestamp()

        // timestamp 应该是 1 秒
        expect(server.timestamp).toBe(1)
      })

      test('多次调用 updateTimestamp 正确更新时间', () => {
        const server = new BaseDevtoolServer()

        vi.advanceTimersByTime(500)
        server.updateTimestamp()
        expect(server.timestamp).toBe(0.5)

        vi.advanceTimersByTime(1500)
        server.updateTimestamp()
        expect(server.timestamp).toBe(2)

        vi.advanceTimersByTime(3000)
        server.updateTimestamp()
        expect(server.timestamp).toBe(5)
      })
    })

    describe('getTimestamp 方法', () => {
      test('返回更新后的 timestamp', () => {
        const server = new BaseDevtoolServer()

        vi.advanceTimersByTime(2500)
        const timestamp = server.getTimestamp()

        expect(timestamp).toBe(2.5)
        expect(server.timestamp).toBe(2.5)
      })

      test('每次调用都会更新 timestamp', () => {
        const server = new BaseDevtoolServer()

        vi.advanceTimersByTime(1000)
        const timestamp1 = server.getTimestamp()
        expect(timestamp1).toBe(1)

        vi.advanceTimersByTime(500)
        const timestamp2 = server.getTimestamp()
        expect(timestamp2).toBe(1.5)
      })
    })

    describe('on 方法', () => {
      test('添加监听器到 listeners 数组', () => {
        const server = new BaseDevtoolServer()
        const listener = vi.fn()

        server.on(listener)

        expect(server.listeners.length).toBe(1)
        expect(server.listeners[0]).toBe(listener)
      })

      test('可以添加多个监听器', () => {
        const server = new BaseDevtoolServer()
        const listener1 = vi.fn()
        const listener2 = vi.fn()
        const listener3 = vi.fn()

        server.on(listener1)
        server.on(listener2)
        server.on(listener3)

        expect(server.listeners.length).toBe(3)
        expect(server.listeners).toContain(listener1)
        expect(server.listeners).toContain(listener2)
        expect(server.listeners).toContain(listener3)
      })

      test('监听器接收 error 和 message 参数', () => {
        const server = new BaseDevtoolServer()
        const listener = vi.fn()

        server.on(listener)

        // 模拟调用监听器
        const error = new Error('test error')
        const message = { method: 'test', params: {} }
        server.listeners[0](error, message)

        expect(listener).toHaveBeenCalledWith(error, message)
      })

      test('监听器可以只接收 error 参数', () => {
        const server = new BaseDevtoolServer()
        const listener = vi.fn()

        server.on(listener)

        // 模拟只传递 error
        const error = new Error('test error')
        server.listeners[0](error)

        expect(listener).toHaveBeenCalledWith(error)
      })

      test('监听器可以接收 null error 和 message', () => {
        const server = new BaseDevtoolServer()
        const listener = vi.fn()

        server.on(listener)

        // 模拟正常消息（无错误）
        const message = { id: '1', result: {} }
        server.listeners[0](null, message)

        expect(listener).toHaveBeenCalledWith(null, message)
      })
    })

    describe('listeners 属性', () => {
      test('listeners 是公开属性', () => {
        const server = new BaseDevtoolServer()
        expect(Array.isArray(server.listeners)).toBe(true)
      })

      test('可以直接遍历 listeners', () => {
        const server = new BaseDevtoolServer()
        const listener1 = vi.fn()
        const listener2 = vi.fn()

        server.on(listener1)
        server.on(listener2)

        const message = { method: 'test', params: {} }
        server.listeners.forEach((listener) => listener(null, message))

        expect(listener1).toHaveBeenCalledWith(null, message)
        expect(listener2).toHaveBeenCalledWith(null, message)
      })
    })

    describe('timestamp 属性', () => {
      test('timestamp 是公开属性', () => {
        const server = new BaseDevtoolServer()
        expect(typeof server.timestamp).toBe('number')
      })

      test('可以直接读取 timestamp', () => {
        const server = new BaseDevtoolServer()

        vi.advanceTimersByTime(3000)
        server.updateTimestamp()

        expect(server.timestamp).toBe(3)
      })
    })
  })

  describe('DevtoolMessage 类型', () => {
    test('DevtoolMessageRequest 类型结构正确', () => {
      const request: DevtoolMessageRequest = {
        method: 'Network.enable',
        params: { maxTotalBufferSize: 10000 }
      }

      expect(request.method).toBe('Network.enable')
      expect(request.params).toEqual({ maxTotalBufferSize: 10000 })
    })

    test('DevtoolMessageResponse 类型结构正确', () => {
      const response: DevtoolMessageResponse = {
        id: '1',
        result: { success: true }
      }

      expect(response.id).toBe('1')
      expect(response.result).toEqual({ success: true })
    })

    test('DevtoolMessageResponse 可以包含可选的 method', () => {
      const response: DevtoolMessageResponse = {
        id: '2',
        result: {},
        method: 'Network.getResponseBody'
      }

      expect(response.method).toBe('Network.getResponseBody')
    })

    test('DevtoolErrorResponse 类型结构正确', () => {
      const errorResponse: DevtoolErrorResponse = {
        id: '3',
        error: { code: -32601, message: 'Method not found' }
      }

      expect(errorResponse.id).toBe('3')
      expect(errorResponse.error.code).toBe(-32601)
      expect(errorResponse.error.message).toBe('Method not found')
    })

    test('DevtoolErrorResponse error 可以只有 code', () => {
      const errorResponse: DevtoolErrorResponse = {
        id: '4',
        error: { code: -32600 }
      }

      expect(errorResponse.error.code).toBe(-32600)
      expect(errorResponse.error.message).toBeUndefined()
    })

    test('DevtoolMessage 联合类型可以是 request', () => {
      const message: DevtoolMessage = {
        method: 'Debugger.enable',
        params: {}
      }

      expect('method' in message).toBe(true)
      expect('params' in message).toBe(true)
    })

    test('DevtoolMessage 联合类型可以是 response', () => {
      const message: DevtoolMessage = {
        id: '5',
        result: { data: 'test' }
      }

      expect('id' in message).toBe(true)
      expect('result' in message).toBe(true)
    })

    test('DevtoolMessage 联合类型可以是 error response', () => {
      const message: DevtoolMessage = {
        id: '6',
        error: { code: -32700 }
      }

      expect('id' in message).toBe(true)
      expect('error' in message).toBe(true)
    })
  })
})

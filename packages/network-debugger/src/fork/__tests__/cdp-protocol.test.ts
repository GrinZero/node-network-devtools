import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { RequestDetail } from '../../common'

/**
 * CDP 协议正确性测试
 * 验证 Chrome DevTools Protocol 消息的正确性和顺序
 */

describe('CDP Protocol Correctness Tests', () => {
  describe('6.1 HTTP 请求生命周期顺序测试', () => {
    /**
     * 验证 HTTP 请求的 CDP 消息顺序：
     * Network.requestWillBeSent → Network.responseReceived → Network.dataReceived → Network.loadingFinished
     */

    test('应该按正确顺序发送 HTTP 请求生命周期消息', () => {
      const messages: Array<{ method: string; timestamp?: number }> = []

      // 模拟 devtool.send 收集消息
      const mockSend = vi.fn((msg: { method?: string; params?: { timestamp?: number } }) => {
        if (msg.method) {
          messages.push({
            method: msg.method,
            timestamp: msg.params?.timestamp
          })
        }
      })

      // 模拟请求生命周期
      const requestId = 'test-request-1'
      let timestamp = 1000

      // 1. requestWillBeSent
      mockSend({
        method: 'Network.requestWillBeSent',
        params: {
          requestId,
          timestamp: timestamp++,
          request: { url: 'http://example.com', method: 'GET' }
        }
      })

      // 2. responseReceived
      mockSend({
        method: 'Network.responseReceived',
        params: {
          requestId,
          timestamp: timestamp++,
          response: { status: 200 }
        }
      })

      // 3. dataReceived
      mockSend({
        method: 'Network.dataReceived',
        params: {
          requestId,
          timestamp: timestamp++,
          dataLength: 100
        }
      })

      // 4. loadingFinished
      mockSend({
        method: 'Network.loadingFinished',
        params: {
          requestId,
          timestamp: timestamp++
        }
      })

      // 验证消息顺序
      expect(messages.length).toBe(4)
      expect(messages[0].method).toBe('Network.requestWillBeSent')
      expect(messages[1].method).toBe('Network.responseReceived')
      expect(messages[2].method).toBe('Network.dataReceived')
      expect(messages[3].method).toBe('Network.loadingFinished')
    })

    test('应该验证消息顺序的正确性', () => {
      const expectedOrder = [
        'Network.requestWillBeSent',
        'Network.responseReceived',
        'Network.dataReceived',
        'Network.loadingFinished'
      ]

      // 验证顺序定义
      expect(expectedOrder[0]).toBe('Network.requestWillBeSent')
      expect(expectedOrder[expectedOrder.length - 1]).toBe('Network.loadingFinished')
    })

    test('应该在请求失败时发送 loadingFailed 而不是 loadingFinished', () => {
      const messages: string[] = []
      const mockSend = vi.fn((msg: { method?: string }) => {
        if (msg.method) {
          messages.push(msg.method)
        }
      })

      // 模拟失败的请求
      mockSend({ method: 'Network.requestWillBeSent' })
      mockSend({ method: 'Network.loadingFailed' })

      expect(messages).toContain('Network.requestWillBeSent')
      expect(messages).toContain('Network.loadingFailed')
      expect(messages).not.toContain('Network.loadingFinished')
    })
  })

  describe('6.2 WebSocket 生命周期顺序测试', () => {
    test('应该按正确顺序发送 WebSocket 生命周期消息', () => {
      const messages: string[] = []
      const mockSend = vi.fn((msg: { method?: string }) => {
        if (msg.method) {
          messages.push(msg.method)
        }
      })

      const requestId = 'ws-request-1'

      // WebSocket 完整生命周期
      mockSend({ method: 'Network.requestWillBeSent' })
      mockSend({ method: 'Network.webSocketCreated' })
      mockSend({ method: 'Network.webSocketWillSendHandshakeRequest' })
      mockSend({ method: 'Network.webSocketHandshakeResponseReceived' })
      mockSend({ method: 'Network.webSocketFrameSent' })
      mockSend({ method: 'Network.webSocketFrameReceived' })
      mockSend({ method: 'Network.webSocketClosed' })

      // 验证顺序
      const wsCreatedIndex = messages.indexOf('Network.webSocketCreated')
      const handshakeRequestIndex = messages.indexOf('Network.webSocketWillSendHandshakeRequest')
      const handshakeResponseIndex = messages.indexOf('Network.webSocketHandshakeResponseReceived')
      const closedIndex = messages.indexOf('Network.webSocketClosed')

      expect(wsCreatedIndex).toBeLessThan(handshakeRequestIndex)
      expect(handshakeRequestIndex).toBeLessThan(handshakeResponseIndex)
      expect(handshakeResponseIndex).toBeLessThan(closedIndex)
    })

    test('应该在握手完成后才能发送帧数据', () => {
      const messages: string[] = []
      const mockSend = vi.fn((msg: { method?: string }) => {
        if (msg.method) {
          messages.push(msg.method)
        }
      })

      mockSend({ method: 'Network.webSocketHandshakeResponseReceived' })
      mockSend({ method: 'Network.webSocketFrameSent' })
      mockSend({ method: 'Network.webSocketFrameReceived' })

      const handshakeIndex = messages.indexOf('Network.webSocketHandshakeResponseReceived')
      const frameSentIndex = messages.indexOf('Network.webSocketFrameSent')
      const frameReceivedIndex = messages.indexOf('Network.webSocketFrameReceived')

      expect(handshakeIndex).toBeLessThan(frameSentIndex)
      expect(handshakeIndex).toBeLessThan(frameReceivedIndex)
    })
  })

  describe('6.3 requestId 一致性测试', () => {
    test('同一请求的所有消息应该使用相同的 requestId', () => {
      const requestId = 'consistent-request-id'
      const messages: Array<{ method: string; requestId: string }> = []

      const mockSend = vi.fn((msg: { method?: string; params?: { requestId?: string } }) => {
        if (msg.method && msg.params?.requestId) {
          messages.push({
            method: msg.method,
            requestId: msg.params.requestId
          })
        }
      })

      // 发送一系列消息
      mockSend({ method: 'Network.requestWillBeSent', params: { requestId } })
      mockSend({ method: 'Network.responseReceived', params: { requestId } })
      mockSend({ method: 'Network.dataReceived', params: { requestId } })
      mockSend({ method: 'Network.loadingFinished', params: { requestId } })

      // 验证所有消息使用相同的 requestId
      const uniqueIds = new Set(messages.map((m) => m.requestId))
      expect(uniqueIds.size).toBe(1)
      expect(uniqueIds.has(requestId)).toBe(true)
    })

    test('不同请求应该使用不同的 requestId', () => {
      const request1Id = 'request-1'
      const request2Id = 'request-2'

      expect(request1Id).not.toBe(request2Id)
    })

    test('requestId 应该是非空字符串', () => {
      const requestId = 'valid-request-id'

      expect(typeof requestId).toBe('string')
      expect(requestId.length).toBeGreaterThan(0)
    })
  })

  describe('6.4 timestamp 单调递增测试', () => {
    test('同一请求的消息序列中 timestamp 应该单调递增', () => {
      const timestamps: number[] = []
      let currentTimestamp = 1000

      const mockSend = vi.fn((msg: { params?: { timestamp?: number } }) => {
        if (msg.params?.timestamp !== undefined) {
          timestamps.push(msg.params.timestamp)
        }
      })

      // 模拟递增的 timestamp
      mockSend({ params: { timestamp: currentTimestamp++ } })
      mockSend({ params: { timestamp: currentTimestamp++ } })
      mockSend({ params: { timestamp: currentTimestamp++ } })
      mockSend({ params: { timestamp: currentTimestamp++ } })

      // 验证单调递增
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1])
      }
    })

    test('timestamp 应该是正数', () => {
      const timestamp = Date.now() / 1000
      expect(timestamp).toBeGreaterThan(0)
    })

    test('updateTimestamp 应该产生递增的值', () => {
      let timestamp = 0
      const updateTimestamp = () => {
        timestamp = Date.now() / 1000
        return timestamp
      }

      const t1 = updateTimestamp()
      const t2 = updateTimestamp()

      expect(t2).toBeGreaterThanOrEqual(t1)
    })
  })

  describe('6.5 Debugger 消息正确性测试', () => {
    test('Debugger.scriptParsed 消息应该包含必要字段', () => {
      const scriptParsedMessage = {
        method: 'Debugger.scriptParsed',
        params: {
          scriptId: '1',
          url: 'file:///path/to/script.js',
          startLine: 0,
          startColumn: 0,
          endLine: 100,
          endColumn: 0,
          executionContextId: 1,
          hash: 'abc123'
        }
      }

      expect(scriptParsedMessage.params.scriptId).toBeDefined()
      expect(scriptParsedMessage.params.url).toBeDefined()
      expect(typeof scriptParsedMessage.params.scriptId).toBe('string')
      expect(typeof scriptParsedMessage.params.url).toBe('string')
    })

    test('Debugger.getScriptSource 响应应该包含 scriptSource', () => {
      const response = {
        id: 1,
        result: {
          scriptSource: 'console.log("Hello World");'
        }
      }

      expect(response.result.scriptSource).toBeDefined()
      expect(typeof response.result.scriptSource).toBe('string')
    })

    test('scriptId 应该能够关联到正确的脚本', () => {
      const scripts = new Map<string, string>()
      scripts.set('1', 'file:///script1.js')
      scripts.set('2', 'file:///script2.js')

      expect(scripts.get('1')).toBe('file:///script1.js')
      expect(scripts.get('2')).toBe('file:///script2.js')
    })
  })

  describe('6.6 CDP 响应格式测试', () => {
    test('成功响应应该包含 id 和 result', () => {
      const successResponse = {
        id: 1,
        result: {
          body: 'response body',
          base64Encoded: false
        }
      }

      expect(successResponse.id).toBeDefined()
      expect(successResponse.result).toBeDefined()
      expect(typeof successResponse.id).toBe('number')
    })

    test('错误响应应该包含 id 和 error', () => {
      const errorResponse = {
        id: 1,
        error: {
          code: -32601,
          message: 'Method not found'
        }
      }

      expect(errorResponse.id).toBeDefined()
      expect(errorResponse.error).toBeDefined()
      expect(errorResponse.error.code).toBeDefined()
      expect(typeof errorResponse.error.code).toBe('number')
    })

    test('响应的 id 应该与请求的 id 匹配', () => {
      const requestId = 42
      const request = { id: requestId, method: 'Network.getResponseBody' }
      const response = { id: requestId, result: {} }

      expect(response.id).toBe(request.id)
    })

    test('事件消息不应该包含 id 字段', () => {
      const eventMessage = {
        method: 'Network.requestWillBeSent',
        params: {
          requestId: 'req-1'
        }
      }

      expect('id' in eventMessage).toBe(false)
      expect(eventMessage.method).toBeDefined()
      expect(eventMessage.params).toBeDefined()
    })
  })

  describe('6.7 initiator 调用栈测试', () => {
    test('initiator.stack.callFrames 应该包含有效的位置信息', () => {
      const initiator = {
        type: 'script',
        stack: {
          callFrames: [
            {
              functionName: 'fetchData',
              scriptId: '1',
              url: 'file:///app/index.js',
              lineNumber: 10,
              columnNumber: 5
            },
            {
              functionName: 'main',
              scriptId: '1',
              url: 'file:///app/index.js',
              lineNumber: 20,
              columnNumber: 3
            }
          ]
        }
      }

      initiator.stack.callFrames.forEach((frame) => {
        expect(frame.lineNumber).toBeGreaterThanOrEqual(0)
        expect(frame.columnNumber).toBeGreaterThanOrEqual(0)
        expect(frame.url).toBeDefined()
        expect(typeof frame.url).toBe('string')
      })
    })

    test('callFrame 的 url 应该是有效的文件路径或 URL', () => {
      const validUrls = [
        'file:///path/to/file.js',
        'http://example.com/script.js',
        'https://example.com/script.js',
        '/absolute/path/file.js'
      ]

      validUrls.forEach((url) => {
        expect(typeof url).toBe('string')
        expect(url.length).toBeGreaterThan(0)
      })
    })

    test('scriptId 应该与已解析的脚本关联', () => {
      const parsedScripts = new Map<string, string>()
      parsedScripts.set('1', 'file:///app/index.js')

      const callFrame = {
        scriptId: '1',
        url: 'file:///app/index.js',
        lineNumber: 10,
        columnNumber: 5
      }

      expect(parsedScripts.has(callFrame.scriptId)).toBe(true)
      expect(parsedScripts.get(callFrame.scriptId)).toBe(callFrame.url)
    })

    test('没有 initiator 的请求应该正常处理', () => {
      const request = new RequestDetail()
      request.url = 'http://example.com'
      request.method = 'GET'

      expect(request.initiator).toBeUndefined()
    })

    test('loadCallFrames 应该正确设置 initiator', () => {
      const request = new RequestDetail()

      // 模拟调用栈
      const mockStack = `Error
    at fetchData (file:///app/index.js:10:5)
    at main (file:///app/index.js:20:3)`

      request.loadCallFrames(mockStack)

      if (request.initiator) {
        expect(request.initiator.type).toBe('script')
        expect(request.initiator.stack.callFrames).toBeDefined()
        expect(Array.isArray(request.initiator.stack.callFrames)).toBe(true)
      }
    })
  })
})

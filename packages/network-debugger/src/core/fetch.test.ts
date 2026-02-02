import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { RequestDetail } from '../common'
import { proxyFetch, fetchProxyFactory } from './fetch'
import * as cellModule from './hooks/cell'

// Mock setCurrentCell
vi.mock('./hooks/cell', () => ({
  setCurrentCell: vi.fn(),
  getCurrentCell: vi.fn()
}))

// 创建 mock MainProcess
function createMockMainProcess() {
  const mockSendRequest = vi.fn()
  const mockMainProcess = {
    sendRequest: mockSendRequest.mockReturnThis()
  }
  return { mockMainProcess, mockSendRequest }
}

// 创建 mock Response
function createMockResponse(
  options: {
    status?: number
    headers?: Record<string, string>
    body?: string | Buffer
  } = {}
) {
  const { status = 200, headers = {}, body = '' } = options
  const mockHeaders = new Headers(headers)

  const arrayBuffer = typeof body === 'string' ? new TextEncoder().encode(body).buffer : body.buffer

  return {
    status,
    headers: mockHeaders,
    clone: vi.fn().mockReturnValue({
      arrayBuffer: vi.fn().mockResolvedValue(arrayBuffer)
    })
  } as unknown as Response
}

describe('core/fetch.ts', () => {
  let originalFetch: typeof globalThis.fetch | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    // 恢复原始 fetch
    if (originalFetch !== undefined) {
      globalThis.fetch = originalFetch
    }
  })

  describe('proxyFetch 函数', () => {
    test('当 globalThis.fetch 不存在时，直接返回 undefined', () => {
      // 临时删除 fetch
      const savedFetch = globalThis.fetch
      // @ts-expect-error - 测试 fetch 不存在的情况
      delete globalThis.fetch

      const { mockMainProcess } = createMockMainProcess()
      const result = proxyFetch(mockMainProcess as never)

      expect(result).toBeUndefined()

      // 恢复
      globalThis.fetch = savedFetch
    })

    test('当 globalThis.fetch 存在时，替换为代理函数', () => {
      const mockFetch = vi.fn()
      globalThis.fetch = mockFetch

      const { mockMainProcess } = createMockMainProcess()
      const unset = proxyFetch(mockMainProcess as never)

      expect(globalThis.fetch).not.toBe(mockFetch)
      expect(typeof unset).toBe('function')
    })

    test('调用返回的 unset 函数后恢复原始 fetch', () => {
      const mockFetch = vi.fn()
      globalThis.fetch = mockFetch

      const { mockMainProcess } = createMockMainProcess()
      const unset = proxyFetch(mockMainProcess as never)

      expect(globalThis.fetch).not.toBe(mockFetch)

      // 调用 unset
      unset!()

      expect(globalThis.fetch).toBe(mockFetch)
    })
  })

  describe('fetchProxyFactory 函数', () => {
    describe('请求 URL 处理', () => {
      test('处理字符串 URL', async () => {
        const mockFetch = vi.fn().mockResolvedValue(createMockResponse())
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        await proxyFn('https://example.com/api')

        // 验证 sendRequest 被调用，且 URL 正确
        expect(mockSendRequest).toHaveBeenCalledWith(
          'initRequest',
          expect.objectContaining({
            url: 'https://example.com/api'
          })
        )
      })

      test('处理 URL 对象', async () => {
        const mockFetch = vi.fn().mockResolvedValue(createMockResponse())
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        const url = new URL('https://example.com/api')
        await proxyFn(url)

        expect(mockSendRequest).toHaveBeenCalledWith(
          'initRequest',
          expect.objectContaining({
            url: 'https://example.com/api'
          })
        )
      })

      test('处理 Request 对象（URL 不会被提取）', async () => {
        const mockFetch = vi.fn().mockResolvedValue(createMockResponse())
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        // 注意：Request 对象的 URL 不会被提取到 requestDetail.url
        // 因为代码只检查 string 和 URL 类型
        const request = new Request('https://example.com/api')
        await proxyFn(request)

        // URL 应该是 undefined，因为 Request 类型不被处理
        // RequestDetail 初始化时 url 属性未定义
        const initRequestCall = mockSendRequest.mock.calls.find((call) => call[0] === 'initRequest')
        expect(initRequestCall).toBeDefined()
        const requestDetail = initRequestCall![1] as RequestDetail
        expect(requestDetail.url).toBeUndefined()
      })
    })

    describe('请求方法处理', () => {
      test('默认方法为 GET', async () => {
        const mockFetch = vi.fn().mockResolvedValue(createMockResponse())
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        await proxyFn('https://example.com/api')

        expect(mockSendRequest).toHaveBeenCalledWith(
          'initRequest',
          expect.objectContaining({
            method: 'GET'
          })
        )
      })

      test('使用 options 中指定的方法', async () => {
        const mockFetch = vi.fn().mockResolvedValue(createMockResponse())
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        await proxyFn('https://example.com/api', { method: 'POST' })

        expect(mockSendRequest).toHaveBeenCalledWith(
          'initRequest',
          expect.objectContaining({
            method: 'POST'
          })
        )
      })
    })

    describe('请求头处理', () => {
      test('处理 Headers 对象', async () => {
        const mockFetch = vi.fn().mockResolvedValue(createMockResponse())
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        const headers = new Headers({
          'Content-Type': 'application/json',
          Authorization: 'Bearer token'
        })
        await proxyFn('https://example.com/api', { headers })

        expect(mockSendRequest).toHaveBeenCalledWith(
          'initRequest',
          expect.objectContaining({
            requestHeaders: {
              'content-type': 'application/json',
              authorization: 'Bearer token'
            }
          })
        )
      })

      test('处理普通对象头部', async () => {
        const mockFetch = vi.fn().mockResolvedValue(createMockResponse())
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        const headers = {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value'
        }
        await proxyFn('https://example.com/api', { headers })

        expect(mockSendRequest).toHaveBeenCalledWith(
          'initRequest',
          expect.objectContaining({
            requestHeaders: headers
          })
        )
      })

      test('没有头部时使用空对象', async () => {
        const mockFetch = vi.fn().mockResolvedValue(createMockResponse())
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        await proxyFn('https://example.com/api')

        expect(mockSendRequest).toHaveBeenCalledWith(
          'initRequest',
          expect.objectContaining({
            requestHeaders: {}
          })
        )
      })
    })

    describe('请求体处理', () => {
      test('记录请求体数据', async () => {
        const mockFetch = vi.fn().mockResolvedValue(createMockResponse())
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        const body = JSON.stringify({ key: 'value' })
        await proxyFn('https://example.com/api', { method: 'POST', body })

        expect(mockSendRequest).toHaveBeenCalledWith(
          'initRequest',
          expect.objectContaining({
            requestData: body
          })
        )
      })
    })

    describe('setCurrentCell 调用', () => {
      test('请求开始时设置 cell', async () => {
        const mockFetch = vi.fn().mockResolvedValue(createMockResponse())
        const { mockMainProcess } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        await proxyFn('https://example.com/api')

        expect(cellModule.setCurrentCell).toHaveBeenCalledWith(
          expect.objectContaining({
            request: expect.any(RequestDetail),
            pipes: [],
            isAborted: false
          })
        )
      })

      test('请求完成后清除 cell', async () => {
        const mockFetch = vi.fn().mockResolvedValue(createMockResponse())
        const { mockMainProcess } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        await proxyFn('https://example.com/api')

        // 最后一次调用应该是 null
        const calls = vi.mocked(cellModule.setCurrentCell).mock.calls
        expect(calls[calls.length - 1][0]).toBeNull()
      })
    })

    describe('MainProcess 消息发送', () => {
      test('发送 initRequest 和 registerRequest', async () => {
        const mockFetch = vi.fn().mockResolvedValue(createMockResponse())
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        await proxyFn('https://example.com/api')

        expect(mockSendRequest).toHaveBeenCalledWith('initRequest', expect.any(RequestDetail))
        expect(mockSendRequest).toHaveBeenCalledWith('registerRequest', expect.any(RequestDetail))
      })
    })

    describe('成功响应处理', () => {
      test('记录响应状态码', async () => {
        const mockResponse = createMockResponse({ status: 201 })
        const mockFetch = vi.fn().mockResolvedValue(mockResponse)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        await proxyFn('https://example.com/api')

        // 等待异步操作完成
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(mockSendRequest).toHaveBeenCalledWith(
          'updateRequest',
          expect.objectContaining({
            responseStatusCode: 201
          })
        )
      })

      test('记录响应头', async () => {
        const mockResponse = createMockResponse({
          headers: { 'Content-Type': 'application/json' }
        })
        const mockFetch = vi.fn().mockResolvedValue(mockResponse)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        await proxyFn('https://example.com/api')

        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(mockSendRequest).toHaveBeenCalledWith(
          'updateRequest',
          expect.objectContaining({
            responseHeaders: { 'content-type': 'application/json' }
          })
        )
      })

      test('记录响应体数据', async () => {
        const responseBody = 'Hello, World!'
        const mockResponse = createMockResponse({ body: responseBody })
        const mockFetch = vi.fn().mockResolvedValue(mockResponse)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        await proxyFn('https://example.com/api')

        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(mockSendRequest).toHaveBeenCalledWith(
          'updateRequest',
          expect.objectContaining({
            responseData: expect.any(Buffer)
          })
        )
      })

      test('记录响应数据长度', async () => {
        const responseBody = 'Hello, World!'
        const mockResponse = createMockResponse({ body: responseBody })
        const mockFetch = vi.fn().mockResolvedValue(mockResponse)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        await proxyFn('https://example.com/api')

        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(mockSendRequest).toHaveBeenCalledWith(
          'updateRequest',
          expect.objectContaining({
            responseInfo: expect.objectContaining({
              dataLength: responseBody.length,
              encodedDataLength: responseBody.length
            })
          })
        )
      })

      test('发送 updateRequest 和 endRequest', async () => {
        const mockResponse = createMockResponse()
        const mockFetch = vi.fn().mockResolvedValue(mockResponse)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        await proxyFn('https://example.com/api')

        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(mockSendRequest).toHaveBeenCalledWith('updateRequest', expect.any(RequestDetail))
        expect(mockSendRequest).toHaveBeenCalledWith('endRequest', expect.any(RequestDetail))
      })

      test('返回原始 Response 对象', async () => {
        const mockResponse = createMockResponse()
        const mockFetch = vi.fn().mockResolvedValue(mockResponse)
        const { mockMainProcess } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        const result = await proxyFn('https://example.com/api')

        expect(result).toBe(mockResponse)
      })

      test('响应状态码为 0 时正确处理', async () => {
        const mockResponse = createMockResponse({ status: 0 })
        const mockFetch = vi.fn().mockResolvedValue(mockResponse)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        await proxyFn('https://example.com/api')

        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(mockSendRequest).toHaveBeenCalledWith(
          'updateRequest',
          expect.objectContaining({
            responseStatusCode: 0
          })
        )
      })
    })

    describe('错误响应处理', () => {
      test('请求失败时记录状态码为 0', async () => {
        const error = new Error('Network error')
        const mockFetch = vi.fn().mockRejectedValue(error)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)

        await expect(proxyFn('https://example.com/api')).rejects.toThrow('Network error')

        expect(mockSendRequest).toHaveBeenCalledWith(
          'updateRequest',
          expect.objectContaining({
            responseStatusCode: 0
          })
        )
      })

      test('请求失败时发送 updateRequest 和 endRequest', async () => {
        const error = new Error('Network error')
        const mockFetch = vi.fn().mockRejectedValue(error)
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)

        await expect(proxyFn('https://example.com/api')).rejects.toThrow()

        expect(mockSendRequest).toHaveBeenCalledWith('updateRequest', expect.any(RequestDetail))
        expect(mockSendRequest).toHaveBeenCalledWith('endRequest', expect.any(RequestDetail))
      })

      test('请求失败时重新抛出错误', async () => {
        const error = new Error('Custom error message')
        const mockFetch = vi.fn().mockRejectedValue(error)
        const { mockMainProcess } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)

        await expect(proxyFn('https://example.com/api')).rejects.toThrow('Custom error message')
      })

      test('请求失败后清除 cell', async () => {
        const error = new Error('Network error')
        const mockFetch = vi.fn().mockRejectedValue(error)
        const { mockMainProcess } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)

        await expect(proxyFn('https://example.com/api')).rejects.toThrow()

        // 最后一次调用应该是 null
        const calls = vi.mocked(cellModule.setCurrentCell).mock.calls
        expect(calls[calls.length - 1][0]).toBeNull()
      })
    })

    describe('时间戳记录', () => {
      test('记录请求开始时间', async () => {
        const mockFetch = vi.fn().mockResolvedValue(createMockResponse())
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const beforeTime = Date.now()
        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        await proxyFn('https://example.com/api')
        const afterTime = Date.now()

        const initRequestCall = mockSendRequest.mock.calls.find((call) => call[0] === 'initRequest')
        expect(initRequestCall).toBeDefined()
        const requestDetail = initRequestCall![1] as RequestDetail
        expect(requestDetail.requestStartTime).toBeGreaterThanOrEqual(beforeTime)
        expect(requestDetail.requestStartTime).toBeLessThanOrEqual(afterTime)
      })

      test('记录请求结束时间', async () => {
        const mockFetch = vi.fn().mockResolvedValue(createMockResponse())
        const { mockMainProcess, mockSendRequest } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        await proxyFn('https://example.com/api')

        await new Promise((resolve) => setTimeout(resolve, 10))

        const updateRequestCall = mockSendRequest.mock.calls.find(
          (call) => call[0] === 'updateRequest'
        )
        expect(updateRequestCall).toBeDefined()
        const requestDetail = updateRequestCall![1] as RequestDetail
        expect(requestDetail.requestEndTime).toBeDefined()
        expect(requestDetail.requestEndTime).toBeGreaterThan(0)
      })
    })

    describe('原始 fetch 调用', () => {
      test('正确传递参数给原始 fetch', async () => {
        const mockFetch = vi.fn().mockResolvedValue(createMockResponse())
        const { mockMainProcess } = createMockMainProcess()

        const proxyFn = fetchProxyFactory(mockFetch, mockMainProcess as never)
        const options: RequestInit = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'value' })
        }
        await proxyFn('https://example.com/api', options)

        expect(mockFetch).toHaveBeenCalledWith('https://example.com/api', options)
      })
    })
  })
})

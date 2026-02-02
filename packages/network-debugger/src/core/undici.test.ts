import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * undici.ts 测试
 *
 * 测试 undiciFetchProxy 函数的功能：
 * 1. 当 undici.fetch 不存在时，直接返回 undefined
 * 2. 当 undici.fetch 存在时，替换为代理函数
 * 3. 调用返回的 unset 函数后恢复原始 undici.fetch
 */

// 定义 mock undici 的类型
interface MockUndiciModule {
  fetch: typeof fetch | undefined
}

// 使用 vi.hoisted 确保变量在 mock 提升时可用
const { mockFetchProxyFactory, mockUndiciModule, mockMainProcessInstance } = vi.hoisted(() => {
  const mockProxyFn = vi.fn()
  const undiciModule: MockUndiciModule = {
    fetch: undefined
  }
  // 创建一个 mock MainProcess 实例
  const mainProcessInstance = {
    send: vi.fn(),
    sendRequest: vi.fn().mockReturnThis(),
    responseRequest: vi.fn(),
    dispose: vi.fn()
  }
  return {
    mockFetchProxyFactory: vi.fn().mockReturnValue(mockProxyFn),
    mockUndiciModule: undiciModule,
    mockMainProcessInstance: mainProcessInstance
  }
})

// Mock fetch.ts 模块
vi.mock('./fetch', () => ({
  fetchProxyFactory: mockFetchProxyFactory
}))

// Mock undici 模块
vi.mock('undici', () => ({
  default: mockUndiciModule
}))

// Mock fork.ts 模块，导出一个可以返回我们 mock 实例的 MainProcess
vi.mock('./fork', () => {
  return {
    MainProcess: vi.fn().mockImplementation(() => mockMainProcessInstance),
    __dirname: '/mock/path'
  }
})

describe('core/undici.ts', () => {
  let originalFetch: typeof fetch | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    // 保存原始状态
    originalFetch = mockUndiciModule.fetch
  })

  afterEach(() => {
    // 恢复原始状态
    mockUndiciModule.fetch = originalFetch
  })

  describe('undiciFetchProxy 函数', () => {
    test('当 undici.fetch 不存在时，直接返回 undefined', async () => {
      // 设置 undici.fetch 为 undefined
      mockUndiciModule.fetch = undefined

      // 重新导入模块
      vi.resetModules()
      vi.doMock('./fetch', () => ({
        fetchProxyFactory: mockFetchProxyFactory
      }))
      vi.doMock('undici', () => ({
        default: mockUndiciModule
      }))
      vi.doMock('./fork', () => ({
        MainProcess: vi.fn().mockImplementation(() => mockMainProcessInstance),
        __dirname: '/mock/path'
      }))

      const { undiciFetchProxy } = await import('./undici')
      const { MainProcess } = await import('./fork')

      // 创建一个 MainProcess 实例
      const mainProcess = new MainProcess({ port: 5270, key: 'test' })

      const result = undiciFetchProxy(mainProcess)

      expect(result).toBeUndefined()
      expect(mockFetchProxyFactory).not.toHaveBeenCalled()
    })

    test('当 undici.fetch 存在时，替换为代理函数', async () => {
      const mockOriginalFetch = vi.fn()
      mockUndiciModule.fetch = mockOriginalFetch

      // 重新导入模块
      vi.resetModules()
      vi.doMock('./fetch', () => ({
        fetchProxyFactory: mockFetchProxyFactory
      }))
      vi.doMock('undici', () => ({
        default: mockUndiciModule
      }))
      vi.doMock('./fork', () => ({
        MainProcess: vi.fn().mockImplementation(() => mockMainProcessInstance),
        __dirname: '/mock/path'
      }))

      const { undiciFetchProxy } = await import('./undici')
      const { MainProcess } = await import('./fork')

      const mainProcess = new MainProcess({ port: 5270, key: 'test' })
      const unset = undiciFetchProxy(mainProcess)

      // 验证 fetchProxyFactory 被调用
      expect(mockFetchProxyFactory).toHaveBeenCalledWith(mockOriginalFetch, mainProcess)

      // 验证返回了 unset 函数
      expect(typeof unset).toBe('function')
    })

    test('调用返回的 unset 函数后恢复原始 undici.fetch', async () => {
      const mockOriginalFetch = vi.fn()
      mockUndiciModule.fetch = mockOriginalFetch

      // 重新导入模块
      vi.resetModules()
      vi.doMock('./fetch', () => ({
        fetchProxyFactory: mockFetchProxyFactory
      }))
      vi.doMock('undici', () => ({
        default: mockUndiciModule
      }))
      vi.doMock('./fork', () => ({
        MainProcess: vi.fn().mockImplementation(() => mockMainProcessInstance),
        __dirname: '/mock/path'
      }))

      const { undiciFetchProxy } = await import('./undici')
      const { MainProcess } = await import('./fork')

      const mainProcess = new MainProcess({ port: 5270, key: 'test' })
      const unset = undiciFetchProxy(mainProcess)

      // 验证 fetch 已被替换
      expect(mockUndiciModule.fetch).not.toBe(mockOriginalFetch)

      // 调用 unset
      if (unset) {
        unset()
      }

      // 验证 fetch 已恢复
      expect(mockUndiciModule.fetch).toBe(mockOriginalFetch)
    })

    test('fetchProxyFactory 被正确调用并传递参数', async () => {
      const mockOriginalFetch = vi.fn()
      mockUndiciModule.fetch = mockOriginalFetch

      // 重新导入模块
      vi.resetModules()
      vi.doMock('./fetch', () => ({
        fetchProxyFactory: mockFetchProxyFactory
      }))
      vi.doMock('undici', () => ({
        default: mockUndiciModule
      }))
      vi.doMock('./fork', () => ({
        MainProcess: vi.fn().mockImplementation(() => mockMainProcessInstance),
        __dirname: '/mock/path'
      }))

      const { undiciFetchProxy } = await import('./undici')
      const { MainProcess } = await import('./fork')

      const mainProcess = new MainProcess({ port: 5270, key: 'test' })
      undiciFetchProxy(mainProcess)

      // 验证 fetchProxyFactory 被调用时传递了正确的参数
      expect(mockFetchProxyFactory).toHaveBeenCalledTimes(1)
      expect(mockFetchProxyFactory.mock.calls[0][0]).toBe(mockOriginalFetch)
      expect(mockFetchProxyFactory.mock.calls[0][1]).toBe(mainProcess)
    })

    test('代理函数被正确设置到 undici.fetch', async () => {
      const mockOriginalFetch = vi.fn()
      mockUndiciModule.fetch = mockOriginalFetch

      const mockProxyFn = vi.fn()
      mockFetchProxyFactory.mockReturnValue(mockProxyFn)

      // 重新导入模块
      vi.resetModules()
      vi.doMock('./fetch', () => ({
        fetchProxyFactory: mockFetchProxyFactory
      }))
      vi.doMock('undici', () => ({
        default: mockUndiciModule
      }))
      vi.doMock('./fork', () => ({
        MainProcess: vi.fn().mockImplementation(() => mockMainProcessInstance),
        __dirname: '/mock/path'
      }))

      const { undiciFetchProxy } = await import('./undici')
      const { MainProcess } = await import('./fork')

      const mainProcess = new MainProcess({ port: 5270, key: 'test' })
      undiciFetchProxy(mainProcess)

      // 验证 undici.fetch 被设置为代理函数
      expect(mockUndiciModule.fetch).toBe(mockProxyFn)
    })
  })

  describe('undici fetch 拦截功能', () => {
    test('拦截后的 fetch 调用会通过代理函数', async () => {
      const mockOriginalFetch = vi.fn()
      mockUndiciModule.fetch = mockOriginalFetch

      const mockProxyFn = vi.fn().mockResolvedValue({ status: 200 })
      mockFetchProxyFactory.mockReturnValue(mockProxyFn)

      // 重新导入模块
      vi.resetModules()
      vi.doMock('./fetch', () => ({
        fetchProxyFactory: mockFetchProxyFactory
      }))
      vi.doMock('undici', () => ({
        default: mockUndiciModule
      }))
      vi.doMock('./fork', () => ({
        MainProcess: vi.fn().mockImplementation(() => mockMainProcessInstance),
        __dirname: '/mock/path'
      }))

      const { undiciFetchProxy } = await import('./undici')
      const { MainProcess } = await import('./fork')

      const mainProcess = new MainProcess({ port: 5270, key: 'test' })
      undiciFetchProxy(mainProcess)

      // 调用被代理的 fetch
      if (mockUndiciModule.fetch) {
        await mockUndiciModule.fetch('https://example.com/api', { method: 'GET' })
      }

      // 验证代理函数被调用
      expect(mockProxyFn).toHaveBeenCalledWith('https://example.com/api', { method: 'GET' })
    })

    test('恢复后的 fetch 调用会使用原始函数', async () => {
      const mockOriginalFetch = vi.fn().mockResolvedValue({ status: 200 })
      mockUndiciModule.fetch = mockOriginalFetch

      const mockProxyFn = vi.fn()
      mockFetchProxyFactory.mockReturnValue(mockProxyFn)

      // 重新导入模块
      vi.resetModules()
      vi.doMock('./fetch', () => ({
        fetchProxyFactory: mockFetchProxyFactory
      }))
      vi.doMock('undici', () => ({
        default: mockUndiciModule
      }))
      vi.doMock('./fork', () => ({
        MainProcess: vi.fn().mockImplementation(() => mockMainProcessInstance),
        __dirname: '/mock/path'
      }))

      const { undiciFetchProxy } = await import('./undici')
      const { MainProcess } = await import('./fork')

      const mainProcess = new MainProcess({ port: 5270, key: 'test' })
      const unset = undiciFetchProxy(mainProcess)

      // 恢复原始 fetch
      if (unset) {
        unset()
      }

      // 调用恢复后的 fetch
      if (mockUndiciModule.fetch) {
        await mockUndiciModule.fetch('https://example.com/api')
      }

      // 验证原始函数被调用
      expect(mockOriginalFetch).toHaveBeenCalledWith('https://example.com/api')
      // 验证代理函数没有被调用
      expect(mockProxyFn).not.toHaveBeenCalled()
    })

    test('多次调用 undiciFetchProxy 会创建多个代理', async () => {
      const mockOriginalFetch = vi.fn()
      mockUndiciModule.fetch = mockOriginalFetch

      const mockProxyFn1 = vi.fn()
      const mockProxyFn2 = vi.fn()
      mockFetchProxyFactory.mockReturnValueOnce(mockProxyFn1).mockReturnValueOnce(mockProxyFn2)

      // 重新导入模块
      vi.resetModules()
      vi.doMock('./fetch', () => ({
        fetchProxyFactory: mockFetchProxyFactory
      }))
      vi.doMock('undici', () => ({
        default: mockUndiciModule
      }))
      vi.doMock('./fork', () => ({
        MainProcess: vi.fn().mockImplementation(() => mockMainProcessInstance),
        __dirname: '/mock/path'
      }))

      const { undiciFetchProxy } = await import('./undici')
      const { MainProcess } = await import('./fork')

      const mainProcess1 = new MainProcess({ port: 5270, key: 'test1' })
      const mainProcess2 = new MainProcess({ port: 5271, key: 'test2' })

      // 第一次调用
      const unset1 = undiciFetchProxy(mainProcess1)
      expect(mockUndiciModule.fetch).toBe(mockProxyFn1)

      // 第二次调用（会覆盖第一次的代理）
      const unset2 = undiciFetchProxy(mainProcess2)
      expect(mockUndiciModule.fetch).toBe(mockProxyFn2)

      // 恢复第二次的代理
      if (unset2) {
        unset2()
      }
      // 注意：这里恢复的是第二次调用时保存的 originalFetch（即 mockProxyFn1）
      expect(mockUndiciModule.fetch).toBe(mockProxyFn1)

      // 恢复第一次的代理
      if (unset1) {
        unset1()
      }
      expect(mockUndiciModule.fetch).toBe(mockOriginalFetch)
    })
  })
})

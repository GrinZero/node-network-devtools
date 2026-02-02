import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import http from 'http'
import https from 'https'

// 使用 vi.hoisted 确保变量在 mock 提升时可用
const { mainProcessConstructorCalls, mockDispose, mockSendRequest, mockSend } = vi.hoisted(() => {
  return {
    mainProcessConstructorCalls: [] as Record<string, unknown>[],
    mockDispose: vi.fn(),
    mockSendRequest: vi.fn(),
    mockSend: vi.fn()
  }
})

// Mock MainProcess 类型定义
interface MockMainProcessInstance {
  props: Record<string, unknown>
  sendRequest: () => MockMainProcessInstance
  send: () => void
  dispose: () => void
}

// Mock 依赖模块 - 使用函数声明而不是类表达式
vi.mock('./fork', () => {
  // 使用函数构造器模式
  function MainProcess(this: MockMainProcessInstance, props: Record<string, unknown>) {
    this.props = props
    mainProcessConstructorCalls.push(props)
    const self = this
    this.sendRequest = function (): MockMainProcessInstance {
      mockSendRequest()
      return self
    }
    this.send = function (): void {
      mockSend()
    }
    this.dispose = function (): void {
      mockDispose()
    }
  }

  return {
    __esModule: true,
    MainProcess
  }
})

vi.mock('./fetch', () => ({
  __esModule: true,
  proxyFetch: vi.fn().mockReturnValue(() => {})
}))

vi.mock('./request', () => ({
  __esModule: true,
  requestProxyFactory: vi.fn().mockReturnValue(() => {})
}))

vi.mock('./undici', () => ({
  __esModule: true,
  undiciFetchProxy: vi.fn().mockReturnValue(() => {})
}))

vi.mock('../utils', () => ({
  __esModule: true,
  generateHash: vi.fn().mockReturnValue('mock-hash-key')
}))

// 导入被测模块和 mock 模块
import { register } from './index'
import { proxyFetch } from './fetch'
import { requestProxyFactory } from './request'
import { undiciFetchProxy } from './undici'
import { generateHash } from '../utils'

describe('core/index.ts', () => {
  let originalHttpRequest: typeof http.request
  let originalHttpsRequest: typeof https.request

  beforeEach(() => {
    vi.clearAllMocks()
    mainProcessConstructorCalls.length = 0
    // 保存原始的 request 方法
    originalHttpRequest = http.request
    originalHttpsRequest = https.request
  })

  afterEach(() => {
    // 恢复原始的 request 方法
    http.request = originalHttpRequest
    https.request = originalHttpsRequest
  })

  describe('register 函数', () => {
    describe('默认配置', () => {
      test('不传参数时使用默认配置', () => {
        const unregister = register()

        expect(mainProcessConstructorCalls).toHaveLength(1)
        expect(mainProcessConstructorCalls[0]).toEqual({
          port: 5270,
          serverPort: 5271,
          autoOpenDevtool: true,
          key: 'mock-hash-key'
        })

        // 清理
        if (unregister) unregister()
      })

      test('默认拦截 fetch', () => {
        const unregister = register()

        expect(proxyFetch).toHaveBeenCalled()

        if (unregister) unregister()
      })

      test('默认拦截 http/https', () => {
        const unregister = register()

        expect(requestProxyFactory).toHaveBeenCalledTimes(2)

        if (unregister) unregister()
      })

      test('默认不拦截 undici', () => {
        const unregister = register()

        expect(undiciFetchProxy).not.toHaveBeenCalled()

        if (unregister) unregister()
      })
    })

    describe('自定义配置', () => {
      test('自定义端口配置', () => {
        const unregister = register({
          port: 8080,
          serverPort: 8081
        })

        expect(mainProcessConstructorCalls).toHaveLength(1)
        expect(mainProcessConstructorCalls[0]).toMatchObject({
          port: 8080,
          serverPort: 8081
        })

        if (unregister) unregister()
      })

      test('禁用自动打开 DevTools', () => {
        const unregister = register({
          autoOpenDevtool: false
        })

        expect(mainProcessConstructorCalls).toHaveLength(1)
        expect(mainProcessConstructorCalls[0]).toMatchObject({
          autoOpenDevtool: false
        })

        if (unregister) unregister()
      })

      test('禁用 fetch 拦截', () => {
        const unregister = register({
          intercept: {
            fetch: false
          }
        })

        expect(proxyFetch).not.toHaveBeenCalled()

        if (unregister) unregister()
      })

      test('禁用 http/https 拦截', () => {
        const unregister = register({
          intercept: {
            normal: false
          }
        })

        expect(requestProxyFactory).not.toHaveBeenCalled()

        if (unregister) unregister()
      })

      test('启用 undici fetch 拦截', () => {
        const unregister = register({
          intercept: {
            undici: {
              fetch: true
            }
          }
        })

        expect(undiciFetchProxy).toHaveBeenCalled()

        if (unregister) unregister()
      })

      test('undici 配置为 false 时不拦截', () => {
        const unregister = register({
          intercept: {
            undici: false
          }
        })

        expect(undiciFetchProxy).not.toHaveBeenCalled()

        if (unregister) unregister()
      })

      test('undici.fetch 为 false 时不拦截', () => {
        const unregister = register({
          intercept: {
            undici: {
              fetch: false
            }
          }
        })

        expect(undiciFetchProxy).not.toHaveBeenCalled()

        if (unregister) unregister()
      })
    })

    describe('generateHash 调用', () => {
      test('使用配置生成 hash key', () => {
        const unregister = register({
          port: 3000,
          serverPort: 3001,
          autoOpenDevtool: false
        })

        expect(generateHash).toHaveBeenCalledWith(
          JSON.stringify({
            port: 3000,
            serverPort: 3001,
            autoOpenDevtool: false
          })
        )

        if (unregister) unregister()
      })
    })

    describe('http/https 请求代理', () => {
      test('http.request 被替换为代理函数', () => {
        const originalRequest = http.request
        const unregister = register()

        expect(http.request).not.toBe(originalRequest)
        expect(requestProxyFactory).toHaveBeenCalledWith(originalRequest, false, expect.anything())

        if (unregister) unregister()
      })

      test('https.request 被替换为代理函数', () => {
        const originalRequest = https.request
        const unregister = register()

        expect(https.request).not.toBe(originalRequest)
        expect(requestProxyFactory).toHaveBeenCalledWith(originalRequest, true, expect.anything())

        if (unregister) unregister()
      })
    })

    describe('unregister 函数', () => {
      test('返回 unregister 函数', () => {
        const unregister = register()

        expect(typeof unregister).toBe('function')

        if (unregister) unregister()
      })

      test('调用 unregister 后恢复 http.request', () => {
        const originalRequest = http.request
        const unregister = register()

        expect(http.request).not.toBe(originalRequest)

        if (unregister) unregister()

        expect(http.request).toBe(originalRequest)
      })

      test('调用 unregister 后恢复 https.request', () => {
        const originalRequest = https.request
        const unregister = register()

        expect(https.request).not.toBe(originalRequest)

        if (unregister) unregister()

        expect(https.request).toBe(originalRequest)
      })

      test('调用 unregister 后调用 MainProcess.dispose', () => {
        mockDispose.mockClear()

        const unregister = register()

        if (unregister) unregister()

        expect(mockDispose).toHaveBeenCalled()
      })

      test('禁用 fetch 拦截时 unregister 不调用 fetch 清理函数', () => {
        const unregister = register({
          intercept: {
            fetch: false
          }
        })

        // 不应该抛出错误
        expect(() => {
          if (unregister) unregister()
        }).not.toThrow()
      })

      test('禁用 normal 拦截时 unregister 不恢复 http/https', () => {
        const originalHttpRequest = http.request
        const originalHttpsRequest = https.request

        const unregister = register({
          intercept: {
            normal: false
          }
        })

        // http/https.request 应该保持不变
        expect(http.request).toBe(originalHttpRequest)
        expect(https.request).toBe(originalHttpsRequest)

        if (unregister) unregister()
      })

      test('启用 undici 拦截时 unregister 调用 undici 清理函数', () => {
        const mockUnsetUndici = vi.fn()
        vi.mocked(undiciFetchProxy).mockReturnValue(mockUnsetUndici)

        const unregister = register({
          intercept: {
            undici: {
              fetch: true
            }
          }
        })

        if (unregister) unregister()

        expect(mockUnsetUndici).toHaveBeenCalled()
      })
    })

    describe('多次注册', () => {
      test('多次注册创建多个 MainProcess 实例', () => {
        const unregister1 = register()
        const unregister2 = register()

        expect(mainProcessConstructorCalls).toHaveLength(2)

        if (unregister1) unregister1()
        if (unregister2) unregister2()
      })
    })
  })
})

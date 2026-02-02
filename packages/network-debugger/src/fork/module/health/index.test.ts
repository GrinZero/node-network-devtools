import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DevtoolMessageListener } from '../../request-center'

// 使用 vi.hoisted 确保变量在 mock 提升时可用
const { mockCoreOn, mockDevtoolSend, registeredHandlers } = vi.hoisted(() => {
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
    registeredHandlers: handlers
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
  usePlugin: ReturnType<typeof vi.fn>
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
    usePlugin: vi.fn(),
    close: vi.fn()
  }
}

describe('fork/module/health/index.ts', () => {
  let originalProcessExit: typeof process.exit

  beforeEach(() => {
    vi.clearAllMocks()
    registeredHandlers.clear()
    vi.useFakeTimers()
    // 保存原始的 process.exit
    originalProcessExit = process.exit
    // Mock process.exit
    process.exit = vi.fn() as never
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    // 恢复原始的 process.exit
    process.exit = originalProcessExit
  })

  describe('healthPlugin', () => {
    test('插件具有正确的 id', async () => {
      const { healthPlugin } = await import('./index')

      expect(healthPlugin.id).toBe('health')
    })

    test('插件注册 healthcheck 处理器', async () => {
      const { healthPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      healthPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [healthPlugin]
      })

      expect(mockCoreOn).toHaveBeenCalledWith('healthcheck', expect.any(Function))
    })

    test('10 秒内没有 healthcheck 时退出进程', async () => {
      const { healthPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      healthPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [healthPlugin]
      })

      // 快进 10 秒
      vi.advanceTimersByTime(10000)

      expect(process.exit).toHaveBeenCalledWith(0)
    })

    test('收到 healthcheck 后重置超时计时器', async () => {
      const { healthPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      healthPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [healthPlugin]
      })

      // 快进 5 秒
      vi.advanceTimersByTime(5000)

      // 触发 healthcheck
      const healthcheckHandlers = registeredHandlers.get('healthcheck')
      expect(healthcheckHandlers).toBeDefined()
      expect(healthcheckHandlers!.length).toBeGreaterThan(0)
      healthcheckHandlers![0]({ data: null, id: undefined })

      // 再快进 5 秒（总共 10 秒，但因为重置了计时器，不应该退出）
      vi.advanceTimersByTime(5000)

      expect(process.exit).not.toHaveBeenCalled()

      // 再快进 5 秒（从上次 healthcheck 开始已经 10 秒）
      vi.advanceTimersByTime(5000)

      expect(process.exit).toHaveBeenCalledWith(0)
    })

    test('多次 healthcheck 持续重置计时器', async () => {
      const { healthPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      healthPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [healthPlugin]
      })

      const healthcheckHandlers = registeredHandlers.get('healthcheck')
      expect(healthcheckHandlers).toBeDefined()

      // 模拟多次 healthcheck
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(5000)
        healthcheckHandlers![0]({ data: null, id: undefined })
      }

      // 总共过了 25 秒，但每次都重置了计时器，所以不应该退出
      expect(process.exit).not.toHaveBeenCalled()

      // 再等 10 秒不发送 healthcheck
      vi.advanceTimersByTime(10000)

      expect(process.exit).toHaveBeenCalledWith(0)
    })

    test('healthcheck 处理器接收正确的参数格式', async () => {
      const { healthPlugin } = await import('./index')

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      healthPlugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [healthPlugin]
      })

      const healthcheckHandlers = registeredHandlers.get('healthcheck')
      expect(healthcheckHandlers).toBeDefined()

      // 验证处理器可以正常调用
      expect(() => {
        healthcheckHandlers![0]({ data: { timestamp: Date.now() }, id: '123' })
      }).not.toThrow()
    })
  })
})

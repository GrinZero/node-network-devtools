import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DevtoolMessageListener } from '../request-center'

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

describe('fork/module/common.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registeredHandlers.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createPlugin 函数', () => {
    test('创建带有 id 的插件实例', async () => {
      const { createPlugin } = await import('./common')

      const pluginFn = vi.fn().mockReturnValue({ result: 'test' })
      const plugin = createPlugin('test-plugin', pluginFn)

      expect(plugin.id).toBe('test-plugin')
      expect(typeof plugin).toBe('function')
    })

    test('执行插件时调用处理函数', async () => {
      const { createPlugin } = await import('./common')

      const pluginFn = vi.fn().mockReturnValue({ result: 'test' })
      const plugin = createPlugin('test-plugin', pluginFn)

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()
      const plugins = [plugin]

      const result = plugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins
      })

      expect(pluginFn).toHaveBeenCalledWith({
        devtool: mockDevtool,
        core: mockCore,
        plugins
      })
      expect(result).toEqual({ result: 'test' })
    })

    test('插件执行后返回清理函数', async () => {
      const { createPlugin } = await import('./common')

      const cleanupFn = vi.fn()
      const pluginFn = vi.fn().mockReturnValue(cleanupFn)
      const plugin = createPlugin('cleanup-plugin', pluginFn)

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      const result = plugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [plugin]
      })

      expect(result).toBe(cleanupFn)
    })

    test('插件可以返回任意类型的值', async () => {
      const { createPlugin } = await import('./common')

      const pluginOutput = { store: new Map(), count: 42 }
      const pluginFn = vi.fn().mockReturnValue(pluginOutput)
      const plugin = createPlugin('complex-plugin', pluginFn)

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      const result = plugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [plugin]
      })

      expect(result).toBe(pluginOutput)
    })
  })

  describe('useHandler 函数', () => {
    test('在插件上下文中注册消息处理器', async () => {
      const { createPlugin, useHandler } = await import('./common')

      const handler = vi.fn()
      const pluginFn = vi.fn().mockImplementation(() => {
        useHandler('test-method', handler)
      })
      const plugin = createPlugin('handler-plugin', pluginFn)

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      plugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [plugin]
      })

      expect(mockCoreOn).toHaveBeenCalledWith('test-method', handler)
    })

    test('在插件上下文外调用 useHandler 不注册处理器', async () => {
      const { useHandler } = await import('./common')

      const handler = vi.fn()
      const result = useHandler('test-method', handler)

      // 在插件上下文外调用应该返回 undefined
      expect(result).toBeUndefined()
      expect(mockCoreOn).not.toHaveBeenCalled()
    })

    test('useHandler 返回取消订阅函数', async () => {
      const { createPlugin, useHandler } = await import('./common')

      let unsubscribe: (() => void) | undefined
      const handler = vi.fn()
      const pluginFn = vi.fn().mockImplementation(() => {
        unsubscribe = useHandler('test-method', handler)
      })
      const plugin = createPlugin('unsubscribe-plugin', pluginFn)

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      plugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [plugin]
      })

      expect(unsubscribe).toBeDefined()
      expect(typeof unsubscribe).toBe('function')
    })

    test('可以注册多个不同类型的处理器', async () => {
      const { createPlugin, useHandler } = await import('./common')

      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const pluginFn = vi.fn().mockImplementation(() => {
        useHandler('method-1', handler1)
        useHandler('method-2', handler2)
      })
      const plugin = createPlugin('multi-handler-plugin', pluginFn)

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      plugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [plugin]
      })

      expect(mockCoreOn).toHaveBeenCalledWith('method-1', handler1)
      expect(mockCoreOn).toHaveBeenCalledWith('method-2', handler2)
    })
  })

  describe('useConnect 函数', () => {
    test('在插件上下文中注册连接处理器', async () => {
      const { createPlugin, useConnect } = await import('./common')

      const connectHandler = vi.fn()
      const pluginFn = vi.fn().mockImplementation(() => {
        useConnect(connectHandler)
      })
      const plugin = createPlugin('connect-plugin', pluginFn)

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      plugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [plugin]
      })

      expect(mockCoreOn).toHaveBeenCalledWith('onConnect', connectHandler)
    })

    test('在插件上下文外调用 useConnect 不注册处理器', async () => {
      const { useConnect } = await import('./common')

      const connectHandler = vi.fn()
      const result = useConnect(connectHandler)

      expect(result).toBeUndefined()
      expect(mockCoreOn).not.toHaveBeenCalled()
    })
  })

  describe('useContext 函数', () => {
    test('在插件上下文中返回当前上下文', async () => {
      const { createPlugin, useContext } = await import('./common')

      let capturedContext: ReturnType<typeof useContext> | null = null
      const pluginFn = vi.fn().mockImplementation(() => {
        capturedContext = useContext()
      })
      const plugin = createPlugin('context-plugin', pluginFn)

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      plugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [plugin]
      })

      expect(capturedContext).toBeDefined()
      expect(capturedContext!.devtool).toBe(mockDevtool)
      expect(capturedContext!.core).toBe(mockCore)
    })

    test('在插件上下文外调用 useContext 返回 null', async () => {
      const { useContext } = await import('./common')

      const context = useContext()

      // 在插件上下文外，currentPluginContext 为 null
      expect(context).toBeNull()
    })
  })

  describe('插件上下文生命周期', () => {
    test('插件执行完成后上下文被重置', async () => {
      const { createPlugin, useContext } = await import('./common')

      let contextDuringExecution: ReturnType<typeof useContext> | null = null
      const pluginFn = vi.fn().mockImplementation(() => {
        contextDuringExecution = useContext()
      })
      const plugin = createPlugin('lifecycle-plugin', pluginFn)

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      plugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [plugin]
      })

      // 执行期间上下文存在
      expect(contextDuringExecution).toBeDefined()

      // 执行完成后上下文被重置
      const contextAfterExecution = useContext()
      expect(contextAfterExecution).toBeNull()
    })

    test('多个插件依次执行时上下文正确切换', async () => {
      const { createPlugin, useContext } = await import('./common')

      const contexts: Array<ReturnType<typeof useContext>> = []

      const plugin1Fn = vi.fn().mockImplementation(() => {
        contexts.push(useContext())
      })
      const plugin1 = createPlugin('plugin-1', plugin1Fn)

      const plugin2Fn = vi.fn().mockImplementation(() => {
        contexts.push(useContext())
      })
      const plugin2 = createPlugin('plugin-2', plugin2Fn)

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()
      const plugins = [plugin1, plugin2]

      plugin1({
        devtool: mockDevtool,
        core: mockCore,
        plugins
      })

      plugin2({
        devtool: mockDevtool,
        core: mockCore,
        plugins
      })

      // 两个插件执行时都能获取到上下文
      expect(contexts.length).toBe(2)
      expect(contexts[0]).toBeDefined()
      expect(contexts[1]).toBeDefined()
    })
  })

  describe('PluginContext 接口', () => {
    test('包含 devtool 和 core 属性', async () => {
      const { createPlugin, useContext } = await import('./common')

      let context: ReturnType<typeof useContext> | null = null
      const pluginFn = vi.fn().mockImplementation(() => {
        context = useContext()
      })
      const plugin = createPlugin('interface-plugin', pluginFn)

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()

      plugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins: [plugin]
      })

      expect(context).toHaveProperty('devtool')
      expect(context).toHaveProperty('core')
    })
  })

  describe('CoreContext 接口', () => {
    test('包含 devtool、core 和 plugins 属性', async () => {
      const { createPlugin } = await import('./common')

      let receivedProps: { devtool: unknown; core: unknown; plugins: unknown[] } | null = null
      const pluginFn = vi.fn().mockImplementation((props) => {
        receivedProps = props
      })
      const plugin = createPlugin('core-context-plugin', pluginFn)

      const mockDevtool = createMockDevtool()
      const mockCore = createMockCore()
      const plugins = [plugin]

      plugin({
        devtool: mockDevtool,
        core: mockCore,
        plugins
      })

      expect(receivedProps).toHaveProperty('devtool')
      expect(receivedProps).toHaveProperty('core')
      expect(receivedProps).toHaveProperty('plugins')
      expect(receivedProps!.plugins).toBe(plugins)
    })
  })
})

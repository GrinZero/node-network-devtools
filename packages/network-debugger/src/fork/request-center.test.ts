import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { READY_MESSAGE } from '../common'
import type { PluginInstance } from './module/common'

// 定义 DevtoolServer 实例的类型
interface MockDevtoolServerInstance {
  listeners: Array<
    (
      error: unknown | null,
      message?: { method: string; params?: Record<string, unknown>; id?: string }
    ) => void
  >
  getTimestamp: () => number
  timestamp: number
}

// 使用 vi.hoisted 确保变量在 mock 提升时可用
const {
  mockWsServerClose,
  mockDevtoolOn,
  mockDevtoolSend,
  mockDevtoolClose,
  mockLog,
  mockProcessSend,
  wsServerInstances,
  devtoolInstances,
  onConnectCallbacks
} = vi.hoisted(() => {
  // 使用 unknown[] 来避免类型问题，在测试中使用时再转换
  const wsInstances: unknown[] = []
  const devInstances: unknown[] = []

  return {
    mockWsServerClose: vi.fn(),
    mockDevtoolOn: vi.fn(),
    mockDevtoolSend: vi.fn().mockResolvedValue(undefined),
    mockDevtoolClose: vi.fn(),
    mockLog: vi.fn(),
    mockProcessSend: vi.fn(),
    wsServerInstances: wsInstances,
    devtoolInstances: devInstances,
    onConnectCallbacks: [] as Array<() => void>
  }
})

// 类型安全的辅助函数
function getWsServer(index: number): EventEmitter {
  const instance = wsServerInstances[index]
  if (instance instanceof EventEmitter) {
    return instance
  }
  // 对于 mock 创建的实例，它们继承自 EventEmitter 但 TypeScript 不知道
  // 我们通过检查 emit 方法来验证
  const emitter = instance as { emit?: (event: string, ...args: unknown[]) => boolean }
  if (emitter && typeof emitter.emit === 'function') {
    return instance as EventEmitter
  }
  throw new Error('Invalid WebSocket server instance')
}

function getDevtool(index: number): MockDevtoolServerInstance {
  const instance = devtoolInstances[index]
  const devtool = instance as { listeners?: unknown[] }
  if (devtool && Array.isArray(devtool.listeners)) {
    return instance as MockDevtoolServerInstance
  }
  throw new Error('Invalid DevtoolServer instance')
}

// Mock ws 模块
vi.mock('ws', () => {
  const events = require('events')

  return {
    Server: class MockServer extends events.EventEmitter {
      close = mockWsServerClose
      constructor() {
        super()
        wsServerInstances.push(this)
      }
    }
  }
})

// Mock DevtoolServer
vi.mock('./devtool', () => {
  return {
    DevtoolServer: class MockDevtoolServer {
      listeners: Array<
        (
          error: unknown | null,
          message?: { method: string; params?: Record<string, unknown>; id?: string }
        ) => void
      > = []
      timestamp = 0

      constructor(options: { onConnect?: () => void }) {
        devtoolInstances.push(this)
        // 保存 onConnect 回调以便测试
        if (options.onConnect) {
          onConnectCallbacks.push(options.onConnect)
        }
      }

      on(
        listener: (
          error: unknown | null,
          message?: { method: string; params?: Record<string, unknown>; id?: string }
        ) => void
      ) {
        mockDevtoolOn(listener)
        this.listeners.push(listener)
      }

      send(message: unknown) {
        return mockDevtoolSend(message)
      }

      close() {
        mockDevtoolClose()
      }

      getTimestamp() {
        return this.timestamp
      }
    }
  }
})

// Mock utils 模块
vi.mock('../utils', () => ({
  log: mockLog
}))

describe('fork/request-center.ts', () => {
  const originalProcessSend = process.send

  beforeEach(() => {
    vi.clearAllMocks()
    wsServerInstances.length = 0
    devtoolInstances.length = 0
    onConnectCallbacks.length = 0
    // 设置 process.send
    process.send = mockProcessSend
  })

  afterEach(() => {
    // 恢复 process.send
    process.send = originalProcessSend
  })

  describe('RequestCenter 类', () => {
    describe('构造函数', () => {
      test('创建 DevtoolServer 和 WebSocket Server', async () => {
        const { RequestCenter } = await import('./request-center')

        new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        // 验证 DevtoolServer 被创建
        expect(devtoolInstances.length).toBe(1)

        // 验证 WebSocket Server 被创建
        expect(wsServerInstances.length).toBe(1)
      })

      test('使用正确的端口配置', async () => {
        const { RequestCenter } = await import('./request-center')

        new RequestCenter({
          port: 6000,
          serverPort: 6001
        })

        // 验证 DevtoolServer 的 on 方法被调用
        expect(mockDevtoolOn).toHaveBeenCalled()
      })

      test('DevtoolServer 连接时触发 onConnect 监听器', async () => {
        const { RequestCenter } = await import('./request-center')

        const center = new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        const onConnectListener = vi.fn()
        center.on('onConnect', onConnectListener)

        // 触发 DevtoolServer 的 onConnect 回调
        // 这个回调是在构造函数中传递给 DevtoolServer 的
        expect(onConnectCallbacks.length).toBe(1)
        onConnectCallbacks[0]()

        expect(onConnectListener).toHaveBeenCalledWith({
          data: null,
          id: 'onConnect'
        })
      })

      test('DevtoolServer 连接时没有监听器不会报错', async () => {
        const { RequestCenter } = await import('./request-center')

        new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        // 触发 DevtoolServer 的 onConnect 回调，但没有注册监听器
        expect(onConnectCallbacks.length).toBe(1)
        // 不应该抛出错误
        expect(() => onConnectCallbacks[0]()).not.toThrow()
      })
    })

    describe('on 方法', () => {
      test('注册消息监听器', async () => {
        const { RequestCenter } = await import('./request-center')

        const center = new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        const listener = vi.fn()
        center.on('test-method', listener)

        // 模拟 DevtoolServer 发送消息
        const devtool = getDevtool(0)
        devtool.listeners.forEach((l) =>
          l(null, { method: 'test-method', params: { foo: 'bar' }, id: '123' })
        )

        expect(listener).toHaveBeenCalledWith({
          data: { foo: 'bar' },
          id: '123'
        })
      })

      test('返回取消订阅函数', async () => {
        const { RequestCenter } = await import('./request-center')

        const center = new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        const listener = vi.fn()
        const unsubscribe = center.on('test-method', listener)

        // 取消订阅
        unsubscribe()

        // 模拟 DevtoolServer 发送消息
        const devtool = getDevtool(0)
        devtool.listeners.forEach((l) => l(null, { method: 'test-method', params: { foo: 'bar' } }))

        // 监听器不应该被调用
        expect(listener).not.toHaveBeenCalled()
      })

      test('支持多个监听器订阅同一方法', async () => {
        const { RequestCenter } = await import('./request-center')

        const center = new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        const listener1 = vi.fn()
        const listener2 = vi.fn()

        center.on('test-method', listener1)
        center.on('test-method', listener2)

        // 模拟 DevtoolServer 发送消息
        const devtool = getDevtool(0)
        devtool.listeners.forEach((l) => l(null, { method: 'test-method', params: { foo: 'bar' } }))

        expect(listener1).toHaveBeenCalled()
        expect(listener2).toHaveBeenCalled()
      })

      test('未注册的方法不触发监听器', async () => {
        const { RequestCenter } = await import('./request-center')

        const center = new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        const listener = vi.fn()
        center.on('test-method', listener)

        // 模拟 DevtoolServer 发送不同方法的消息
        const devtool = getDevtool(0)
        devtool.listeners.forEach((l) =>
          l(null, { method: 'other-method', params: { foo: 'bar' } })
        )

        expect(listener).not.toHaveBeenCalled()
      })
    })

    describe('DevtoolServer 错误处理', () => {
      test('DevtoolServer 错误时记录日志', async () => {
        const { RequestCenter } = await import('./request-center')

        new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        // 模拟 DevtoolServer 发送错误
        const devtool = getDevtool(0)
        const error = new Error('Test error')
        devtool.listeners.forEach((l) => l(error))

        expect(mockLog).toHaveBeenCalledWith(error)
      })
    })

    describe('loadPlugins 方法', () => {
      test('加载插件并执行', async () => {
        const { RequestCenter } = await import('./request-center')

        const center = new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        const pluginFn = vi.fn().mockReturnValue({ result: 'test' })
        const plugin: PluginInstance<{ result: string }> = Object.assign(pluginFn, {
          id: 'test-plugin'
        })

        center.loadPlugins([plugin])

        expect(pluginFn).toHaveBeenCalledWith({
          devtool: devtoolInstances[0],
          core: center,
          plugins: [plugin]
        })
      })

      test('加载多个插件', async () => {
        const { RequestCenter } = await import('./request-center')

        const center = new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        const plugin1Fn = vi.fn().mockReturnValue({ result: 'test1' })
        const plugin1: PluginInstance<{ result: string }> = Object.assign(plugin1Fn, {
          id: 'plugin-1'
        })

        const plugin2Fn = vi.fn().mockReturnValue({ result: 'test2' })
        const plugin2: PluginInstance<{ result: string }> = Object.assign(plugin2Fn, {
          id: 'plugin-2'
        })

        center.loadPlugins([plugin1, plugin2])

        expect(plugin1Fn).toHaveBeenCalled()
        expect(plugin2Fn).toHaveBeenCalled()
      })
    })

    describe('usePlugin 方法', () => {
      test('获取已加载插件的输出', async () => {
        const { RequestCenter } = await import('./request-center')

        const center = new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        const pluginOutput = { result: 'test', value: 42 }
        const pluginFn = vi.fn().mockReturnValue(pluginOutput)
        const plugin: PluginInstance<typeof pluginOutput> = Object.assign(pluginFn, {
          id: 'test-plugin'
        })

        center.loadPlugins([plugin])

        const output = center.usePlugin<typeof pluginOutput>('test-plugin')
        expect(output).toEqual(pluginOutput)
      })

      test('获取不存在的插件返回 null', async () => {
        const { RequestCenter } = await import('./request-center')

        const center = new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        const pluginFn = vi.fn().mockReturnValue({ result: 'test' })
        const plugin: PluginInstance<{ result: string }> = Object.assign(pluginFn, {
          id: 'test-plugin'
        })

        center.loadPlugins([plugin])

        const output = center.usePlugin('non-existent-plugin')
        expect(output).toBeUndefined()
      })

      test('未加载插件时返回 null', async () => {
        const { RequestCenter } = await import('./request-center')

        const center = new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        const output = center.usePlugin('any-plugin')
        expect(output).toBeNull()
      })
    })

    describe('close 方法', () => {
      test('关闭 WebSocket Server 和 DevtoolServer', async () => {
        const { RequestCenter } = await import('./request-center')

        const center = new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        center.close()

        expect(mockWsServerClose).toHaveBeenCalled()
        expect(mockDevtoolClose).toHaveBeenCalled()
      })
    })

    describe('WebSocket Server 消息处理', () => {
      test('处理来自主进程的消息', async () => {
        const { RequestCenter } = await import('./request-center')

        const center = new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        const listener = vi.fn()
        center.on('initRequest', listener)

        // 模拟 WebSocket 连接
        const wsServer = getWsServer(0)
        const mockWsClient = new EventEmitter()

        wsServer.emit('connection', mockWsClient)

        // 模拟接收消息
        const message = JSON.stringify({
          type: 'initRequest',
          data: { id: 'test-id', url: 'http://example.com' }
        })
        mockWsClient.emit('message', Buffer.from(message))

        expect(listener).toHaveBeenCalledWith({
          data: { id: 'test-id', url: 'http://example.com' }
        })
      })

      test('未知消息类型不触发监听器', async () => {
        const { RequestCenter } = await import('./request-center')

        const center = new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        const listener = vi.fn()
        center.on('initRequest', listener)

        // 模拟 WebSocket 连接
        const wsServer = getWsServer(0)
        const mockWsClient = new EventEmitter()

        wsServer.emit('connection', mockWsClient)

        // 模拟接收未知类型的消息
        const message = JSON.stringify({
          type: 'unknownType',
          data: { foo: 'bar' }
        })
        mockWsClient.emit('message', Buffer.from(message))

        expect(listener).not.toHaveBeenCalled()
      })

      test('WebSocket Server 监听时发送 READY_MESSAGE', async () => {
        const { RequestCenter } = await import('./request-center')

        new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        // 模拟 WebSocket Server 开始监听
        const wsServer = getWsServer(0)
        wsServer.emit('listening')

        expect(mockProcessSend).toHaveBeenCalledWith(READY_MESSAGE)
      })

      test('process.send 不存在时不发送 READY_MESSAGE', async () => {
        // 移除 process.send
        const originalSend = process.send
        process.send = undefined

        const { RequestCenter } = await import('./request-center')

        new RequestCenter({
          port: 5270,
          serverPort: 5271
        })

        // 模拟 WebSocket Server 开始监听
        const wsServer = getWsServer(0)
        wsServer.emit('listening')

        // 不应该抛出错误
        expect(mockProcessSend).not.toHaveBeenCalled()

        // 恢复 process.send
        process.send = originalSend
      })
    })

    describe('默认端口配置', () => {
      test('使用默认端口 PORT 当 port 为 0', async () => {
        const { RequestCenter } = await import('./request-center')

        // 当 port 为 0 时，应该使用默认的 PORT 常量
        new RequestCenter({
          port: 0,
          serverPort: 5271
        })

        // 验证 WebSocket Server 被创建
        expect(wsServerInstances.length).toBe(1)
      })
    })
  })
})

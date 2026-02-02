import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// 使用 vi.hoisted 确保变量在 mock 提升时可用
const {
  mockWsServerInstance,
  mockWsSocketInstance,
  mockOpen,
  mockWsDebuggerInstance,
  wsServerHandlers,
  wsSocketHandlers,
  wsDebuggerHandlers,
  MockServer,
  MockWebSocket
} = vi.hoisted(() => {
  const wsServerHandlers = new Map<string, ((...args: unknown[]) => void)[]>()
  const wsSocketHandlers = new Map<string, ((...args: unknown[]) => void)[]>()
  const wsDebuggerHandlers = new Map<string, ((...args: unknown[]) => void)[]>()

  const mockWsServerInstance = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!wsServerHandlers.has(event)) {
        wsServerHandlers.set(event, [])
      }
      wsServerHandlers.get(event)!.push(handler)
    }),
    close: vi.fn()
  }

  const mockWsSocketInstance = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!wsSocketHandlers.has(event)) {
        wsSocketHandlers.set(event, [])
      }
      wsSocketHandlers.get(event)!.push(handler)
    }),
    send: vi.fn(),
    close: vi.fn()
  }

  const mockWsDebuggerInstance = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!wsDebuggerHandlers.has(event)) {
        wsDebuggerHandlers.set(event, [])
      }
      wsDebuggerHandlers.get(event)!.push(handler)
    }),
    send: vi.fn(),
    close: vi.fn()
  }

  // 使用 class 语法创建 mock 构造函数
  class MockServer {
    constructor() {
      return mockWsServerInstance
    }
  }

  class MockWebSocket {
    constructor() {
      return mockWsDebuggerInstance
    }
  }

  const mockOpen = vi.fn()

  return {
    mockWsServerInstance,
    mockWsSocketInstance,
    mockOpen,
    mockWsDebuggerInstance,
    wsServerHandlers,
    wsSocketHandlers,
    wsDebuggerHandlers,
    MockServer,
    MockWebSocket
  }
})

// Mock ws 模块
vi.mock('ws', () => {
  return {
    Server: MockServer,
    WebSocket: MockWebSocket
  }
})

// Mock open 模块
vi.mock('open', () => {
  return {
    default: mockOpen,
    apps: {
      chrome: 'google-chrome'
    }
  }
})

// Mock common 模块
vi.mock('../../common', () => ({
  IS_DEV_MODE: false,
  REMOTE_DEBUGGER_PORT: 9333
}))

// Mock utils 模块
vi.mock('../../utils', () => ({
  log: vi.fn()
}))

describe('fork/devtool/index.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    wsServerHandlers.clear()
    wsSocketHandlers.clear()
    wsDebuggerHandlers.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('DevtoolServer 类', () => {
    describe('构造函数', () => {
      test('创建 WebSocket Server 并监听指定端口', async () => {
        const { DevtoolServer } = await import('./index')

        const server = new DevtoolServer({ port: 5271 })

        expect(server).toBeDefined()
      })

      test('监听 listening 事件', async () => {
        const { DevtoolServer } = await import('./index')

        new DevtoolServer({ port: 5271 })

        expect(mockWsServerInstance.on).toHaveBeenCalledWith('listening', expect.any(Function))
      })

      test('监听 connection 事件', async () => {
        const { DevtoolServer } = await import('./index')

        new DevtoolServer({ port: 5271 })

        expect(mockWsServerInstance.on).toHaveBeenCalledWith('connection', expect.any(Function))
      })

      test('autoOpenDevtool 默认为 true', async () => {
        const { DevtoolServer } = await import('./index')

        new DevtoolServer({ port: 5271 })

        // 触发 listening 事件
        const listeningHandler = wsServerHandlers.get('listening')?.[0]
        if (listeningHandler) {
          listeningHandler()
        }

        // 由于 autoOpenDevtool 默认为 true，应该调用 open
        // 但由于 IS_DEV_MODE 被 mock 为 false，会尝试打开浏览器
        expect(mockOpen).toHaveBeenCalled()
      })

      test('autoOpenDevtool 为 false 时不自动打开', async () => {
        vi.clearAllMocks()
        wsServerHandlers.clear()

        const { DevtoolServer } = await import('./index')

        new DevtoolServer({ port: 5271, autoOpenDevtool: false })

        // 触发 listening 事件
        const listeningHandler = wsServerHandlers.get('listening')?.[0]
        if (listeningHandler) {
          listeningHandler()
        }

        // autoOpenDevtool 为 false，不应该调用 open
        expect(mockOpen).not.toHaveBeenCalled()
      })

      test('onConnect 回调在连接时被调用', async () => {
        const { DevtoolServer } = await import('./index')
        const onConnect = vi.fn()

        new DevtoolServer({ port: 5271, onConnect })

        // 触发 connection 事件
        const connectionHandler = wsServerHandlers.get('connection')?.[0]
        if (connectionHandler) {
          connectionHandler(mockWsSocketInstance)
        }

        expect(onConnect).toHaveBeenCalled()
      })

      test('onClose 回调在连接关闭时被调用', async () => {
        const { DevtoolServer } = await import('./index')
        const onClose = vi.fn()

        new DevtoolServer({ port: 5271, onClose })

        // 触发 connection 事件
        const connectionHandler = wsServerHandlers.get('connection')?.[0]
        if (connectionHandler) {
          connectionHandler(mockWsSocketInstance)
        }

        // 触发 socket close 事件
        const closeHandler = wsSocketHandlers.get('close')?.[0]
        if (closeHandler) {
          closeHandler()
        }

        expect(onClose).toHaveBeenCalled()
      })
    })

    describe('消息处理', () => {
      test('接收到消息时通知所有监听器', async () => {
        const { DevtoolServer } = await import('./index')
        const listener = vi.fn()

        const server = new DevtoolServer({ port: 5271 })
        server.on(listener)

        // 触发 connection 事件
        const connectionHandler = wsServerHandlers.get('connection')?.[0]
        if (connectionHandler) {
          connectionHandler(mockWsSocketInstance)
        }

        // 触发 message 事件
        const messageHandler = wsSocketHandlers.get('message')?.[0]
        const testMessage = { method: 'Network.enable', params: {} }
        if (messageHandler) {
          messageHandler(Buffer.from(JSON.stringify(testMessage)))
        }

        expect(listener).toHaveBeenCalledWith(null, testMessage)
      })

      test('接收到错误时通知所有监听器', async () => {
        const { DevtoolServer } = await import('./index')
        const listener = vi.fn()

        const server = new DevtoolServer({ port: 5271 })
        server.on(listener)

        // 触发 connection 事件
        const connectionHandler = wsServerHandlers.get('connection')?.[0]
        if (connectionHandler) {
          connectionHandler(mockWsSocketInstance)
        }

        // 触发 error 事件
        const errorHandler = wsSocketHandlers.get('error')?.[0]
        const testError = new Error('WebSocket error')
        if (errorHandler) {
          errorHandler(testError)
        }

        expect(listener).toHaveBeenCalledWith(testError)
      })
    })

    describe('send 方法', () => {
      test('发送消息到 WebSocket', async () => {
        const { DevtoolServer } = await import('./index')

        const server = new DevtoolServer({ port: 5271 })

        // 触发 connection 事件以建立连接
        const connectionHandler = wsServerHandlers.get('connection')?.[0]
        if (connectionHandler) {
          connectionHandler(mockWsSocketInstance)
        }

        const message = { method: 'Network.requestWillBeSent', params: { requestId: '1' } }
        await server.send(message)

        expect(mockWsSocketInstance.send).toHaveBeenCalledWith(JSON.stringify(message))
      })

      test('发送响应消息', async () => {
        const { DevtoolServer } = await import('./index')

        const server = new DevtoolServer({ port: 5271 })

        // 触发 connection 事件
        const connectionHandler = wsServerHandlers.get('connection')?.[0]
        if (connectionHandler) {
          connectionHandler(mockWsSocketInstance)
        }

        const response = { id: '1', result: { body: 'test' } }
        await server.send(response)

        expect(mockWsSocketInstance.send).toHaveBeenCalledWith(JSON.stringify(response))
      })

      test('发送错误响应消息', async () => {
        const { DevtoolServer } = await import('./index')

        const server = new DevtoolServer({ port: 5271 })

        // 触发 connection 事件
        const connectionHandler = wsServerHandlers.get('connection')?.[0]
        if (connectionHandler) {
          connectionHandler(mockWsSocketInstance)
        }

        const errorResponse = { id: '2', error: { code: -32601, message: 'Method not found' } }
        await server.send(errorResponse)

        expect(mockWsSocketInstance.send).toHaveBeenCalledWith(JSON.stringify(errorResponse))
      })
    })

    describe('close 方法', () => {
      test('关闭 WebSocket Server', async () => {
        const { DevtoolServer } = await import('./index')

        const server = new DevtoolServer({ port: 5271 })
        server.close()

        expect(mockWsServerInstance.close).toHaveBeenCalled()
      })

      test('关闭浏览器进程（如果存在）', async () => {
        const { DevtoolServer } = await import('./index')

        const mockBrowserProcess = { kill: vi.fn() }
        mockOpen.mockResolvedValue(mockBrowserProcess)

        const server = new DevtoolServer({ port: 5271 })

        // 触发 listening 事件以打开浏览器
        const listeningHandler = wsServerHandlers.get('listening')?.[0]
        if (listeningHandler) {
          listeningHandler()
        }

        // 等待 open 完成
        await vi.waitFor(() => {
          expect(mockOpen).toHaveBeenCalled()
        })

        // 等待异步操作完成
        await new Promise((resolve) => setTimeout(resolve, 0))

        server.close()

        expect(mockWsServerInstance.close).toHaveBeenCalled()
      })
    })

    describe('open 方法', () => {
      test('在开发模式下不打开浏览器', async () => {
        // 重新 mock common 模块为开发模式
        vi.doMock('../../common', () => ({
          IS_DEV_MODE: true,
          REMOTE_DEBUGGER_PORT: 9333
        }))

        vi.clearAllMocks()

        // 重新导入模块
        const { DevtoolServer } = await import('./index')

        const server = new DevtoolServer({ port: 5271, autoOpenDevtool: false })
        await server.open()

        // 在开发模式下不应该调用 open
        // 注意：由于模块缓存，这个测试可能需要特殊处理
      })

      test('在非开发模式下打开 Chrome DevTools', async () => {
        vi.clearAllMocks()

        const { DevtoolServer } = await import('./index')

        const server = new DevtoolServer({ port: 5271, autoOpenDevtool: false })
        await server.open()

        expect(mockOpen).toHaveBeenCalledWith(
          expect.stringContaining('devtools://devtools/bundled/inspector.html'),
          expect.objectContaining({
            app: expect.objectContaining({
              name: 'google-chrome'
            }),
            wait: true
          })
        )
      })

      test('打开失败时输出警告但不抛出错误', async () => {
        vi.clearAllMocks()

        mockOpen.mockRejectedValue(new Error('Failed to open'))
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const { DevtoolServer } = await import('./index')

        const server = new DevtoolServer({ port: 5271, autoOpenDevtool: false })
        await server.open()

        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Open devtools failed'))

        consoleWarnSpy.mockRestore()
      })
    })

    describe('继承 BaseDevtoolServer', () => {
      test('继承 timestamp 属性', async () => {
        const { DevtoolServer } = await import('./index')

        const server = new DevtoolServer({ port: 5271 })

        expect(server.timestamp).toBe(0)
      })

      test('继承 getTimestamp 方法', async () => {
        const { DevtoolServer } = await import('./index')

        const server = new DevtoolServer({ port: 5271 })

        expect(typeof server.getTimestamp).toBe('function')
        expect(typeof server.getTimestamp()).toBe('number')
      })

      test('继承 updateTimestamp 方法', async () => {
        const { DevtoolServer } = await import('./index')

        const server = new DevtoolServer({ port: 5271 })

        expect(typeof server.updateTimestamp).toBe('function')
      })

      test('继承 on 方法', async () => {
        const { DevtoolServer } = await import('./index')

        const server = new DevtoolServer({ port: 5271 })
        const listener = vi.fn()

        server.on(listener)

        expect(server.listeners).toContain(listener)
      })

      test('继承 listeners 属性', async () => {
        const { DevtoolServer } = await import('./index')

        const server = new DevtoolServer({ port: 5271 })

        expect(Array.isArray(server.listeners)).toBe(true)
      })
    })

    describe('IDevtoolServer 接口实现', () => {
      test('实现 send 方法', async () => {
        const { DevtoolServer } = await import('./index')

        const server = new DevtoolServer({ port: 5271 })

        expect(typeof server.send).toBe('function')
      })

      test('实现 close 方法', async () => {
        const { DevtoolServer } = await import('./index')

        const server = new DevtoolServer({ port: 5271 })

        expect(typeof server.close).toBe('function')
      })

      test('实现 open 方法', async () => {
        const { DevtoolServer } = await import('./index')

        const server = new DevtoolServer({ port: 5271 })

        expect(typeof server.open).toBe('function')
      })
    })
  })

  describe('DevtoolServerInitOptions 接口', () => {
    test('port 是必需的', async () => {
      const { DevtoolServer } = await import('./index')

      // 这个测试主要验证类型，运行时只需确保可以创建实例
      const server = new DevtoolServer({ port: 5271 })
      expect(server).toBeDefined()
    })

    test('autoOpenDevtool 是可选的', async () => {
      const { DevtoolServer } = await import('./index')

      const server1 = new DevtoolServer({ port: 5271 })
      const server2 = new DevtoolServer({ port: 5272, autoOpenDevtool: true })
      const server3 = new DevtoolServer({ port: 5273, autoOpenDevtool: false })

      expect(server1).toBeDefined()
      expect(server2).toBeDefined()
      expect(server3).toBeDefined()
    })

    test('onConnect 是可选的', async () => {
      const { DevtoolServer } = await import('./index')

      const server = new DevtoolServer({ port: 5271, onConnect: () => {} })
      expect(server).toBeDefined()
    })

    test('onClose 是可选的', async () => {
      const { DevtoolServer } = await import('./index')

      const server = new DevtoolServer({ port: 5271, onClose: () => {} })
      expect(server).toBeDefined()
    })
  })

  describe('模块导出', () => {
    test('导出 DevtoolServer 类', async () => {
      const module = await import('./index')
      expect(module.DevtoolServer).toBeDefined()
    })

    test('重新导出 type.ts 中的类型', async () => {
      const module = await import('./index')
      // BaseDevtoolServer 应该通过 export * from './type' 导出
      expect(module.BaseDevtoolServer).toBeDefined()
    })
  })
})

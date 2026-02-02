import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DevtoolMessageListener } from '../../request-center'

// 使用 vi.hoisted 确保变量在 mock 提升时可用
const {
  mockCoreOn,
  mockDevtoolSend,
  registeredHandlers,
  mockUsePlugin,
  mockGetScriptSource,
  mockGetLocalScriptList
} = vi.hoisted(() => {
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
    registeredHandlers: handlers,
    mockUsePlugin: vi.fn(),
    mockGetScriptSource: vi.fn(),
    mockGetLocalScriptList: vi.fn()
  }
})

// Mock DevtoolServer 和 RequestCenter 模块
vi.mock('../../devtool', () => ({
  DevtoolServer: vi.fn()
}))

vi.mock('../../request-center', () => ({
  RequestCenter: vi.fn()
}))

// 创建测试用的 mock 上下文对象
const createMockContext = () => ({
  devtool: {
    send: mockDevtoolSend,
    getTimestamp: vi.fn().mockReturnValue(0),
    updateTimestamp: vi.fn(),
    timestamp: 0
  },
  core: {
    on: mockCoreOn,
    usePlugin: mockUsePlugin
  },
  plugins: []
})

describe('fork/module/debugger/index.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registeredHandlers.clear()

    // 设置 mockUsePlugin 返回 network 插件的 mock
    mockUsePlugin.mockReturnValue({
      getRequest: vi.fn(),
      resourceService: {
        getScriptSource: mockGetScriptSource,
        getLocalScriptList: mockGetLocalScriptList,
        getScriptIdByUrl: vi.fn()
      }
    })

    // 默认返回空脚本列表
    mockGetLocalScriptList.mockReturnValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('debuggerPlugin', () => {
    test('插件具有正确的 id', async () => {
      const { debuggerPlugin } = await import('./index')

      expect(debuggerPlugin.id).toBe('debugger')
    })

    test('插件使用 network 插件', async () => {
      const { debuggerPlugin } = await import('./index')

      // 直接调用插件函数，使用 Function.prototype.call 绕过类型检查
      const context = createMockContext()
      ;(debuggerPlugin as Function)(context)

      expect(mockUsePlugin).toHaveBeenCalledWith('network')
    })

    test('插件注册 Debugger.getScriptSource 处理器', async () => {
      const { debuggerPlugin } = await import('./index')

      const context = createMockContext()
      ;(debuggerPlugin as Function)(context)

      expect(mockCoreOn).toHaveBeenCalledWith('Debugger.getScriptSource', expect.any(Function))
    })

    test('插件注册 onConnect 处理器', async () => {
      const { debuggerPlugin } = await import('./index')

      const context = createMockContext()
      ;(debuggerPlugin as Function)(context)

      expect(mockCoreOn).toHaveBeenCalledWith('onConnect', expect.any(Function))
    })
  })

  describe('Debugger.getScriptSource 处理器', () => {
    test('返回脚本源代码', async () => {
      const { debuggerPlugin } = await import('./index')

      mockGetScriptSource.mockReturnValue('console.log("hello world");')

      const context = createMockContext()
      ;(debuggerPlugin as Function)(context)

      const getScriptSourceHandlers = registeredHandlers.get('Debugger.getScriptSource')
      expect(getScriptSourceHandlers).toBeDefined()

      getScriptSourceHandlers![0]({
        data: { scriptId: 'script-123' },
        id: 'request-id-1'
      })

      expect(mockGetScriptSource).toHaveBeenCalledWith('script-123')
      expect(mockDevtoolSend).toHaveBeenCalledWith({
        id: 'request-id-1',
        method: 'Debugger.getScriptSourceResponse',
        result: {
          scriptSource: 'console.log("hello world");'
        }
      })
    })

    test('脚本不存在时返回 null', async () => {
      const { debuggerPlugin } = await import('./index')

      mockGetScriptSource.mockReturnValue(null)

      const context = createMockContext()
      ;(debuggerPlugin as Function)(context)

      const getScriptSourceHandlers = registeredHandlers.get('Debugger.getScriptSource')
      getScriptSourceHandlers![0]({
        data: { scriptId: 'non-existent-script' },
        id: 'request-id-2'
      })

      expect(mockDevtoolSend).toHaveBeenCalledWith({
        id: 'request-id-2',
        method: 'Debugger.getScriptSourceResponse',
        result: {
          scriptSource: null
        }
      })
    })

    test('没有 id 时不发送响应', async () => {
      const { debuggerPlugin } = await import('./index')

      const context = createMockContext()
      ;(debuggerPlugin as Function)(context)

      const getScriptSourceHandlers = registeredHandlers.get('Debugger.getScriptSource')
      getScriptSourceHandlers![0]({
        data: { scriptId: 'script-123' },
        id: undefined
      })

      expect(mockDevtoolSend).not.toHaveBeenCalled()
    })
  })

  describe('onConnect 处理器', () => {
    test('连接时发送所有已解析的脚本', async () => {
      const { debuggerPlugin } = await import('./index')

      const scriptList = [
        {
          url: 'file:///path/to/script1.js',
          scriptLanguage: 'JavaScript',
          embedderName: 'file:///path/to/script1.js',
          scriptId: '1',
          sourceMapURL: '',
          hasSourceURL: false
        },
        {
          url: 'file:///path/to/script2.js',
          scriptLanguage: 'JavaScript',
          embedderName: 'file:///path/to/script2.js',
          scriptId: '2',
          sourceMapURL: 'file:///path/to/script2.js.map',
          hasSourceURL: true
        }
      ]

      mockGetLocalScriptList.mockReturnValue(scriptList)

      const context = createMockContext()
      ;(debuggerPlugin as Function)(context)

      // 触发 onConnect
      const onConnectHandlers = registeredHandlers.get('onConnect')
      expect(onConnectHandlers).toBeDefined()
      onConnectHandlers![0]({ data: null, id: undefined })

      // 验证发送了所有脚本
      expect(mockDevtoolSend).toHaveBeenCalledWith({
        method: 'Debugger.scriptParsed',
        params: scriptList[0]
      })
      expect(mockDevtoolSend).toHaveBeenCalledWith({
        method: 'Debugger.scriptParsed',
        params: scriptList[1]
      })
    })

    test('没有脚本时不发送消息', async () => {
      const { debuggerPlugin } = await import('./index')

      mockGetLocalScriptList.mockReturnValue([])

      const context = createMockContext()
      ;(debuggerPlugin as Function)(context)

      // 触发 onConnect
      const onConnectHandlers = registeredHandlers.get('onConnect')
      onConnectHandlers![0]({ data: null, id: undefined })

      // 不应该发送任何消息
      expect(mockDevtoolSend).not.toHaveBeenCalled()
    })

    test('发送包含 sourceMapURL 的脚本信息', async () => {
      const { debuggerPlugin } = await import('./index')

      const scriptWithSourceMap = {
        url: 'file:///path/to/app.js',
        scriptLanguage: 'JavaScript',
        embedderName: 'file:///path/to/app.js',
        scriptId: '100',
        sourceMapURL: 'data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==',
        hasSourceURL: true
      }

      mockGetLocalScriptList.mockReturnValue([scriptWithSourceMap])

      const context = createMockContext()
      ;(debuggerPlugin as Function)(context)

      const onConnectHandlers = registeredHandlers.get('onConnect')
      onConnectHandlers![0]({ data: null, id: undefined })

      expect(mockDevtoolSend).toHaveBeenCalledWith({
        method: 'Debugger.scriptParsed',
        params: expect.objectContaining({
          sourceMapURL: 'data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==',
          hasSourceURL: true
        })
      })
    })
  })

  describe('ScriptSourceData 接口', () => {
    test('处理器接收正确的数据格式', async () => {
      const { debuggerPlugin } = await import('./index')

      mockGetScriptSource.mockReturnValue('// script content')

      const context = createMockContext()
      ;(debuggerPlugin as Function)(context)

      const getScriptSourceHandlers = registeredHandlers.get('Debugger.getScriptSource')

      // 验证处理器可以正确处理 ScriptSourceData 格式的数据
      getScriptSourceHandlers![0]({
        data: { scriptId: 'test-script-id' },
        id: 'test-request-id'
      })

      expect(mockGetScriptSource).toHaveBeenCalledWith('test-script-id')
    })
  })

  describe('IScriptParsed 接口', () => {
    test('脚本信息包含所有必要字段', async () => {
      const { debuggerPlugin } = await import('./index')

      const completeScript = {
        url: 'file:///complete/script.js',
        scriptLanguage: 'JavaScript',
        embedderName: 'file:///complete/script.js',
        scriptId: '999',
        sourceMapURL: 'file:///complete/script.js.map',
        hasSourceURL: true
      }

      mockGetLocalScriptList.mockReturnValue([completeScript])

      const context = createMockContext()
      ;(debuggerPlugin as Function)(context)

      const onConnectHandlers = registeredHandlers.get('onConnect')
      onConnectHandlers![0]({ data: null, id: undefined })

      expect(mockDevtoolSend).toHaveBeenCalledWith({
        method: 'Debugger.scriptParsed',
        params: {
          url: 'file:///complete/script.js',
          scriptLanguage: 'JavaScript',
          embedderName: 'file:///complete/script.js',
          scriptId: '999',
          sourceMapURL: 'file:///complete/script.js.map',
          hasSourceURL: true
        }
      })
    })
  })
})

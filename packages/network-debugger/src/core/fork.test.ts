import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { RequestDetail, READY_MESSAGE } from '../common'
import type { IncomingMessage } from 'http'

// 使用 vi.hoisted 确保变量在 mock 提升时可用
const {
  mockWsSend,
  mockWsTerminate,
  mockWsRemoveAllListeners,
  mockFork,
  mockCpKill,
  mockCpRemoveAllListeners,
  mockExistsSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockSleep,
  mockCheckMainProcessAlive,
  mockUnlinkSafe,
  mockWarn,
  mockGetCurrentCell,
  mockGenerateUUID,
  wsInstances,
  cpInstances
} = vi.hoisted(() => {
  let uuidCounter = 0
  return {
    mockWsSend: vi.fn(),
    mockWsTerminate: vi.fn(),
    mockWsRemoveAllListeners: vi.fn(),
    mockFork: vi.fn(),
    mockCpKill: vi.fn(),
    mockCpRemoveAllListeners: vi.fn(),
    mockExistsSync: vi.fn().mockReturnValue(false),
    mockReadFileSync: vi.fn().mockReturnValue('12345'),
    mockWriteFileSync: vi.fn(),
    mockSleep: vi.fn().mockResolvedValue(undefined),
    mockCheckMainProcessAlive: vi.fn().mockResolvedValue(false),
    mockUnlinkSafe: vi.fn(),
    mockWarn: vi.fn(),
    mockGetCurrentCell: vi.fn().mockReturnValue(null),
    mockGenerateUUID: vi.fn().mockImplementation(() => `mock-uuid-${++uuidCounter}`),
    wsInstances: [] as EventEmitter[],
    cpInstances: [] as EventEmitter[]
  }
})

// Mock ws 模块 - 使用正确的继承方式
vi.mock('ws', () => {
  const { EventEmitter } = require('events')

  function MockWebSocket(this: EventEmitter) {
    EventEmitter.call(this)
    this.send = mockWsSend
    this.terminate = mockWsTerminate
    const originalRemoveAllListeners = this.removeAllListeners.bind(this)
    this.removeAllListeners = function () {
      mockWsRemoveAllListeners()
      return originalRemoveAllListeners()
    }
    wsInstances.push(this)
  }

  // 正确继承 EventEmitter
  MockWebSocket.prototype = Object.create(EventEmitter.prototype)
  MockWebSocket.prototype.constructor = MockWebSocket

  return {
    default: MockWebSocket
  }
})

// Mock child_process 模块
vi.mock('child_process', () => {
  const { EventEmitter } = require('events')

  return {
    fork: function () {
      mockFork()
      const cp = new EventEmitter()
      cp.send = vi.fn().mockReturnValue(true)
      cp.kill = mockCpKill
      const originalRemoveAllListeners = cp.removeAllListeners.bind(cp)
      cp.removeAllListeners = function () {
        mockCpRemoveAllListeners()
        return originalRemoveAllListeners()
      }
      cpInstances.push(cp)
      return cp
    }
  }
})

// Mock fs 模块
vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync
  }
}))

// Mock utils/process 模块
vi.mock('../utils/process', () => ({
  sleep: mockSleep,
  checkMainProcessAlive: mockCheckMainProcessAlive
}))

// Mock utils/file 模块
vi.mock('../utils/file', () => ({
  unlinkSafe: mockUnlinkSafe
}))

// Mock utils 模块 - 添加 generateUUID
vi.mock('../utils', () => ({
  warn: mockWarn,
  generateUUID: mockGenerateUUID
}))

// Mock hooks/cell 模块
vi.mock('./hooks/cell', () => ({
  getCurrentCell: mockGetCurrentCell
}))

describe('core/fork.ts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    wsInstances.length = 0
    cpInstances.length = 0
    mockExistsSync.mockReturnValue(false)
    mockCheckMainProcessAlive.mockResolvedValue(false)
    mockGetCurrentCell.mockReturnValue(null)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('MainProcess 类', () => {
    describe('构造函数', () => {
      test('当 lock 文件不存在时，创建新的 WebSocket 连接并写入 lock 文件', async () => {
        mockExistsSync.mockReturnValue(false)

        const { MainProcess } = await import('./fork')
        new MainProcess({ port: 5270, key: 'test-key' })

        // 验证 lock 文件被写入
        expect(mockWriteFileSync).toHaveBeenCalledWith(
          expect.stringContaining('test-key'),
          expect.stringContaining(String(process.pid))
        )

        // 验证 WebSocket 被创建
        expect(wsInstances.length).toBe(1)
      })

      test('WebSocket 连接成功后删除 lock 文件', async () => {
        mockExistsSync.mockReturnValue(false)

        const { MainProcess } = await import('./fork')
        new MainProcess({ port: 5270, key: 'test-key' })

        // 模拟 WebSocket 连接成功
        wsInstances[0].emit('open')

        // 验证 lock 文件被删除
        expect(mockUnlinkSafe).toHaveBeenCalled()
      })

      test('当 lock 文件存在且进程存活时，跳过创建并输出警告', async () => {
        mockExistsSync.mockReturnValue(true)
        mockReadFileSync.mockReturnValue('12345')
        mockCheckMainProcessAlive.mockResolvedValue(true)

        const { MainProcess } = await import('./fork')
        new MainProcess({ port: 5270, key: 'test-key' })

        // 运行所有待处理的定时器和微任务
        await vi.runAllTimersAsync()

        // 验证警告被输出
        expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('already running'))
      })

      test('当 lock 文件存在但进程不存活时，删除 lock 文件并继续', async () => {
        mockExistsSync.mockReturnValue(true)
        mockReadFileSync.mockReturnValue('12345')
        mockCheckMainProcessAlive.mockResolvedValue(false)

        const { MainProcess } = await import('./fork')
        new MainProcess({ port: 5270, key: 'test-key' })

        // 运行所有待处理的定时器和微任务
        await vi.runAllTimersAsync()

        // 验证 lock 文件被删除
        expect(mockUnlinkSafe).toHaveBeenCalled()
      })

      test('WebSocket 连接错误时，启动子进程', async () => {
        mockExistsSync.mockReturnValue(false)

        const { MainProcess } = await import('./fork')
        new MainProcess({ port: 5270, key: 'test-key' })

        // 模拟 WebSocket 连接错误
        wsInstances[0].emit('error', new Error('Connection refused'))

        // 验证 fork 被调用
        expect(mockFork).toHaveBeenCalled()
      })

      test('子进程发送 READY_MESSAGE 后创建新的 WebSocket 连接', async () => {
        mockExistsSync.mockReturnValue(false)

        const { MainProcess } = await import('./fork')
        new MainProcess({ port: 5270, key: 'test-key' })

        const initialWsCount = wsInstances.length

        // 模拟 WebSocket 连接错误
        wsInstances[0].emit('error', new Error('Connection refused'))

        // 模拟子进程发送 ready 消息
        cpInstances[0].emit('message', READY_MESSAGE)

        // 验证新的 WebSocket 连接被创建
        expect(wsInstances.length).toBeGreaterThan(initialWsCount)
      })

      test('子进程发送非 READY_MESSAGE 时不创建新连接', async () => {
        mockExistsSync.mockReturnValue(false)

        const { MainProcess } = await import('./fork')
        new MainProcess({ port: 5270, key: 'test-key' })

        // 模拟 WebSocket 连接错误
        wsInstances[0].emit('error', new Error('Connection refused'))

        const wsCountAfterError = wsInstances.length

        // 模拟子进程发送其他消息
        cpInstances[0].emit('message', 'other-message')

        // 验证没有创建新的 WebSocket 连接
        expect(wsInstances.length).toBe(wsCountAfterError)
      })

      test('WebSocket 错误事件被正确记录', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        mockExistsSync.mockReturnValue(false)

        const { MainProcess } = await import('./fork')
        new MainProcess({ port: 5270, key: 'test-key' })

        // 先连接成功
        wsInstances[0].emit('open')

        // 等待 Promise 解析
        await vi.advanceTimersByTimeAsync(0)

        // 然后发生错误
        const error = new Error('WebSocket error')
        wsInstances[0].emit('error', error)

        // 验证错误被记录
        expect(consoleSpy).toHaveBeenCalledWith('MainProcess Socket Error: ', error)

        consoleSpy.mockRestore()
      })
    })

    describe('send 方法', () => {
      test('发送数据到 WebSocket', async () => {
        mockExistsSync.mockReturnValue(false)

        const { MainProcess } = await import('./fork')
        const mainProcess = new MainProcess({ port: 5270, key: 'test-key' })

        // 模拟 WebSocket 连接成功
        wsInstances[0].emit('open')

        // 发送数据
        const testData = { type: 'test', data: { foo: 'bar' } }
        await mainProcess.send(testData)

        // 验证数据被发送
        expect(mockWsSend).toHaveBeenCalledWith(JSON.stringify(testData))
      })

      test('当 cell 被中止时，不发送数据', async () => {
        mockExistsSync.mockReturnValue(false)
        mockGetCurrentCell.mockReturnValue({
          isAborted: true,
          request: new RequestDetail(),
          pipes: []
        })

        const { MainProcess } = await import('./fork')
        const mainProcess = new MainProcess({ port: 5270, key: 'test-key' })

        // 模拟 WebSocket 连接成功
        wsInstances[0].emit('open')

        // 清除之前的调用
        mockWsSend.mockClear()

        // 发送数据
        await mainProcess.send({ type: 'test' })

        // 验证数据没有被发送
        expect(mockWsSend).not.toHaveBeenCalled()
      })
    })

    describe('sendRequest 方法', () => {
      test('发送请求数据', async () => {
        mockExistsSync.mockReturnValue(false)
        mockGetCurrentCell.mockReturnValue(null)

        const { MainProcess } = await import('./fork')
        const mainProcess = new MainProcess({ port: 5270, key: 'test-key' })

        // 模拟 WebSocket 连接成功
        wsInstances[0].emit('open')

        // 等待 Promise 解析
        await vi.advanceTimersByTimeAsync(0)

        // 清除之前的调用
        mockWsSend.mockClear()

        // 发送请求
        const requestDetail = new RequestDetail()
        requestDetail.url = 'http://example.com'
        requestDetail.method = 'GET'

        mainProcess.sendRequest('initRequest', requestDetail)

        // 等待异步发送完成
        await vi.advanceTimersByTimeAsync(0)

        // 验证数据被发送
        expect(mockWsSend).toHaveBeenCalledWith(expect.stringContaining('initRequest'))
      })

      test('返回 this 以支持链式调用', async () => {
        mockExistsSync.mockReturnValue(false)

        const { MainProcess } = await import('./fork')
        const mainProcess = new MainProcess({ port: 5270, key: 'test-key' })

        const requestDetail = new RequestDetail()
        const result = mainProcess.sendRequest('initRequest', requestDetail)

        expect(result).toBe(mainProcess)
      })

      test('当存在 cell 时，应用 pipes', async () => {
        mockExistsSync.mockReturnValue(false)

        const mockPipe = vi.fn((req: RequestDetail) => {
          req.method = 'POST'
          return req
        })

        mockGetCurrentCell.mockReturnValue({
          isAborted: false,
          request: new RequestDetail(),
          pipes: [{ type: 'initRequest', pipe: mockPipe }]
        })

        const { MainProcess } = await import('./fork')
        const mainProcess = new MainProcess({ port: 5270, key: 'test-key' })

        const requestDetail = new RequestDetail()
        requestDetail.method = 'GET'

        mainProcess.sendRequest('initRequest', requestDetail)

        // 验证 pipe 被调用
        expect(mockPipe).toHaveBeenCalled()
      })

      test('只应用匹配类型的 pipes', async () => {
        mockExistsSync.mockReturnValue(false)

        const initPipe = vi.fn((req: RequestDetail) => req)
        const updatePipe = vi.fn((req: RequestDetail) => req)

        mockGetCurrentCell.mockReturnValue({
          isAborted: false,
          request: new RequestDetail(),
          pipes: [
            { type: 'initRequest', pipe: initPipe },
            { type: 'updateRequest', pipe: updatePipe }
          ]
        })

        const { MainProcess } = await import('./fork')
        const mainProcess = new MainProcess({ port: 5270, key: 'test-key' })

        const requestDetail = new RequestDetail()
        mainProcess.sendRequest('initRequest', requestDetail)

        // 验证只有 initPipe 被调用
        expect(initPipe).toHaveBeenCalled()
        expect(updatePipe).not.toHaveBeenCalled()
      })
    })

    describe('responseRequest 方法', () => {
      test('处理响应数据并发送', async () => {
        mockExistsSync.mockReturnValue(false)

        const { MainProcess } = await import('./fork')
        const mainProcess = new MainProcess({ port: 5270, key: 'test-key' })

        // 模拟 WebSocket 连接成功
        wsInstances[0].emit('open')

        // 等待 Promise 解析
        await vi.advanceTimersByTimeAsync(0)

        // 清除之前的调用
        mockWsSend.mockClear()

        // 创建 mock 响应
        const mockResponse = new EventEmitter() as EventEmitter & {
          statusCode: number
          headers: Record<string, string>
        }
        mockResponse.statusCode = 200
        mockResponse.headers = { 'content-type': 'application/json' }

        // 调用 responseRequest
        mainProcess.responseRequest('test-id', mockResponse as IncomingMessage)

        // 模拟响应数据
        mockResponse.emit('data', Buffer.from('{"foo":"bar"}'))
        mockResponse.emit('end')

        // 等待异步操作完成
        await vi.advanceTimersByTimeAsync(0)

        // 验证数据被发送
        expect(mockWsSend).toHaveBeenCalledWith(expect.stringContaining('responseData'), {
          binary: true
        })

        // 验证发送的数据包含正确的 id 和状态码
        const sentData = JSON.parse(mockWsSend.mock.calls[0][0])
        expect(sentData.type).toBe('responseData')
        expect(sentData.data.id).toBe('test-id')
        expect(sentData.data.statusCode).toBe(200)
      })

      test('正确合并多个数据块', async () => {
        mockExistsSync.mockReturnValue(false)

        const { MainProcess } = await import('./fork')
        const mainProcess = new MainProcess({ port: 5270, key: 'test-key' })

        // 模拟 WebSocket 连接成功
        wsInstances[0].emit('open')

        // 等待 Promise 解析
        await vi.advanceTimersByTimeAsync(0)

        // 清除之前的调用
        mockWsSend.mockClear()

        const mockResponse = new EventEmitter() as EventEmitter & {
          statusCode: number
          headers: Record<string, string>
        }
        mockResponse.statusCode = 200
        mockResponse.headers = {}

        mainProcess.responseRequest('test-id', mockResponse as IncomingMessage)

        // 模拟多个数据块
        mockResponse.emit('data', Buffer.from('Hello'))
        mockResponse.emit('data', Buffer.from(' '))
        mockResponse.emit('data', Buffer.from('World'))
        mockResponse.emit('end')

        await vi.advanceTimersByTimeAsync(0)

        // 验证数据被正确合并
        const sentData = JSON.parse(mockWsSend.mock.calls[0][0])
        const rawData = Buffer.from(sentData.data.rawData.data)
        expect(rawData.toString()).toBe('Hello World')
      })
    })

    describe('dispose 方法', () => {
      test('清理 WebSocket 连接', async () => {
        mockExistsSync.mockReturnValue(false)

        const { MainProcess } = await import('./fork')
        const mainProcess = new MainProcess({ port: 5270, key: 'test-key' })

        // 模拟 WebSocket 连接成功
        wsInstances[0].emit('open')

        // 调用 dispose
        await mainProcess.dispose()

        // 验证 WebSocket 被清理
        expect(mockWsRemoveAllListeners).toHaveBeenCalled()
        expect(mockWsTerminate).toHaveBeenCalled()
      })

      test('清理子进程', async () => {
        mockExistsSync.mockReturnValue(false)

        const { MainProcess } = await import('./fork')
        const mainProcess = new MainProcess({ port: 5270, key: 'test-key' })

        // 模拟 WebSocket 连接错误，触发子进程创建
        wsInstances[0].emit('error', new Error('Connection refused'))

        // 模拟子进程发送 ready 消息
        cpInstances[0].emit('message', READY_MESSAGE)

        // 模拟新的 WebSocket 连接成功
        wsInstances[1].emit('open')

        // 调用 dispose
        await mainProcess.dispose()

        // 验证子进程被清理
        expect(mockCpRemoveAllListeners).toHaveBeenCalled()
        expect(mockCpKill).toHaveBeenCalled()
      })
    })

    describe('healthCheck 私有方法', () => {
      test('WebSocket 连接成功后发送健康检查消息', async () => {
        mockExistsSync.mockReturnValue(false)

        const { MainProcess } = await import('./fork')
        new MainProcess({ port: 5270, key: 'test-key' })

        // 模拟 WebSocket 连接成功
        wsInstances[0].emit('open')

        // 等待 Promise 解析
        await vi.advanceTimersByTimeAsync(0)

        // 验证健康检查消息被发送
        expect(mockWsSend).toHaveBeenCalledWith(expect.stringContaining('healthcheck'))
      })

      test('定时发送健康检查消息', async () => {
        mockExistsSync.mockReturnValue(false)

        const { MainProcess } = await import('./fork')
        new MainProcess({ port: 5270, key: 'test-key' })

        // 模拟 WebSocket 连接成功
        wsInstances[0].emit('open')

        // 清除初始的健康检查调用
        mockWsSend.mockClear()

        // 推进时间 2 秒
        await vi.advanceTimersByTimeAsync(2000)

        // 验证健康检查消息被再次发送
        expect(mockWsSend).toHaveBeenCalledWith(expect.stringContaining('healthcheck'))
      })
    })
  })

  describe('RequestType 类型', () => {
    test('导出正确的请求类型', async () => {
      const { MainProcess } = await import('./fork')

      // 验证 MainProcess 类存在
      expect(MainProcess).toBeDefined()
      expect(typeof MainProcess).toBe('function')
    })
  })

  describe('__dirname 导出', () => {
    test('导出 __dirname', async () => {
      const forkModule = await import('./fork')

      expect(forkModule.__dirname).toBeDefined()
      expect(typeof forkModule.__dirname).toBe('string')
    })
  })
})

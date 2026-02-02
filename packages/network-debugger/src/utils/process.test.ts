import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import net from 'net'
import { EventEmitter } from 'events'
import { sleep, checkMainProcessAlive } from './process'

describe('process.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('sleep', () => {
    describe('基本功能', () => {
      test('返回一个 Promise', () => {
        const result = sleep(100)
        expect(result).toBeInstanceOf(Promise)
      })

      test('在指定时间后 resolve', async () => {
        const promise = sleep(1000)

        // 快进时间
        vi.advanceTimersByTime(1000)

        await expect(promise).resolves.toBeUndefined()
      })

      test('在时间未到时不会 resolve', async () => {
        let resolved = false
        const promise = sleep(1000).then(() => {
          resolved = true
        })

        // 快进 500ms
        vi.advanceTimersByTime(500)

        // 使用 Promise.resolve 确保微任务队列被处理
        await Promise.resolve()

        expect(resolved).toBe(false)

        // 快进剩余时间
        vi.advanceTimersByTime(500)
        await promise

        expect(resolved).toBe(true)
      })
    })

    describe('不同延迟时间', () => {
      test('0ms 延迟', async () => {
        const promise = sleep(0)
        vi.advanceTimersByTime(0)
        await expect(promise).resolves.toBeUndefined()
      })

      test('1ms 延迟', async () => {
        const promise = sleep(1)
        vi.advanceTimersByTime(1)
        await expect(promise).resolves.toBeUndefined()
      })

      test('100ms 延迟', async () => {
        const promise = sleep(100)
        vi.advanceTimersByTime(100)
        await expect(promise).resolves.toBeUndefined()
      })

      test('1000ms 延迟', async () => {
        const promise = sleep(1000)
        vi.advanceTimersByTime(1000)
        await expect(promise).resolves.toBeUndefined()
      })

      test('大延迟值 (10000ms)', async () => {
        const promise = sleep(10000)
        vi.advanceTimersByTime(10000)
        await expect(promise).resolves.toBeUndefined()
      })
    })

    describe('边界情况', () => {
      test('负数延迟（行为与 setTimeout 一致，立即执行）', async () => {
        const promise = sleep(-100)
        vi.advanceTimersByTime(0)
        await expect(promise).resolves.toBeUndefined()
      })

      test('小数延迟', async () => {
        const promise = sleep(1.5)
        vi.advanceTimersByTime(2)
        await expect(promise).resolves.toBeUndefined()
      })
    })
  })

  describe('checkMainProcessAlive', () => {
    let originalProcessKill: typeof process.kill
    let mockServerEmitter: EventEmitter
    let mockListenFn: ReturnType<typeof vi.fn>
    let mockCloseFn: ReturnType<typeof vi.fn>

    beforeEach(() => {
      originalProcessKill = process.kill

      // 创建 EventEmitter 用于事件触发
      mockServerEmitter = new EventEmitter()
      mockListenFn = vi.fn()
      mockCloseFn = vi.fn((callback?: (err?: Error) => void) => {
        if (callback) callback()
      })

      // 创建一个符合 net.Server 接口的 mock 对象
      const mockServer = Object.assign(mockServerEmitter, {
        listen: mockListenFn,
        close: mockCloseFn,
        address: vi.fn().mockReturnValue(null),
        getConnections: vi.fn(),
        ref: vi.fn().mockReturnThis(),
        unref: vi.fn().mockReturnThis(),
        maxConnections: 0,
        connections: 0,
        listening: false,
        [Symbol.asyncDispose]: vi.fn()
      }) as net.Server

      // 使用 spyOn 来 mock createServer
      vi.spyOn(net, 'createServer').mockReturnValue(mockServer)
    })

    afterEach(() => {
      process.kill = originalProcessKill
    })

    describe('当 pid 等于当前进程 pid 时', () => {
      test('返回 true（数字类型 pid）', async () => {
        const result = await checkMainProcessAlive(process.pid, 3000)
        expect(result).toBe(true)
      })

      test('返回 true（字符串类型 pid）', async () => {
        const result = await checkMainProcessAlive(String(process.pid), 3000)
        expect(result).toBe(true)
      })
    })

    describe('当进程存在时', () => {
      beforeEach(() => {
        // Mock process.kill 不抛出错误（进程存在）
        process.kill = vi.fn()
      })

      test('端口未被占用时返回 true', async () => {
        // 设置 listen 行为：触发 listening 事件
        mockListenFn.mockImplementation(() => {
          setTimeout(() => {
            mockServerEmitter.emit('listening')
          }, 0)
        })

        const promise = checkMainProcessAlive(12345, 3000)
        vi.advanceTimersByTime(10)
        const result = await promise

        expect(result).toBe(true)
        expect(process.kill).toHaveBeenCalledWith(12345, 0)
        expect(mockListenFn).toHaveBeenCalledWith(3000)
      })

      test('端口被占用时返回 false（EADDRINUSE）', async () => {
        // 设置 listen 行为：触发 error 事件
        mockListenFn.mockImplementation(() => {
          setTimeout(() => {
            const error = new Error('EADDRINUSE') as NodeJS.ErrnoException
            error.code = 'EADDRINUSE'
            mockServerEmitter.emit('error', error)
          }, 0)
        })

        const promise = checkMainProcessAlive(12345, 3000)
        vi.advanceTimersByTime(10)
        const result = await promise

        expect(result).toBe(false)
      })

      test('其他端口错误时返回 false', async () => {
        // 设置 listen 行为：触发其他错误
        mockListenFn.mockImplementation(() => {
          setTimeout(() => {
            const error = new Error('EACCES') as NodeJS.ErrnoException
            error.code = 'EACCES'
            mockServerEmitter.emit('error', error)
          }, 0)
        })

        const promise = checkMainProcessAlive(12345, 3000)
        vi.advanceTimersByTime(10)
        const result = await promise

        expect(result).toBe(false)
      })
    })

    describe('当进程不存在时', () => {
      test('process.kill 抛出错误时返回 false', async () => {
        process.kill = vi.fn().mockImplementation(() => {
          throw new Error('ESRCH')
        })

        const result = await checkMainProcessAlive(99999, 3000)

        expect(result).toBe(false)
        expect(process.kill).toHaveBeenCalledWith(99999, 0)
      })
    })

    describe('字符串类型 pid', () => {
      beforeEach(() => {
        process.kill = vi.fn()
        mockListenFn.mockImplementation(() => {
          setTimeout(() => {
            mockServerEmitter.emit('listening')
          }, 0)
        })
      })

      test('字符串 pid 被正确转换为数字', async () => {
        const promise = checkMainProcessAlive('12345', 3000)
        vi.advanceTimersByTime(10)
        await promise

        expect(process.kill).toHaveBeenCalledWith(12345, 0)
      })
    })

    describe('不同端口号', () => {
      beforeEach(() => {
        process.kill = vi.fn()
        mockListenFn.mockImplementation(() => {
          setTimeout(() => {
            mockServerEmitter.emit('listening')
          }, 0)
        })
      })

      test('端口 80', async () => {
        const promise = checkMainProcessAlive(12345, 80)
        vi.advanceTimersByTime(10)
        await promise

        expect(mockListenFn).toHaveBeenCalledWith(80)
      })

      test('端口 443', async () => {
        const promise = checkMainProcessAlive(12345, 443)
        vi.advanceTimersByTime(10)
        await promise

        expect(mockListenFn).toHaveBeenCalledWith(443)
      })

      test('端口 8080', async () => {
        const promise = checkMainProcessAlive(12345, 8080)
        vi.advanceTimersByTime(10)
        await promise

        expect(mockListenFn).toHaveBeenCalledWith(8080)
      })

      test('端口 65535', async () => {
        const promise = checkMainProcessAlive(12345, 65535)
        vi.advanceTimersByTime(10)
        await promise

        expect(mockListenFn).toHaveBeenCalledWith(65535)
      })
    })
  })
})

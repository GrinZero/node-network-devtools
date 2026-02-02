import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRegisterRequest } from './useRegisterRequest'
import { setCurrentCell, type Cell } from './cell'
import { RequestDetail } from '../../common'

describe('core/hooks/useRegisterRequest.ts', () => {
  beforeEach(() => {
    // 每个测试前重置 currentCell 为 null
    setCurrentCell(null)
  })

  afterEach(() => {
    // 每个测试后清理
    setCurrentCell(null)
  })

  describe('useRegisterRequest 函数', () => {
    test('当 currentCell 为 null 时抛出错误', () => {
      const mockPipe = (req: RequestDetail) => req

      expect(() => {
        useRegisterRequest(mockPipe)
      }).toThrow('useRegisterRequest must be used in request handler')
    })

    test('当 currentCell 存在时，将 pipe 添加到 pipes 数组', () => {
      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(cell)

      const mockPipe = (req: RequestDetail) => req

      expect(cell.pipes).toHaveLength(0)

      useRegisterRequest(mockPipe)

      expect(cell.pipes).toHaveLength(1)
      expect(cell.pipes[0].pipe).toBe(mockPipe)
      expect(cell.pipes[0].type).toBe('registerRequest')
    })

    test('多次调用 useRegisterRequest 添加多个 pipes', () => {
      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(cell)

      const pipe1 = (req: RequestDetail) => req
      const pipe2 = (req: RequestDetail) => {
        req.method = 'POST'
        return req
      }
      const pipe3 = (req: RequestDetail) => {
        req.url = 'http://modified.com'
        return req
      }

      useRegisterRequest(pipe1)
      useRegisterRequest(pipe2)
      useRegisterRequest(pipe3)

      expect(cell.pipes).toHaveLength(3)
      expect(cell.pipes[0].pipe).toBe(pipe1)
      expect(cell.pipes[1].pipe).toBe(pipe2)
      expect(cell.pipes[2].pipe).toBe(pipe3)

      // 所有 pipes 的 type 都应该是 'registerRequest'
      cell.pipes.forEach((pipeItem) => {
        expect(pipeItem.type).toBe('registerRequest')
      })
    })

    test('useRegisterRequest 返回 undefined', () => {
      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(cell)

      const mockPipe = (req: RequestDetail) => req
      const result = useRegisterRequest(mockPipe)

      expect(result).toBeUndefined()
    })

    test('添加的 pipe 可以正确执行', () => {
      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(cell)

      const mockPipe = vi.fn((req: RequestDetail) => {
        req.method = 'POST'
        req.url = 'http://modified.com'
        return req
      })

      useRegisterRequest(mockPipe)

      // 执行添加的 pipe
      const request = new RequestDetail()
      request.method = 'GET'
      request.url = 'http://original.com'

      const result = cell.pipes[0].pipe(request)

      expect(mockPipe).toHaveBeenCalledWith(request)
      expect(result.method).toBe('POST')
      expect(result.url).toBe('http://modified.com')
    })

    test('useRegisterRequest 不影响 cell 的其他属性', () => {
      const request = new RequestDetail()
      request.url = 'http://example.com'

      const cell: Cell = {
        request,
        pipes: [],
        isAborted: true
      }

      setCurrentCell(cell)

      const mockPipe = (req: RequestDetail) => req
      useRegisterRequest(mockPipe)

      // 验证其他属性未被修改
      expect(cell.request).toBe(request)
      expect(cell.request.url).toBe('http://example.com')
      expect(cell.isAborted).toBe(true)
    })

    test('可以与已有的 pipes 共存', () => {
      const existingPipe = (req: RequestDetail) => req

      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [{ pipe: existingPipe, type: 'initRequest' }],
        isAborted: false
      }

      setCurrentCell(cell)

      const newPipe = (req: RequestDetail) => req
      useRegisterRequest(newPipe)

      expect(cell.pipes).toHaveLength(2)
      expect(cell.pipes[0].pipe).toBe(existingPipe)
      expect(cell.pipes[0].type).toBe('initRequest')
      expect(cell.pipes[1].pipe).toBe(newPipe)
      expect(cell.pipes[1].type).toBe('registerRequest')
    })
  })
})

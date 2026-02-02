import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRequestPipe } from './useRequestPipe'
import { setCurrentCell, type Cell } from './cell'
import { RequestDetail } from '../../common'

describe('core/hooks/useRequestPipe.ts', () => {
  beforeEach(() => {
    // 每个测试前重置 currentCell 为 null
    setCurrentCell(null)
  })

  afterEach(() => {
    // 每个测试后清理
    setCurrentCell(null)
  })

  describe('useRequestPipe 函数', () => {
    test('当 currentCell 为 null 时抛出错误', () => {
      const mockPipe = (req: RequestDetail) => req

      expect(() => {
        useRequestPipe('initRequest', mockPipe)
      }).toThrow('useRequestPipe must be used in request handler')
    })

    test('当 currentCell 存在时，将 pipe 添加到 pipes 数组并使用指定的 type', () => {
      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(cell)

      const mockPipe = (req: RequestDetail) => req

      expect(cell.pipes).toHaveLength(0)

      useRequestPipe('initRequest', mockPipe)

      expect(cell.pipes).toHaveLength(1)
      expect(cell.pipes[0].pipe).toBe(mockPipe)
      expect(cell.pipes[0].type).toBe('initRequest')
    })

    test('可以添加不同类型的 pipes', () => {
      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(cell)

      const initPipe = (req: RequestDetail) => req
      const registerPipe = (req: RequestDetail) => req
      const updatePipe = (req: RequestDetail) => req
      const endPipe = (req: RequestDetail) => req

      useRequestPipe('initRequest', initPipe)
      useRequestPipe('registerRequest', registerPipe)
      useRequestPipe('updateRequest', updatePipe)
      useRequestPipe('endRequest', endPipe)

      expect(cell.pipes).toHaveLength(4)
      expect(cell.pipes[0].type).toBe('initRequest')
      expect(cell.pipes[1].type).toBe('registerRequest')
      expect(cell.pipes[2].type).toBe('updateRequest')
      expect(cell.pipes[3].type).toBe('endRequest')
    })

    test('可以添加多个相同类型的 pipes', () => {
      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(cell)

      const pipe1 = (req: RequestDetail) => req
      const pipe2 = (req: RequestDetail) => req
      const pipe3 = (req: RequestDetail) => req

      useRequestPipe('updateRequest', pipe1)
      useRequestPipe('updateRequest', pipe2)
      useRequestPipe('updateRequest', pipe3)

      expect(cell.pipes).toHaveLength(3)
      cell.pipes.forEach((pipeItem) => {
        expect(pipeItem.type).toBe('updateRequest')
      })
    })

    test('useRequestPipe 返回 undefined', () => {
      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(cell)

      const mockPipe = (req: RequestDetail) => req
      const result = useRequestPipe('initRequest', mockPipe)

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
        req.method = 'PUT'
        req.url = 'http://updated.com'
        return req
      })

      useRequestPipe('updateRequest', mockPipe)

      // 执行添加的 pipe
      const request = new RequestDetail()
      request.method = 'GET'
      request.url = 'http://original.com'

      const result = cell.pipes[0].pipe(request)

      expect(mockPipe).toHaveBeenCalledWith(request)
      expect(result.method).toBe('PUT')
      expect(result.url).toBe('http://updated.com')
    })

    test('useRequestPipe 不影响 cell 的其他属性', () => {
      const request = new RequestDetail()
      request.url = 'http://example.com'

      const cell: Cell = {
        request,
        pipes: [],
        isAborted: true
      }

      setCurrentCell(cell)

      const mockPipe = (req: RequestDetail) => req
      useRequestPipe('endRequest', mockPipe)

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
      useRequestPipe('updateRequest', newPipe)

      expect(cell.pipes).toHaveLength(2)
      expect(cell.pipes[0].pipe).toBe(existingPipe)
      expect(cell.pipes[0].type).toBe('initRequest')
      expect(cell.pipes[1].pipe).toBe(newPipe)
      expect(cell.pipes[1].type).toBe('updateRequest')
    })

    test('pipe 可以修改请求的各种属性', () => {
      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(cell)

      const modifyPipe = (req: RequestDetail) => {
        req.method = 'POST'
        req.url = 'http://modified.com'
        req.requestHeaders = { 'Content-Type': 'application/json' }
        req.requestData = { key: 'value' }
        return req
      }

      useRequestPipe('initRequest', modifyPipe)

      const request = new RequestDetail()
      const result = cell.pipes[0].pipe(request)

      expect(result.method).toBe('POST')
      expect(result.url).toBe('http://modified.com')
      expect(result.requestHeaders).toEqual({ 'Content-Type': 'application/json' })
      expect(result.requestData).toEqual({ key: 'value' })
    })
  })

  describe('RequestType 类型验证', () => {
    test('支持 initRequest 类型', () => {
      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(cell)

      const mockPipe = (req: RequestDetail) => req
      useRequestPipe('initRequest', mockPipe)

      expect(cell.pipes[0].type).toBe('initRequest')
    })

    test('支持 registerRequest 类型', () => {
      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(cell)

      const mockPipe = (req: RequestDetail) => req
      useRequestPipe('registerRequest', mockPipe)

      expect(cell.pipes[0].type).toBe('registerRequest')
    })

    test('支持 updateRequest 类型', () => {
      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(cell)

      const mockPipe = (req: RequestDetail) => req
      useRequestPipe('updateRequest', mockPipe)

      expect(cell.pipes[0].type).toBe('updateRequest')
    })

    test('支持 endRequest 类型', () => {
      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(cell)

      const mockPipe = (req: RequestDetail) => req
      useRequestPipe('endRequest', mockPipe)

      expect(cell.pipes[0].type).toBe('endRequest')
    })
  })
})

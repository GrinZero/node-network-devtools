import { describe, test, expect, beforeEach } from 'vitest'
import { getCurrentCell, setCurrentCell, type Cell, type Pipe } from './cell'
import { RequestDetail } from '../../common'

describe('core/hooks/cell.ts', () => {
  beforeEach(() => {
    // 每个测试前重置 currentCell 为 null
    setCurrentCell(null)
  })

  describe('getCurrentCell 函数', () => {
    test('初始状态下返回 null', () => {
      const cell = getCurrentCell()
      expect(cell).toBeNull()
    })

    test('设置 cell 后返回正确的值', () => {
      const mockCell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(mockCell)
      const cell = getCurrentCell()

      expect(cell).toBe(mockCell)
    })
  })

  describe('setCurrentCell 函数', () => {
    test('可以设置 cell 为有效对象', () => {
      const mockCell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(mockCell)

      expect(getCurrentCell()).toBe(mockCell)
    })

    test('可以设置 cell 为 null', () => {
      const mockCell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: true
      }

      setCurrentCell(mockCell)
      expect(getCurrentCell()).toBe(mockCell)

      setCurrentCell(null)
      expect(getCurrentCell()).toBeNull()
    })

    test('可以多次设置不同的 cell', () => {
      const cell1: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      const cell2: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: true
      }

      setCurrentCell(cell1)
      expect(getCurrentCell()).toBe(cell1)

      setCurrentCell(cell2)
      expect(getCurrentCell()).toBe(cell2)
    })
  })

  describe('Cell 接口', () => {
    test('Cell 对象包含正确的属性', () => {
      const request = new RequestDetail()
      request.url = 'http://example.com'
      request.method = 'GET'

      const mockPipe: Pipe = (req) => {
        req.method = 'POST'
        return req
      }

      const cell: Cell = {
        request,
        pipes: [{ pipe: mockPipe, type: 'initRequest' }],
        isAborted: false
      }

      expect(cell.request).toBe(request)
      expect(cell.pipes).toHaveLength(1)
      expect(cell.pipes[0].type).toBe('initRequest')
      expect(cell.isAborted).toBe(false)
    })

    test('Cell 的 isAborted 默认为 false', () => {
      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      expect(cell.isAborted).toBe(false)
    })

    test('Cell 可以包含多个 pipes', () => {
      const pipe1: Pipe = (req) => req
      const pipe2: Pipe = (req) => req
      const pipe3: Pipe = (req) => req

      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [
          { pipe: pipe1, type: 'initRequest' },
          { pipe: pipe2, type: 'registerRequest' },
          { pipe: pipe3, type: 'updateRequest' }
        ],
        isAborted: false
      }

      expect(cell.pipes).toHaveLength(3)
      expect(cell.pipes[0].type).toBe('initRequest')
      expect(cell.pipes[1].type).toBe('registerRequest')
      expect(cell.pipes[2].type).toBe('updateRequest')
    })
  })

  describe('Pipe 接口', () => {
    test('Pipe 函数可以修改 RequestDetail', () => {
      const pipe: Pipe = (req) => {
        req.method = 'POST'
        req.url = 'http://modified.com'
        return req
      }

      const request = new RequestDetail()
      request.method = 'GET'
      request.url = 'http://original.com'

      const result = pipe(request)

      expect(result.method).toBe('POST')
      expect(result.url).toBe('http://modified.com')
    })

    test('Pipe 函数返回相同的 RequestDetail 实例', () => {
      const pipe: Pipe = (req) => req

      const request = new RequestDetail()
      const result = pipe(request)

      expect(result).toBe(request)
    })
  })
})

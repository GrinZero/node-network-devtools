import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { useAbortRequest } from './useAbortRequest'
import { setCurrentCell, type Cell } from './cell'
import { RequestDetail } from '../../common'

describe('core/hooks/useAbortRequest.ts', () => {
  beforeEach(() => {
    // 每个测试前重置 currentCell 为 null
    setCurrentCell(null)
  })

  afterEach(() => {
    // 每个测试后清理
    setCurrentCell(null)
  })

  describe('useAbortRequest 函数', () => {
    test('当 currentCell 为 null 时抛出错误', () => {
      expect(() => {
        useAbortRequest()
      }).toThrow('useRegisterRequest must be used in request handler')
    })

    test('当 currentCell 存在时，设置 isAborted 为 true', () => {
      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(cell)

      expect(cell.isAborted).toBe(false)

      useAbortRequest()

      expect(cell.isAborted).toBe(true)
    })

    test('多次调用 useAbortRequest 保持 isAborted 为 true', () => {
      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(cell)

      useAbortRequest()
      expect(cell.isAborted).toBe(true)

      useAbortRequest()
      expect(cell.isAborted).toBe(true)
    })

    test('useAbortRequest 返回 undefined', () => {
      const cell: Cell = {
        request: new RequestDetail(),
        pipes: [],
        isAborted: false
      }

      setCurrentCell(cell)

      const result = useAbortRequest()

      expect(result).toBeUndefined()
    })

    test('useAbortRequest 不影响 cell 的其他属性', () => {
      const request = new RequestDetail()
      request.url = 'http://example.com'
      request.method = 'GET'

      const mockPipe = (req: RequestDetail) => req

      const cell: Cell = {
        request,
        pipes: [{ pipe: mockPipe, type: 'initRequest' }],
        isAborted: false
      }

      setCurrentCell(cell)

      useAbortRequest()

      // 验证其他属性未被修改
      expect(cell.request).toBe(request)
      expect(cell.request.url).toBe('http://example.com')
      expect(cell.request.method).toBe('GET')
      expect(cell.pipes).toHaveLength(1)
      expect(cell.pipes[0].type).toBe('initRequest')
    })
  })
})

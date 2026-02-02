import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatHeadersToHeaderText,
  parseRawHeaders,
  stringifyNestedObj,
  getTimestamp
} from './header'

describe('header.ts', () => {
  describe('formatHeadersToHeaderText', () => {
    test('将空 headers 对象格式化为仅包含基础字符串', () => {
      const base = 'HTTP/1.1 200 OK\r\n'
      const headers = {}
      const result = formatHeadersToHeaderText(base, headers)

      expect(result).toBe('HTTP/1.1 200 OK\r\n')
    })

    test('将单个 header 格式化为文本', () => {
      const base = 'HTTP/1.1 200 OK\r\n'
      const headers = { 'Content-Type': 'application/json' }
      const result = formatHeadersToHeaderText(base, headers)

      expect(result).toBe('HTTP/1.1 200 OK\r\nContent-Type: application/json')
    })

    test('将多个 headers 格式化为文本，使用 CRLF 分隔', () => {
      const base = 'HTTP/1.1 200 OK\r\n'
      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': '123',
        'Cache-Control': 'no-cache'
      }
      const result = formatHeadersToHeaderText(base, headers)

      expect(result).toBe(
        'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 123\r\nCache-Control: no-cache'
      )
    })

    test('将非字符串值转换为字符串', () => {
      const base = ''
      const headers = {
        'Content-Length': 123,
        'X-Custom-Boolean': true,
        'X-Custom-Null': null
      }
      const result = formatHeadersToHeaderText(base, headers)

      expect(result).toBe('Content-Length: 123\r\nX-Custom-Boolean: true\r\nX-Custom-Null: null')
    })

    test('处理空基础字符串', () => {
      const base = ''
      const headers = { 'Content-Type': 'text/html' }
      const result = formatHeadersToHeaderText(base, headers)

      expect(result).toBe('Content-Type: text/html')
    })

    test('处理 undefined 值', () => {
      const base = ''
      const headers = { 'X-Undefined': undefined }
      const result = formatHeadersToHeaderText(base, headers)

      expect(result).toBe('X-Undefined: undefined')
    })
  })

  describe('parseRawHeaders', () => {
    test('解析空数组返回空对象', () => {
      const rawHeaders: string[] = []
      const result = parseRawHeaders(rawHeaders)

      expect(result).toEqual({})
    })

    test('解析单个键值对', () => {
      const rawHeaders = ['Content-Type', 'application/json']
      const result = parseRawHeaders(rawHeaders)

      expect(result).toEqual({ 'Content-Type': 'application/json' })
    })

    test('解析多个键值对', () => {
      const rawHeaders = [
        'Content-Type',
        'application/json',
        'Content-Length',
        '123',
        'Cache-Control',
        'no-cache'
      ]
      const result = parseRawHeaders(rawHeaders)

      expect(result).toEqual({
        'Content-Type': 'application/json',
        'Content-Length': '123',
        'Cache-Control': 'no-cache'
      })
    })

    test('处理奇数长度数组（最后一个键没有值）', () => {
      const rawHeaders = ['Content-Type', 'application/json', 'X-Orphan']
      const result = parseRawHeaders(rawHeaders)

      // 奇数长度时，最后一个键的值为 undefined
      expect(result).toEqual({
        'Content-Type': 'application/json',
        'X-Orphan': undefined
      })
    })

    test('处理重复的键（后者覆盖前者）', () => {
      const rawHeaders = ['Content-Type', 'text/html', 'Content-Type', 'application/json']
      const result = parseRawHeaders(rawHeaders)

      expect(result).toEqual({ 'Content-Type': 'application/json' })
    })

    test('处理空字符串键和值', () => {
      const rawHeaders = ['', 'empty-key-value', 'X-Header', '']
      const result = parseRawHeaders(rawHeaders)

      expect(result).toEqual({
        '': 'empty-key-value',
        'X-Header': ''
      })
    })
  })

  describe('stringifyNestedObj', () => {
    test('将空对象返回空对象', () => {
      const obj = {}
      const result = stringifyNestedObj(obj)

      expect(result).toEqual({})
    })

    test('将简单值转换为字符串', () => {
      const obj = {
        string: 'hello',
        number: 123,
        boolean: true,
        nullValue: null
      }
      const result = stringifyNestedObj(obj)

      expect(result).toEqual({
        string: 'hello',
        number: '123',
        boolean: 'true',
        nullValue: 'null'
      })
    })

    test('递归处理嵌套对象', () => {
      const obj = {
        level1: {
          level2: {
            value: 42
          }
        }
      }
      const result = stringifyNestedObj(obj)

      expect(result).toEqual({
        level1: {
          level2: {
            value: '42'
          }
        }
      })
    })

    test('处理混合嵌套和简单值', () => {
      const obj = {
        name: 'test',
        count: 5,
        nested: {
          active: true,
          data: {
            id: 100
          }
        }
      }
      const result = stringifyNestedObj(obj)

      expect(result).toEqual({
        name: 'test',
        count: '5',
        nested: {
          active: 'true',
          data: {
            id: '100'
          }
        }
      })
    })

    test('处理 undefined 值', () => {
      const obj = {
        undefinedValue: undefined
      }
      const result = stringifyNestedObj(obj)

      expect(result).toEqual({
        undefinedValue: 'undefined'
      })
    })

    test('处理数组（作为对象处理）', () => {
      const obj = {
        arr: [1, 2, 3]
      }
      const result = stringifyNestedObj(obj)

      // 数组是对象，会被递归处理
      expect(result).toEqual({
        arr: {
          '0': '1',
          '1': '2',
          '2': '3'
        }
      })
    })

    test('处理空嵌套对象', () => {
      const obj = {
        empty: {}
      }
      const result = stringifyNestedObj(obj)

      expect(result).toEqual({
        empty: {}
      })
    })

    test('处理深层嵌套', () => {
      const obj = {
        a: {
          b: {
            c: {
              d: {
                value: 'deep'
              }
            }
          }
        }
      }
      const result = stringifyNestedObj(obj)

      expect(result).toEqual({
        a: {
          b: {
            c: {
              d: {
                value: 'deep'
              }
            }
          }
        }
      })
    })
  })

  describe('getTimestamp', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    test('返回当前时间戳（秒）', () => {
      const mockTime = 1700000000000 // 2023-11-14T22:13:20.000Z
      vi.setSystemTime(mockTime)

      const result = getTimestamp()

      expect(result).toBe(1700000000)
    })

    test('返回带小数的时间戳', () => {
      const mockTime = 1700000000500 // 500ms
      vi.setSystemTime(mockTime)

      const result = getTimestamp()

      expect(result).toBe(1700000000.5)
    })

    test('时间戳随时间变化', () => {
      vi.setSystemTime(1000000000000)
      const timestamp1 = getTimestamp()

      vi.setSystemTime(2000000000000)
      const timestamp2 = getTimestamp()

      expect(timestamp2).toBeGreaterThan(timestamp1)
      // 时间差为 1000000000000ms = 1000000000s
      expect(timestamp2 - timestamp1).toBe(1000000000)
    })

    test('返回数字类型', () => {
      vi.setSystemTime(Date.now())
      const result = getTimestamp()

      expect(typeof result).toBe('number')
    })
  })
})

import { describe, test, expect } from 'vitest'
import { jsonParse } from './json'

describe('json.ts', () => {
  describe('jsonParse', () => {
    describe('有效 JSON 输入', () => {
      test('解析简单对象', () => {
        const jsonStr = '{"name":"test","value":123}'
        const result = jsonParse(jsonStr)

        expect(result).toEqual({ name: 'test', value: 123 })
      })

      test('解析简单数组', () => {
        const jsonStr = '[1, 2, 3, "four"]'
        const result = jsonParse(jsonStr)

        expect(result).toEqual([1, 2, 3, 'four'])
      })

      test('解析嵌套对象', () => {
        const jsonStr = '{"outer":{"inner":{"value":"deep"}}}'
        const result = jsonParse(jsonStr)

        expect(result).toEqual({ outer: { inner: { value: 'deep' } } })
      })

      test('解析字符串值', () => {
        const jsonStr = '"hello world"'
        const result = jsonParse(jsonStr)

        expect(result).toBe('hello world')
      })

      test('解析数字值', () => {
        const jsonStr = '42'
        const result = jsonParse(jsonStr)

        expect(result).toBe(42)
      })

      test('解析浮点数', () => {
        const jsonStr = '3.14159'
        const result = jsonParse(jsonStr)

        expect(result).toBe(3.14159)
      })

      test('解析布尔值 true', () => {
        const jsonStr = 'true'
        const result = jsonParse(jsonStr)

        expect(result).toBe(true)
      })

      test('解析布尔值 false', () => {
        const jsonStr = 'false'
        const result = jsonParse(jsonStr)

        expect(result).toBe(false)
      })

      test('解析 null 值', () => {
        const jsonStr = 'null'
        const result = jsonParse(jsonStr)

        expect(result).toBeNull()
      })

      test('解析空对象', () => {
        const jsonStr = '{}'
        const result = jsonParse(jsonStr)

        expect(result).toEqual({})
      })

      test('解析空数组', () => {
        const jsonStr = '[]'
        const result = jsonParse(jsonStr)

        expect(result).toEqual([])
      })

      test('解析包含特殊字符的字符串', () => {
        const jsonStr = '{"text":"hello\\nworld\\t!"}'
        const result = jsonParse(jsonStr)

        expect(result).toEqual({ text: 'hello\nworld\t!' })
      })

      test('解析包含 Unicode 字符的字符串', () => {
        const jsonStr = '{"emoji":"😀","chinese":"中文"}'
        const result = jsonParse(jsonStr)

        expect(result).toEqual({ emoji: '😀', chinese: '中文' })
      })

      test('解析负数', () => {
        const jsonStr = '-123'
        const result = jsonParse(jsonStr)

        expect(result).toBe(-123)
      })

      test('解析科学计数法', () => {
        const jsonStr = '1.5e10'
        const result = jsonParse(jsonStr)

        expect(result).toBe(1.5e10)
      })
    })

    describe('无效 JSON 输入', () => {
      test('无效 JSON 返回 undefined（无 fallback）', () => {
        const jsonStr = 'invalid json'
        const result = jsonParse(jsonStr)

        expect(result).toBeUndefined()
      })

      test('无效 JSON 返回指定的 fallback 值（对象）', () => {
        const jsonStr = 'invalid json'
        const fallback = { default: true }
        const result = jsonParse(jsonStr, fallback)

        expect(result).toEqual({ default: true })
      })

      test('无效 JSON 返回指定的 fallback 值（数组）', () => {
        const jsonStr = '{broken'
        const fallback = [1, 2, 3]
        const result = jsonParse(jsonStr, fallback)

        expect(result).toEqual([1, 2, 3])
      })

      test('无效 JSON 返回指定的 fallback 值（字符串）', () => {
        const jsonStr = 'not valid'
        const fallback = 'default string'
        const result = jsonParse(jsonStr, fallback)

        expect(result).toBe('default string')
      })

      test('无效 JSON 返回指定的 fallback 值（数字）', () => {
        const jsonStr = '{invalid}'
        const fallback = 0
        const result = jsonParse(jsonStr, fallback)

        expect(result).toBe(0)
      })

      test('无效 JSON 返回指定的 fallback 值（null）', () => {
        const jsonStr = 'broken json'
        const fallback = null
        const result = jsonParse(jsonStr, fallback)

        expect(result).toBeNull()
      })

      test('空字符串返回 fallback', () => {
        const jsonStr = ''
        const fallback = { empty: true }
        const result = jsonParse(jsonStr, fallback)

        expect(result).toEqual({ empty: true })
      })

      test('只有空格的字符串返回 fallback', () => {
        const jsonStr = '   '
        const fallback = 'whitespace'
        const result = jsonParse(jsonStr, fallback)

        expect(result).toBe('whitespace')
      })

      test('不完整的 JSON 对象返回 fallback', () => {
        const jsonStr = '{"key": "value"'
        const fallback = {}
        const result = jsonParse(jsonStr, fallback)

        expect(result).toEqual({})
      })

      test('不完整的 JSON 数组返回 fallback', () => {
        const jsonStr = '[1, 2, 3'
        const fallback: number[] = []
        const result = jsonParse(jsonStr, fallback)

        expect(result).toEqual([])
      })

      test('单引号字符串（非标准 JSON）返回 fallback', () => {
        const jsonStr = "{'key': 'value'}"
        const fallback = { error: true }
        const result = jsonParse(jsonStr, fallback)

        expect(result).toEqual({ error: true })
      })

      test('尾随逗号（非标准 JSON）返回 fallback', () => {
        const jsonStr = '{"key": "value",}'
        const fallback = { trailing: 'comma' }
        const result = jsonParse(jsonStr, fallback)

        expect(result).toEqual({ trailing: 'comma' })
      })

      test('undefined 作为 fallback', () => {
        const jsonStr = 'invalid'
        const result = jsonParse(jsonStr, undefined)

        expect(result).toBeUndefined()
      })
    })

    describe('类型推断', () => {
      test('泛型类型推断 - 指定返回类型', () => {
        interface User {
          name: string
          age: number
        }
        const jsonStr = '{"name":"Alice","age":30}'
        const result = jsonParse<User, User>(jsonStr)

        expect(result).toEqual({ name: 'Alice', age: 30 })
        // TypeScript 类型检查
        expect(result?.name).toBe('Alice')
        expect(result?.age).toBe(30)
      })

      test('fallback 类型与返回类型不同', () => {
        const jsonStr = 'invalid'
        const fallback = 'error'
        const result = jsonParse<string, { data: string }>(jsonStr, fallback)

        expect(result).toBe('error')
      })
    })
  })
})

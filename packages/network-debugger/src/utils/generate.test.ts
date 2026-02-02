import { describe, test, expect } from 'vitest'
import { generateUUID, generateHash } from './generate'

describe('generate.ts', () => {
  describe('generateUUID', () => {
    describe('UUID 格式验证', () => {
      test('生成的 UUID 符合标准格式', () => {
        const uuid = generateUUID()
        // UUID 格式: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        expect(uuid).toMatch(uuidRegex)
      })

      test('UUID 长度为 36 个字符', () => {
        const uuid = generateUUID()
        expect(uuid.length).toBe(36)
      })

      test('UUID 第三段以 4 开头（版本号）', () => {
        const uuid = generateUUID()
        const parts = uuid.split('-')
        expect(parts[2][0]).toBe('4')
      })

      test('UUID 第四段首字符为 8、9、a 或 b（变体标识）', () => {
        const uuid = generateUUID()
        const parts = uuid.split('-')
        const variantChar = parts[3][0].toLowerCase()
        expect(['8', '9', 'a', 'b']).toContain(variantChar)
      })

      test('UUID 包含正确数量的连字符', () => {
        const uuid = generateUUID()
        const hyphens = uuid.split('-').length - 1
        expect(hyphens).toBe(4)
      })

      test('UUID 各段长度正确', () => {
        const uuid = generateUUID()
        const parts = uuid.split('-')
        expect(parts[0].length).toBe(8)
        expect(parts[1].length).toBe(4)
        expect(parts[2].length).toBe(4)
        expect(parts[3].length).toBe(4)
        expect(parts[4].length).toBe(12)
      })
    })

    describe('UUID 唯一性', () => {
      test('连续生成的两个 UUID 不相同', () => {
        const uuid1 = generateUUID()
        const uuid2 = generateUUID()
        expect(uuid1).not.toBe(uuid2)
      })

      test('生成 100 个 UUID 全部唯一', () => {
        const uuids = new Set<string>()
        for (let i = 0; i < 100; i++) {
          uuids.add(generateUUID())
        }
        expect(uuids.size).toBe(100)
      })

      test('生成 1000 个 UUID 全部唯一', () => {
        const uuids = new Set<string>()
        for (let i = 0; i < 1000; i++) {
          uuids.add(generateUUID())
        }
        expect(uuids.size).toBe(1000)
      })
    })

    describe('UUID 字符验证', () => {
      test('UUID 只包含有效的十六进制字符和连字符', () => {
        const uuid = generateUUID()
        const validChars = /^[0-9a-f-]+$/i
        expect(uuid).toMatch(validChars)
      })

      test('多次生成的 UUID 都只包含有效字符', () => {
        const validChars = /^[0-9a-f-]+$/i
        for (let i = 0; i < 50; i++) {
          const uuid = generateUUID()
          expect(uuid).toMatch(validChars)
        }
      })
    })
  })

  describe('generateHash', () => {
    describe('Hash 一致性', () => {
      test('相同输入产生相同的 hash', () => {
        const input = 'test string'
        const hash1 = generateHash(input)
        const hash2 = generateHash(input)
        expect(hash1).toBe(hash2)
      })

      test('多次调用相同输入始终返回相同结果', () => {
        const input = 'consistent input'
        const firstHash = generateHash(input)
        for (let i = 0; i < 100; i++) {
          expect(generateHash(input)).toBe(firstHash)
        }
      })

      test('复杂字符串的 hash 一致性', () => {
        const input = '{"key": "value", "number": 123, "array": [1, 2, 3]}'
        const hash1 = generateHash(input)
        const hash2 = generateHash(input)
        expect(hash1).toBe(hash2)
      })

      test('包含特殊字符的字符串 hash 一致性', () => {
        const input = 'hello\nworld\t!@#$%^&*()'
        const hash1 = generateHash(input)
        const hash2 = generateHash(input)
        expect(hash1).toBe(hash2)
      })

      test('包含 Unicode 字符的字符串 hash 一致性', () => {
        const input = '中文字符串 😀 emoji'
        const hash1 = generateHash(input)
        const hash2 = generateHash(input)
        expect(hash1).toBe(hash2)
      })
    })

    describe('不同输入产生不同 hash', () => {
      test('不同字符串产生不同的 hash', () => {
        const hash1 = generateHash('string1')
        const hash2 = generateHash('string2')
        expect(hash1).not.toBe(hash2)
      })

      test('相似字符串产生不同的 hash', () => {
        const hash1 = generateHash('test')
        const hash2 = generateHash('Test')
        expect(hash1).not.toBe(hash2)
      })

      test('只差一个字符的字符串产生不同的 hash', () => {
        const hash1 = generateHash('hello')
        const hash2 = generateHash('hellp')
        expect(hash1).not.toBe(hash2)
      })

      test('字符顺序不同产生不同的 hash', () => {
        const hash1 = generateHash('abc')
        const hash2 = generateHash('cba')
        expect(hash1).not.toBe(hash2)
      })

      test('长度不同的字符串产生不同的 hash', () => {
        const hash1 = generateHash('short')
        const hash2 = generateHash('short string')
        expect(hash1).not.toBe(hash2)
      })
    })

    describe('边界情况', () => {
      test('空字符串返回 "0"', () => {
        const hash = generateHash('')
        expect(hash).toBe('0')
      })

      test('单字符字符串产生有效 hash', () => {
        const hash = generateHash('a')
        expect(typeof hash).toBe('string')
        expect(hash.length).toBeGreaterThan(0)
      })

      test('非常长的字符串产生有效 hash', () => {
        const longString = 'a'.repeat(10000)
        const hash = generateHash(longString)
        expect(typeof hash).toBe('string')
        expect(hash.length).toBeGreaterThan(0)
      })

      test('只有空格的字符串产生有效 hash', () => {
        const hash = generateHash('   ')
        expect(typeof hash).toBe('string')
        expect(hash.length).toBeGreaterThan(0)
      })

      test('只有换行符的字符串产生有效 hash', () => {
        const hash = generateHash('\n\n\n')
        expect(typeof hash).toBe('string')
        expect(hash.length).toBeGreaterThan(0)
      })
    })

    describe('Hash 格式验证', () => {
      test('hash 返回字符串类型', () => {
        const hash = generateHash('test')
        expect(typeof hash).toBe('string')
      })

      test('hash 是 base36 格式（只包含 0-9 和 a-z）', () => {
        const hash = generateHash('test string')
        const base36Regex = /^-?[0-9a-z]+$/
        expect(hash).toMatch(base36Regex)
      })

      test('多个不同输入的 hash 都是 base36 格式', () => {
        const inputs = ['hello', 'world', '123', 'test!@#', '中文', '']
        const base36Regex = /^-?[0-9a-z]+$/
        inputs.forEach((input) => {
          const hash = generateHash(input)
          expect(hash).toMatch(base36Regex)
        })
      })

      test('hash 可能为负数（以负号开头）', () => {
        // 由于 hash 算法使用位运算，可能产生负数
        // 测试一些已知会产生负数 hash 的输入
        const inputs = ['a', 'ab', 'abc', 'test', 'hello world']
        const hashes = inputs.map((input) => generateHash(input))
        // 验证所有 hash 都是有效的 base36 格式（可能带负号）
        const base36Regex = /^-?[0-9a-z]+$/
        hashes.forEach((hash) => {
          expect(hash).toMatch(base36Regex)
        })
      })
    })

    describe('Hash 确定性', () => {
      test('相同输入在不同时间产生相同 hash', async () => {
        const input = 'deterministic test'
        const hash1 = generateHash(input)
        // 等待一小段时间
        await new Promise((resolve) => setTimeout(resolve, 10))
        const hash2 = generateHash(input)
        expect(hash1).toBe(hash2)
      })

      test('hash 不依赖于外部状态', () => {
        const input = 'stateless test'
        // 在不同的循环中调用，确保没有状态累积
        const hashes: string[] = []
        for (let i = 0; i < 10; i++) {
          hashes.push(generateHash(input))
        }
        // 所有 hash 应该相同
        expect(new Set(hashes).size).toBe(1)
      })
    })
  })
})

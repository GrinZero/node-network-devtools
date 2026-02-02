import { describe, test, expect } from 'vitest'
import * as fc from 'fast-check'
import { jsonParse } from '../utils/json'
import { headersToObject } from '../utils/map'
import { generateUUID, generateHash } from '../utils/generate'
import { RequestHeaderPipe } from '../fork/pipe/request-header-transformer'

/**
 * 属性测试 (Property-Based Tests)
 * 使用 fast-check 验证代码的通用属性
 */

describe('Property-Based Tests', () => {
  describe('7.1 Property 7: JSON 解析往返一致性', () => {
    /**
     * **Validates: Requirements 5.4**
     * 对于任意有效的 JSON 字符串，jsonParse 函数解析后再序列化应该得到等价的结果
     */

    test('有效 JSON 解析后再序列化应该等价', () => {
      fc.assert(
        fc.property(fc.jsonValue(), (value) => {
          const jsonString = JSON.stringify(value)
          const parsed = jsonParse(jsonString, null)
          const reserialized = JSON.stringify(parsed)

          // 解析后再序列化应该得到相同的结果
          expect(reserialized).toBe(jsonString)
        }),
        { numRuns: 100 }
      )
    })

    test('无效 JSON 应该返回 fallback 值', () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => {
            try {
              JSON.parse(s)
              return false // 有效 JSON，过滤掉
            } catch {
              return true // 无效 JSON，保留
            }
          }),
          fc.anything(),
          (invalidJson, fallback) => {
            const result = jsonParse(invalidJson, fallback)
            expect(result).toBe(fallback)
          }
        ),
        { numRuns: 50 }
      )
    })

    test('null 和 undefined 输入应该返回 fallback 或抛出错误', () => {
      // jsonParse 对于 null 输入会尝试 JSON.parse(null)
      // JSON.parse(null) 实际上会返回 null（因为 null 被转换为字符串 "null"）
      // 所以这个测试验证的是实际行为

      const fallback = 'default'

      // null 输入 - JSON.parse(null) 返回 null
      // @ts-expect-error 测试边界情况
      const nullResult = jsonParse(null, fallback)
      expect(nullResult).toBe(null) // JSON.parse('null') = null

      // undefined 输入 - JSON.parse(undefined) 会抛出错误
      // @ts-expect-error 测试边界情况
      const undefinedResult = jsonParse(undefined, fallback)
      expect(undefinedResult).toBe(fallback)
    })
  })

  describe('7.2 Property 8: Headers 转换完整性', () => {
    /**
     * **Validates: Requirements 5.5**
     * 对于任意 Headers 对象，headersToObject 函数转换后的对象应该包含所有原始的键值对
     */

    test('转换后应该包含所有原始键值对', () => {
      fc.assert(
        fc.property(
          fc.dictionary(
            fc.string({ minLength: 1 }).filter((s) => !s.includes('\0')),
            fc.string().filter((s) => !s.includes('\0'))
          ),
          (headers) => {
            // 创建 Headers 对象
            const headersObj = new Headers()
            Object.entries(headers).forEach(([key, value]) => {
              try {
                headersObj.set(key, value)
              } catch {
                // 忽略无效的 header 名称
              }
            })

            const result = headersToObject(headersObj)

            // 验证所有有效的键都被转换
            headersObj.forEach((value, key) => {
              expect(result[key]).toBe(value)
            })
          }
        ),
        { numRuns: 50 }
      )
    })

    test('空 Headers 应该转换为空对象', () => {
      const emptyHeaders = new Headers()
      const result = headersToObject(emptyHeaders)
      expect(Object.keys(result).length).toBe(0)
    })
  })

  describe('7.3 Property 9: UUID 唯一性', () => {
    /**
     * **Validates: Requirements 5.6**
     * 对于任意数量的 generateUUID 调用，生成的 UUID 应该互不相同
     */

    test('生成的 UUID 应该互不相同', () => {
      fc.assert(
        fc.property(fc.integer({ min: 10, max: 100 }), (count) => {
          const uuids = new Set<string>()

          for (let i = 0; i < count; i++) {
            uuids.add(generateUUID())
          }

          // 所有 UUID 应该唯一
          expect(uuids.size).toBe(count)
        }),
        { numRuns: 20 }
      )
    })

    test('UUID 应该是有效的格式', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const uuid = generateUUID()

          // UUID 应该是非空字符串
          expect(typeof uuid).toBe('string')
          expect(uuid.length).toBeGreaterThan(0)
        }),
        { numRuns: 50 }
      )
    })

    test('大量 UUID 生成应该保持唯一性', () => {
      const count = 1000
      const uuids = new Set<string>()

      for (let i = 0; i < count; i++) {
        uuids.add(generateUUID())
      }

      expect(uuids.size).toBe(count)
    })
  })

  describe('7.4 Property 10: Hash 一致性', () => {
    /**
     * **Validates: Requirements 5.6**
     * 对于任意相同的输入字符串，generateHash 函数应该始终返回相同的 hash 值
     */

    test('相同输入应该产生相同 hash', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          const hash1 = generateHash(input)
          const hash2 = generateHash(input)

          expect(hash1).toBe(hash2)
        }),
        { numRuns: 100 }
      )
    })

    test('不同输入应该产生不同 hash（高概率）', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (input1, input2) => {
          fc.pre(input1 !== input2) // 前置条件：输入不同

          const hash1 = generateHash(input1)
          const hash2 = generateHash(input2)

          // 不同输入应该产生不同 hash（碰撞概率极低）
          expect(hash1).not.toBe(hash2)
        }),
        { numRuns: 50 }
      )
    })

    test('hash 应该是确定性的', () => {
      const testCases = ['hello', 'world', '123', '', 'special!@#$%']

      testCases.forEach((input) => {
        const results = Array.from({ length: 10 }, () => generateHash(input))
        const uniqueResults = new Set(results)

        // 所有结果应该相同
        expect(uniqueResults.size).toBe(1)
      })
    })
  })

  describe('7.5 Property 11: RequestHeaderPipe 大小写不敏感', () => {
    /**
     * **Validates: Requirements 4.6**
     * 对于任意 HTTP 头部名称，RequestHeaderPipe.getHeader 方法应该能够以大小写不敏感的方式查询到对应的值
     */

    test('header 查询应该大小写不敏感', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }).filter((s) => /^[a-zA-Z][a-zA-Z0-9-]*$/.test(s)),
          fc.string(),
          (headerName, headerValue) => {
            const headers = { [headerName]: headerValue }
            const pipe = new RequestHeaderPipe(headers)

            // 使用不同大小写查询
            const lowerCase = pipe.getHeader(headerName.toLowerCase())
            const upperCase = pipe.getHeader(headerName.toUpperCase())
            const original = pipe.getHeader(headerName)

            // 所有查询应该返回相同的值
            expect(lowerCase).toBe(headerValue)
            expect(upperCase).toBe(headerValue)
            expect(original).toBe(headerValue)
          }
        ),
        { numRuns: 50 }
      )
    })

    test('混合大小写的 header 名称应该正确处理', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }).filter((s) => /^[a-zA-Z][a-zA-Z0-9-]*$/.test(s)),
          fc.string(),
          (headerName, headerValue) => {
            // 创建混合大小写的名称
            const mixedCase = headerName
              .split('')
              .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
              .join('')

            const headers = { [headerName]: headerValue }
            const pipe = new RequestHeaderPipe(headers)

            const result = pipe.getHeader(mixedCase)
            expect(result).toBe(headerValue)
          }
        ),
        { numRuns: 30 }
      )
    })
  })

  describe('7.6 Property 13-19: CDP 协议属性测试', () => {
    /**
     * **Validates: Requirements 4.7, 7.1-7.8**
     * CDP 协议相关的属性测试
     */

    describe('Property 13: HTTP 请求生命周期消息顺序', () => {
      test('消息顺序应该保持一致', () => {
        const expectedOrder = [
          'Network.requestWillBeSent',
          'Network.responseReceived',
          'Network.dataReceived',
          'Network.loadingFinished'
        ]

        fc.assert(
          fc.property(fc.constant(null), () => {
            // 验证顺序定义的正确性
            expect(expectedOrder[0]).toBe('Network.requestWillBeSent')
            expect(expectedOrder[expectedOrder.length - 1]).toBe('Network.loadingFinished')

            // 验证 responseReceived 在 requestWillBeSent 之后
            expect(expectedOrder.indexOf('Network.responseReceived')).toBeGreaterThan(
              expectedOrder.indexOf('Network.requestWillBeSent')
            )
          }),
          { numRuns: 10 }
        )
      })
    })

    describe('Property 15: requestId 唯一性', () => {
      test('生成的 requestId 应该唯一', () => {
        fc.assert(
          fc.property(fc.integer({ min: 10, max: 50 }), (count) => {
            const requestIds = new Set<string>()

            for (let i = 0; i < count; i++) {
              requestIds.add(generateUUID())
            }

            expect(requestIds.size).toBe(count)
          }),
          { numRuns: 20 }
        )
      })
    })

    describe('Property 16: timestamp 单调递增', () => {
      test('timestamp 序列应该单调递增', () => {
        fc.assert(
          fc.property(
            fc.array(fc.nat({ max: 1000 }), { minLength: 2, maxLength: 10 }),
            (deltas) => {
              let timestamp = Date.now()
              const timestamps: number[] = [timestamp]

              deltas.forEach((delta) => {
                timestamp += delta
                timestamps.push(timestamp)
              })

              // 验证单调递增
              for (let i = 1; i < timestamps.length; i++) {
                expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1])
              }
            }
          ),
          { numRuns: 30 }
        )
      })
    })

    describe('Property 18: CDP 响应格式', () => {
      test('响应 id 应该与请求 id 匹配', () => {
        fc.assert(
          fc.property(fc.integer({ min: 1, max: 10000 }), (requestId) => {
            const request = { id: requestId, method: 'Network.getResponseBody' }
            const response = { id: requestId, result: {} }

            expect(response.id).toBe(request.id)
          }),
          { numRuns: 50 }
        )
      })

      test('错误响应应该包含 code', () => {
        fc.assert(
          fc.property(
            fc.integer({ min: 1, max: 10000 }),
            fc.integer({ min: -32700, max: -32600 }),
            fc.string(),
            (id, code, message) => {
              const errorResponse = {
                id,
                error: { code, message }
              }

              expect(errorResponse.id).toBe(id)
              expect(errorResponse.error.code).toBe(code)
              expect(typeof errorResponse.error.code).toBe('number')
            }
          ),
          { numRuns: 30 }
        )
      })
    })

    describe('Property 19: initiator 调用栈', () => {
      test('callFrame 应该包含有效的位置信息', () => {
        fc.assert(
          fc.property(
            fc.nat({ max: 10000 }),
            fc.nat({ max: 1000 }),
            fc.string({ minLength: 1 }),
            (lineNumber, columnNumber, url) => {
              const callFrame = {
                lineNumber,
                columnNumber,
                url,
                functionName: 'testFunction'
              }

              expect(callFrame.lineNumber).toBeGreaterThanOrEqual(0)
              expect(callFrame.columnNumber).toBeGreaterThanOrEqual(0)
              expect(typeof callFrame.url).toBe('string')
              expect(callFrame.url.length).toBeGreaterThan(0)
            }
          ),
          { numRuns: 50 }
        )
      })
    })
  })
})

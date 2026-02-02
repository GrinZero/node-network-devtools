import { describe, test, expect } from 'vitest'
import { headersToObject } from './map'

describe('map.ts', () => {
  describe('headersToObject', () => {
    describe('基本功能', () => {
      test('将空 Headers 转换为空对象', () => {
        const headers = new Headers()
        const result = headersToObject(headers)

        expect(result).toEqual({})
      })

      test('将单个 header 转换为对象', () => {
        const headers = new Headers()
        headers.set('Content-Type', 'application/json')
        const result = headersToObject(headers)

        expect(result).toEqual({ 'content-type': 'application/json' })
      })

      test('将多个 headers 转换为对象', () => {
        const headers = new Headers()
        headers.set('Content-Type', 'application/json')
        headers.set('Content-Length', '123')
        headers.set('Cache-Control', 'no-cache')
        const result = headersToObject(headers)

        expect(result).toEqual({
          'content-type': 'application/json',
          'content-length': '123',
          'cache-control': 'no-cache'
        })
      })

      test('使用初始化对象创建 Headers', () => {
        const headers = new Headers({
          'X-Custom-Header': 'custom-value',
          Authorization: 'Bearer token123'
        })
        const result = headersToObject(headers)

        expect(result).toEqual({
          'x-custom-header': 'custom-value',
          authorization: 'Bearer token123'
        })
      })

      test('使用数组初始化 Headers', () => {
        const headers = new Headers([
          ['Content-Type', 'text/html'],
          ['Accept', 'application/json']
        ])
        const result = headersToObject(headers)

        expect(result).toEqual({
          'content-type': 'text/html',
          accept: 'application/json'
        })
      })
    })

    describe('Header 键名处理', () => {
      test('Headers API 会将键名转换为小写', () => {
        const headers = new Headers()
        headers.set('Content-TYPE', 'application/json')
        headers.set('X-CUSTOM-HEADER', 'value')
        const result = headersToObject(headers)

        // Headers API 标准化键名为小写
        expect(result).toEqual({
          'content-type': 'application/json',
          'x-custom-header': 'value'
        })
      })

      test('处理混合大小写的键名', () => {
        const headers = new Headers()
        headers.set('Accept-Language', 'en-US')
        headers.set('X-Request-ID', '12345')
        const result = headersToObject(headers)

        expect(result).toEqual({
          'accept-language': 'en-US',
          'x-request-id': '12345'
        })
      })
    })

    describe('Header 值处理', () => {
      test('保留值中的空格', () => {
        const headers = new Headers()
        headers.set('Content-Type', 'text/html; charset=utf-8')
        const result = headersToObject(headers)

        expect(result).toEqual({
          'content-type': 'text/html; charset=utf-8'
        })
      })

      test('处理空字符串值', () => {
        const headers = new Headers()
        headers.set('X-Empty', '')
        const result = headersToObject(headers)

        expect(result).toEqual({
          'x-empty': ''
        })
      })

      test('处理包含特殊字符的值', () => {
        const headers = new Headers()
        headers.set('Authorization', 'Bearer abc123!@#$%')
        const result = headersToObject(headers)

        expect(result).toEqual({
          authorization: 'Bearer abc123!@#$%'
        })
      })

      test('处理包含 URL 编码的 Unicode 字符', () => {
        // HTTP Headers 规范要求值为 ByteString，不能直接包含非 ASCII 字符
        // 实际使用中，Unicode 字符通常会被 URL 编码
        const headers = new Headers()
        headers.set('X-Custom', encodeURIComponent('中文值'))
        const result = headersToObject(headers)

        expect(result).toEqual({
          'x-custom': '%E4%B8%AD%E6%96%87%E5%80%BC'
        })
        // 解码后应该得到原始值
        expect(decodeURIComponent(result['x-custom'])).toBe('中文值')
      })

      test('处理数字字符串值', () => {
        const headers = new Headers()
        headers.set('Content-Length', '1024')
        headers.set('X-Count', '0')
        const result = headersToObject(headers)

        expect(result).toEqual({
          'content-length': '1024',
          'x-count': '0'
        })
      })
    })

    describe('常见 HTTP Headers', () => {
      test('处理请求相关的 headers', () => {
        const headers = new Headers()
        headers.set('Accept', 'application/json')
        headers.set('Accept-Language', 'en-US,en;q=0.9')
        headers.set('Accept-Encoding', 'gzip, deflate, br')
        headers.set('User-Agent', 'Mozilla/5.0')
        const result = headersToObject(headers)

        expect(result).toEqual({
          accept: 'application/json',
          'accept-language': 'en-US,en;q=0.9',
          'accept-encoding': 'gzip, deflate, br',
          'user-agent': 'Mozilla/5.0'
        })
      })

      test('处理响应相关的 headers', () => {
        const headers = new Headers()
        headers.set('Content-Type', 'application/json')
        headers.set('Content-Length', '256')
        headers.set('Cache-Control', 'max-age=3600')
        headers.set('ETag', '"abc123"')
        const result = headersToObject(headers)

        expect(result).toEqual({
          'content-type': 'application/json',
          'content-length': '256',
          'cache-control': 'max-age=3600',
          etag: '"abc123"'
        })
      })

      test('处理安全相关的 headers', () => {
        const headers = new Headers()
        headers.set('Authorization', 'Bearer token')
        headers.set('X-CSRF-Token', 'csrf123')
        headers.set('X-Frame-Options', 'DENY')
        const result = headersToObject(headers)

        expect(result).toEqual({
          authorization: 'Bearer token',
          'x-csrf-token': 'csrf123',
          'x-frame-options': 'DENY'
        })
      })

      test('处理 CORS 相关的 headers', () => {
        const headers = new Headers()
        headers.set('Access-Control-Allow-Origin', '*')
        headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT')
        headers.set('Access-Control-Allow-Headers', 'Content-Type')
        const result = headersToObject(headers)

        expect(result).toEqual({
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, PUT',
          'access-control-allow-headers': 'Content-Type'
        })
      })
    })

    describe('边界情况', () => {
      test('处理大量 headers', () => {
        const headers = new Headers()
        const expectedObj: Record<string, string> = {}

        for (let i = 0; i < 50; i++) {
          const key = `x-header-${i}`
          const value = `value-${i}`
          headers.set(key, value)
          expectedObj[key] = value
        }

        const result = headersToObject(headers)

        expect(result).toEqual(expectedObj)
        expect(Object.keys(result).length).toBe(50)
      })

      test('处理长值的 header', () => {
        const headers = new Headers()
        const longValue = 'a'.repeat(1000)
        headers.set('X-Long-Value', longValue)
        const result = headersToObject(headers)

        expect(result).toEqual({
          'x-long-value': longValue
        })
        expect(result['x-long-value'].length).toBe(1000)
      })

      test('处理包含逗号分隔值的 header', () => {
        const headers = new Headers()
        headers.set('Accept', 'text/html, application/json, */*')
        const result = headersToObject(headers)

        expect(result).toEqual({
          accept: 'text/html, application/json, */*'
        })
      })

      test('处理包含分号分隔参数的 header', () => {
        const headers = new Headers()
        headers.set('Content-Type', 'text/html; charset=utf-8; boundary=something')
        const result = headersToObject(headers)

        expect(result).toEqual({
          'content-type': 'text/html; charset=utf-8; boundary=something'
        })
      })
    })

    describe('返回值验证', () => {
      test('返回的对象是新对象，不影响原 Headers', () => {
        const headers = new Headers()
        headers.set('Content-Type', 'application/json')

        const result = headersToObject(headers)
        result['new-key'] = 'new-value'

        // 原 Headers 不应该被修改
        expect(headers.get('new-key')).toBeNull()
      })

      test('返回的对象类型为 Record<string, string>', () => {
        const headers = new Headers()
        headers.set('Content-Type', 'application/json')

        const result = headersToObject(headers)

        expect(typeof result).toBe('object')
        expect(result).not.toBeNull()
        expect(Array.isArray(result)).toBe(false)
      })

      test('所有值都是字符串类型', () => {
        const headers = new Headers()
        headers.set('Content-Length', '123')
        headers.set('X-Boolean', 'true')
        headers.set('X-Null', 'null')

        const result = headersToObject(headers)

        Object.values(result).forEach((value) => {
          expect(typeof value).toBe('string')
        })
      })
    })
  })
})

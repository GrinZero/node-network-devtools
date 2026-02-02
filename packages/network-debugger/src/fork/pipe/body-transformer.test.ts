import { describe, test, expect, vi, beforeEach } from 'vitest'
import { BodyTransformer } from './body-transformer'
import { RequestDetail } from '../../common'
import iconv from 'iconv-lite'

// Mock iconv-lite
vi.mock('iconv-lite', () => ({
  default: {
    decode: vi.fn((buffer: Buffer, encoding: string) => {
      // 简单模拟：返回 buffer 的 utf-8 字符串
      return buffer.toString('utf-8')
    })
  }
}))

describe('BodyTransformer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    test('应该正确初始化 RequestDetail', () => {
      const req = new RequestDetail()
      req.responseHeaders = { 'content-type': 'text/plain' }
      req.responseData = Buffer.from('test data')

      const transformer = new BodyTransformer(req)
      expect(transformer).toBeInstanceOf(BodyTransformer)
    })
  })

  describe('decodeBody', () => {
    describe('当 responseData 为 undefined 或 null 时', () => {
      test('responseData 为 undefined 时应返回 undefined body', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'text/plain' }
        req.responseData = undefined

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.body).toBeUndefined()
        expect(result.base64Encoded).toBe(false)
      })

      test('responseData 为 null 时应返回 undefined body', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'text/plain' }
        req.responseData = null

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.body).toBeUndefined()
        expect(result.base64Encoded).toBe(false)
      })
    })

    describe('二进制内容处理', () => {
      test('应该对二进制内容进行 base64 编码', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'image/png' }
        req.responseData = Buffer.from([0x89, 0x50, 0x4e, 0x47])

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.base64Encoded).toBe(true)
        expect(result.body).toBe(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'))
      })

      test('application/octet-stream 应被视为二进制', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'application/octet-stream' }
        req.responseData = Buffer.from([0x00, 0x01, 0x02])

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.base64Encoded).toBe(true)
      })

      test('audio/mp3 应被视为二进制', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'audio/mp3' }
        req.responseData = Buffer.from([0xff, 0xfb])

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.base64Encoded).toBe(true)
      })

      test('video/mp4 应被视为二进制', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'video/mp4' }
        req.responseData = Buffer.from([0x00, 0x00, 0x00])

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.base64Encoded).toBe(true)
      })
    })

    describe('文本内容处理', () => {
      test('text/plain 应被视为文本', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'text/plain; charset=utf-8' }
        req.responseData = Buffer.from('Hello World')

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.base64Encoded).toBe(false)
        expect(iconv.decode).toHaveBeenCalledWith(Buffer.from('Hello World'), 'utf-8')
      })

      test('text/html 应被视为文本', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'text/html' }
        req.responseData = Buffer.from('<html></html>')

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.base64Encoded).toBe(false)
      })

      test('application/json 应被视为文本', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'application/json' }
        req.responseData = Buffer.from('{"key": "value"}')

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.base64Encoded).toBe(false)
      })

      test('application/xml 应被视为文本', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'application/xml' }
        req.responseData = Buffer.from('<root></root>')

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.base64Encoded).toBe(false)
      })

      test('text/xml 应被视为文本', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'text/xml' }
        req.responseData = Buffer.from('<root></root>')

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.base64Encoded).toBe(false)
      })
    })

    describe('字符编码处理', () => {
      test('应该从 content-type 中提取 charset', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'text/plain; charset=gbk' }
        req.responseData = Buffer.from('test')

        const transformer = new BodyTransformer(req)
        transformer.decodeBody()

        expect(iconv.decode).toHaveBeenCalledWith(Buffer.from('test'), 'gbk')
      })

      test('没有 charset 时应默认使用 utf-8', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'text/plain' }
        req.responseData = Buffer.from('test')

        const transformer = new BodyTransformer(req)
        transformer.decodeBody()

        expect(iconv.decode).toHaveBeenCalledWith(Buffer.from('test'), 'utf-8')
      })

      test('没有 content-type 时应默认使用 utf-8', () => {
        const req = new RequestDetail()
        req.responseHeaders = {}
        req.responseData = Buffer.from('test')

        const transformer = new BodyTransformer(req)
        transformer.decodeBody()

        expect(iconv.decode).toHaveBeenCalledWith(Buffer.from('test'), 'utf-8')
      })

      test('应该处理 charset=iso-8859-1', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'text/html; charset=iso-8859-1' }
        req.responseData = Buffer.from('test')

        const transformer = new BodyTransformer(req)
        transformer.decodeBody()

        expect(iconv.decode).toHaveBeenCalledWith(Buffer.from('test'), 'iso-8859-1')
      })
    })

    describe('Buffer 对象格式处理', () => {
      test('应该处理 JSON.stringify(Buffer) 格式的数据', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'text/plain' }
        req.responseData = {
          type: 'Buffer',
          data: [72, 101, 108, 108, 111] // "Hello"
        }

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.base64Encoded).toBe(false)
        expect(iconv.decode).toHaveBeenCalledWith(Buffer.from([72, 101, 108, 108, 111]), 'utf-8')
      })

      test('应该处理带有 charset 的 Buffer 对象格式', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'text/plain; charset=gbk' }
        req.responseData = {
          type: 'Buffer',
          data: [72, 101, 108, 108, 111]
        }

        const transformer = new BodyTransformer(req)
        transformer.decodeBody()

        expect(iconv.decode).toHaveBeenCalledWith(Buffer.from([72, 101, 108, 108, 111]), 'gbk')
      })
    })

    describe('其他数据类型处理', () => {
      test('应该直接返回字符串类型的 responseData', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'text/plain' }
        req.responseData = 'already a string'

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.body).toBe('already a string')
        expect(result.base64Encoded).toBe(false)
      })

      test('应该直接返回数字类型的 responseData', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'text/plain' }
        req.responseData = 12345

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.body).toBe(12345)
        expect(result.base64Encoded).toBe(false)
      })

      test('应该直接返回普通对象类型的 responseData', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'application/json' }
        req.responseData = { key: 'value' }

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.body).toEqual({ key: 'value' })
        expect(result.base64Encoded).toBe(false)
      })
    })

    describe('header 大小写不敏感', () => {
      test('应该处理大写的 Content-Type', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'Content-Type': 'text/plain' }
        req.responseData = Buffer.from('test')

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.base64Encoded).toBe(false)
      })

      test('应该处理混合大小写的 content-TYPE', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-TYPE': 'image/png' }
        req.responseData = Buffer.from([0x89, 0x50])

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.base64Encoded).toBe(true)
      })
    })

    describe('边界情况', () => {
      test('应该处理空 Buffer', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'text/plain' }
        req.responseData = Buffer.from([])

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.base64Encoded).toBe(false)
        expect(iconv.decode).toHaveBeenCalledWith(Buffer.from([]), 'utf-8')
      })

      test('应该处理空的 Buffer 对象格式', () => {
        const req = new RequestDetail()
        req.responseHeaders = { 'content-type': 'text/plain' }
        req.responseData = {
          type: 'Buffer',
          data: []
        }

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        expect(result.base64Encoded).toBe(false)
        expect(iconv.decode).toHaveBeenCalledWith(Buffer.from([]), 'utf-8')
      })

      test('应该处理 responseHeaders 为 undefined', () => {
        const req = new RequestDetail()
        req.responseHeaders = undefined
        req.responseData = Buffer.from('test')

        const transformer = new BodyTransformer(req)
        const result = transformer.decodeBody()

        // 默认使用 text/plain; charset=utf-8
        expect(result.base64Encoded).toBe(false)
      })
    })
  })
})

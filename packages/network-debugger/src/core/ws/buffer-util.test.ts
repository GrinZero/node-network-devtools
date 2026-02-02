import { describe, it, expect } from 'vitest'
import { concat, mask, unmask, toArrayBuffer, toBuffer } from './buffer-util'
import { EMPTY_BUFFER } from './constants'

describe('buffer-util', () => {
  describe('concat', () => {
    it('应该返回空缓冲区当列表为空时', () => {
      const result = concat([], 0)
      expect(result).toBe(EMPTY_BUFFER)
    })

    it('应该返回单个缓冲区当列表只有一个元素时', () => {
      const buf = Buffer.from('hello')
      const result = concat([buf], buf.length)
      expect(result).toBe(buf)
    })

    it('应该正确合并多个缓冲区', () => {
      const buf1 = Buffer.from('hello')
      const buf2 = Buffer.from(' ')
      const buf3 = Buffer.from('world')
      const totalLength = buf1.length + buf2.length + buf3.length
      const result = concat([buf1, buf2, buf3], totalLength)
      expect(result.toString()).toBe('hello world')
    })

    it('应该处理 totalLength 大于实际长度的情况', () => {
      const buf1 = Buffer.from('hello')
      const buf2 = Buffer.from('world')
      const actualLength = buf1.length + buf2.length
      const result = concat([buf1, buf2], actualLength + 10)
      // 当 offset < totalLength 时，返回截断的缓冲区
      expect(result.length).toBe(actualLength)
      expect(result.toString()).toBe('helloworld')
    })

    it('应该处理精确的 totalLength', () => {
      const buf1 = Buffer.from('abc')
      const buf2 = Buffer.from('def')
      const totalLength = buf1.length + buf2.length
      const result = concat([buf1, buf2], totalLength)
      expect(result.length).toBe(totalLength)
      expect(result.toString()).toBe('abcdef')
    })
  })

  describe('mask', () => {
    it('应该正确对数据进行掩码处理', () => {
      const source = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05])
      const maskKey = Buffer.from([0xff, 0x00, 0xff, 0x00])
      const output = Buffer.alloc(source.length)

      mask(source, maskKey, output, 0, source.length)

      // 验证掩码结果: source[i] ^ mask[i & 3]
      expect(output[0]).toBe(0x01 ^ 0xff) // 0xfe
      expect(output[1]).toBe(0x02 ^ 0x00) // 0x02
      expect(output[2]).toBe(0x03 ^ 0xff) // 0xfc
      expect(output[3]).toBe(0x04 ^ 0x00) // 0x04
      expect(output[4]).toBe(0x05 ^ 0xff) // 0xfa
    })

    it('应该支持偏移量写入', () => {
      const source = Buffer.from([0x01, 0x02])
      const maskKey = Buffer.from([0xff, 0x00, 0xff, 0x00])
      const output = Buffer.alloc(5)

      mask(source, maskKey, output, 2, source.length)

      expect(output[0]).toBe(0)
      expect(output[1]).toBe(0)
      expect(output[2]).toBe(0x01 ^ 0xff)
      expect(output[3]).toBe(0x02 ^ 0x00)
      expect(output[4]).toBe(0)
    })

    it('应该处理空数据', () => {
      const source = Buffer.alloc(0)
      const maskKey = Buffer.from([0xff, 0x00, 0xff, 0x00])
      const output = Buffer.alloc(0)

      mask(source, maskKey, output, 0, 0)

      expect(output.length).toBe(0)
    })
  })

  describe('unmask', () => {
    it('应该正确解除掩码', () => {
      const buffer = Buffer.from([0xfe, 0x02, 0xfc, 0x04, 0xfa])
      const maskKey = Buffer.from([0xff, 0x00, 0xff, 0x00])

      unmask(buffer, maskKey)

      // 验证解除掩码结果
      expect(buffer[0]).toBe(0xfe ^ 0xff) // 0x01
      expect(buffer[1]).toBe(0x02 ^ 0x00) // 0x02
      expect(buffer[2]).toBe(0xfc ^ 0xff) // 0x03
      expect(buffer[3]).toBe(0x04 ^ 0x00) // 0x04
      expect(buffer[4]).toBe(0xfa ^ 0xff) // 0x05
    })

    it('应该处理空缓冲区', () => {
      const buffer = Buffer.alloc(0)
      const maskKey = Buffer.from([0xff, 0x00, 0xff, 0x00])

      unmask(buffer, maskKey)

      expect(buffer.length).toBe(0)
    })

    it('mask 和 unmask 应该是可逆的', () => {
      const original = Buffer.from('Hello, WebSocket!')
      const maskKey = Buffer.from([0x12, 0x34, 0x56, 0x78])
      const masked = Buffer.alloc(original.length)

      mask(original, maskKey, masked, 0, original.length)
      unmask(masked, maskKey)

      expect(masked.toString()).toBe(original.toString())
    })
  })

  describe('toArrayBuffer', () => {
    it('应该直接返回 buffer 当 buffer 占用整个 ArrayBuffer 时', () => {
      const buf = Buffer.alloc(10)
      const result = toArrayBuffer(buf)
      expect(result).toBe(buf.buffer)
    })

    it('应该返回切片的 ArrayBuffer 当 buffer 是子视图时', () => {
      const originalBuffer = Buffer.alloc(20)
      originalBuffer.write('hello world', 5)
      const subBuffer = originalBuffer.subarray(5, 16)

      const result = toArrayBuffer(subBuffer)

      expect(result.byteLength).toBe(subBuffer.length)
      expect(Buffer.from(result).toString()).toBe('hello world')
    })

    it('应该处理空缓冲区', () => {
      const buf = Buffer.alloc(0)
      const result = toArrayBuffer(buf)
      expect(result.byteLength).toBe(0)
    })
  })

  describe('toBuffer', () => {
    it('应该直接返回 Buffer 类型的输入', () => {
      const buf = Buffer.from('hello')
      const result = toBuffer(buf)
      expect(result).toBe(buf)
    })

    it('应该转换 ArrayBuffer 为 Buffer', () => {
      const arrayBuffer = new ArrayBuffer(5)
      const view = new Uint8Array(arrayBuffer)
      view.set([104, 101, 108, 108, 111]) // 'hello'

      const result = toBuffer(arrayBuffer)

      expect(Buffer.isBuffer(result)).toBe(true)
      expect(result.toString()).toBe('hello')
    })

    it('应该转换 TypedArray 为 Buffer', () => {
      const uint8Array = new Uint8Array([104, 101, 108, 108, 111])

      const result = toBuffer(uint8Array)

      expect(Buffer.isBuffer(result)).toBe(true)
      expect(result.toString()).toBe('hello')
    })

    it('应该转换 DataView 为 Buffer', () => {
      const arrayBuffer = new ArrayBuffer(5)
      const dataView = new DataView(arrayBuffer)
      dataView.setUint8(0, 104) // h
      dataView.setUint8(1, 101) // e
      dataView.setUint8(2, 108) // l
      dataView.setUint8(3, 108) // l
      dataView.setUint8(4, 111) // o

      const result = toBuffer(dataView)

      expect(Buffer.isBuffer(result)).toBe(true)
      expect(result.toString()).toBe('hello')
    })

    it('应该转换字符串为 Buffer', () => {
      const result = toBuffer('hello')

      expect(Buffer.isBuffer(result)).toBe(true)
      expect(result.toString()).toBe('hello')
    })

    it('应该设置 readOnly 属性为 true 对于 Buffer 输入', () => {
      const buf = Buffer.from('hello')
      toBuffer(buf)
      expect((toBuffer as { readOnly?: boolean }).readOnly).toBe(true)
    })

    it('应该设置 readOnly 属性为 true 对于 ArrayBuffer 输入', () => {
      const arrayBuffer = new ArrayBuffer(5)
      toBuffer(arrayBuffer)
      expect((toBuffer as { readOnly?: boolean }).readOnly).toBe(true)
    })

    it('应该设置 readOnly 属性为 false 对于字符串输入', () => {
      toBuffer('hello')
      expect((toBuffer as { readOnly?: boolean }).readOnly).toBe(false)
    })
  })
})

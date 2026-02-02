import { describe, it, expect } from 'vitest'
import {
  hasBlob,
  BINARY_TYPES,
  EMPTY_BUFFER,
  GUID,
  kForOnEventAttribute,
  kListener,
  kStatusCode,
  kWebSocket,
  NOOP
} from './constants'

describe('constants', () => {
  describe('hasBlob', () => {
    it('应该是布尔值', () => {
      expect(typeof hasBlob).toBe('boolean')
    })

    it('在 Node.js 环境中应该为 true（Node.js 18+ 支持 Blob）', () => {
      // Node.js 18+ 原生支持 Blob
      expect(hasBlob).toBe(true)
    })
  })

  describe('BINARY_TYPES', () => {
    it('应该是字符串数组', () => {
      expect(Array.isArray(BINARY_TYPES)).toBe(true)
      BINARY_TYPES.forEach((type) => {
        expect(typeof type).toBe('string')
      })
    })

    it('应该包含 nodebuffer', () => {
      expect(BINARY_TYPES).toContain('nodebuffer')
    })

    it('应该包含 arraybuffer', () => {
      expect(BINARY_TYPES).toContain('arraybuffer')
    })

    it('应该包含 fragments', () => {
      expect(BINARY_TYPES).toContain('fragments')
    })

    it('当 hasBlob 为 true 时应该包含 blob', () => {
      if (hasBlob) {
        expect(BINARY_TYPES).toContain('blob')
      }
    })

    it('不应该包含 null 或 undefined', () => {
      BINARY_TYPES.forEach((type) => {
        expect(type).not.toBeNull()
        expect(type).not.toBeUndefined()
      })
    })
  })

  describe('EMPTY_BUFFER', () => {
    it('应该是 Buffer 类型', () => {
      expect(Buffer.isBuffer(EMPTY_BUFFER)).toBe(true)
    })

    it('应该长度为 0', () => {
      expect(EMPTY_BUFFER.length).toBe(0)
    })

    it('应该是不可变的空缓冲区', () => {
      expect(EMPTY_BUFFER.byteLength).toBe(0)
    })
  })

  describe('GUID', () => {
    it('应该是 WebSocket 协议定义的 GUID', () => {
      expect(GUID).toBe('258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    })

    it('应该是字符串类型', () => {
      expect(typeof GUID).toBe('string')
    })

    it('应该有正确的长度', () => {
      expect(GUID.length).toBe(36)
    })
  })

  describe('Symbol 常量', () => {
    it('kForOnEventAttribute 应该是 Symbol', () => {
      expect(typeof kForOnEventAttribute).toBe('symbol')
    })

    it('kListener 应该是 Symbol', () => {
      expect(typeof kListener).toBe('symbol')
    })

    it('kStatusCode 应该是 Symbol', () => {
      expect(typeof kStatusCode).toBe('symbol')
    })

    it('kWebSocket 应该是 Symbol', () => {
      expect(typeof kWebSocket).toBe('symbol')
    })

    it('所有 Symbol 应该是唯一的', () => {
      const symbols = [kForOnEventAttribute, kListener, kStatusCode, kWebSocket]
      const uniqueSymbols = new Set(symbols)
      expect(uniqueSymbols.size).toBe(symbols.length)
    })
  })

  describe('NOOP', () => {
    it('应该是函数', () => {
      expect(typeof NOOP).toBe('function')
    })

    it('调用时不应该抛出错误', () => {
      expect(() => NOOP()).not.toThrow()
    })

    it('应该返回 undefined', () => {
      expect(NOOP()).toBeUndefined()
    })
  })
})

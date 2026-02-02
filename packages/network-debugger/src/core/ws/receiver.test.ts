import { describe, it, expect } from 'vitest'
import { Receiver } from './receiver'
import { PerMessageDeflate } from './permessage-deflate'

describe('Receiver', () => {
  describe('constructor', () => {
    it('应该使用默认选项创建实例', () => {
      const receiver = new Receiver()
      expect(receiver).toBeInstanceOf(Receiver)
    })

    it('应该接受自定义选项', () => {
      const receiver = new Receiver({
        allowSynchronousEvents: false,
        binaryType: 'arraybuffer',
        isServer: true,
        maxPayload: 1024,
        skipUTF8Validation: true
      })
      expect(receiver).toBeInstanceOf(Receiver)
    })

    it('应该接受扩展选项', () => {
      const pmd = new PerMessageDeflate({}, true)
      pmd.accept([{}])
      const receiver = new Receiver({
        extensions: { 'permessage-deflate': pmd }
      })
      expect(receiver).toBeInstanceOf(Receiver)
      pmd.cleanup()
    })
  })

  describe('_write', () => {
    it('应该处理有效的文本帧', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('message', (data: Buffer, isBinary: boolean) => {
          expect(data.toString()).toBe('Hello')
          expect(isBinary).toBe(false)
          resolve()
        })

        // 构造一个有效的 WebSocket 文本帧
        // FIN=1, opcode=1 (text), MASK=1, payload length=5
        const frame = Buffer.from([
          0x81, // FIN + opcode 1 (text)
          0x85, // MASK + length 5
          0x00,
          0x00,
          0x00,
          0x00, // mask key (all zeros)
          0x48,
          0x65,
          0x6c,
          0x6c,
          0x6f // 'Hello' (masked with zeros = unchanged)
        ])

        receiver.write(frame)
      })
    })

    it('应该处理有效的二进制帧', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('message', (data: Buffer, isBinary: boolean) => {
          expect(data).toEqual(Buffer.from([0x01, 0x02, 0x03]))
          expect(isBinary).toBe(true)
          resolve()
        })

        // FIN=1, opcode=2 (binary), MASK=1, payload length=3
        const frame = Buffer.from([
          0x82, // FIN + opcode 2 (binary)
          0x83, // MASK + length 3
          0x00,
          0x00,
          0x00,
          0x00, // mask key
          0x01,
          0x02,
          0x03 // payload
        ])

        receiver.write(frame)
      })
    })

    it('应该处理 ping 帧', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('ping', (data: Buffer) => {
          expect(data.toString()).toBe('ping')
          resolve()
        })

        // FIN=1, opcode=9 (ping), MASK=1, payload length=4
        const frame = Buffer.from([
          0x89, // FIN + opcode 9 (ping)
          0x84, // MASK + length 4
          0x00,
          0x00,
          0x00,
          0x00, // mask key
          0x70,
          0x69,
          0x6e,
          0x67 // 'ping'
        ])

        receiver.write(frame)
      })
    })

    it('应该处理 pong 帧', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('pong', (data: Buffer) => {
          expect(data.toString()).toBe('pong')
          resolve()
        })

        // FIN=1, opcode=10 (pong), MASK=1, payload length=4
        const frame = Buffer.from([
          0x8a, // FIN + opcode 10 (pong)
          0x84, // MASK + length 4
          0x00,
          0x00,
          0x00,
          0x00, // mask key
          0x70,
          0x6f,
          0x6e,
          0x67 // 'pong'
        ])

        receiver.write(frame)
      })
    })

    it('应该处理关闭帧（无数据）', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('conclude', (code: number, reason: Buffer) => {
          expect(code).toBe(1005)
          expect(reason.length).toBe(0)
          resolve()
        })

        // FIN=1, opcode=8 (close), MASK=1, payload length=0
        const frame = Buffer.from([
          0x88, // FIN + opcode 8 (close)
          0x80, // MASK + length 0
          0x00,
          0x00,
          0x00,
          0x00 // mask key
        ])

        receiver.write(frame)
      })
    })

    it('应该处理关闭帧（带状态码）', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('conclude', (code: number, reason: Buffer) => {
          expect(code).toBe(1000)
          expect(reason.toString()).toBe('bye')
          resolve()
        })

        // FIN=1, opcode=8 (close), MASK=1, payload length=5
        // payload: 0x03E8 (1000) + 'bye'
        const frame = Buffer.from([
          0x88, // FIN + opcode 8 (close)
          0x85, // MASK + length 5
          0x00,
          0x00,
          0x00,
          0x00, // mask key
          0x03,
          0xe8, // status code 1000
          0x62,
          0x79,
          0x65 // 'bye'
        ])

        receiver.write(frame)
      })
    })
  })

  describe('错误处理', () => {
    it('应该在 RSV2 或 RSV3 不为 0 时报错', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('error', (err: Error & { code?: string }) => {
          expect(err.message).toContain('RSV2 and RSV3 must be clear')
          expect(err.code).toBe('WS_ERR_UNEXPECTED_RSV_2_3')
          resolve()
        })

        // RSV2=1
        const frame = Buffer.from([
          0x91, // FIN + RSV2 + opcode 1
          0x80, // MASK + length 0
          0x00,
          0x00,
          0x00,
          0x00
        ])

        receiver.write(frame)
      })
    })

    it('应该在没有扩展时 RSV1 不为 0 报错', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('error', (err: Error & { code?: string }) => {
          expect(err.message).toContain('RSV1 must be clear')
          expect(err.code).toBe('WS_ERR_UNEXPECTED_RSV_1')
          resolve()
        })

        // RSV1=1 without extension
        const frame = Buffer.from([
          0xc1, // FIN + RSV1 + opcode 1
          0x80, // MASK + length 0
          0x00,
          0x00,
          0x00,
          0x00
        ])

        receiver.write(frame)
      })
    })

    it('应该在服务器模式下没有 MASK 时报错', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('error', (err: Error & { code?: string }) => {
          expect(err.message).toContain('MASK must be set')
          expect(err.code).toBe('WS_ERR_EXPECTED_MASK')
          resolve()
        })

        // No MASK bit
        const frame = Buffer.from([
          0x81, // FIN + opcode 1
          0x05, // length 5 (no MASK)
          0x48,
          0x65,
          0x6c,
          0x6c,
          0x6f
        ])

        receiver.write(frame)
      })
    })

    it('应该在客户端模式下有 MASK 时报错', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: false })

        receiver.on('error', (err: Error & { code?: string }) => {
          expect(err.message).toContain('MASK must be clear')
          expect(err.code).toBe('WS_ERR_UNEXPECTED_MASK')
          resolve()
        })

        // MASK bit set in client mode
        const frame = Buffer.from([
          0x81, // FIN + opcode 1
          0x85, // MASK + length 5
          0x00,
          0x00,
          0x00,
          0x00,
          0x48,
          0x65,
          0x6c,
          0x6c,
          0x6f
        ])

        receiver.write(frame)
      })
    })

    it('应该在无效的 opcode 时报错', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('error', (err: Error & { code?: string }) => {
          expect(err.message).toContain('invalid opcode')
          expect(err.code).toBe('WS_ERR_INVALID_OPCODE')
          resolve()
        })

        // Invalid opcode 3
        const frame = Buffer.from([
          0x83, // FIN + opcode 3 (invalid)
          0x80, // MASK + length 0
          0x00,
          0x00,
          0x00,
          0x00
        ])

        receiver.write(frame)
      })
    })

    it('应该在控制帧没有 FIN 时报错', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('error', (err: Error & { code?: string }) => {
          expect(err.message).toContain('FIN must be set')
          expect(err.code).toBe('WS_ERR_EXPECTED_FIN')
          resolve()
        })

        // Ping without FIN
        const frame = Buffer.from([
          0x09, // opcode 9 (ping) without FIN
          0x80, // MASK + length 0
          0x00,
          0x00,
          0x00,
          0x00
        ])

        receiver.write(frame)
      })
    })

    it('应该在控制帧负载过大时报错', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('error', (err: Error & { code?: string }) => {
          expect(err.message).toContain('invalid payload length')
          expect(err.code).toBe('WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH')
          resolve()
        })

        // Ping with payload > 125
        const frame = Buffer.from([
          0x89, // FIN + opcode 9 (ping)
          0xfe, // MASK + length 126 (extended)
          0x00,
          0x7e, // 126 bytes
          0x00,
          0x00,
          0x00,
          0x00 // mask key
        ])

        receiver.write(frame)
      })
    })

    it('应该在无效的关闭状态码时报错', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('error', (err: Error & { code?: string }) => {
          expect(err.message).toContain('invalid status code')
          expect(err.code).toBe('WS_ERR_INVALID_CLOSE_CODE')
          resolve()
        })

        // Close frame with invalid status code 1004
        const frame = Buffer.from([
          0x88, // FIN + opcode 8 (close)
          0x82, // MASK + length 2
          0x00,
          0x00,
          0x00,
          0x00, // mask key
          0x03,
          0xec // status code 1004 (reserved)
        ])

        receiver.write(frame)
      })
    })

    it('应该在无效的 UTF-8 序列时报错', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true, skipUTF8Validation: false })

        receiver.on('error', (err: Error & { code?: string }) => {
          expect(err.message).toContain('invalid UTF-8 sequence')
          expect(err.code).toBe('WS_ERR_INVALID_UTF8')
          resolve()
        })

        // Text frame with invalid UTF-8
        const frame = Buffer.from([
          0x81, // FIN + opcode 1 (text)
          0x82, // MASK + length 2
          0x00,
          0x00,
          0x00,
          0x00, // mask key
          0xff,
          0xfe // invalid UTF-8
        ])

        receiver.write(frame)
      })
    })
  })

  describe('分片消息', () => {
    it('应该处理分片的文本消息', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('message', (data: Buffer, isBinary: boolean) => {
          expect(data.toString()).toBe('HelloWorld')
          expect(isBinary).toBe(false)
          resolve()
        })

        // First fragment: opcode=1, FIN=0
        const fragment1 = Buffer.from([
          0x01, // opcode 1 (text), FIN=0
          0x85, // MASK + length 5
          0x00,
          0x00,
          0x00,
          0x00, // mask key
          0x48,
          0x65,
          0x6c,
          0x6c,
          0x6f // 'Hello'
        ])

        // Continuation fragment: opcode=0, FIN=1
        const fragment2 = Buffer.from([
          0x80, // opcode 0 (continuation), FIN=1
          0x85, // MASK + length 5
          0x00,
          0x00,
          0x00,
          0x00, // mask key
          0x57,
          0x6f,
          0x72,
          0x6c,
          0x64 // 'World'
        ])

        receiver.write(fragment1)
        receiver.write(fragment2)
      })
    })

    it('应该在没有开始分片时收到 continuation 帧报错', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('error', (err: Error & { code?: string }) => {
          expect(err.message).toContain('invalid opcode 0')
          expect(err.code).toBe('WS_ERR_INVALID_OPCODE')
          resolve()
        })

        // Continuation frame without prior fragment
        const frame = Buffer.from([
          0x80, // opcode 0 (continuation), FIN=1
          0x80, // MASK + length 0
          0x00,
          0x00,
          0x00,
          0x00
        ])

        receiver.write(frame)
      })
    })

    it('应该在分片过程中收到新的数据帧时报错', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('error', (err: Error & { code?: string }) => {
          expect(err.message).toContain('invalid opcode')
          expect(err.code).toBe('WS_ERR_INVALID_OPCODE')
          resolve()
        })

        // First fragment
        const fragment1 = Buffer.from([
          0x01, // opcode 1 (text), FIN=0
          0x80, // MASK + length 0
          0x00,
          0x00,
          0x00,
          0x00
        ])

        // New text frame instead of continuation
        const fragment2 = Buffer.from([
          0x81, // opcode 1 (text), FIN=1
          0x80, // MASK + length 0
          0x00,
          0x00,
          0x00,
          0x00
        ])

        receiver.write(fragment1)
        receiver.write(fragment2)
      })
    })
  })

  describe('扩展负载长度', () => {
    it('应该处理 16 位扩展负载长度', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })
        const payloadSize = 200

        receiver.on('message', (data: Buffer) => {
          expect(data.length).toBe(payloadSize)
          resolve()
        })

        const payload = Buffer.alloc(payloadSize, 0x41) // 'A'
        const frame = Buffer.alloc(4 + 4 + payloadSize)
        frame[0] = 0x82 // FIN + binary
        frame[1] = 0xfe // MASK + 126 (16-bit length follows)
        frame.writeUInt16BE(payloadSize, 2)
        // mask key at offset 4
        frame[4] = 0x00
        frame[5] = 0x00
        frame[6] = 0x00
        frame[7] = 0x00
        payload.copy(frame, 8)

        receiver.write(frame)
      })
    })

    it('应该处理 64 位扩展负载长度', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })
        const payloadSize = 70000

        receiver.on('message', (data: Buffer) => {
          expect(data.length).toBe(payloadSize)
          resolve()
        })

        const payload = Buffer.alloc(payloadSize, 0x42) // 'B'
        const frame = Buffer.alloc(2 + 8 + 4 + payloadSize)
        frame[0] = 0x82 // FIN + binary
        frame[1] = 0xff // MASK + 127 (64-bit length follows)
        // 64-bit length
        frame.writeUInt32BE(0, 2)
        frame.writeUInt32BE(payloadSize, 6)
        // mask key at offset 10
        frame[10] = 0x00
        frame[11] = 0x00
        frame[12] = 0x00
        frame[13] = 0x00
        payload.copy(frame, 14)

        receiver.write(frame)
      })
    })
  })

  describe('maxPayload', () => {
    it('应该在超过 maxPayload 时报错', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true, maxPayload: 100 })

        receiver.on('error', (err: Error & { code?: string }) => {
          expect(err.message).toContain('Max payload size exceeded')
          expect(err.code).toBe('WS_ERR_UNSUPPORTED_MESSAGE_LENGTH')
          resolve()
        })

        const payload = Buffer.alloc(150, 0x41)
        const frame = Buffer.alloc(4 + 4 + 150)
        frame[0] = 0x82 // FIN + binary
        frame[1] = 0xfe // MASK + 126
        frame.writeUInt16BE(150, 2)
        frame[4] = 0x00
        frame[5] = 0x00
        frame[6] = 0x00
        frame[7] = 0x00
        payload.copy(frame, 8)

        receiver.write(frame)
      })
    })
  })

  describe('binaryType', () => {
    it('应该返回 arraybuffer 类型', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true, binaryType: 'arraybuffer' })

        receiver.on('message', (data: ArrayBuffer, isBinary: boolean) => {
          expect(data).toBeInstanceOf(ArrayBuffer)
          expect(isBinary).toBe(true)
          resolve()
        })

        const frame = Buffer.from([
          0x82, // FIN + binary
          0x83, // MASK + length 3
          0x00,
          0x00,
          0x00,
          0x00,
          0x01,
          0x02,
          0x03
        ])

        receiver.write(frame)
      })
    })

    it('应该返回 fragments 类型', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true, binaryType: 'fragments' })

        receiver.on('message', (data: Buffer[], isBinary: boolean) => {
          expect(Array.isArray(data)).toBe(true)
          expect(isBinary).toBe(true)
          resolve()
        })

        const frame = Buffer.from([
          0x82, // FIN + binary
          0x83, // MASK + length 3
          0x00,
          0x00,
          0x00,
          0x00,
          0x01,
          0x02,
          0x03
        ])

        receiver.write(frame)
      })
    })
  })

  describe('allowSynchronousEvents', () => {
    it('应该异步触发事件当 allowSynchronousEvents 为 false', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true, allowSynchronousEvents: false })
        let syncFlag = true

        receiver.on('message', () => {
          expect(syncFlag).toBe(false)
          resolve()
        })

        const frame = Buffer.from([
          0x81, // FIN + text
          0x85, // MASK + length 5
          0x00,
          0x00,
          0x00,
          0x00,
          0x48,
          0x65,
          0x6c,
          0x6c,
          0x6f
        ])

        receiver.write(frame)
        syncFlag = false
      })
    })
  })

  describe('skipUTF8Validation', () => {
    it('应该跳过 UTF-8 验证当选项为 true', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true, skipUTF8Validation: true })

        receiver.on('message', (data: Buffer) => {
          // 即使是无效的 UTF-8 也应该成功
          expect(data).toEqual(Buffer.from([0xff, 0xfe]))
          resolve()
        })

        const frame = Buffer.from([
          0x81, // FIN + text
          0x82, // MASK + length 2
          0x00,
          0x00,
          0x00,
          0x00,
          0xff,
          0xfe // invalid UTF-8
        ])

        receiver.write(frame)
      })
    })
  })

  describe('consume', () => {
    it('应该正确消费跨多个缓冲区的数据', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('message', (data: Buffer) => {
          expect(data.toString()).toBe('Hello')
          resolve()
        })

        // 分多次写入帧数据
        const part1 = Buffer.from([0x81, 0x85, 0x00])
        const part2 = Buffer.from([0x00, 0x00, 0x00])
        const part3 = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f])

        receiver.write(part1)
        receiver.write(part2)
        receiver.write(part3)
      })
    })
  })

  describe('关闭帧 payload 长度为 1 的情况', () => {
    it('应该在关闭帧 payload 长度为 1 时报错', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('error', (err: Error & { code?: string }) => {
          expect(err.message).toContain('invalid payload length')
          expect(err.code).toBe('WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH')
          resolve()
        })

        // Close frame with payload length 1
        const frame = Buffer.from([
          0x88, // FIN + opcode 8 (close)
          0x81, // MASK + length 1
          0x00,
          0x00,
          0x00,
          0x00, // mask key
          0x00 // single byte payload (invalid)
        ])

        receiver.write(frame)
      })
    })
  })

  describe('64 位负载长度超出安全整数范围', () => {
    it('应该在负载长度超出安全整数范围时报错', () => {
      return new Promise<void>((resolve) => {
        const receiver = new Receiver({ isServer: true })

        receiver.on('error', (err: Error & { code?: string }) => {
          expect(err.message).toContain('payload length > 2^53 - 1')
          expect(err.code).toBe('WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH')
          resolve()
        })

        // 64-bit length with high bits set
        const frame = Buffer.from([
          0x82, // FIN + binary
          0xff, // MASK + 127 (64-bit length)
          0x00,
          0x20,
          0x00,
          0x00, // high 32 bits (too large)
          0x00,
          0x00,
          0x00,
          0x00, // low 32 bits
          0x00,
          0x00,
          0x00,
          0x00 // mask key
        ])

        receiver.write(frame)
      })
    })
  })
})

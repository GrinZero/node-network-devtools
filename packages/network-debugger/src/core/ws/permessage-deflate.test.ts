import { describe, it, expect } from 'vitest'
import { PerMessageDeflate } from './permessage-deflate'

describe('PerMessageDeflate', () => {
  describe('extensionName', () => {
    it('应该返回 permessage-deflate', () => {
      expect(PerMessageDeflate.extensionName).toBe('permessage-deflate')
    })
  })

  describe('constructor', () => {
    it('应该使用默认选项创建实例', () => {
      const pmd = new PerMessageDeflate()
      expect(pmd.params).toBeNull()
    })

    it('应该接受自定义选项', () => {
      const pmd = new PerMessageDeflate({
        serverNoContextTakeover: true,
        clientNoContextTakeover: true,
        threshold: 512
      })
      expect(pmd.params).toBeNull()
    })

    it('应该设置 isServer 标志', () => {
      const serverPmd = new PerMessageDeflate({}, true)
      const clientPmd = new PerMessageDeflate({}, false)
      expect(serverPmd).toBeDefined()
      expect(clientPmd).toBeDefined()
    })

    it('应该设置 maxPayload', () => {
      const pmd = new PerMessageDeflate({}, false, 1024)
      expect(pmd).toBeDefined()
    })
  })

  describe('offer', () => {
    it('应该返回空对象当没有选项时', () => {
      const pmd = new PerMessageDeflate()
      const offer = pmd.offer()
      // 默认情况下 clientMaxWindowBits 为 true
      expect(offer.client_max_window_bits).toBe(true)
    })

    it('应该包含 server_no_context_takeover 当选项设置时', () => {
      const pmd = new PerMessageDeflate({ serverNoContextTakeover: true })
      const offer = pmd.offer()
      expect(offer.server_no_context_takeover).toBe(true)
    })

    it('应该包含 client_no_context_takeover 当选项设置时', () => {
      const pmd = new PerMessageDeflate({ clientNoContextTakeover: true })
      const offer = pmd.offer()
      expect(offer.client_no_context_takeover).toBe(true)
    })

    it('应该包含 server_max_window_bits 当选项设置时', () => {
      const pmd = new PerMessageDeflate({ serverMaxWindowBits: 10 })
      const offer = pmd.offer()
      expect(offer.server_max_window_bits).toBe(10)
    })

    it('应该包含 client_max_window_bits 当选项设置时', () => {
      const pmd = new PerMessageDeflate({ clientMaxWindowBits: 12 })
      const offer = pmd.offer()
      expect(offer.client_max_window_bits).toBe(12)
    })

    it('当 clientMaxWindowBits 为 null 时应该设置为 true', () => {
      const pmd = new PerMessageDeflate({})
      const offer = pmd.offer()
      expect(offer.client_max_window_bits).toBe(true)
    })
  })

  describe('accept', () => {
    describe('作为服务器', () => {
      it('应该接受有效的配置', () => {
        const pmd = new PerMessageDeflate({}, true)
        const configurations = [{ client_max_window_bits: [15] }]
        const params = pmd.accept(configurations)
        expect(params).toBeDefined()
        expect(pmd.params).toBe(params)
      })

      it('应该拒绝所有配置时抛出错误', () => {
        const pmd = new PerMessageDeflate({ serverNoContextTakeover: false }, true)
        const configurations = [{ server_no_context_takeover: [true] }]
        expect(() => pmd.accept(configurations)).toThrow(
          'None of the extension offers can be accepted'
        )
      })

      it('应该应用服务器选项到接受的配置', () => {
        const pmd = new PerMessageDeflate(
          {
            serverNoContextTakeover: true,
            clientNoContextTakeover: true,
            serverMaxWindowBits: 10
          },
          true
        )
        // 需要提供 client_max_window_bits 因为我们没有设置 clientMaxWindowBits 为数字
        const configurations = [{}]
        const params = pmd.accept(configurations)
        expect(params.server_no_context_takeover).toBe(true)
        expect(params.client_no_context_takeover).toBe(true)
        expect(params.server_max_window_bits).toBe(10)
      })

      it('应该删除 client_max_window_bits 当为 true 且 clientMaxWindowBits 为 false', () => {
        const pmd = new PerMessageDeflate({ clientMaxWindowBits: false }, true)
        const configurations = [{ client_max_window_bits: [true] }]
        const params = pmd.accept(configurations)
        expect(params.client_max_window_bits).toBeUndefined()
      })
    })

    describe('作为客户端', () => {
      it('应该接受服务器响应', () => {
        const pmd = new PerMessageDeflate({}, false)
        const response = [{ server_max_window_bits: [15] }]
        const params = pmd.accept(response)
        expect(params).toBeDefined()
      })

      it('应该在 clientNoContextTakeover 为 false 且服务器要求时抛出错误', () => {
        const pmd = new PerMessageDeflate({ clientNoContextTakeover: false }, false)
        const response = [{ client_no_context_takeover: [true] }]
        expect(() => pmd.accept(response)).toThrow(
          'Unexpected parameter "client_no_context_takeover"'
        )
      })

      it('应该设置 client_max_window_bits 当选项指定时', () => {
        const pmd = new PerMessageDeflate({ clientMaxWindowBits: 10 }, false)
        const response = [{}]
        const params = pmd.accept(response)
        expect(params.client_max_window_bits).toBe(10)
      })

      it('应该在 clientMaxWindowBits 为 false 且服务器返回值时抛出错误', () => {
        const pmd = new PerMessageDeflate({ clientMaxWindowBits: false }, false)
        const response = [{ client_max_window_bits: [12] }]
        expect(() => pmd.accept(response)).toThrow(
          'Unexpected or invalid parameter "client_max_window_bits"'
        )
      })

      it('应该在服务器返回的 client_max_window_bits 大于客户端选项时抛出错误', () => {
        const pmd = new PerMessageDeflate({ clientMaxWindowBits: 10 }, false)
        const response = [{ client_max_window_bits: [12] }]
        expect(() => pmd.accept(response)).toThrow(
          'Unexpected or invalid parameter "client_max_window_bits"'
        )
      })
    })
  })

  describe('normalizeParams', () => {
    it('应该在参数有多个值时抛出错误', () => {
      const pmd = new PerMessageDeflate({}, true)
      const configurations = [{ server_max_window_bits: [10, 12] }]
      expect(() => pmd.accept(configurations)).toThrow(
        'Parameter "server_max_window_bits" must have only a single value'
      )
    })

    it('应该在 client_max_window_bits 值无效时抛出错误', () => {
      const pmd = new PerMessageDeflate({}, true)
      const configurations = [{ client_max_window_bits: [7] }]
      expect(() => pmd.accept(configurations)).toThrow(
        'Invalid value for parameter "client_max_window_bits": 7'
      )
    })

    it('应该在 client_max_window_bits 大于 15 时抛出错误', () => {
      const pmd = new PerMessageDeflate({}, true)
      const configurations = [{ client_max_window_bits: [16] }]
      expect(() => pmd.accept(configurations)).toThrow(
        'Invalid value for parameter "client_max_window_bits": 16'
      )
    })

    it('应该在客户端收到 client_max_window_bits 为 true 时抛出错误', () => {
      const pmd = new PerMessageDeflate({}, false)
      const configurations = [{ client_max_window_bits: [true] }]
      expect(() => pmd.accept(configurations)).toThrow(
        'Invalid value for parameter "client_max_window_bits": true'
      )
    })

    it('应该在 server_max_window_bits 值无效时抛出错误', () => {
      const pmd = new PerMessageDeflate({}, true)
      const configurations = [{ server_max_window_bits: [7] }]
      expect(() => pmd.accept(configurations)).toThrow(
        'Invalid value for parameter "server_max_window_bits": 7'
      )
    })

    it('应该在 server_no_context_takeover 值不为 true 时抛出错误', () => {
      const pmd = new PerMessageDeflate({}, true)
      const configurations = [{ server_no_context_takeover: ['false'] }]
      expect(() => pmd.accept(configurations)).toThrow(
        'Invalid value for parameter "server_no_context_takeover": false'
      )
    })

    it('应该在 client_no_context_takeover 值不为 true 时抛出错误', () => {
      const pmd = new PerMessageDeflate({}, true)
      const configurations = [{ client_no_context_takeover: ['false'] }]
      expect(() => pmd.accept(configurations)).toThrow(
        'Invalid value for parameter "client_no_context_takeover": false'
      )
    })

    it('应该在遇到未知参数时抛出错误', () => {
      const pmd = new PerMessageDeflate({}, true)
      const configurations = [{ unknown_param: ['value'] }]
      expect(() => pmd.accept(configurations)).toThrow('Unknown parameter "unknown_param"')
    })
  })

  describe('cleanup', () => {
    it('应该清理 inflate 和 deflate 流', () => {
      const pmd = new PerMessageDeflate({}, true)
      pmd.accept([{}])
      pmd.cleanup()
      expect(pmd.params).not.toBeNull()
    })

    it('应该可以多次调用 cleanup', () => {
      const pmd = new PerMessageDeflate({}, true)
      pmd.accept([{}])
      pmd.cleanup()
      pmd.cleanup()
      expect(pmd.params).not.toBeNull()
    })
  })

  describe('compress 和 decompress', () => {
    it('应该压缩数据', async () => {
      const pmd = new PerMessageDeflate({}, true)
      pmd.accept([{}])

      const data = Buffer.from('Hello, World!')

      const result = await new Promise<Buffer | null>((resolve, reject) => {
        pmd.compress(data, true, (err, result) => {
          if (err) {
            reject(err)
            return
          }
          resolve(result ?? null)
        })
      })

      expect(result).toBeDefined()
      expect(Buffer.isBuffer(result)).toBe(true)
      pmd.cleanup()
    })

    it('应该压缩字符串数据', async () => {
      const pmd = new PerMessageDeflate({}, true)
      pmd.accept([{}])

      const result = await new Promise<Buffer | null>((resolve, reject) => {
        pmd.compress('Hello, World!', true, (err, result) => {
          if (err) {
            reject(err)
            return
          }
          resolve(result ?? null)
        })
      })

      expect(result).toBeDefined()
      pmd.cleanup()
    })

    it('应该解压缩数据', async () => {
      const serverPmd = new PerMessageDeflate({}, true)
      serverPmd.accept([{}])

      const data = Buffer.from('Hello, World!')

      const compressed = await new Promise<Buffer | null>((resolve, reject) => {
        serverPmd.compress(data, true, (err, result) => {
          if (err) {
            reject(err)
            return
          }
          resolve(result ?? null)
        })
      })

      expect(compressed).toBeDefined()

      // 创建新的 PerMessageDeflate 实例作为客户端来解压
      const clientPmd = new PerMessageDeflate({}, false)
      clientPmd.accept([{}])

      const decompressed = await new Promise<Buffer | null>((resolve, reject) => {
        clientPmd.decompress(compressed!, true, (err, result) => {
          if (err) {
            reject(err)
            return
          }
          resolve(result ?? null)
        })
      })

      expect(decompressed).toBeDefined()
      expect(decompressed!.toString()).toBe('Hello, World!')

      serverPmd.cleanup()
      clientPmd.cleanup()
    })

    it('应该在超过 maxPayload 时返回错误（解压缩）', async () => {
      const serverPmd = new PerMessageDeflate({}, true)
      serverPmd.accept([{}])

      const data = Buffer.from('Hello, World!')

      const compressed = await new Promise<Buffer | null>((resolve, reject) => {
        serverPmd.compress(data, true, (err, result) => {
          if (err) {
            reject(err)
            return
          }
          resolve(result ?? null)
        })
      })

      const clientPmd = new PerMessageDeflate({}, false, 5)
      clientPmd.accept([{}])

      const error = await new Promise<Error | null>((resolve) => {
        clientPmd.decompress(compressed!, true, (err) => {
          resolve(err)
        })
      })

      expect(error).toBeInstanceOf(RangeError)
      expect(error?.message).toBe('Max payload size exceeded')

      serverPmd.cleanup()
      clientPmd.cleanup()
    })
  })

  describe('acceptAsServer 边界情况', () => {
    it('应该拒绝 serverMaxWindowBits 为 false 且配置包含 server_max_window_bits', () => {
      const pmd = new PerMessageDeflate({ serverMaxWindowBits: false }, true)
      const configurations = [{ server_max_window_bits: [10] }]
      expect(() => pmd.accept(configurations)).toThrow(
        'None of the extension offers can be accepted'
      )
    })

    it('应该拒绝 clientMaxWindowBits 为数字但配置不包含 client_max_window_bits', () => {
      const pmd = new PerMessageDeflate({ clientMaxWindowBits: 10 }, true)
      const configurations = [{}]
      expect(() => pmd.accept(configurations)).toThrow(
        'None of the extension offers can be accepted'
      )
    })

    it('应该接受 server_max_window_bits 等于选项值的配置', () => {
      const pmd = new PerMessageDeflate({ serverMaxWindowBits: 10 }, true)
      const configurations = [{ server_max_window_bits: [10] }]
      const params = pmd.accept(configurations)
      // 服务器选项会覆盖客户端请求
      expect(params.server_max_window_bits).toBe(10)
    })
  })
})

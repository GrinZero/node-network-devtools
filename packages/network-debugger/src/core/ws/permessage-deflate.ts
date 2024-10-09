import zlib from 'node:zlib'
import * as bufferUtil from './buffer-util'
import { Limiter } from './limiter'
// import { kStatusCode } from './constants'

// const FastBuffer = (Buffer as any)[Symbol.species]
const TRAILER = Buffer.from([0x00, 0x00, 0xff, 0xff])

const kPerMessageDeflate = Symbol('permessage-deflate')
const kTotalLength = Symbol('total-length')
const kCallback = Symbol('callback')
const kBuffers = Symbol('buffers')
const kError = Symbol('error')

let zlibLimiter: Limiter | undefined

/**
 * Options interface for PerMessageDeflate constructor.
 */
interface PerMessageDeflateOptions {
  clientMaxWindowBits?: boolean | number
  clientNoContextTakeover?: boolean
  concurrencyLimit?: number
  serverMaxWindowBits?: boolean | number
  serverNoContextTakeover?: boolean
  threshold?: number
  zlibDeflateOptions?: zlib.ZlibOptions
  zlibInflateOptions?: zlib.ZlibOptions
}

/**
 * permessage-deflate implementation.
 */
export class PerMessageDeflate {
  private _maxPayload: number
  private _options: PerMessageDeflateOptions
  private _threshold: number
  private _isServer: boolean
  private _deflate: zlib.DeflateRaw | null
  private _inflate: zlib.InflateRaw | null
  public params: Record<string, any> | null;
  [kCallback]?: (err: Error | null, result?: Buffer | null) => void;
  [kPerMessageDeflate]?: PerMessageDeflate;
  [kTotalLength]?: number;
  [kBuffers]?: Buffer[]

  constructor(
    options: PerMessageDeflateOptions = {},
    isServer: boolean = false,
    maxPayload: number = 0
  ) {
    this._maxPayload = maxPayload | 0
    this._options = options
    this._threshold = this._options.threshold !== undefined ? this._options.threshold : 1024
    this._isServer = !!isServer
    this._deflate = null
    this._inflate = null
    this.params = null

    if (!zlibLimiter) {
      const concurrency =
        this._options.concurrencyLimit !== undefined ? this._options.concurrencyLimit : 10
      zlibLimiter = new Limiter(concurrency)
    }
  }

  static get extensionName(): string {
    return 'permessage-deflate'
  }

  offer(): Record<string, any> {
    const params: Record<string, any> = {}

    if (this._options.serverNoContextTakeover) {
      params.server_no_context_takeover = true
    }
    if (this._options.clientNoContextTakeover) {
      params.client_no_context_takeover = true
    }
    if (this._options.serverMaxWindowBits) {
      params.server_max_window_bits = this._options.serverMaxWindowBits
    }
    if (this._options.clientMaxWindowBits) {
      params.client_max_window_bits = this._options.clientMaxWindowBits
    } else if (this._options.clientMaxWindowBits == null) {
      params.client_max_window_bits = true
    }

    return params
  }

  accept(configurations: Record<string, any>[]): Record<string, any> {
    configurations = this.normalizeParams(configurations)
    this.params = this._isServer
      ? this.acceptAsServer(configurations)
      : this.acceptAsClient(configurations)

    return this.params
  }

  cleanup(): void {
    if (this._inflate) {
      this._inflate.close()
      this._inflate = null
    }

    if (this._deflate) {
      const callback = this._deflate[kCallback as unknown as keyof zlib.DeflateRaw] as
        | Function
        | undefined

      this._deflate.close()
      this._deflate = null

      if (callback) {
        callback(new Error('The deflate stream was closed while data was being processed'))
      }
    }
  }

  private acceptAsServer(offers: Record<string, any>[]): Record<string, any> {
    const opts = this._options
    const accepted = offers.find((params) => {
      if (
        (opts.serverNoContextTakeover === false && params.server_no_context_takeover) ||
        (params.server_max_window_bits &&
          (opts.serverMaxWindowBits === false ||
            (typeof opts.serverMaxWindowBits === 'number' &&
              opts.serverMaxWindowBits > params.server_max_window_bits))) ||
        (typeof opts.clientMaxWindowBits === 'number' && !params.client_max_window_bits)
      ) {
        return false
      }

      return true
    })

    if (!accepted) {
      throw new Error('None of the extension offers can be accepted')
    }

    if (opts.serverNoContextTakeover) {
      accepted.server_no_context_takeover = true
    }
    if (opts.clientNoContextTakeover) {
      accepted.client_no_context_takeover = true
    }
    if (typeof opts.serverMaxWindowBits === 'number') {
      accepted.server_max_window_bits = opts.serverMaxWindowBits
    }
    if (typeof opts.clientMaxWindowBits === 'number') {
      accepted.client_max_window_bits = opts.clientMaxWindowBits
    } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
      delete accepted.client_max_window_bits
    }

    return accepted
  }

  private acceptAsClient(response: Record<string, any>[]): Record<string, any> {
    const params = response[0]

    if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
      throw new Error('Unexpected parameter "client_no_context_takeover"')
    }

    if (!params.client_max_window_bits) {
      if (typeof this._options.clientMaxWindowBits === 'number') {
        params.client_max_window_bits = this._options.clientMaxWindowBits
      }
    } else if (
      this._options.clientMaxWindowBits === false ||
      (typeof this._options.clientMaxWindowBits === 'number' &&
        params.client_max_window_bits > this._options.clientMaxWindowBits)
    ) {
      throw new Error('Unexpected or invalid parameter "client_max_window_bits"')
    }

    return params
  }

  private normalizeParams(configurations: Record<string, any>[]): Record<string, any>[] {
    configurations.forEach((params) => {
      Object.keys(params).forEach((key) => {
        let value = params[key]

        if (value.length > 1) {
          throw new Error(`Parameter "${key}" must have only a single value`)
        }

        value = value[0]

        if (key === 'client_max_window_bits') {
          if (value !== true) {
            const num = +value
            if (!Number.isInteger(num) || num < 8 || num > 15) {
              throw new TypeError(`Invalid value for parameter "${key}": ${value}`)
            }
            value = num
          } else if (!this._isServer) {
            throw new TypeError(`Invalid value for parameter "${key}": ${value}`)
          }
        } else if (key === 'server_max_window_bits') {
          const num = +value
          if (!Number.isInteger(num) || num < 8 || num > 15) {
            throw new TypeError(`Invalid value for parameter "${key}": ${value}`)
          }
          value = num
        } else if (key === 'client_no_context_takeover' || key === 'server_no_context_takeover') {
          if (value !== true) {
            throw new TypeError(`Invalid value for parameter "${key}": ${value}`)
          }
        } else {
          throw new Error(`Unknown parameter "${key}"`)
        }

        params[key] = value
      })
    })

    return configurations
  }

  decompress(
    data: Buffer,
    fin: boolean,
    callback: (err: Error | null, result?: Buffer | null) => void
  ): void {
    zlibLimiter?.add((done: () => void) => {
      this._decompress(data, fin, (err, result) => {
        done()
        callback(err, result)
      })
    })
  }

  compress(
    data: Buffer | string,
    fin: boolean,
    callback: (err: Error | null, result?: Buffer | null) => void
  ): void {
    zlibLimiter?.add((done: () => void) => {
      this._compress(data, fin, (err, result) => {
        done()
        callback(err, result)
      })
    })
  }

  private _decompress(
    data: Buffer,
    fin: boolean,
    callback: (err: Error | null, result?: Buffer | null) => void
  ): void {
    const endpoint = this._isServer ? 'client' : 'server'

    if (!this._inflate) {
      const key = `${endpoint}_max_window_bits`
      const windowBits =
        typeof this.params![key] !== 'number'
          ? zlib.constants.Z_DEFAULT_WINDOWBITS
          : this.params![key]

      this._inflate = zlib.createInflateRaw({
        ...this._options.zlibInflateOptions,
        windowBits
      })
      ;(this._inflate as any)[kPerMessageDeflate] = this
      ;(this._inflate as any)[kTotalLength] = 0
      ;(this._inflate as any)[kBuffers] = []
      this._inflate.on('error', inflateOnError)
      this._inflate.on('data', inflateOnData)
    }

    ;(this._inflate as any)[kCallback] = callback

    this._inflate.write(data)
    if (fin) this._inflate.write(TRAILER)

    this._inflate.flush(() => {
      const err = (this._inflate as any)[kError]

      if (err) {
        this._inflate!.close()
        this._inflate = null
        callback(err)
        return
      }

      const data = bufferUtil.concat(
        (this._inflate as any)[kBuffers],
        (this._inflate as any)[kTotalLength]
      )

      if (this._maxPayload < 1 || data.length <= this._maxPayload) {
        callback(null, data)
        return
      }

      callback(new RangeError('Max payload size exceeded'), null)
    })
  }

  private _compress(
    data: Buffer | string,
    fin: boolean,
    callback: (err: Error | null, result?: Buffer | null) => void
  ): void {
    const endpoint = this._isServer ? 'server' : 'client'

    if (!this._deflate) {
      const key = `${endpoint}_max_window_bits`
      const windowBits =
        typeof this.params![key] !== 'number'
          ? zlib.constants.Z_DEFAULT_WINDOWBITS
          : this.params![key]

      this._deflate = zlib.createDeflateRaw({
        ...this._options.zlibDeflateOptions,
        windowBits
      })
      ;(this._deflate as any)[kTotalLength] = 0
      ;(this._deflate as any)[kBuffers] = []
      this._deflate.on('error', deflateOnError)
      this._deflate.on('data', deflateOnData)
    }

    ;(this._deflate as any)[kCallback] = callback

    this._deflate.write(data)
    if (fin)
      this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
        const data = bufferUtil.concat(
          (this._deflate as any)[kBuffers],
          (this._deflate as any)[kTotalLength]
        )

        if (this._maxPayload < 1 || data.length <= this._maxPayload) {
          callback(null, data)
          return
        }

        callback(new RangeError('Max payload size exceeded'), null)
      })
  }
}

function inflateOnError(this: PerMessageDeflate, err: Error): void {
  this[kPerMessageDeflate]![kCallback]!(err)
}

function inflateOnData(this: PerMessageDeflate, chunk: Buffer): void {
  this[kTotalLength]! += chunk.length
  this[kBuffers]!.push(chunk)
}

function deflateOnError(this: PerMessageDeflate, err: Error): void {
  this[kPerMessageDeflate]![kCallback]!(err)
}

function deflateOnData(this: PerMessageDeflate, chunk: Buffer): void {
  this[kTotalLength]! += chunk.length
  this[kBuffers]!.push(chunk)
}

export default PerMessageDeflate

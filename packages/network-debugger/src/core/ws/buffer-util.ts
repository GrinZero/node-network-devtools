import { EMPTY_BUFFER } from './constants'

const FastBuffer = (Buffer as any)[Symbol.species]

/**
 * Merges an array of buffers into a new buffer.
 *
 * @param {Buffer[]} list The array of buffers to concatP>
 * @param {Number} totalLength The total length of buffers in the list
 * @return {Buffer} The resulting buffer
 * @public
 */
export function concat(list: Buffer[], totalLength: number): Buffer {
  if (list.length === 0) return EMPTY_BUFFER
  if (list.length === 1) return list[0]

  const target = Buffer.allocUnsafe(totalLength)
  let offset = 0

  for (let i = 0; i < list.length; i++) {
    const buf = list[i]
    target.set(buf, offset)
    offset += buf.length
  }

  if (offset < totalLength) {
    return new FastBuffer(target.buffer, target.byteOffset, offset)
  }

  return target
}

/**
 * Masks a buffer using the given mask.
 *
 * @param {Buffer} source The buffer to mask
 * @param {Buffer} mask The mask to use
 * @param {Buffer} output The buffer where to store the result
 * @param {Number} offset The offset at which to start writing
 * @param {Number} length The number of bytes to mask.
 * @public
 */
function _mask(source: Buffer, mask: Buffer, output: Buffer, offset: number, length: number): void {
  for (let i = 0; i < length; i++) {
    output[offset + i] = source[i] ^ mask[i & 3]
  }
}

/**
 * Unmasks a buffer using the given mask.
 *
 * @param {Buffer} buffer The buffer to unmask
 * @param {Buffer} mask The mask to use
 * @public
 */
export function _unmask(buffer: Buffer, mask: Buffer): void {
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] ^= mask[i & 3]
  }
}

/**
 * Converts a buffer to an `ArrayBuffer`.
 *
 * @param {Buffer} buf The buffer to convert
 * @return {ArrayBuffer} Converted buffer
 * @public
 */
export function toArrayBuffer(buf: Buffer): ArrayBuffer {
  if (buf.length === buf.buffer.byteLength) {
    return buf.buffer
  }

  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)
}

export interface ToBufferFn {
  (data: any): Buffer
  readOnly: boolean
}

/**
 * Converts `data` to a `Buffer`.
 *
 * @param {*} data The data to convert
 * @return {Buffer} The buffer
 * @throws {TypeError}
 * @public
 */
export function toBuffer(data: any): Buffer {
  ;(toBuffer as any).readOnly = true

  if (Buffer.isBuffer(data)) return data

  let buf

  if (data instanceof ArrayBuffer) {
    buf = new FastBuffer(data)
  } else if (ArrayBuffer.isView(data)) {
    buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength)
  } else {
    buf = Buffer.from(data)
    ;(toBuffer as any).readOnly = false
  }

  return buf
}

export { _unmask as unmask }
export { _mask as mask }
// if (!process.env.WS_NO_BUFFER_UTIL) {
//   try {
//     const bufferUtil = require('bufferutil')

//     module.exports.mask = function (source, mask, output, offset, length) {
//       if (length < 48) _mask(source, mask, output, offset, length)
//       else bufferUtil.mask(source, mask, output, offset, length)
//     }

//     module.exports.unmask = function (buffer, mask) {
//       if (buffer.length < 32) _unmask(buffer, mask)
//       else bufferUtil.unmask(buffer, mask)
//     }
//   } catch (e) {
//     // Continue regardless of the error.
//   }
// }

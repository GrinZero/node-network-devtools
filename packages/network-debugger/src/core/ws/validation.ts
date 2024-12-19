import { isUtf8 } from 'node:buffer'
import { hasBlob } from './constants'

/**
 * Checks if a status code is allowed in a close frame.
 *
 * @param {number} code The status code
 * @return {boolean} `true` if the status code is valid, else `false`
 */
export function isValidStatusCode(code: number): boolean {
  return (
    (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) ||
    (code >= 3000 && code <= 4999)
  )
}

/**
 * Checks if a given buffer contains only correct UTF-8.
 * Ported from https://www.cl.cam.ac.uk/%7Emgk25/ucs/utf8_check.c by
 * Markus Kuhn.
 *
 * @param {Buffer} buf The buffer to check
 * @return {boolean} `true` if `buf` contains only correct UTF-8, else `false`
 */
function _isValidUTF8(buf: Buffer): boolean {
  const len = buf.length
  let i = 0

  while (i < len) {
    if ((buf[i] & 0x80) === 0) {
      // 0xxxxxxx
      i++
    } else if ((buf[i] & 0xe0) === 0xc0) {
      // 110xxxxx 10xxxxxx
      if (
        i + 1 === len ||
        (buf[i + 1] & 0xc0) !== 0x80 ||
        (buf[i] & 0xfe) === 0xc0 // Overlong
      ) {
        return false
      }

      i += 2
    } else if ((buf[i] & 0xf0) === 0xe0) {
      // 1110xxxx 10xxxxxx 10xxxxxx
      if (
        i + 2 >= len ||
        (buf[i + 1] & 0xc0) !== 0x80 ||
        (buf[i + 2] & 0xc0) !== 0x80 ||
        (buf[i] === 0xe0 && (buf[i + 1] & 0xe0) === 0x80) || // Overlong
        (buf[i] === 0xed && (buf[i + 1] & 0xe0) === 0xa0) // Surrogate (U+D800 - U+DFFF)
      ) {
        return false
      }

      i += 3
    } else if ((buf[i] & 0xf8) === 0xf0) {
      // 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
      if (
        i + 3 >= len ||
        (buf[i + 1] & 0xc0) !== 0x80 ||
        (buf[i + 2] & 0xc0) !== 0x80 ||
        (buf[i + 3] & 0xc0) !== 0x80 ||
        (buf[i] === 0xf0 && (buf[i + 1] & 0xf0) === 0x80) || // Overlong
        (buf[i] === 0xf4 && buf[i + 1] > 0x8f) ||
        buf[i] > 0xf4 // > U+10FFFF
      ) {
        return false
      }

      i += 4
    } else {
      return false
    }
  }

  return true
}

/**
 * Determines whether a value is a `Blob`.
 *
 * @param {*} value The value to be tested
 * @return {boolean} `true` if `value` is a `Blob`, else `false`
 */
export function isBlob(value: any): boolean {
  return (
    hasBlob &&
    typeof value === 'object' &&
    typeof value.arrayBuffer === 'function' &&
    typeof value.type === 'string' &&
    typeof value.stream === 'function' &&
    (value[Symbol.toStringTag] === 'Blob' || value[Symbol.toStringTag] === 'File')
  )
}

// export const utils = {
//   isBlob,
//   isValidStatusCode,
//   isValidUTF8: _isValidUTF8,
//   tokenChars
// };

export const isValidUTF8 = Boolean(isUtf8)
  ? function (buf: Buffer): boolean {
      return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf)
    }
  : _isValidUTF8
// if (isUtf8) {
//   utils.isValidUTF8 = function (buf: Buffer): boolean {
//     return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
//   };
// } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
//   try {
//     const isValidUTF8 = require('utf-8-validate') as (buf: Buffer) => boolean;

//     utils.isValidUTF8 = function (buf: Buffer): boolean {
//       return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
//     };
//   } catch (e) {
//     // Continue regardless of the error.
//   }
// }

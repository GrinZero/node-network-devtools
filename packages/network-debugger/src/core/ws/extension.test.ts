import { describe, expect, test } from 'vitest'
import { parsePerMessageDeflate } from './extension'

describe('Sec-WebSocket-Extensions parsing', () => {
  test('extracts negotiated permessage-deflate parameters and quoted values', () => {
    expect(
      parsePerMessageDeflate(
        'x-ignored; value=1, permessage-deflate; server_no_context_takeover; client_max_window_bits="12"'
      )
    ).toEqual([
      {
        server_no_context_takeover: [true],
        client_max_window_bits: ['12']
      }
    ])
  })

  test('retains duplicate parameters so negotiation validation can reject them', () => {
    expect(
      parsePerMessageDeflate(
        'permessage-deflate; server_max_window_bits=12; server_max_window_bits=13'
      )
    ).toEqual([{ server_max_window_bits: ['12', '13'] }])
  })

  test('rejects malformed quoted values without evaluating them', () => {
    expect(() => parsePerMessageDeflate('permessage-deflate; server_max_window_bits="12')).toThrow(
      SyntaxError
    )
  })
})

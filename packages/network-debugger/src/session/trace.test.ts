import { describe, expect, test } from 'vitest'
import { parseTraceparent, traceContextFromHeaders } from './trace'

describe('traceparent correlation', () => {
  test('parses an existing sampled trace context without changing its source headers', () => {
    const headers = {
      TraceParent: '00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01',
      TraceState: 'vendor=value'
    }
    const before = JSON.stringify(headers)

    expect(traceContextFromHeaders(headers)).toEqual({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      version: '00',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      parentId: '00f067aa0ba902b7',
      traceFlags: '01',
      sampled: true,
      tracestate: 'vendor=value'
    })
    expect(JSON.stringify(headers)).toBe(before)
  })

  test.each([
    '',
    'ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    '00-00000000000000000000000000000000-00f067aa0ba902b7-01',
    '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01',
    '00-short-00f067aa0ba902b7-01',
    '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra'
  ])('rejects invalid traceparent %j', (value) => {
    expect(parseTraceparent(value)).toBeUndefined()
  })

  test('reads array header values and reports unsampled flags', () => {
    expect(
      traceContextFromHeaders({
        traceparent: ['00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00']
      })
    ).toMatchObject({ traceFlags: '00', sampled: false })
  })
})

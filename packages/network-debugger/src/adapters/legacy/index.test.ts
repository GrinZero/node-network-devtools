import { describe, expect, test } from 'vitest'
import { LEGACY_CAPABILITIES, LegacyAdapter } from '.'

describe('LegacyAdapter capabilities', () => {
  test('advertises the tested default Legacy feature set', () => {
    expect(new LegacyAdapter().probe().capabilities).toEqual(LEGACY_CAPABILITIES)
  })

  test('does not advertise transports explicitly disabled by interception config', () => {
    expect(
      new LegacyAdapter({ intercept: { normal: false, fetch: true } }).probe().capabilities
    ).toMatchObject({
      http: false,
      https: false,
      fetch: true,
      websocketLifecycle: false,
      websocketFrames: false,
      sseMessages: true,
      responseBody: true
    })

    expect(
      new LegacyAdapter({ intercept: { normal: false, fetch: false } }).probe().capabilities
    ).toMatchObject({
      http: false,
      https: false,
      fetch: false,
      responseBody: false,
      requestBody: false,
      sseMessages: false,
      initiator: false
    })
  })
})

import { describe, expect, test, vi } from 'vitest'
import {
  NATIVE_CAPABILITIES,
  getMissingCapabilities,
  getNativeCapabilities,
  hasNativeInspectionFlag,
  isNativeAutoBaseline,
  parseNodeVersion,
  supportsNativeNetworkInspection,
  type NativeNetworkApi
} from './capability'

const lifecycleNetwork = (): NativeNetworkApi => ({
  requestWillBeSent: vi.fn(),
  responseReceived: vi.fn(),
  loadingFinished: vi.fn(),
  loadingFailed: vi.fn()
})

describe('native capability detection', () => {
  test('publishes a conservative maximum capability set', () => {
    expect(NATIVE_CAPABILITIES).toMatchObject({
      http: true,
      https: true,
      fetch: true,
      http2: true,
      responseBody: true,
      requestBody: false,
      websocketLifecycle: true,
      websocketFrames: false,
      sseMessages: false,
      initiator: true
    })
  })

  test.each([
    ['20.17.0', false],
    ['20.18.0', true],
    ['21.7.3', false],
    ['22.5.0', false],
    ['22.6.0', true],
    ['23.0.0', true],
    ['24.0.0', true]
  ])('detects native inspection runtime support for Node %s', (text, expected) => {
    expect(supportsNativeNetworkInspection(parseNodeVersion(text))).toBe(expected)
  })

  test.each([
    ['24.6.0', false],
    ['24.7.0', true],
    ['25.0.0', true],
    ['22.22.0', false]
  ])('uses a stricter Auto baseline for Node %s', (text, expected) => {
    expect(isNativeAutoBaseline(parseNodeVersion(text))).toBe(expected)
  })

  test('rejects malformed versions', () => {
    expect(parseNodeVersion('nightly')).toBeNull()
  })

  test('detects the experimental flag without accepting lookalikes', () => {
    expect(hasNativeInspectionFlag(['--experimental-network-inspection'])).toBe(true)
    expect(hasNativeInspectionFlag(['--experimental-network-inspection=true'])).toBe(true)
    expect(hasNativeInspectionFlag(['--experimental-network-inspection-extra'])).toBe(false)
  })

  test('derives optional capabilities from runtime methods and versions', () => {
    const network: NativeNetworkApi = {
      ...lifecycleNetwork(),
      dataReceived: vi.fn(),
      dataSent: vi.fn(),
      webSocketCreated: vi.fn(),
      webSocketHandshakeResponseReceived: vi.fn(),
      webSocketClosed: vi.fn()
    }
    const capabilities = getNativeCapabilities(parseNodeVersion('24.8.0'), network)

    expect(capabilities).toMatchObject({
      http: true,
      https: true,
      fetch: true,
      http2: true,
      responseBody: true,
      requestBody: false,
      websocketLifecycle: true,
      websocketFrames: false,
      sseMessages: false,
      initiator: true
    })
  })

  test('does not infer HTTP request-body support from dataSent', () => {
    const capabilities = getNativeCapabilities(parseNodeVersion('26.1.0'), {
      ...lifecycleNetwork(),
      dataSent: vi.fn()
    })
    expect(capabilities.requestBody).toBe(false)
  })

  test('does not advertise cross-transport response bodies on Node 22', () => {
    const capabilities = getNativeCapabilities(parseNodeVersion('22.22.3'), {
      ...lifecycleNetwork(),
      dataReceived: vi.fn()
    })
    expect(capabilities).toMatchObject({ fetch: true, responseBody: false })
  })

  test('turns protocol capabilities off when lifecycle methods are incomplete', () => {
    const capabilities = getNativeCapabilities(parseNodeVersion('26.1.0'), {
      requestWillBeSent: vi.fn()
    })
    expect(capabilities.http).toBe(false)
    expect(capabilities.fetch).toBe(false)
    expect(capabilities.initiator).toBe(false)
  })

  test('reports required capabilities that are unavailable', () => {
    const capabilities = getNativeCapabilities(parseNodeVersion('24.7.0'), lifecycleNetwork())
    expect(
      getMissingCapabilities(capabilities, ['http', 'responseBody', 'websocketFrames'])
    ).toEqual(['responseBody', 'websocketFrames'])
  })
})

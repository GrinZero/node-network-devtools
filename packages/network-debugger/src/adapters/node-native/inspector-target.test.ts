import { describe, expect, test, vi } from 'vitest'
import { NodeNativeAdapterError } from './errors'
import { discoverInspectorTarget, getInspectorDiscoveryUrl } from './inspector-target'

describe('Inspector target discovery', () => {
  test('maps an Inspector WebSocket URL to the standard discovery endpoint', () => {
    expect(getInspectorDiscoveryUrl('ws://127.0.0.1:9229/target-id')).toBe(
      'http://127.0.0.1:9229/json/list'
    )
  })

  test('rejects non-Inspector protocols', () => {
    expect(() => getInspectorDiscoveryUrl('http://127.0.0.1:9229/target-id')).toThrow(
      'Unsupported Inspector URL protocol'
    )
    expect(() => getInspectorDiscoveryUrl('wss://localhost:9443/target-id')).toThrow(
      'Unsupported Inspector URL protocol'
    )
  })

  test('selects the descriptor matching the Inspector target id', async () => {
    const requestJson = vi.fn().mockResolvedValue([
      {
        id: 'different',
        title: 'different',
        type: 'node',
        url: 'file://',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9229/different'
      },
      {
        id: 'target-id',
        title: 'node[123]',
        type: 'node',
        url: 'file:///app.js',
        webSocketDebuggerUrl: 'ws://localhost:9229/target-id',
        devtoolsFrontendUrl: 'devtools://native-target'
      }
    ])

    const target = await discoverInspectorTarget(
      'ws://127.0.0.1:9229/target-id',
      { attempts: 1 },
      { requestJson }
    )

    expect(target).toEqual({
      id: 'target-id',
      title: 'node[123]',
      type: 'node',
      url: 'file:///app.js',
      webSocketDebuggerUrl: 'ws://localhost:9229/target-id',
      devtoolsFrontendUrl: 'devtools://native-target',
      discoveryUrl: 'http://127.0.0.1:9229/json/list'
    })
  })

  test('retries discovery with bounded attempts', async () => {
    const requestJson = vi
      .fn()
      .mockRejectedValueOnce(new Error('not listening'))
      .mockResolvedValueOnce([
        {
          id: 'target-id',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9229/target-id'
        }
      ])
    const sleep = vi.fn().mockResolvedValue(undefined)

    const target = await discoverInspectorTarget(
      'ws://127.0.0.1:9229/target-id',
      { attempts: 2, requestTimeoutMs: 10, retryDelayMs: 1 },
      { requestJson, sleep }
    )

    expect(target.id).toBe('target-id')
    expect(requestJson).toHaveBeenCalledTimes(2)
    expect(requestJson).toHaveBeenCalledWith('http://127.0.0.1:9229/json/list', 10)
    expect(sleep).toHaveBeenCalledWith(1)
  })

  test('fails with a stable discovery code after exhausting retries', async () => {
    const requestJson = vi.fn().mockRejectedValue(new Error('connection refused'))

    await expect(
      discoverInspectorTarget(
        'ws://127.0.0.1:9229/target-id',
        { attempts: 2, retryDelayMs: 0 },
        { requestJson, sleep: vi.fn().mockResolvedValue(undefined) }
      )
    ).rejects.toMatchObject<NodeNativeAdapterError>({
      code: 'NND_NATIVE_TARGET_DISCOVERY_FAILED'
    })
    expect(requestJson).toHaveBeenCalledTimes(2)
  })
})

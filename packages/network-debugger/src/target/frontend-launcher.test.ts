import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { DevtoolsTarget } from '../adapters/types'

const open = vi.hoisted(() => vi.fn())
vi.mock('open', () => ({ default: open }))

import { openDevtoolsTarget } from './frontend-launcher'

const target = (overrides: Partial<DevtoolsTarget> = {}): DevtoolsTarget => ({
  id: 'target',
  title: 'Node.js',
  type: 'node',
  url: 'file:///app.mjs',
  webSocketDebuggerUrl: 'ws://127.0.0.1:9229/target',
  discoveryUrl: 'http://127.0.0.1:9229/json/list',
  devtoolsFrontendUrl: 'devtools://devtools/bundled/js_app.html?ws=127.0.0.1:9229/target',
  ...overrides
})

describe('openDevtoolsTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    open.mockResolvedValue({})
  })

  test('opens the canonical target URL without retaining or waiting for a browser', async () => {
    await openDevtoolsTarget(target())

    expect(open).toHaveBeenCalledWith(
      'devtools://devtools/bundled/js_app.html?ws=127.0.0.1:9229/target',
      { wait: false }
    )
  })

  test('uses the compatibility URL when it is the only frontend descriptor', async () => {
    const descriptor = target({
      devtoolsFrontendUrl: undefined,
      devtoolsFrontendUrlCompat: 'devtools://compat'
    })

    await openDevtoolsTarget(descriptor)
    expect(open).toHaveBeenCalledWith('devtools://compat', { wait: false })
  })

  test('fails with a stable code when discovery exposes no frontend URL', async () => {
    await expect(
      openDevtoolsTarget(
        target({
          devtoolsFrontendUrl: undefined,
          devtoolsFrontendUrlCompat: undefined
        })
      )
    ).rejects.toMatchObject({ code: 'NND_FRONTEND_URL_UNAVAILABLE' })
    expect(open).not.toHaveBeenCalled()
  })
})

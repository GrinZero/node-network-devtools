import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { WebSocket } from 'ws'
import { RequestDetail } from '../common'
import { createPlugin, useHandler } from './module/common'
import { RequestCenter } from './request-center'

const centers = new Set<RequestCenter>()
const sockets = new Set<WebSocket>()

afterEach(async () => {
  for (const socket of sockets) socket.terminate()
  sockets.clear()
  await Promise.all([...centers].map((center) => center.close()))
  centers.clear()
})

async function createCenter(options: ConstructorParameters<typeof RequestCenter>[0] = {}) {
  const center = new RequestCenter({ serverPort: 0, ...options })
  centers.add(center)
  const target = await center.ready
  return { center, target }
}

async function connect(url: string) {
  const socket = new WebSocket(url)
  sockets.add(socket)
  await once(socket, 'open')
  return socket
}

function nextJson(socket: WebSocket): Promise<Record<string, any>> {
  return once(socket, 'message').then(([raw]) => JSON.parse(raw.toString()))
}

describe('RequestCenter', () => {
  test('exposes its bound target and does not bind the deprecated application port', async () => {
    const occupied = createServer()
    occupied.listen(0, '127.0.0.1')
    await once(occupied, 'listening')
    const occupiedPort = (occupied.address() as AddressInfo).port

    const { center, target } = await createCenter({ port: occupiedPort })
    expect(center.target).toEqual(target)
    expect(target.discoveryUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/json\/list$/)

    await new Promise<void>((resolve) => occupied.close(() => resolve()))
  })

  test('routes structured capture events directly to plugin listeners', async () => {
    const { center } = await createCenter()
    const listener = vi.fn()
    center.on<RequestDetail>('initRequest', listener)
    const request = new RequestDetail()
    request.url = 'https://example.test/capture'

    center.handleCaptureEvent({ type: 'initRequest', data: request })
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())
    expect(listener).toHaveBeenCalledWith({ data: request })
  })

  test('supplies source-client result/error helpers to command plugins, including id 0', async () => {
    const { center, target } = await createCenter()
    const handler = vi.fn(async ({ id, client, result }) => {
      expect(id).toBe(0)
      expect(client).toBeInstanceOf(WebSocket)
      await result?.({ echoed: true })
    })
    center.on('Test.echo', handler)
    const socket = await connect(target.webSocketDebuggerUrl)

    const response = nextJson(socket)
    socket.send(JSON.stringify({ id: 0, method: 'Test.echo', params: { value: 1 } }))
    await expect(response).resolves.toEqual({ id: 0, result: { echoed: true } })
    expect(handler).toHaveBeenCalledOnce()
  })

  test('loads plugins, exposes outputs and invokes cleanup during idempotent close', async () => {
    const { center } = await createCenter()
    const cleanup = vi.fn()
    const plugin = createPlugin('owned-plugin', () => {
      useHandler('capture-owned', () => undefined)
      return cleanup
    })

    center.loadPlugins([plugin])
    expect(center.usePlugin('owned-plugin')).toBe(cleanup)
    const firstClose = center.close()
    const secondClose = center.close()
    expect(secondClose).toBe(firstClose)
    await firstClose
    expect(cleanup).toHaveBeenCalledOnce()
  })

  test('notifies onConnect listeners for every reconnect', async () => {
    const { center, target } = await createCenter()
    const listener = vi.fn()
    center.on('onConnect', listener)

    const first = await connect(target.webSocketDebuggerUrl)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    first.close()
    await once(first, 'close')
    sockets.delete(first)

    await connect(target.webSocketDebuggerUrl)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2))
  })
})

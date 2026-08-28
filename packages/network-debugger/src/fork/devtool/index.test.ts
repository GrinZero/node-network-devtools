import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, test } from 'vitest'
import { WebSocket } from 'ws'
import {
  CDP_ERROR_CODES,
  DevtoolServer,
  DevtoolServerClosedError,
  MAX_BUFFERED_EVENT_BYTES,
  MAX_BUFFERED_EVENTS
} from './index'

type JsonMessage = Record<string, any>

class ProtocolClient {
  readonly socket: WebSocket
  private readonly messages: JsonMessage[] = []
  private readonly waiters: Array<{
    predicate(message: JsonMessage): boolean
    resolve(message: JsonMessage): void
    reject(error: Error): void
    timer: ReturnType<typeof setTimeout>
  }> = []

  private constructor(url: string) {
    this.socket = new WebSocket(url)
    this.socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as JsonMessage
      const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(message))
      if (waiterIndex >= 0) {
        const [waiter] = this.waiters.splice(waiterIndex, 1)
        clearTimeout(waiter.timer)
        waiter.resolve(message)
      } else {
        this.messages.push(message)
      }
    })
  }

  static async connect(url: string) {
    const client = new ProtocolClient(url)
    await once(client.socket, 'open')
    return client
  }

  send(message: unknown) {
    this.socket.send(JSON.stringify(message))
  }

  sendRaw(message: string) {
    this.socket.send(message)
  }

  next(
    predicate: (message: JsonMessage) => boolean = () => true,
    timeoutMs = 2_000
  ): Promise<JsonMessage> {
    const index = this.messages.findIndex(predicate)
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0])
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = this.waiters.findIndex((waiter) => waiter.timer === timer)
        if (waiterIndex >= 0) this.waiters.splice(waiterIndex, 1)
        reject(new Error('Timed out waiting for a CDP message.'))
      }, timeoutMs)
      this.waiters.push({ predicate, resolve, reject, timer })
    })
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return
    const closed = once(this.socket, 'close')
    this.socket.close()
    await closed
  }
}

const servers = new Set<DevtoolServer>()
const clients = new Set<ProtocolClient>()

async function createServer(options: Partial<ConstructorParameters<typeof DevtoolServer>[0]> = {}) {
  const server = new DevtoolServer({ port: 0, ...options })
  servers.add(server)
  const target = await server.ready
  return { server, target }
}

async function connect(url: string) {
  const client = await ProtocolClient.connect(url)
  clients.add(client)
  return client
}

afterEach(async () => {
  await Promise.all([...clients].map((client) => client.close().catch(() => undefined)))
  clients.clear()
  await Promise.all([...servers].map((server) => server.close()))
  servers.clear()
})

describe('Legacy discoverable CDP target', () => {
  test('binds port 0 before publishing one consistent loopback target', async () => {
    const server = new DevtoolServer({ port: 0 })
    servers.add(server)
    expect(server.target).toBeUndefined()

    const target = await server.ready
    const discovery = new URL(target.discoveryUrl)
    expect(discovery.hostname).toBe('127.0.0.1')
    expect(Number(discovery.port)).toBeGreaterThan(0)
    expect(target.webSocketDebuggerUrl).toMatch(
      new RegExp(`^ws://127\\.0\\.0\\.1:${discovery.port}/devtools/page/${target.id}$`)
    )
    expect(server.target).toEqual(target)

    const list = await fetch(target.discoveryUrl).then((response) => response.json())
    const alias = await fetch(new URL('/json', target.discoveryUrl)).then((response) =>
      response.json()
    )
    const version = await fetch(new URL('/json/version', target.discoveryUrl)).then((response) =>
      response.json()
    )
    const protocol = await fetch(new URL('/json/protocol', target.discoveryUrl)).then((response) =>
      response.json()
    )

    expect(list).toEqual([target])
    expect(alias).toEqual([target])
    expect(version).toMatchObject({
      Browser: 'node-network-devtools/2',
      'Protocol-Version': '1.3',
      webSocketDebuggerUrl: target.webSocketDebuggerUrl
    })
    expect(protocol.version).toEqual({ major: '1', minor: '3' })
    expect(protocol.domains.map((domain: { domain: string }) => domain.domain)).toEqual(
      expect.arrayContaining(['Network', 'Debugger', 'Runtime', 'Schema'])
    )

    const notFound = await fetch(new URL('/not-a-target', target.discoveryUrl))
    expect(notFound.status).toBe(404)
  })

  test('accepts upgrades only on the published WebSocket path', async () => {
    const { target } = await createServer()
    const wrongUrl = new URL(target.webSocketDebuggerUrl)
    wrongUrl.pathname = '/devtools/page/wrong-target'
    const socket = new WebSocket(wrongUrl)
    const outcome = Promise.race([
      once(socket, 'open').then(() => 'open'),
      once(socket, 'error').then(() => 'error'),
      once(socket, 'unexpected-response').then(() => 'rejected')
    ])
    await expect(outcome).resolves.not.toBe('open')
    socket.terminate()
  })

  test('uses a parent-supplied stable target identity in discovery and WebSocket URLs', async () => {
    const { target } = await createServer({ targetId: 'stable.parent-target_1' })
    expect(target.id).toBe('stable.parent-target_1')
    expect(new URL(target.webSocketDebuggerUrl).pathname).toBe(
      '/devtools/page/stable.parent-target_1'
    )
  })

  test('single-casts same-id async command responses to their source clients', async () => {
    const { server, target } = await createServer()
    server.on(async (_error, message, context) => {
      if (!message || !('method' in message) || message.method !== 'Test.echo' || !context) {
        return false
      }
      const token = String(message.params?.token)
      if (token === 'slow') await delay(30)
      await context.result({ token })
      return true
    })

    const first = await connect(target.webSocketDebuggerUrl)
    const second = await connect(target.webSocketDebuggerUrl)
    first.send({ id: 7, method: 'Test.echo', params: { token: 'slow' } })
    second.send({ id: 7, method: 'Test.echo', params: { token: 'fast' } })

    await expect(second.next((message) => message.id === 7)).resolves.toEqual({
      id: 7,
      result: { token: 'fast' }
    })
    await expect(first.next((message) => message.id === 7)).resolves.toEqual({
      id: 7,
      result: { token: 'slow' }
    })
  })

  test('preserves legacy devtool.send response routing across async handler work', async () => {
    const { server, target } = await createServer()
    server.on(async (_error, message) => {
      if (!message || !('method' in message) || message.method !== 'Test.legacyReply') return false
      await delay(Number(message.params?.delay ?? 0))
      await server.send({ id: message.id!, result: { owner: message.params?.owner } })
      return true
    })
    const first = await connect(target.webSocketDebuggerUrl)
    const second = await connect(target.webSocketDebuggerUrl)

    first.send({ id: 'same', method: 'Test.legacyReply', params: { owner: 'first', delay: 20 } })
    second.send({ id: 'same', method: 'Test.legacyReply', params: { owner: 'second' } })

    expect(await second.next((message) => message.id === 'same')).toEqual({
      id: 'same',
      result: { owner: 'second' }
    })
    expect(await first.next((message) => message.id === 'same')).toEqual({
      id: 'same',
      result: { owner: 'first' }
    })
  })

  test('broadcasts events to every connected frontend', async () => {
    const { server, target } = await createServer()
    const first = await connect(target.webSocketDebuggerUrl)
    const second = await connect(target.webSocketDebuggerUrl)
    first.send({ id: 1, method: 'Network.enable' })
    second.send({ id: 2, method: 'Network.enable' })
    await first.next((message) => message.id === 1)
    await second.next((message) => message.id === 2)
    const event = {
      method: 'Network.requestWillBeSent',
      params: { requestId: 'broadcast-request' }
    }

    await server.send(event)
    await expect(first.next((message) => message.method === event.method)).resolves.toEqual(event)
    await expect(second.next((message) => message.method === event.method)).resolves.toEqual(event)
  })

  test('sends Network events only to clients that enabled the domain', async () => {
    const { server, target } = await createServer()
    const enabled = await connect(target.webSocketDebuggerUrl)
    const disabled = await connect(target.webSocketDebuggerUrl)
    enabled.send({ id: 'enable', method: 'Network.enable' })
    await enabled.next((message) => message.id === 'enable')

    await server.send({
      method: 'Network.loadingFinished',
      params: { requestId: 'enabled-only' }
    })
    expect(
      await enabled.next((message) => message.params?.requestId === 'enabled-only')
    ).toMatchObject({
      method: 'Network.loadingFinished'
    })
    await expect(
      disabled.next((message) => message.params?.requestId === 'enabled-only', 100)
    ).rejects.toThrow('Timed out')

    enabled.send({ id: 'disable', method: 'Network.disable' })
    await enabled.next((message) => message.id === 'disable')
    await server.send({ method: 'Network.loadingFinished', params: { requestId: 'disabled-now' } })
    await expect(
      enabled.next((message) => message.params?.requestId === 'disabled-now', 100)
    ).rejects.toThrow('Timed out')
  }, 6_000)

  test('returns standard results/errors for zero, string, unknown, invalid and thrown commands', async () => {
    const { server, target } = await createServer()
    server.on(async (_error, message, context) => {
      if (!message || !('method' in message) || !context) return false
      if (message.method === 'Test.fail') throw new Error('handler exploded')
      if (message.method === 'Test.applicationError') {
        await context.error(CDP_ERROR_CODES.SERVER_ERROR, 'request body unavailable')
        return true
      }
      return false
    })
    const client = await connect(target.webSocketDebuggerUrl)

    client.send({ id: 0, method: 'Network.enable', params: {} })
    expect(await client.next((message) => message.id === 0)).toEqual({ id: 0, result: {} })

    client.send({ id: 'debugger', method: 'Debugger.enable', params: {} })
    expect(await client.next((message) => message.id === 'debugger')).toMatchObject({
      id: 'debugger',
      result: { debuggerId: target.id }
    })

    client.send({ id: 2, method: 'Missing.command', params: {} })
    expect(await client.next((message) => message.id === 2)).toMatchObject({
      id: 2,
      error: { code: CDP_ERROR_CODES.METHOD_NOT_FOUND }
    })

    client.send({ id: 3, method: 'Network.enable', params: [] })
    expect(await client.next((message) => message.id === 3)).toMatchObject({
      id: 3,
      error: { code: CDP_ERROR_CODES.INVALID_PARAMS }
    })

    client.send({ id: 4, method: 'Test.fail' })
    expect(await client.next((message) => message.id === 4)).toMatchObject({
      id: 4,
      error: { code: CDP_ERROR_CODES.INTERNAL_ERROR, message: 'handler exploded' }
    })

    client.send({ id: 5, method: 'Test.applicationError' })
    expect(await client.next((message) => message.id === 5)).toMatchObject({
      id: 5,
      error: { code: CDP_ERROR_CODES.SERVER_ERROR, message: 'request body unavailable' }
    })
  })

  test('survives malformed JSON and continues serving commands', async () => {
    const { target } = await createServer()
    const client = await connect(target.webSocketDebuggerUrl)
    client.sendRaw('{ definitely not json')

    expect(await client.next((message) => message.id === null)).toMatchObject({
      error: { code: CDP_ERROR_CODES.INVALID_REQUEST }
    })

    client.send({ id: 9, method: 'Runtime.enable' })
    expect(await client.next((message) => message.id === 9)).toEqual({ id: 9, result: {} })
  })

  test('bounds no-client history and replays it after enable on reconnect', async () => {
    const { server, target } = await createServer()
    for (let index = 0; index < MAX_BUFFERED_EVENTS + 50; index += 1) {
      await server.send({
        method: 'Network.requestWillBeSent',
        params: { requestId: `request-${index}` }
      })
    }
    expect(server.bufferedEventCount).toBe(MAX_BUFFERED_EVENTS)
    expect(server.bufferedEventBytes).toBeLessThanOrEqual(MAX_BUFFERED_EVENT_BYTES)
    expect(server.clientCount).toBe(0)

    const first = await connect(target.webSocketDebuggerUrl)
    first.send({ id: 1, method: 'Network.enable' })
    expect(await first.next((message) => message.id === 1)).toEqual({ id: 1, result: {} })
    expect(await first.next((message) => message.params?.requestId === 'request-50')).toMatchObject(
      {
        method: 'Network.requestWillBeSent'
      }
    )
    await first.close()
    clients.delete(first)

    await server.send({
      method: 'Network.loadingFinished',
      params: { requestId: 'after-refresh' }
    })
    const refreshed = await connect(target.webSocketDebuggerUrl)
    refreshed.send({ id: 'enable-again', method: 'Network.enable' })
    expect(await refreshed.next((message) => message.id === 'enable-again')).toEqual({
      id: 'enable-again',
      result: {}
    })
    expect(
      await refreshed.next((message) => message.params?.requestId === 'after-refresh')
    ).toMatchObject({ method: 'Network.loadingFinished' })
  })

  test('close rejects an explicit pending client waiter, clears history and releases the port', async () => {
    const { server, target } = await createServer()
    await server.send({ method: 'Network.loadingFinished', params: { requestId: 'buffered' } })
    const pending = server.waitForClient()
    const discoveryUrl = target.discoveryUrl

    await server.close()
    await expect(pending).rejects.toBeInstanceOf(DevtoolServerClosedError)
    expect(server.bufferedEventCount).toBe(0)
    await expect(fetch(discoveryUrl)).rejects.toThrow()
  })
})

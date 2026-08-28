import { createServer, get, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { DevtoolsTarget } from '../adapters/types'
import { ProtocolTap } from './protocol-tap'

interface Harness {
  server: Server
  webSocketServer: WebSocketServer
  target: DevtoolsTarget
  commands: Array<{ id: number | string; method: string; params: Record<string, unknown> }>
  clients: Set<WebSocket>
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return (server.address() as AddressInfo).port
}

async function createHarness(): Promise<Harness> {
  let target!: DevtoolsTarget
  const commands: Harness['commands'] = []
  const clients = new Set<WebSocket>()
  const webSocketServer = new WebSocketServer({ noServer: true })
  const server = createServer((request, response) => {
    if (request.url !== '/json/list') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify([target]))
  })
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/devtools/page/session-integration') {
      socket.destroy()
      return
    }
    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit('connection', client, request)
    })
  })
  webSocketServer.on('connection', (client) => {
    clients.add(client)
    client.once('close', () => clients.delete(client))
    client.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as {
        id: number | string
        method: string
        params?: Record<string, unknown>
      }
      commands.push({ id: message.id, method: message.method, params: message.params ?? {} })
      if (message.method === 'Network.enable') {
        client.send(JSON.stringify({ id: message.id, result: {} }))
        client.send(
          JSON.stringify({
            method: 'Network.requestWillBeSent',
            params: { requestId: 'from-real-websocket' }
          })
        )
      } else if (message.method === 'Echo') {
        const delay = Number(message.params?.delay ?? 0)
        setTimeout(() => {
          client.send(JSON.stringify({ id: message.id, result: { value: message.params?.value } }))
        }, delay)
      } else if (message.method === 'Fail') {
        client.send(
          JSON.stringify({
            id: message.id,
            error: { code: -32000, message: 'intentional failure' }
          })
        )
      } else if (message.method === 'Drop') {
        client.close(1011, 'backend exited')
      } else if (message.method === 'Malformed') {
        client.send('{')
      }
    })
  })
  const port = await listen(server)
  target = {
    id: 'session-integration',
    title: 'Session integration',
    type: 'node',
    url: '',
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/session-integration`,
    discoveryUrl: `http://127.0.0.1:${port}/json/list`
  }
  return { server, webSocketServer, target, commands, clients }
}

async function discover(url: string): Promise<DevtoolsTarget> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => {
        try {
          resolve((JSON.parse(Buffer.concat(chunks).toString()) as DevtoolsTarget[])[0])
        } catch (error) {
          reject(error)
        }
      })
    }).on('error', reject)
  })
}

async function closeHarness(harness: Harness): Promise<void> {
  for (const client of harness.clients) client.terminate()
  await new Promise<void>((resolve) => harness.webSocketServer.close(() => resolve()))
  await new Promise<void>((resolve) => harness.server.close(() => resolve()))
}

describe('ProtocolTap real WebSocket transport', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  afterEach(async () => {
    await closeHarness(harness)
  })

  test('connects through discovery, enables Network, dispatches events, and correlates commands', async () => {
    const discovered = await discover(harness.target.discoveryUrl)
    expect(discovered.webSocketDebuggerUrl).toBe(harness.target.webSocketDebuggerUrl)
    const tap = new ProtocolTap(discovered)
    const events: string[] = []
    tap.onEvent((event) => {
      events.push(event.method)
    })

    await tap.connect()
    const slow = tap.command<{ value: string }>('Echo', { value: 'slow', delay: 25 })
    const fast = tap.command<{ value: string }>('Echo', { value: 'fast', delay: 0 })

    await expect(fast).resolves.toEqual({ value: 'fast' })
    await expect(slow).resolves.toEqual({ value: 'slow' })
    await expect(tap.command('Fail')).rejects.toMatchObject({
      name: 'CdpCommandError',
      method: 'Fail',
      cdpError: { code: -32000, message: 'intentional failure' }
    })
    expect(events).toContain('Network.requestWillBeSent')
    expect(harness.commands.filter(({ method }) => method === 'Network.enable')).toHaveLength(1)

    const firstClose = tap.close()
    expect(tap.close()).toBe(firstClose)
    await firstClose
    expect(tap.state).toBe('closed')
  })

  test('bounds pending commands and rejects the waiter when closed', async () => {
    const tap = new ProtocolTap(harness.target, {
      maxPendingCommands: 1,
      commandTimeoutMs: 30_000
    })
    await tap.connect()
    const held = tap.command('Hold')
    const heldRejection = expect(held).rejects.toMatchObject({
      code: 'SESSION_TAP_CLOSED'
    })

    await expect(tap.command('Second')).rejects.toMatchObject({
      code: 'SESSION_TAP_PENDING_LIMIT'
    })
    expect(tap.pendingCommandCount).toBe(1)
    await tap.close()
    await heldRejection
    expect(tap.pendingCommandCount).toBe(0)
  })

  test('expires unanswered commands without retaining pending state', async () => {
    const tap = new ProtocolTap(harness.target, { commandTimeoutMs: 20 })
    await tap.connect()

    await expect(tap.command('Hold')).rejects.toMatchObject({
      code: 'SESSION_TAP_COMMAND_TIMEOUT'
    })
    expect(tap.pendingCommandCount).toBe(0)
    await tap.close()
  })

  test('surfaces abnormal disconnects to commands and observers', async () => {
    const tap = new ProtocolTap(harness.target)
    const disconnects: Error[] = []
    tap.onDisconnect((error) => disconnects.push(error))
    await tap.connect()

    await expect(tap.command('Drop')).rejects.toMatchObject({
      code: 'SESSION_TAP_DISCONNECTED'
    })
    expect(disconnects).toHaveLength(1)
    await expect(tap.command('AfterDrop')).rejects.toMatchObject({
      code: 'SESSION_TAP_DISCONNECTED'
    })
    await tap.close()
  })

  test('treats malformed protocol JSON as a terminal protocol error', async () => {
    const tap = new ProtocolTap(harness.target)
    await tap.connect()

    await expect(tap.command('Malformed')).rejects.toMatchObject({
      code: 'SESSION_TAP_PROTOCOL_ERROR'
    })
    expect(tap.pendingCommandCount).toBe(0)
    await tap.close()
  })
})

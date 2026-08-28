import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WebSocketServer, type WebSocket } from 'ws'
import { afterEach, describe, expect, test } from 'vitest'
import type { DevtoolsTarget } from '../adapters/types'
import { readSessionManifest } from './files'
import { SessionRecorder } from './recorder'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('SessionRecorder loopback integration', () => {
  test('records events and retrieves a body over a real standard target WebSocket', async () => {
    const clients = new Set<WebSocket>()
    let target!: DevtoolsTarget
    let resolveBodyRequested!: () => void
    const bodyRequested = new Promise<void>((resolve) => (resolveBodyRequested = resolve))
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
      if (request.url !== '/devtools/page/session-recorder') {
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
        const command = JSON.parse(raw.toString()) as {
          id: number
          method: string
          params: Record<string, unknown>
        }
        if (command.method === 'Network.enable') {
          client.send(JSON.stringify({ id: command.id, result: {} }))
        } else if (command.method === 'Network.getResponseBody') {
          expect(command.params).toEqual({ requestId: 'integration' })
          resolveBodyRequested()
          client.send(
            JSON.stringify({
              id: command.id,
              result: { body: 'loopback body', base64Encoded: false }
            })
          )
        }
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const port = (server.address() as AddressInfo).port
    target = {
      id: 'session-recorder',
      title: 'Session recorder',
      type: 'node',
      url: '',
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/session-recorder`,
      discoveryUrl: `http://127.0.0.1:${port}/json/list`
    }
    const directory = await mkdtemp(join(tmpdir(), 'nnd-session-integration-'))
    cleanups.push(async () => rm(directory, { recursive: true }))
    cleanups.push(async () => {
      for (const client of clients) client.terminate()
      await new Promise<void>((resolve) => webSocketServer.close(() => resolve()))
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })

    const recorder = await SessionRecorder.start({ directory, target })
    const client = [...clients][0]
    client.send(
      JSON.stringify({
        method: 'Network.requestWillBeSent',
        params: {
          requestId: 'integration',
          timestamp: 1,
          wallTime: 1_800_000_000,
          request: {
            url: `http://127.0.0.1:${port}/resource`,
            method: 'GET',
            headers: {}
          }
        }
      })
    )
    client.send(
      JSON.stringify({
        method: 'Network.responseReceived',
        params: {
          requestId: 'integration',
          timestamp: 1.1,
          response: {
            url: `http://127.0.0.1:${port}/resource`,
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/plain' },
            mimeType: 'text/plain'
          }
        }
      })
    )
    client.send(
      JSON.stringify({
        method: 'Network.loadingFinished',
        params: { requestId: 'integration', timestamp: 1.2, encodedDataLength: 13 }
      })
    )

    await bodyRequested
    await recorder.close()

    const manifest = await readSessionManifest(directory)
    expect(manifest.state).toBe('completed')
    expect(manifest.stats).toMatchObject({ eventCount: 3, requestCount: 1, bodyCount: 1 })
    expect(await readFile(join(directory, manifest.bodyIndex.integration.path), 'utf8')).toBe(
      'loopback body'
    )
    expect(clients.size).toBe(0)
  })
})

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { DevtoolsTarget } from '../adapters/types'
import { readSessionManifest } from './files'
import { SessionRecorder } from './recorder'
import type { CdpProtocolEvent, ResponseBodyResult, SessionProtocolConnection } from './types'

const TARGET: DevtoolsTarget = {
  id: 'session-test',
  title: 'Session test',
  type: 'node',
  url: 'file:///fixture.js',
  webSocketDebuggerUrl: 'ws://127.0.0.1:43123/devtools/page/session-test',
  discoveryUrl: 'http://127.0.0.1:43123/json/list'
}

class FakeTap implements SessionProtocolConnection {
  readonly target = TARGET
  state: SessionProtocolConnection['state'] = 'idle'
  readonly commands: Array<{ method: string; params: Record<string, unknown> }> = []
  readonly bodies = new Map<string, ResponseBodyResult | Error>()
  readonly closeMock = vi.fn(async () => {
    this.state = 'closed'
  })
  private readonly eventListeners = new Set<(event: CdpProtocolEvent) => void | Promise<void>>()
  private readonly disconnectListeners = new Set<(error: Error) => void>()

  async connect() {
    this.state = 'open'
  }

  async command<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.commands.push({ method, params: { ...params } })
    const requestId = String(params.requestId ?? '')
    const value = this.bodies.get(requestId)
    if (value instanceof Error) throw value
    if (!value) throw new Error(`No body for ${requestId}`)
    return value as T
  }

  onEvent(listener: (event: CdpProtocolEvent) => void | Promise<void>) {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  onDisconnect(listener: (error: Error) => void) {
    this.disconnectListeners.add(listener)
    return () => this.disconnectListeners.delete(listener)
  }

  close() {
    return this.closeMock()
  }

  async emit(method: string, params: Record<string, unknown>) {
    const event = { method, params }
    await Promise.all([...this.eventListeners].map((listener) => listener(event)))
  }

  disconnect(error: Error) {
    this.state = 'closed'
    for (const listener of this.disconnectListeners) listener(error)
  }
}

const directories: string[] = []

async function sessionDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nnd-session-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

async function requestStarted(
  tap: FakeTap,
  requestId: string,
  overrides: Record<string, unknown> = {}
) {
  await tap.emit('Network.requestWillBeSent', {
    requestId,
    timestamp: 10,
    wallTime: 1_800_000_000,
    type: 'Fetch',
    request: {
      url: `https://example.test/resource?id=${requestId}`,
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      postData: 'request body'
    },
    ...overrides
  })
}

async function responseReceived(tap: FakeTap, requestId: string, mimeType: string) {
  await tap.emit('Network.responseReceived', {
    requestId,
    timestamp: 10.25,
    type: 'Fetch',
    response: {
      url: `https://example.test/resource?id=${requestId}`,
      status: 200,
      statusText: 'OK',
      protocol: 'h2',
      headers: { 'content-type': mimeType },
      mimeType,
      encodedDataLength: 3
    }
  })
}

describe('SessionRecorder', () => {
  test('writes text bodies, an append-only journal, and trace indexes', async () => {
    const directory = await sessionDirectory()
    const tap = new FakeTap()
    tap.bodies.set('../unsafe/request', { body: 'hello session', base64Encoded: false })
    const recorder = await SessionRecorder.start({ directory, target: TARGET, tap })
    const headers = {
      'content-type': 'text/plain',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      tracestate: 'vendor=value'
    }
    const before = JSON.stringify(headers)

    await requestStarted(tap, '../unsafe/request', {
      request: {
        url: 'https://example.test/text?one=1&one=2',
        method: 'POST',
        headers,
        postData: 'request body'
      }
    })
    await responseReceived(tap, '../unsafe/request', 'text/plain')
    await tap.emit('Network.loadingFinished', {
      requestId: '../unsafe/request',
      timestamp: 10.5,
      encodedDataLength: 13
    })
    await recorder.close()

    expect(JSON.stringify(headers)).toBe(before)
    const manifest = await readSessionManifest(directory)
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      state: 'completed',
      stats: {
        eventCount: 3,
        requestCount: 1,
        bodyCount: 1,
        bodyErrorCount: 0,
        failedRequestCount: 0
      }
    })
    expect(manifest.traceIndex['4bf92f3577b34da6a3ce929d0e0e4736']).toMatchObject({
      requestIds: ['../unsafe/request'],
      spans: [{ requestId: '../unsafe/request', sampled: true }]
    })
    const indexedBody = manifest.bodyIndex['../unsafe/request']
    expect(basename(indexedBody.path)).toMatch(/^[a-f0-9]{16}-[a-f0-9]{64}\.body$/)
    expect(indexedBody.path).not.toContain('unsafe')
    expect(await readFile(join(directory, indexedBody.path), 'utf8')).toBe('hello session')
    expect(
      (await readFile(join(directory, 'events.ndjson'), 'utf8')).trim().split('\n')
    ).toHaveLength(3)
    expect(tap.commands).toEqual([
      { method: 'Network.getResponseBody', params: { requestId: '../unsafe/request' } }
    ])
    expect(tap.commands.some(({ method }) => method === 'Network.setExtraHTTPHeaders')).toBe(false)
  })

  test('decodes base64 response bodies to original binary files', async () => {
    const directory = await sessionDirectory()
    const tap = new FakeTap()
    const binary = Buffer.from([0, 255, 16, 128])
    tap.bodies.set('binary', { body: binary.toString('base64'), base64Encoded: true })
    const recorder = await SessionRecorder.start({ directory, target: TARGET, tap })

    await requestStarted(tap, 'binary')
    await responseReceived(tap, 'binary', 'application/octet-stream')
    await tap.emit('Network.loadingFinished', {
      requestId: 'binary',
      timestamp: 11,
      encodedDataLength: binary.length
    })
    await recorder.close()

    const manifest = await readSessionManifest(directory)
    const indexed = manifest.bodyIndex.binary
    expect(indexed).toMatchObject({ base64Encoded: true, byteLength: 4 })
    expect(await readFile(join(directory, indexed.path))).toEqual(binary)
  })

  test('records failures without requesting or inventing a response body', async () => {
    const directory = await sessionDirectory()
    const tap = new FakeTap()
    const recorder = await SessionRecorder.start({ directory, target: TARGET, tap })

    await requestStarted(tap, 'failed')
    await tap.emit('Network.loadingFailed', {
      requestId: 'failed',
      timestamp: 10.1,
      errorText: 'net::ERR_CONNECTION_REFUSED',
      canceled: false
    })
    await recorder.close()

    const manifest = await readSessionManifest(directory)
    expect(manifest.stats).toMatchObject({ failedRequestCount: 1, bodyCount: 0 })
    expect(manifest.requestIndex.failed.failure).toEqual({
      errorText: 'net::ERR_CONNECTION_REFUSED',
      canceled: false
    })
    expect(tap.commands).toEqual([])
  })

  test('keeps recording when getResponseBody is unavailable and indexes the issue', async () => {
    const directory = await sessionDirectory()
    const tap = new FakeTap()
    tap.bodies.set('missing', new Error('No resource with given identifier found'))
    const recorder = await SessionRecorder.start({ directory, target: TARGET, tap })

    await requestStarted(tap, 'missing')
    await responseReceived(tap, 'missing', 'text/plain')
    await tap.emit('Network.loadingFinished', {
      requestId: 'missing',
      timestamp: 10.5,
      encodedDataLength: 0
    })
    await recorder.close()

    const manifest = await readSessionManifest(directory)
    expect(manifest.state).toBe('completed')
    expect(manifest.stats).toMatchObject({ bodyCount: 0, bodyErrorCount: 1 })
    expect(manifest.issues).toContainEqual(
      expect.objectContaining({
        operation: 'Network.getResponseBody',
        requestId: 'missing',
        message: 'No resource with given identifier found'
      })
    )
  })

  test('marks unexpected disconnects failed and closes idempotently without owning the tap', async () => {
    const directory = await sessionDirectory()
    const tap = new FakeTap()
    const recorder = await SessionRecorder.start({ directory, target: TARGET, tap })
    tap.disconnect(new Error('backend exited'))

    const firstClose = recorder.close()
    expect(recorder.close()).toBe(firstClose)
    await firstClose
    await tap.emit('Network.requestWillBeSent', { requestId: 'too-late' })

    const manifest = await readSessionManifest(directory)
    expect(manifest.state).toBe('failed')
    expect(manifest.stats.eventCount).toBe(0)
    expect(manifest.issues).toContainEqual(
      expect.objectContaining({ operation: 'protocol-disconnect', message: 'backend exited' })
    )
    expect(tap.closeMock).not.toHaveBeenCalled()
    expect((await readdir(directory)).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  test('refuses to overwrite an existing session directory', async () => {
    const directory = await sessionDirectory()
    const first = await SessionRecorder.start({ directory, target: TARGET, tap: new FakeTap() })
    await first.close()
    const before = await readSessionManifest(directory)

    await expect(
      SessionRecorder.start({ directory, target: TARGET, tap: new FakeTap() })
    ).rejects.toThrow(`Session artifacts already exist in: ${directory}`)

    expect((await readSessionManifest(directory)).sessionId).toBe(before.sessionId)
  })
})

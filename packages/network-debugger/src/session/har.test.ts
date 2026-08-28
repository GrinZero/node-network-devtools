import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, test } from 'vitest'
import type { DevtoolsTarget } from '../adapters/types'
import { buildHar, exportHar } from './har'
import { readSessionManifest } from './files'
import { SessionRecorder } from './recorder'
import type { CdpProtocolEvent, ResponseBodyResult, SessionProtocolConnection } from './types'

const TARGET: DevtoolsTarget = {
  id: 'har-test',
  title: 'HAR test',
  type: 'node',
  url: '',
  webSocketDebuggerUrl: 'ws://127.0.0.1:43124/devtools/page/har-test',
  discoveryUrl: 'http://127.0.0.1:43124/json/list'
}

class HarTap implements SessionProtocolConnection {
  readonly target = TARGET
  state: SessionProtocolConnection['state'] = 'idle'
  readonly bodies = new Map<string, ResponseBodyResult>()
  private readonly listeners = new Set<(event: CdpProtocolEvent) => void | Promise<void>>()

  async connect() {
    this.state = 'open'
  }

  async command<T>(_method: string, params: Record<string, unknown> = {}) {
    const result = this.bodies.get(String(params.requestId))
    if (!result) throw new Error('missing body')
    return result as T
  }

  onEvent(listener: (event: CdpProtocolEvent) => void | Promise<void>) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onDisconnect() {
    return () => undefined
  }

  async close() {
    this.state = 'closed'
  }

  async emit(method: string, params: Record<string, unknown>) {
    await Promise.all([...this.listeners].map((listener) => listener({ method, params })))
  }
}

const directories: string[] = []

async function makeDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'nnd-har-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('HAR 1.2 export', () => {
  test('matches text, binary, failed, and traced requests from one session', async () => {
    const directory = await makeDirectory()
    const tap = new HarTap()
    const binary = Buffer.from([0, 1, 254, 255])
    tap.bodies.set('text', { body: 'hello', base64Encoded: false })
    tap.bodies.set('binary', { body: binary.toString('base64'), base64Encoded: true })
    const recorder = await SessionRecorder.start({ directory, target: TARGET, tap })

    await tap.emit('Network.requestWillBeSent', {
      requestId: 'text',
      timestamp: 1,
      wallTime: 1_800_000_000,
      type: 'Fetch',
      request: {
        url: 'https://example.test/text?tag=one&tag=two',
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          'x-request': 'captured',
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
        },
        postData: 'posted'
      }
    })
    await tap.emit('Network.responseReceived', {
      requestId: 'text',
      timestamp: 1.2,
      type: 'Fetch',
      response: {
        url: 'https://example.test/text?tag=one&tag=two',
        status: 201,
        statusText: 'Created',
        protocol: 'h2',
        headers: { 'content-type': 'text/plain', 'x-response': 'captured' },
        mimeType: 'text/plain',
        timing: {
          dnsStart: 0,
          dnsEnd: 2,
          connectStart: 2,
          connectEnd: 5,
          sslStart: 3,
          sslEnd: 5,
          sendStart: 5,
          sendEnd: 6
        }
      }
    })
    await tap.emit('Network.loadingFinished', {
      requestId: 'text',
      timestamp: 1.5,
      encodedDataLength: 5
    })

    await tap.emit('Network.requestWillBeSent', {
      requestId: 'binary',
      timestamp: 2,
      wallTime: 1_800_000_001,
      request: {
        url: 'https://example.test/file.bin',
        method: 'GET',
        headers: {}
      }
    })
    await tap.emit('Network.responseReceived', {
      requestId: 'binary',
      timestamp: 2.1,
      response: {
        url: 'https://example.test/file.bin',
        status: 206,
        statusText: 'Partial Content',
        protocol: 'http/1.1',
        headers: { 'content-type': 'application/octet-stream' },
        mimeType: 'application/octet-stream'
      }
    })
    await tap.emit('Network.loadingFinished', {
      requestId: 'binary',
      timestamp: 2.2,
      encodedDataLength: binary.length
    })

    await tap.emit('Network.requestWillBeSent', {
      requestId: 'failed',
      timestamp: 3,
      wallTime: 1_800_000_002_000,
      request: {
        url: 'https://example.test/unavailable',
        method: 'GET',
        headers: { accept: '*/*' }
      }
    })
    await tap.emit('Network.loadingFailed', {
      requestId: 'failed',
      timestamp: 3.05,
      errorText: 'net::ERR_CONNECTION_REFUSED',
      canceled: false
    })
    await recorder.close()

    const outputPath = join(directory, 'export.har')
    const result = await exportHar(directory, outputPath)
    expect(result.outputPath).toBe(outputPath)
    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual(result.har)
    expect(result.har.log).toMatchObject({
      version: '1.2',
      creator: { name: 'node-network-devtools' }
    })
    expect(result.har.log.entries).toHaveLength(3)

    const text = result.har.log.entries[0]
    expect(text.request).toMatchObject({
      method: 'POST',
      url: 'https://example.test/text?tag=one&tag=two',
      httpVersion: 'HTTP/2',
      queryString: [
        { name: 'tag', value: 'one' },
        { name: 'tag', value: 'two' }
      ],
      postData: { mimeType: 'text/plain', text: 'posted' }
    })
    expect(text.request.headers).toContainEqual({ name: 'x-request', value: 'captured' })
    expect(text.response).toMatchObject({
      status: 201,
      statusText: 'Created',
      content: { size: 5, mimeType: 'text/plain', text: 'hello' }
    })
    expect(text.response.content.encoding).toBeUndefined()
    expect(text.time).toBeCloseTo(500)
    expect(text.timings).toMatchObject({ dns: 2, connect: 3, send: 1, ssl: 2 })
    expect(text.timings.wait).toBeCloseTo(200)
    expect(text.timings.receive).toBeCloseTo(300)
    expect(text._trace).toMatchObject({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      parentId: '00f067aa0ba902b7'
    })

    const binaryEntry = result.har.log.entries[1]
    expect(binaryEntry.response.content).toEqual({
      size: binary.length,
      mimeType: 'application/octet-stream',
      text: binary.toString('base64'),
      encoding: 'base64'
    })

    const failure = result.har.log.entries[2]
    expect(failure.response.status).toBe(0)
    expect(failure.response.statusText).toBe('net::ERR_CONNECTION_REFUSED')
    expect(failure._failure).toEqual({
      errorText: 'net::ERR_CONNECTION_REFUSED',
      canceled: false
    })
    expect(failure.startedDateTime).toBe(new Date(1_800_000_002_000).toISOString())
  })

  test('rejects a body whose external bytes no longer match the manifest index', async () => {
    const directory = await makeDirectory()
    const tap = new HarTap()
    tap.bodies.set('body', { body: 'original', base64Encoded: false })
    const recorder = await SessionRecorder.start({ directory, target: TARGET, tap })
    await tap.emit('Network.requestWillBeSent', {
      requestId: 'body',
      timestamp: 1,
      request: { url: 'https://example.test', method: 'GET', headers: {} }
    })
    await tap.emit('Network.responseReceived', {
      requestId: 'body',
      timestamp: 2,
      response: { status: 200, headers: {}, mimeType: 'text/plain' }
    })
    await tap.emit('Network.loadingFinished', { requestId: 'body', timestamp: 3 })
    await recorder.close()
    const manifest = await readSessionManifest(directory)
    await writeFile(join(directory, manifest.bodyIndex.body.path), 'tampered')

    await expect(buildHar(directory)).rejects.toThrow(
      'Session body integrity check failed for request body.'
    )
  })
})

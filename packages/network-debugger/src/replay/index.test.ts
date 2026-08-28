import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { HarDocument, SessionManifest } from '../session/types'
import { replay, sanitizeReplayHeaders } from '.'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

function har(entries: HarDocument['log']['entries']): HarDocument {
  return {
    log: {
      version: '1.2',
      creator: { name: 'node-network-devtools', version: '2.0.0' },
      pages: [],
      entries
    }
  }
}

function entry(url: string, method = 'POST'): HarDocument['log']['entries'][number] {
  return {
    startedDateTime: new Date(0).toISOString(),
    time: 1,
    request: {
      method,
      url,
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: [
        { name: 'Connection', value: 'keep-alive, x-private-hop' },
        { name: 'X-Private-Hop', value: 'remove-me' },
        { name: 'Content-Length', value: '999' },
        { name: 'X-End-To-End', value: 'preserve-me' }
      ],
      queryString: [],
      postData: { mimeType: 'text/plain', text: 'payload' },
      headersSize: -1,
      bodySize: 7
    },
    response: {
      status: 200,
      statusText: 'OK',
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: [],
      content: { size: 0, mimeType: 'text/plain' },
      redirectURL: '',
      headersSize: -1,
      bodySize: 0
    },
    cache: {},
    timings: { blocked: -1, dns: -1, connect: -1, send: 0, wait: 1, receive: 0, ssl: -1 },
    _requestId: 'request-1'
  }
}

describe('replay', () => {
  test('sanitizes hop-by-hop, Connection-nominated, and runtime-owned headers', () => {
    expect(
      sanitizeReplayHeaders([
        ['Connection', 'X-Temporary'],
        ['X-Temporary', 'no'],
        ['Transfer-Encoding', 'chunked'],
        ['Host', 'old.example'],
        ['Content-Length', '10'],
        ['Traceparent', '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01']
      ])
    ).toEqual({
      Traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01'
    })
  })

  test('builds a deterministic HAR dry-run without opening the network', async () => {
    const fetch = vi.fn()
    const report = await replay(har([entry('http://127.0.0.1:43101/replay')]), {
      dryRun: true,
      fetch: fetch as unknown as typeof globalThis.fetch
    })

    expect(fetch).not.toHaveBeenCalled()
    expect(report).toMatchObject({ dryRun: true, succeeded: 1, failed: 0 })
    expect(report.requests).toEqual([
      {
        index: 0,
        requestId: 'request-1',
        method: 'POST',
        url: 'http://127.0.0.1:43101/replay',
        headers: { 'X-End-To-End': 'preserve-me' },
        body: 'payload'
      }
    ])
  })

  test('loads a Session directory in event sequence order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nnd-replay-session-'))
    temporaryDirectories.push(directory)
    const manifest: SessionManifest = {
      schemaVersion: 1,
      sessionId: 'session-1',
      state: 'completed',
      createdAt: new Date(0).toISOString(),
      completedAt: new Date(1).toISOString(),
      target: {
        id: 'target',
        title: 'target',
        type: 'node',
        url: '',
        webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/target',
        discoveryUrl: 'http://127.0.0.1/json/list'
      },
      files: { events: 'events.ndjson', bodies: 'bodies' },
      stats: {
        eventCount: 2,
        requestCount: 2,
        bodyCount: 0,
        bodyErrorCount: 0,
        failedRequestCount: 0
      },
      requestIndex: {
        second: {
          requestId: 'second',
          firstSequence: 2,
          request: { url: 'http://127.0.0.1/second', method: 'GET', headers: {} }
        },
        first: {
          requestId: 'first',
          firstSequence: 1,
          request: {
            url: 'http://127.0.0.1/first',
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            postData: 'first-body'
          }
        }
      },
      bodyIndex: {},
      traceIndex: {},
      issues: []
    }
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))

    const report = await replay(directory, { dryRun: true })
    expect(report.requests.map((request) => request.requestId)).toEqual(['first', 'second'])
    expect(report.requests[0].body).toBe('first-body')
    expect(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))).toEqual(manifest)
  })

  test('performs real fetch calls, drains bodies, and reports HTTP failures', async () => {
    const responseBody = vi.fn(async () => new ArrayBuffer(0))
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
      headers: new Headers({ 'x-result': 'captured' }),
      arrayBuffer: responseBody
    }))

    const report = await replay(har([entry('http://127.0.0.1/service')]), {
      fetch: fetch as unknown as typeof globalThis.fetch
    })

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1/service',
      expect.objectContaining({ method: 'POST', body: 'payload', redirect: 'manual' })
    )
    expect(responseBody).toHaveBeenCalledOnce()
    expect(report).toMatchObject({ succeeded: 0, failed: 1 })
    expect(report.results[0]).toMatchObject({ ok: false, status: 503 })
  })
})

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

import { runNativeMockConflictConsumer, withEnhancementsHarness } from './enhancements-harness.mjs'
import { BINARY_BODY } from './fixtures/origin-server.mjs'

const TEST_TIMEOUT_MS = 60_000
const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
const TRACESTATE = 'vendor=value'

function entryForUrl(har, url) {
  const entry = har.log.entries.find((candidate) => candidate.request.url === url)
  assert.ok(entry, `HAR entry is missing for ${url}`)
  return entry
}

function indexedRequestForUrl(manifest, url) {
  const entry = Object.values(manifest.requestIndex).find(
    (candidate) => candidate.request?.url === url
  )
  assert.ok(entry, `Session request index is missing ${url}`)
  return entry
}

test(
  'records real Legacy traffic, exports HAR, replays, mocks, and correlates trace context',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    await withEnhancementsHarness(t, async (harness) => {
      assert.equal(harness.networkEnable.request.id, harness.networkEnable.response.id)
      assert.deepEqual(harness.networkEnable.result, {})

      const traceToken = harness.createToken('trace')
      const binaryToken = harness.createToken('binary')
      const plainToken = harness.createToken('plain')
      const postToken = harness.createToken('post')
      const mockHttpToken = harness.createToken('mock-http')
      const mockFetchToken = harness.createToken('mock-fetch')
      const urls = {
        trace: harness.url('/text', traceToken),
        binary: harness.url('/binary', binaryToken),
        plain: harness.url('/plain', plainToken),
        post: harness.url('/post', postToken),
        mockHttp: harness.url('/mock-http', mockHttpToken),
        mockFetch: harness.url('/mock-fetch', mockFetchToken)
      }
      const postBody = `replay-post:${postToken}:正文`

      const traceResult = await harness.run('http-text', {
        url: urls.trace,
        headers: { traceparent: TRACEPARENT, tracestate: TRACESTATE }
      })
      const binaryResult = await harness.run('http-binary', { url: urls.binary })
      const plainResult = await harness.run('http-plain', { url: urls.plain })
      const postResult = await harness.run('fetch-post', {
        url: urls.post,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: postBody
      })
      const mockHttpResult = await harness.run('mock-http', { url: urls.mockHttp })
      const mockFetchResult = await harness.run('mock-fetch', {
        url: urls.mockFetch,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'x-mock-match': 'fetch'
        },
        body: 'mock-fetch-request'
      })

      assert.equal(traceResult.result.status, 200)
      assert.equal(
        Buffer.from(traceResult.result.bodyBase64, 'base64').toString('utf8'),
        `session-text:${traceToken}:你好`
      )
      assert.deepEqual(Buffer.from(binaryResult.result.bodyBase64, 'base64'), BINARY_BODY)
      assert.equal(plainResult.result.status, 200)
      assert.equal(postResult.result.status, 201)
      assert.equal(JSON.parse(postResult.result.body).requestBody, postBody)
      assert.equal(mockHttpResult.result.status, 207)
      assert.equal(mockHttpResult.result.headers['x-mock-kind'], 'http')
      assert.equal(
        Buffer.from(mockHttpResult.result.bodyBase64, 'base64').toString('utf8'),
        'legacy-http-mock-body'
      )
      assert.equal(mockFetchResult.result.status, 202)
      assert.equal(mockFetchResult.result.headers['x-mock-kind'], 'fetch')
      assert.equal(mockFetchResult.result.body, 'legacy-fetch-mock-body')

      for (const result of [
        traceResult,
        binaryResult,
        plainResult,
        postResult,
        mockHttpResult,
        mockFetchResult
      ]) {
        assert.equal(result.terminalMethod, 'Network.loadingFinished')
        assert.equal(typeof result.requestId, 'string')
        assert.ok(result.requestId.length > 0)
      }
      for (const url of Object.values(urls)) {
        assert.equal(
          harness.client.findEvents(
            'Network.requestWillBeSent',
            (params) => params.request?.url === url
          ).length,
          1,
          `independent raw CDP client did not observe ${url}`
        )
      }

      // Mocked calls are real http.request/fetch invocations, but the loopback
      // origin must prove neither call escaped the Legacy mock layer.
      assert.equal(
        harness.origin.records.some(
          (record) => record.pathname === '/mock-http' || record.pathname === '/mock-fetch'
        ),
        false
      )

      const finalized = await harness.finalize()
      const manifest = JSON.parse(
        await readFile(resolve(harness.sessionDirectory, 'manifest.json'), 'utf8')
      )
      const eventText = await readFile(resolve(harness.sessionDirectory, 'events.ndjson'), 'utf8')
      const events = eventText
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
      const har = JSON.parse(await readFile(finalized.harPath, 'utf8'))

      assert.equal(manifest.schemaVersion, 1)
      assert.equal(manifest.state, 'completed')
      assert.equal(manifest.target.id, harness.sessionInfo.target.id)
      assert.equal(manifest.stats.requestCount, 6)
      assert.equal(manifest.stats.bodyCount, 6)
      assert.equal(manifest.stats.bodyErrorCount, 0)
      assert.equal(manifest.stats.failedRequestCount, 0)
      assert.equal(manifest.issues.length, 0)
      assert.equal(events.length, manifest.stats.eventCount)
      assert.ok(events.length >= 18)
      events.forEach((event, index) => {
        assert.equal(event.schemaVersion, 1)
        assert.equal(event.sequence, index + 1)
        assert.equal(typeof event.recordedAt, 'string')
      })
      assert.equal(
        events.some(
          (event) =>
            event.method === 'Network.requestWillBeSent' &&
            event.params?.request?.url === urls.trace
        ),
        true
      )
      assert.equal(
        events.some((event) => event.method.startsWith('Network.webSocket')),
        false,
        'the Session tap must not record its own CDP WebSocket transport'
      )
      assert.equal(
        Object.values(manifest.requestIndex).some((request) =>
          request.request?.url?.startsWith('ws://127.0.0.1:')
        ),
        false,
        'the Session tap must not appear in the request index'
      )

      for (const bodyIndex of Object.values(manifest.bodyIndex)) {
        const bytes = await readFile(resolve(harness.sessionDirectory, bodyIndex.path))
        assert.equal(bytes.byteLength, bodyIndex.byteLength)
        assert.equal(createHash('sha256').update(bytes).digest('hex'), bodyIndex.sha256)
      }

      assert.equal(har.log.version, '1.2')
      assert.equal(har.log.entries.length, 6)
      const textEntry = entryForUrl(har, urls.trace)
      assert.equal(textEntry.response.content.text, `session-text:${traceToken}:你好`)
      assert.equal(textEntry.response.content.encoding, undefined)
      const binaryEntry = entryForUrl(har, urls.binary)
      assert.equal(binaryEntry.response.content.encoding, 'base64')
      assert.deepEqual(Buffer.from(binaryEntry.response.content.text, 'base64'), BINARY_BODY)
      const postEntry = entryForUrl(har, urls.post)
      assert.equal(postEntry.request.method, 'POST')
      assert.equal(postEntry.request.postData.text, postBody)
      assert.equal(entryForUrl(har, urls.mockHttp).response.status, 207)
      assert.equal(entryForUrl(har, urls.mockFetch).response.status, 202)

      const tracedRequest = indexedRequestForUrl(manifest, urls.trace)
      assert.deepEqual(tracedRequest.trace, {
        traceparent: TRACEPARENT,
        version: '00',
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        parentId: '00f067aa0ba902b7',
        traceFlags: '01',
        sampled: true,
        tracestate: TRACESTATE
      })
      assert.deepEqual(manifest.traceIndex[tracedRequest.trace.traceId].requestIds, [
        tracedRequest.requestId
      ])
      assert.equal(indexedRequestForUrl(manifest, urls.plain).trace, undefined)
      assert.equal(entryForUrl(har, urls.trace)._trace.traceparent, TRACEPARENT)
      assert.equal(entryForUrl(har, urls.plain)._trace, undefined)

      assert.equal(finalized.dryRun.dryRun, true)
      assert.equal(finalized.dryRun.requests.length, 6)
      assert.equal(finalized.dryRun.succeeded, 6)
      assert.equal(finalized.dryRun.failed, 0)
      assert.equal(
        finalized.dryRun.results.every((result) => result.dryRun && result.ok),
        true
      )
      assert.equal(finalized.realReplay.dryRun, false)
      assert.equal(finalized.realReplay.requests.length, 6)
      assert.equal(finalized.realReplay.succeeded, 6)
      assert.equal(finalized.realReplay.failed, 0)
      assert.equal(
        finalized.realReplay.results.every((result) => !result.dryRun && result.ok),
        true
      )

      // Four non-mocked requests hit once while recording and once during real
      // HAR replay. Header evidence proves trace correlation did not inject a
      // traceparent into unrelated requests.
      for (const token of [traceToken, binaryToken, plainToken, postToken]) {
        assert.equal(
          harness.origin.records.filter((record) => record.token === token).length,
          2,
          `expected original plus replay traffic for ${token}`
        )
      }
      assert.equal(
        harness.origin.records.some(
          (record) => record.pathname === '/mock-http' || record.pathname === '/mock-fetch'
        ),
        false
      )
      for (const record of harness.origin.records.filter((record) => record.token === traceToken)) {
        assert.equal(record.headers.traceparent, TRACEPARENT)
        assert.equal(record.headers.tracestate, TRACESTATE)
      }
      for (const record of harness.origin.records.filter((record) => record.token === plainToken)) {
        assert.equal(record.headers.traceparent, undefined)
        assert.equal(record.headers.tracestate, undefined)
      }
      for (const record of harness.origin.records.filter((record) => record.token === postToken)) {
        assert.equal(Buffer.from(record.bodyBase64, 'base64').toString('utf8'), postBody)
      }
    })
  }
)

test(
  'built consumer rejects Native plus Legacy Mock with a stable conflict',
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const result = await runNativeMockConflictConsumer()
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.signal, null)
    const lines = result.stdout.trim().split('\n').filter(Boolean)
    const error = JSON.parse(lines.at(-1))
    assert.equal(error.name, 'RuntimeRegistrationError')
    assert.equal(error.code, 'NND_NATIVE_MOCK_CONFLICT')
    assert.match(error.message, /only with the Legacy backend/i)
    assert.equal(error.details.mode, 'native')
    assert.equal(error.details.mockRuleCount, 1)
  }
)

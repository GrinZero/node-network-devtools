import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

import { withNativeHarness } from './harness/native-harness.mjs'

const TEST_TIMEOUT_MS = 30_000

function eventForUrl(client, method, url) {
  return client.waitForEvent(method, (params) => {
    const eventUrl = params.request?.url ?? params.response?.url
    return eventUrl === url
  })
}

function assertTimestamp(value, label) {
  assert.equal(typeof value, 'number', `${label} must be a number`)
  assert.ok(Number.isFinite(value), `${label} must be finite`)
  assert.ok(value >= 0, `${label} must not be negative`)
}

function assertNativeWallTime(value) {
  assertTimestamp(value, 'request wallTime')
  // Node's native Network domain currently emits epoch milliseconds on some
  // releases even though CDP models wallTime as TimeSinceEpoch (seconds).
  // NativeAdapter intentionally forwards the official runtime unchanged.
  const epochMilliseconds = value > 100_000_000_000 ? value : value * 1_000
  assert.ok(
    Math.abs(Date.now() - epochMilliseconds) < 60_000,
    `wallTime must represent the current epoch; received ${value}`
  )
}

function assertSuccessfulLifecycle(client, request, response, finished) {
  const requestId = request.message.params.requestId
  assert.ok(requestId, 'requestWillBeSent must include a requestId')
  assert.equal(response.message.params.requestId, requestId)
  assert.equal(finished.message.params.requestId, requestId)
  assert.ok(request.sequence < response.sequence, 'request must precede response')
  assert.ok(response.sequence < finished.sequence, 'response must precede loadingFinished')

  assertTimestamp(request.message.params.timestamp, 'request timestamp')
  assertTimestamp(response.message.params.timestamp, 'response timestamp')
  assertTimestamp(finished.message.params.timestamp, 'loadingFinished timestamp')
  assert.ok(
    request.message.params.timestamp <= response.message.params.timestamp,
    'request timestamp must not exceed response timestamp'
  )
  assert.ok(
    response.message.params.timestamp <= finished.message.params.timestamp,
    'response timestamp must not exceed loadingFinished timestamp'
  )

  assertNativeWallTime(request.message.params.wallTime)
  for (const method of [
    'Network.requestWillBeSent',
    'Network.responseReceived',
    'Network.loadingFinished'
  ]) {
    assert.equal(
      client.findEvents(method, (params) => params.requestId === requestId).length,
      1,
      `${method} must be emitted exactly once`
    )
  }
}

function decodeBody(result) {
  return result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body
}

test(
  'native adapter uses a real Node Inspector session with correlated CDP commands',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    await withNativeHarness(t, async (harness) => {
      assert.equal(harness.sessionInfo.mode, 'native')
      assert.deepEqual(harness.nativeFunctionsUnchanged, {
        fetch: true,
        httpRequest: true,
        httpsRequest: true
      })
      assert.equal(harness.sessionInfo.target.webSocketDebuggerUrl, harness.inspectorUrl)
      assert.equal(harness.networkEnable.request.id, harness.networkEnable.response.id)
      assert.deepEqual(harness.networkEnable.result, {})

      const evaluation = await harness.client.command('Runtime.evaluate', {
        expression: 'process.pid',
        returnByValue: true
      })
      assert.equal(evaluation.result.result.type, 'number')
      assert.equal(evaluation.result.result.value, harness.targetPid)
    })
  }
)

test(
  'native adapter reports a real HTTP lifecycle and source initiator',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    await withNativeHarness(t, async (harness) => {
      const token = harness.createToken('http')
      const url = harness.url('/http', token)
      const requestPromise = eventForUrl(harness.client, 'Network.requestWillBeSent', url)
      const responsePromise = eventForUrl(harness.client, 'Network.responseReceived', url)

      const scenarioPromise = harness.runScenario('http', { url, token })
      const request = await requestPromise
      const response = await responsePromise
      const finished = await harness.client.waitForEvent(
        'Network.loadingFinished',
        (params) => params.requestId === request.message.params.requestId
      )
      const scenario = await scenarioPromise

      assertSuccessfulLifecycle(harness.client, request, response, finished)
      assert.equal(request.message.params.request.method, 'GET')
      assert.equal(response.message.params.response.status, 200)
      assert.equal(response.message.params.response.headers['x-e2e-token'], token)
      assert.deepEqual(scenario, { status: 200, body: `http-response:${token}` })

      if (harness.sessionInfo.capabilities?.initiator !== false) {
        const frames = request.message.params.initiator?.stack?.callFrames ?? []
        assert.ok(frames.length > 0, 'supported initiator capability must include call frames')
        assert.ok(
          frames.some((frame) =>
            frame.url.replaceAll('\\', '/').endsWith('/test/e2e/fixtures/native-target.mjs')
          ),
          `initiator must reference native-target.mjs; received ${JSON.stringify(frames)}`
        )
      }
    })
  }
)

test(
  'native adapter reports a real Fetch lifecycle and response body',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    await withNativeHarness(t, async (harness) => {
      const token = harness.createToken('fetch')
      const url = harness.url('/fetch', token)
      const requestPromise = eventForUrl(harness.client, 'Network.requestWillBeSent', url)
      const responsePromise = eventForUrl(harness.client, 'Network.responseReceived', url)

      const scenarioPromise = harness.runScenario('fetch', { url, token })
      const request = await requestPromise
      const response = await responsePromise
      const finished = await harness.client.waitForEvent(
        'Network.loadingFinished',
        (params) => params.requestId === request.message.params.requestId
      )
      const scenario = await scenarioPromise

      assertSuccessfulLifecycle(harness.client, request, response, finished)
      assert.equal(request.message.params.request.method, 'POST')
      assert.equal(response.message.params.response.status, 201)

      const bodyExchange = await harness.client.command('Network.getResponseBody', {
        requestId: request.message.params.requestId
      })
      const body = JSON.parse(decodeBody(bodyExchange.result))
      assert.deepEqual(body, {
        token,
        requestBody: `fetch-request:${token}`
      })
      assert.equal(scenario.status, 201)
      assert.deepEqual(JSON.parse(scenario.body), body)
    })
  }
)

test(
  'native adapter terminates a failed request with loadingFailed only',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    await withNativeHarness(t, async (harness) => {
      const token = harness.createToken('failed')
      const url = harness.url('/reset', token)
      const requestPromise = eventForUrl(harness.client, 'Network.requestWillBeSent', url)
      const scenarioPromise = harness.runScenario('failed', { url, token })

      const request = await requestPromise
      const requestId = request.message.params.requestId
      const failed = await harness.client.waitForEvent(
        'Network.loadingFailed',
        (params) => params.requestId === requestId
      )
      const scenario = await scenarioPromise

      assert.equal(scenario.failed, true)
      assert.ok(failed.sequence > request.sequence)
      assertTimestamp(failed.message.params.timestamp, 'loadingFailed timestamp')
      assert.equal(typeof failed.message.params.errorText, 'string')
      assert.ok(failed.message.params.errorText.length > 0)
      assert.equal(
        harness.client.findEvents(
          'Network.responseReceived',
          (params) => params.requestId === requestId
        ).length,
        0
      )
      assert.equal(
        harness.client.findEvents(
          'Network.loadingFinished',
          (params) => params.requestId === requestId
        ).length,
        0
      )
    })
  }
)

test(
  'native adapter records a real backend-neutral Session and HAR',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    await withNativeHarness(
      t,
      async (harness) => {
        assert.equal(harness.sessionInfo.mode, 'native')
        assert.equal(harness.sessionInfo.session?.directory, harness.sessionDirectory)

        const token = harness.createToken('native-session')
        const url = harness.url('/http', token)
        const scenario = await harness.runScenario('http', { url, token })
        assert.deepEqual(scenario, { status: 200, body: `http-response:${token}` })

        // The scenario result arrives over IPC, while Session events arrive over
        // a separate Inspector WebSocket. Wait for the real terminal event and
        // body capture instead of racing finalization against that second channel.
        await harness.waitForRecordedRequest(url)
        await harness.finalizeSession()
        const manifest = JSON.parse(
          await readFile(resolve(harness.sessionDirectory, 'manifest.json'), 'utf8')
        )
        const har = JSON.parse(
          await readFile(resolve(harness.sessionDirectory, 'session.har'), 'utf8')
        )

        assert.equal(manifest.state, 'completed')
        assert.equal(manifest.target.id, harness.sessionInfo.target.id)
        assert.equal(manifest.stats.requestCount, 1)
        assert.equal(manifest.stats.failedRequestCount, 0)
        assert.equal(manifest.stats.bodyErrorCount, 0)
        assert.equal(manifest.stats.bodyCount, 1)
        const indexedRequest = Object.values(manifest.requestIndex)[0]
        assert.equal(indexedRequest.request.url, url)
        const indexedBody = manifest.bodyIndex[indexedRequest.requestId]
        const body = await readFile(resolve(harness.sessionDirectory, indexedBody.path))
        assert.equal(createHash('sha256').update(body).digest('hex'), indexedBody.sha256)
        assert.equal(body.toString('utf8'), `http-response:${token}`)

        assert.equal(har.log.version, '1.2')
        assert.equal(har.log.entries.length, 1)
        assert.equal(har.log.entries[0].request.url, url)
        assert.equal(har.log.entries[0].response.content.text, `http-response:${token}`)
      },
      { recordSession: true }
    )
  }
)

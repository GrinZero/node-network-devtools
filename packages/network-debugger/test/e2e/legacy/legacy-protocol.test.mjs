import assert from 'node:assert/strict'
import test from 'node:test'

import { withLegacyHarness } from './legacy-harness.mjs'

const TEST_TIMEOUT_MS = 50_000
const BINARY_WEBSOCKET_PAYLOAD = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x42])

function eventUrl(params) {
  return params.request?.url ?? params.response?.url ?? params.url
}

function eventForUrl(client, method, url) {
  return client.waitForEvent(method, (params) => eventUrl(params) === url)
}

function assertTimestamp(value, label) {
  assert.equal(typeof value, 'number', `${label} must be a number`)
  assert.ok(Number.isFinite(value), `${label} must be finite`)
  assert.ok(value >= 0, `${label} must not be negative`)
}

function assertSuccessfulLifecycle(request, response, finished) {
  const requestId = request.message.params.requestId
  assert.ok(requestId, 'requestWillBeSent must include requestId')
  assert.equal(response.message.params.requestId, requestId)
  assert.equal(finished.message.params.requestId, requestId)
  assert.ok(request.sequence < response.sequence, 'request must precede response')
  assert.ok(response.sequence < finished.sequence, 'response must precede loadingFinished')
  assertTimestamp(request.message.params.timestamp, 'request timestamp')
  assertTimestamp(response.message.params.timestamp, 'response timestamp')
  assertTimestamp(finished.message.params.timestamp, 'loadingFinished timestamp')
}

function decodeBody(result) {
  return result.base64Encoded
    ? Buffer.from(result.body, 'base64')
    : Buffer.from(result.body, 'utf8')
}

async function successfulExchange(harness, scenario, { url, token, ...payload }) {
  const requestPromise = eventForUrl(harness.client, 'Network.requestWillBeSent', url)
  const scenarioPromise = harness.runScenario(scenario, { url, token, ...payload })
  const request = await requestPromise
  const requestId = request.message.params.requestId
  const response = await harness.client.waitForEvent(
    'Network.responseReceived',
    (params) => params.requestId === requestId
  )
  const finished = await harness.client.waitForEvent(
    'Network.loadingFinished',
    (params) => params.requestId === requestId
  )
  const result = await scenarioPromise
  assertSuccessfulLifecycle(request, response, finished)
  for (const method of [
    'Network.requestWillBeSent',
    'Network.responseReceived',
    'Network.loadingFinished'
  ]) {
    assert.equal(
      harness.client.findEvents(method, (params) => params.requestId === requestId).length,
      1,
      `${method} must be emitted exactly once for ${url}`
    )
  }
  return { request, response, finished, result }
}

async function responseBody(harness, requestId) {
  const exchange = await harness.client.command('Network.getResponseBody', { requestId })
  assert.equal(exchange.response.id, exchange.request.id)
  assert.equal(typeof exchange.result?.body, 'string')
  assert.equal(typeof exchange.result?.base64Encoded, 'boolean')
  return exchange.result
}

async function expectCdpError(client, method, params = {}) {
  try {
    await client.command(method, params, { timeoutMs: 3_000 })
  } catch (error) {
    assert.ok(error.cdpResponse, `${method} must return a CDP error, not time out or disconnect`)
    assert.equal(typeof error.cdpResponse.id, 'number')
    assert.equal(typeof error.cdpError?.code, 'number')
    assert.equal(typeof error.cdpError?.message, 'string')
    assert.ok(error.cdpError.message.length > 0)
    return error.cdpResponse
  }
  assert.fail(`${method} unexpectedly succeeded`)
}

async function failedExchange(harness, scenario, url, token, { mayReceiveResponse = false } = {}) {
  const requestPromise = eventForUrl(harness.client, 'Network.requestWillBeSent', url)
  const scenarioPromise = harness.runScenario(scenario, { url, token })
  const request = await requestPromise
  const requestId = request.message.params.requestId
  const failed = await harness.client.waitForEvent(
    'Network.loadingFailed',
    (params) => params.requestId === requestId
  )
  const result = await scenarioPromise

  assert.ok(failed.sequence > request.sequence)
  assertTimestamp(failed.message.params.timestamp, `${scenario} loadingFailed timestamp`)
  assert.equal(typeof failed.message.params.errorText, 'string')
  assert.ok(failed.message.params.errorText.length > 0)
  assert.equal(
    harness.client.findEvents('Network.loadingFailed', (params) => params.requestId === requestId)
      .length,
    1,
    `${scenario} must emit loadingFailed exactly once`
  )
  assert.equal(
    harness.client.findEvents('Network.loadingFinished', (params) => params.requestId === requestId)
      .length,
    0,
    `${scenario} must not also emit loadingFinished`
  )
  if (!mayReceiveResponse) {
    assert.equal(
      harness.client.findEvents(
        'Network.responseReceived',
        (params) => params.requestId === requestId
      ).length,
      0,
      `${scenario} must not manufacture a response`
    )
  }
  return { request, failed, result }
}

test(
  'Legacy exposes standard discovery and answers every raw CDP command id',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    await withLegacyHarness(t, { consumer: 'esm' }, async (harness) => {
      const target = harness.sessionInfo.target
      assert.equal(target.type, 'node')
      assert.equal(harness.discoveredTarget.id, target.id)
      assert.equal(harness.discoveredTarget.webSocketDebuggerUrl, target.webSocketDebuggerUrl)
      assert.equal(harness.networkEnable.response.id, harness.networkEnable.request.id)
      assert.deepEqual(harness.networkEnable.result, {})
      assert.equal(typeof harness.discovery.version['Protocol-Version'], 'string')
      assert.ok(
        harness.discovery.protocol.domains.some((domain) => domain.domain === 'Network'),
        '/json/protocol must describe Network'
      )

      const before = harness.client.journal.length
      const debuggerOutcome = await Promise.allSettled([
        harness.client.command('Debugger.enable', {}, { timeoutMs: 3_000 }),
        harness.client.command('Runtime.enable', {}, { timeoutMs: 3_000 })
      ])
      for (const outcome of debuggerOutcome) {
        if (outcome.status === 'fulfilled') {
          assert.ok(
            Object.hasOwn(outcome.value.response, 'result'),
            'successful CDP command must include result'
          )
        } else {
          assert.ok(
            outcome.reason?.cdpResponse,
            `known unsupported domains must return CDP errors: ${outcome.reason}`
          )
        }
      }
      const missingBody = await expectCdpError(harness.client, 'Network.getResponseBody', {
        requestId: 'missing-request-id'
      })
      assert.ok(
        [-32602, -32000].includes(missingBody.error.code),
        `missing body must use invalid-params/server-error, received ${missingBody.error.code}`
      )
      const unknownMethod = await expectCdpError(
        harness.client,
        'NodeNetworkDevtools.unknownMethod'
      )
      assert.equal(unknownMethod.error.code, -32601)

      const commandJournal = harness.client.journal.slice(before)
      const sent = commandJournal.filter(
        (record) => record.direction === 'send' && record.message.id !== undefined
      )
      const received = new Map(
        commandJournal
          .filter((record) => record.direction === 'receive' && record.message.id !== undefined)
          .map((record) => [record.message.id, record.message])
      )
      assert.ok(sent.length >= 4)
      for (const command of sent) {
        const response = received.get(command.message.id)
        assert.ok(
          response,
          `${command.message.method} (${command.message.id}) received no result or CDP error`
        )
        const hasResult = Object.hasOwn(response, 'result')
        const hasError = Object.hasOwn(response, 'error')
        assert.notEqual(
          hasResult,
          hasError,
          `${command.message.method} (${command.message.id}) must receive exactly one of result/error`
        )
      }
    })
  }
)

test(
  'Legacy ESM consumer captures real HTTP GET and Fetch POST lifecycles',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    await withLegacyHarness(t, { consumer: 'esm' }, async (harness) => {
      const getToken = harness.createToken('http-get')
      const getUrl = harness.url('/get', getToken)
      const get = await successfulExchange(harness, 'http-get', {
        url: getUrl,
        token: getToken
      })
      assert.equal(get.request.message.params.request.method, 'GET')
      assert.equal(get.response.message.params.response.status, 200)
      assert.equal(
        Buffer.from(get.result.bodyBase64, 'base64').toString('utf8'),
        `get-response:${getToken}`
      )
      const getBody = await responseBody(harness, get.request.message.params.requestId)
      assert.equal(decodeBody(getBody).toString('utf8'), `get-response:${getToken}`)

      const frames = get.request.message.params.initiator?.stack?.callFrames ?? []
      assert.ok(frames.length > 0, 'Legacy initiator capability must include real call frames')
      assert.ok(
        frames.some((frame) =>
          frame.url.replaceAll('\\', '/').endsWith('/legacy/fixtures/scenario-runner.cjs')
        ),
        `initiator must reference the real consumer scenario: ${JSON.stringify(frames)}`
      )

      const postToken = harness.createToken('fetch-post')
      const postUrl = harness.url('/post', postToken)
      const post = await successfulExchange(harness, 'fetch-post', {
        url: postUrl,
        token: postToken
      })
      assert.equal(post.request.message.params.request.method, 'POST')
      assert.equal(post.request.message.params.request.postData, `fetch-request:${postToken}`)
      const postData = await harness.client.command('Network.getRequestPostData', {
        requestId: post.request.message.params.requestId
      })
      assert.equal(postData.result.postData, `fetch-request:${postToken}`)
      assert.equal(post.response.message.params.response.status, 201)
      const postBody = await responseBody(harness, post.request.message.params.requestId)
      assert.deepEqual(JSON.parse(decodeBody(postBody).toString('utf8')), {
        token: postToken,
        requestBody: `fetch-request:${postToken}`
      })
      assert.deepEqual(JSON.parse(post.result.body), {
        token: postToken,
        requestBody: `fetch-request:${postToken}`
      })

      const chunkedToken = harness.createToken('http-post-chunks')
      const chunkedUrl = harness.url('/post', chunkedToken)
      const chunked = await successfulExchange(harness, 'http-post-chunks', {
        url: chunkedUrl,
        token: chunkedToken
      })
      const expectedChunkedBody = `http-request:${chunkedToken}`
      assert.equal(chunked.request.message.params.request.postData, expectedChunkedBody)
      const chunkedPostData = await harness.client.command('Network.getRequestPostData', {
        requestId: chunked.request.message.params.requestId
      })
      assert.equal(chunkedPostData.result.postData, expectedChunkedBody)
      assert.deepEqual(
        JSON.parse(Buffer.from(chunked.result.bodyBase64, 'base64').toString('utf8')),
        { token: chunkedToken, requestBody: expectedChunkedBody }
      )
    })
  }
)

test(
  'Legacy preserves text, gzip, and binary response bodies',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    await withLegacyHarness(t, { consumer: 'esm' }, async (harness) => {
      const textToken = harness.createToken('text')
      const text = await successfulExchange(harness, 'body', {
        url: harness.url('/text', textToken),
        token: textToken
      })
      const textBody = await responseBody(harness, text.request.message.params.requestId)
      assert.equal(textBody.base64Encoded, false)
      assert.equal(decodeBody(textBody).toString('utf8'), `legacy-text:${textToken}:你好`)

      const gzipToken = harness.createToken('gzip')
      const gzip = await successfulExchange(harness, 'body', {
        url: harness.url('/gzip', gzipToken),
        token: gzipToken
      })
      const gzipBody = await responseBody(harness, gzip.request.message.params.requestId)
      assert.equal(gzipBody.base64Encoded, false)
      assert.equal(decodeBody(gzipBody).toString('utf8'), `legacy-gzip:${gzipToken}:压缩内容`)

      const binaryToken = harness.createToken('binary')
      const binary = await successfulExchange(harness, 'body', {
        url: harness.url('/binary', binaryToken),
        token: binaryToken
      })
      const binaryBody = await responseBody(harness, binary.request.message.params.requestId)
      assert.equal(binaryBody.base64Encoded, true)
      assert.deepEqual(decodeBody(binaryBody), harness.origin.binaryBody)
    })
  }
)

test(
  'Legacy reports redirect, abort, reset, and timeout terminal states',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    await withLegacyHarness(t, { consumer: 'esm' }, async (harness) => {
      const redirectToken = harness.createToken('redirect')
      const redirectUrl = harness.url('/redirect', redirectToken)
      const destinationUrl = harness.url('/text', redirectToken)
      const firstRequestPromise = eventForUrl(
        harness.client,
        'Network.requestWillBeSent',
        redirectUrl
      )
      const destinationRequestPromise = eventForUrl(
        harness.client,
        'Network.requestWillBeSent',
        destinationUrl
      )
      const redirectScenario = harness.runScenario('redirect', {
        url: redirectUrl,
        token: redirectToken
      })
      const firstRequest = await firstRequestPromise
      const destinationRequest = await destinationRequestPromise
      const firstResponse = await harness.client.waitForEvent(
        'Network.responseReceived',
        (params) => params.requestId === firstRequest.message.params.requestId
      )
      const firstFinished = await harness.client.waitForEvent(
        'Network.loadingFinished',
        (params) => params.requestId === firstRequest.message.params.requestId
      )
      const destinationResponse = await harness.client.waitForEvent(
        'Network.responseReceived',
        (params) => params.requestId === destinationRequest.message.params.requestId
      )
      const destinationFinished = await harness.client.waitForEvent(
        'Network.loadingFinished',
        (params) => params.requestId === destinationRequest.message.params.requestId
      )
      const redirectResult = await redirectScenario

      assertSuccessfulLifecycle(firstRequest, firstResponse, firstFinished)
      assertSuccessfulLifecycle(destinationRequest, destinationResponse, destinationFinished)
      assert.notEqual(
        firstRequest.message.params.requestId,
        destinationRequest.message.params.requestId
      )
      assert.equal(firstResponse.message.params.response.status, 302)
      assert.equal(destinationResponse.message.params.response.status, 200)
      assert.equal(redirectResult.redirect.status, 302)
      assert.equal(redirectResult.destination.status, 200)
      assert.equal(redirectResult.destinationUrl, destinationUrl)

      const resetToken = harness.createToken('reset')
      const reset = await failedExchange(
        harness,
        'reset',
        harness.url('/reset', resetToken),
        resetToken
      )
      assert.equal(reset.result.failed, true)

      const timeoutToken = harness.createToken('timeout')
      const timeout = await failedExchange(
        harness,
        'timeout',
        harness.url('/timeout', timeoutToken),
        timeoutToken
      )
      assert.equal(timeout.result.failed, true)

      const abortToken = harness.createToken('abort')
      const abort = await failedExchange(
        harness,
        'abort',
        harness.url('/abort', abortToken),
        abortToken,
        { mayReceiveResponse: true }
      )
      assert.equal(abort.result.aborted, true)
    })
  }
)

test(
  'Legacy preserves SSE fields and ordering from a real chunked stream',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    await withLegacyHarness(t, { consumer: 'esm' }, async (harness) => {
      const token = harness.createToken('sse')
      const url = harness.url('/sse', token)
      const requestPromise = eventForUrl(harness.client, 'Network.requestWillBeSent', url)
      const scenarioPromise = harness.runScenario('sse', { url, token })
      const request = await requestPromise
      const requestId = request.message.params.requestId
      const response = await harness.client.waitForEvent(
        'Network.responseReceived',
        (params) => params.requestId === requestId
      )
      const first = await harness.client.waitForEvent(
        'Network.eventSourceMessageReceived',
        (params) => params.requestId === requestId && params.eventId === '1'
      )
      const second = await harness.client.waitForEvent(
        'Network.eventSourceMessageReceived',
        (params) => params.requestId === requestId && params.eventId === '2'
      )
      const third = await harness.client.waitForEvent(
        'Network.eventSourceMessageReceived',
        (params) => params.requestId === requestId && params.eventId === '3'
      )
      const finished = await harness.client.waitForEvent(
        'Network.loadingFinished',
        (params) => params.requestId === requestId
      )
      const result = await scenarioPromise

      assertSuccessfulLifecycle(request, response, finished)
      assert.equal(response.message.params.type, 'EventSource')
      assert.deepEqual(
        [first, second, third].map(({ message }) => ({
          eventName: message.params.eventName,
          eventId: message.params.eventId,
          data: message.params.data
        })),
        [
          { eventName: 'alpha', eventId: '1', data: 'first\nline-2' },
          { eventName: 'message', eventId: '2', data: 'second' },
          { eventName: 'omega', eventId: '3', data: 'third' }
        ]
      )
      assert.ok(response.sequence < first.sequence)
      assert.ok(first.sequence < second.sequence)
      assert.ok(second.sequence < third.sequence)
      assert.ok(third.sequence < finished.sequence)
      assert.equal(
        harness.client.findEvents(
          'Network.responseReceived',
          (params) => params.requestId === requestId
        ).length,
        1,
        'SSE must emit responseReceived exactly once'
      )
      assert.equal(
        harness.client.findEvents(
          'Network.eventSourceMessageReceived',
          (params) => params.requestId === requestId
        ).length,
        3,
        'SSE must emit exactly the three origin events'
      )
      assert.equal(
        harness.client.findEvents(
          'Network.loadingFinished',
          (params) => params.requestId === requestId
        ).length,
        1,
        'SSE must terminate exactly once'
      )
      assert.equal(result.status, 200)
      assert.match(result.body, /event: alpha/)
    })
  }
)

test(
  'Legacy reports a real compressed WebSocket handshake, text, binary, and close events',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    await withLegacyHarness(t, { consumer: 'esm' }, async (harness) => {
      const token = harness.createToken('websocket')
      const url = harness.webSocketUrl('/websocket', token)
      const createdPromise = eventForUrl(harness.client, 'Network.webSocketCreated', url)
      const scenarioPromise = harness.runScenario('websocket', {
        url,
        token,
        binaryBase64: BINARY_WEBSOCKET_PAYLOAD.toString('base64')
      })
      const created = await createdPromise
      const requestId = created.message.params.requestId
      const willSend = await harness.client.waitForEvent(
        'Network.webSocketWillSendHandshakeRequest',
        (params) => params.requestId === requestId
      )
      const handshake = await harness.client.waitForEvent(
        'Network.webSocketHandshakeResponseReceived',
        (params) => params.requestId === requestId
      )
      const textSent = await harness.client.waitForEvent(
        'Network.webSocketFrameSent',
        (params) =>
          params.requestId === requestId &&
          params.response.opcode === 1 &&
          params.response.payloadData === `client-text:${token}`
      )
      const textReceived = await harness.client.waitForEvent(
        'Network.webSocketFrameReceived',
        (params) =>
          params.requestId === requestId &&
          params.response.opcode === 1 &&
          params.response.payloadData === `client-text:${token}`
      )
      const binaryPayload = BINARY_WEBSOCKET_PAYLOAD.toString('base64')
      const binarySent = await harness.client.waitForEvent(
        'Network.webSocketFrameSent',
        (params) =>
          params.requestId === requestId &&
          params.response.opcode === 2 &&
          params.response.payloadData === binaryPayload
      )
      const binaryReceived = await harness.client.waitForEvent(
        'Network.webSocketFrameReceived',
        (params) =>
          params.requestId === requestId &&
          params.response.opcode === 2 &&
          params.response.payloadData === binaryPayload
      )
      const closed = await harness.client.waitForEvent(
        'Network.webSocketClosed',
        (params) => params.requestId === requestId
      )
      const result = await scenarioPromise
      const extensionHeader = Object.entries(handshake.message.params.response.headers).find(
        ([name]) => name.toLowerCase() === 'sec-websocket-extensions'
      )?.[1]

      assert.equal(handshake.message.params.response.status, 101)
      assert.match(String(extensionHeader), /permessage-deflate/)
      assert.ok(created.sequence < willSend.sequence)
      assert.ok(willSend.sequence < handshake.sequence)
      assert.ok(handshake.sequence < textSent.sequence)
      assert.ok(textSent.sequence < textReceived.sequence)
      assert.ok(textReceived.sequence < binarySent.sequence)
      assert.ok(binarySent.sequence < binaryReceived.sequence)
      assert.ok(binaryReceived.sequence < closed.sequence)
      assert.equal(result.textEcho, `client-text:${token}`)
      assert.equal(result.textEchoIsBinary, false)
      assert.equal(result.binaryEchoBase64, binaryPayload)
      assert.equal(result.binaryEchoIsBinary, true)
      assert.equal(result.extensions, 'permessage-deflate')
      assert.equal(result.close.code, 1000)
      assert.equal(
        harness.client.findEvents(
          'Network.loadingFailed',
          (params) => params.requestId === requestId
        ).length,
        0,
        'a successful WebSocket upgrade must not also report HTTP loadingFailed'
      )
    })
  }
)

test(
  'Legacy concurrent requests retain stable distinct request ids',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    await withLegacyHarness(t, { consumer: 'esm' }, async (harness) => {
      const token = harness.createToken('concurrent')
      const urls = Array.from({ length: 20 }, (_value, index) =>
        harness.url('/concurrent', token, { index })
      )
      const requestPromises = urls.map((url) =>
        eventForUrl(harness.client, 'Network.requestWillBeSent', url)
      )
      const scenarioPromise = harness.runScenario('concurrent', { urls, token })
      const requests = await Promise.all(requestPromises)
      const terminals = await Promise.all(
        requests.map(async (request) => {
          const requestId = request.message.params.requestId
          const response = await harness.client.waitForEvent(
            'Network.responseReceived',
            (params) => params.requestId === requestId
          )
          const finished = await harness.client.waitForEvent(
            'Network.loadingFinished',
            (params) => params.requestId === requestId
          )
          assertSuccessfulLifecycle(request, response, finished)
          return requestId
        })
      )
      const results = await scenarioPromise

      assert.equal(new Set(terminals).size, urls.length)
      assert.equal(results.length, urls.length)
      assert.ok(results.every((result) => result.status === 200))
    })
  }
)

test(
  'Legacy works through the built CommonJS public package consumer',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    await withLegacyHarness(t, { consumer: 'cjs' }, async (harness) => {
      assert.equal(harness.sessionInfo.mode, 'legacy')
      const token = harness.createToken('cjs')
      const exchange = await successfulExchange(harness, 'http-get', {
        url: harness.url('/get', token),
        token
      })
      assert.equal(exchange.response.message.params.response.status, 200)
      const body = await responseBody(harness, exchange.request.message.params.requestId)
      assert.equal(decodeBody(body).toString('utf8'), `get-response:${token}`)
    })
  }
)

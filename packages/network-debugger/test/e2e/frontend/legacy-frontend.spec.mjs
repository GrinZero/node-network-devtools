import { mkdir } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

import { CdpClient } from '../harness/cdp-client.mjs'
import { LegacyE2EHarness } from '../legacy/legacy-harness.mjs'
import { ChromiumDevToolsFrontend } from './chromium-devtools.mjs'

async function expectConnected(frontend) {
  await expect
    .poll(() => frontend.targetState(), {
      message: 'the official frontend should have one live Legacy Node target'
    })
    .toMatchObject({
      connected: true,
      targetCount: 1,
      type: 'node',
      suspended: false
    })
}

function eventForUrl(client, method, url) {
  return client.waitForEvent(method, (params) => {
    const eventUrl = params.request?.url ?? params.response?.url ?? params.url
    return eventUrl === url
  })
}

function decodeBody(result) {
  return result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body
}

async function attachJournal(testInfo, name, client) {
  await mkdir(testInfo.outputDir, { recursive: true })
  const path = testInfo.outputPath(name)
  await client.writeJournal(path)
  await testInfo.attach(name, { path, contentType: 'application/x-ndjson' })
}

async function exerciseFetch(frontend, legacyHarness, secondClient, label) {
  const token = legacyHarness.createToken(label)
  const url = legacyHarness.url('/post', token)
  const requestPromise = eventForUrl(legacyHarness.client, 'Network.requestWillBeSent', url)
  const scenarioPromise = legacyHarness.runScenario('fetch-post', { url, token })
  const request = await requestPromise
  const scenario = await scenarioPromise

  await expect
    .poll(() => frontend.requestState(url), {
      message: 'the official DevTools Network model should finish the Legacy request'
    })
    .toMatchObject({
      found: true,
      finished: true,
      method: 'POST',
      mimeType: 'application/json',
      statusCode: 201,
      url
    })

  await expect(frontend.page.getByText(token, { exact: false }).first()).toBeVisible()

  // Both raw clients started at command id 1. Issue different commands with
  // the same next id while the official frontend is also requesting content.
  // A broadcast or incorrectly routed response makes one of these assertions
  // fail immediately.
  const frontendBodyPromise = frontend.requestBody(url)
  const rawBodyPromise = legacyHarness.client.command('Network.getResponseBody', {
    requestId: request.message.params.requestId
  })
  const secondClientErrorPromise = secondClient
    .command('NodeNetworkDevtools.frontendMultiClientProbe')
    .then(
      () => undefined,
      (error) => error
    )
  const [content, rawBody, secondClientError] = await Promise.all([
    frontendBodyPromise,
    rawBodyPromise,
    secondClientErrorPromise
  ])

  expect(secondClientError?.cdpError?.code).toBe(-32601)
  expect(secondClientError.cdpResponse.id).toBe(rawBody.request.id)
  expect(rawBody.response.id).toBe(rawBody.request.id)
  expect(content.error).toBeUndefined()
  expect(content.mimeType).toBe('application/json')
  expect(content.charset).toBe('utf-8')

  const expected = {
    token,
    requestBody: `fetch-request:${token}`
  }
  expect(JSON.parse(content.text)).toEqual(expected)
  expect(JSON.parse(decodeBody(rawBody.result))).toEqual(expected)
  expect(JSON.parse(scenario.body)).toEqual(expected)
}

test('official Chromium DevTools frontend displays Legacy requests across reload and isolates clients', async ({}, testInfo) => {
  const legacyHarness = new LegacyE2EHarness({ consumer: 'esm' })
  let frontend
  let secondClient
  let failure

  try {
    await legacyHarness.start()
    secondClient = new CdpClient(legacyHarness.sessionInfo.target.webSocketDebuggerUrl)
    await secondClient.connect()
    const secondEnable = await secondClient.command('Network.enable')
    expect(secondEnable.response.id).toBe(secondEnable.request.id)

    frontend = new ChromiumDevToolsFrontend(legacyHarness.sessionInfo.target.webSocketDebuggerUrl, {
      backend: 'legacy'
    })
    await frontend.start()
    await expect(frontend.page).toHaveTitle(/DevTools/)
    const inspectorSocket = legacyHarness.sessionInfo.target.webSocketDebuggerUrl.replace(
      /^ws:\/\//,
      ''
    )
    expect(new URL(frontend.page.url()).searchParams.get('ws')).toBe(inspectorSocket)
    await expectConnected(frontend)

    await exerciseFetch(frontend, legacyHarness, secondClient, 'legacy-frontend-initial')

    await frontend.reload()
    await expect(frontend.page).toHaveTitle(/DevTools/)
    expect(new URL(frontend.page.url()).searchParams.get('ws')).toBe(inspectorSocket)
    await expectConnected(frontend)
    await exerciseFetch(frontend, legacyHarness, secondClient, 'legacy-frontend-reconnected')

    frontend.assertNoUnexpectedErrors()
    await frontend.captureEvidence(testInfo, 'legacy-devtools')
    await attachJournal(testInfo, 'legacy-primary-cdp.ndjson', legacyHarness.client)
    await attachJournal(testInfo, 'legacy-secondary-cdp.ndjson', secondClient)
  } catch (error) {
    failure = error
    await frontend?.captureFailure(testInfo, error, legacyHarness).catch(() => {})
    if (secondClient) {
      await attachJournal(testInfo, 'legacy-secondary-cdp.ndjson', secondClient).catch(() => {})
    }
    await legacyHarness.writeFailureArtifacts(error).catch(() => undefined)
    throw error
  } finally {
    const cleanupErrors = []
    await frontend?.close().catch((error) => cleanupErrors.push(error))
    await secondClient?.close().catch((error) => cleanupErrors.push(error))
    await legacyHarness.close().catch((error) => cleanupErrors.push(error))
    if (!failure && cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, 'Legacy frontend E2E cleanup failed')
    }
  }
})

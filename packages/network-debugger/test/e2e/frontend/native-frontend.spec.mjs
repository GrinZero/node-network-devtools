import { expect, test } from '@playwright/test'

import { NativeE2EHarness } from '../harness/native-harness.mjs'
import { ChromiumDevToolsFrontend } from './chromium-devtools.mjs'

async function expectConnected(frontend) {
  await expect
    .poll(() => frontend.targetState(), {
      message: 'the official frontend should have a live Node target'
    })
    .toMatchObject({
      connected: true,
      targetCount: 1,
      type: 'node',
      suspended: false
    })
}

async function exerciseFetch(frontend, nativeHarness, label) {
  const token = nativeHarness.createToken(label)
  const url = nativeHarness.url('/fetch', token)
  const scenario = await nativeHarness.runScenario('fetch', { url, token })

  await expect
    .poll(() => frontend.requestState(url), {
      message: 'the official DevTools Network model should finish the Native request'
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

  const content = await frontend.requestBody(url)
  expect(content.error).toBeUndefined()
  expect(content.mimeType).toBe('application/json')
  expect(content.charset).toBe('utf-8')
  expect(JSON.parse(content.text)).toEqual({
    token,
    requestBody: `fetch-request:${token}`
  })
  expect(JSON.parse(scenario.body)).toEqual(JSON.parse(content.text))
}

test('official Chromium DevTools frontend displays Native requests before and after reconnecting', async ({}, testInfo) => {
  const nativeHarness = new NativeE2EHarness()
  let frontend
  let failure

  try {
    await nativeHarness.start()
    // Construct before starting so launch failures still retain Chromium logs,
    // screenshots/traces where available, and the Native CDP journal.
    frontend = new ChromiumDevToolsFrontend(nativeHarness.inspectorUrl)
    await frontend.start()
    await expect(frontend.page).toHaveTitle(/DevTools/)
    const inspectorSocket = nativeHarness.inspectorUrl.replace(/^ws:\/\//, '')
    expect(new URL(frontend.page.url()).searchParams.get('ws')).toBe(inspectorSocket)
    await expectConnected(frontend)

    await exerciseFetch(frontend, nativeHarness, 'frontend-initial')

    await frontend.reload()
    await expect(frontend.page).toHaveTitle(/DevTools/)
    expect(new URL(frontend.page.url()).searchParams.get('ws')).toBe(inspectorSocket)
    await expectConnected(frontend)
    await exerciseFetch(frontend, nativeHarness, 'frontend-reconnected')
    frontend.assertNoUnexpectedErrors()
  } catch (error) {
    failure = error
    await frontend?.captureFailure(testInfo, error, nativeHarness).catch(() => {})
    throw error
  } finally {
    const cleanupErrors = []
    await frontend?.close().catch((error) => cleanupErrors.push(error))
    await nativeHarness.close().catch((error) => cleanupErrors.push(error))
    if (!failure && cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, 'Frontend E2E cleanup failed')
    }
  }
})

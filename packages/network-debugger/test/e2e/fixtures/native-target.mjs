import http from 'node:http'
import https from 'node:https'

const entryUrl = process.env.NETWORK_DEBUGGER_E2E_ENTRY
if (!entryUrl) throw new Error('NETWORK_DEBUGGER_E2E_ENTRY is required')
if (!process.send) throw new Error('Native E2E target must be started with an IPC channel')

const originalNetworkFunctions = {
  fetch: globalThis.fetch,
  httpRequest: http.request,
  httpsRequest: https.request
}

const { register } = await import(entryUrl)
if (typeof register !== 'function')
  throw new Error(`No public register() export found at ${entryUrl}`)

const handle = register({
  mode: 'native',
  autoOpenDevtool: false,
  ...(process.env.NETWORK_DEBUGGER_E2E_SESSION_DIR
    ? {
        session: {
          directory: process.env.NETWORK_DEBUGGER_E2E_SESSION_DIR,
          har: true
        }
      }
    : {})
})

if (typeof handle !== 'function' || !handle.ready || typeof handle.dispose !== 'function') {
  throw new Error('register({ mode: "native" }) did not return the public callable session handle')
}

const sessionInfo = await handle.ready
if (sessionInfo.mode !== 'native') {
  throw new Error(`Expected native adapter, received ${sessionInfo.mode}`)
}

function send(message) {
  return new Promise((resolve, reject) => {
    process.send(message, (error) => (error ? reject(error) : resolve()))
  })
}

function performHttpGet(url, token) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers: { 'x-e2e-token': token } }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.once('error', reject)
      response.once('end', () => {
        resolve({
          status: response.statusCode,
          body: Buffer.concat(chunks).toString('utf8')
        })
      })
    })
    request.once('error', reject)
  })
}

async function performFetchPost(url, token) {
  const requestBody = `fetch-request:${token}`
  const request = new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-e2e-token': token
    },
    body: requestBody
  })
  const response = await fetch(request)
  return {
    status: response.status,
    body: await response.text(),
    requestBody
  }
}

async function performFailedRequest(url, token) {
  try {
    await performHttpGet(url, token)
  } catch (error) {
    return { failed: true, error: String(error) }
  }
  throw new Error('Expected the reset endpoint to fail the HTTP request')
}

async function runScenario(message) {
  switch (message.scenario) {
    case 'http':
      return performHttpGet(message.url, message.token)
    case 'fetch':
      return performFetchPost(message.url, message.token)
    case 'failed':
      return performFailedRequest(message.url, message.token)
    default:
      throw new Error(`Unknown E2E scenario: ${message.scenario}`)
  }
}

process.on('message', async (message) => {
  if (message?.type === 'run') {
    try {
      const result = await runScenario(message)
      await send({ type: 'scenario-result', id: message.id, ok: true, result })
    } catch (error) {
      await send({
        type: 'scenario-result',
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.stack : String(error)
      })
    }
    return
  }

  if (message?.type === 'finalize-session') {
    try {
      await handle.dispose()
      await send({
        type: 'session-finalized',
        id: message.id,
        ok: true,
        result: sessionInfo.session
      })
    } catch (error) {
      await send({
        type: 'session-finalized',
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.stack : String(error)
      })
    }
    return
  }

  if (message?.type === 'shutdown') {
    try {
      await handle.dispose()
      await send({ type: 'shutdown-complete' })
    } finally {
      process.removeAllListeners('message')
      process.disconnect()
    }
  }
})

await send({
  type: 'ready',
  pid: process.pid,
  sessionInfo,
  nativeFunctionsUnchanged: {
    fetch: globalThis.fetch === originalNetworkFunctions.fetch,
    httpRequest: http.request === originalNetworkFunctions.httpRequest,
    httpsRequest: https.request === originalNetworkFunctions.httpsRequest
  }
})

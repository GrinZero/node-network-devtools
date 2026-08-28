import http from 'node:http'
import { pathToFileURL } from 'node:url'

const entryPath = process.env.NETWORK_DEBUGGER_E2E_ENTRY
const originBaseUrl = process.env.NETWORK_DEBUGGER_E2E_ORIGIN
const sessionDirectory = process.env.NETWORK_DEBUGGER_E2E_SESSION_DIR

if (!entryPath) throw new Error('NETWORK_DEBUGGER_E2E_ENTRY is required')
if (!originBaseUrl) throw new Error('NETWORK_DEBUGGER_E2E_ORIGIN is required')
if (!sessionDirectory) throw new Error('NETWORK_DEBUGGER_E2E_SESSION_DIR is required')

const api = await import(pathToFileURL(entryPath).href)
for (const name of ['register', 'SessionRecorder', 'exportHar', 'replay']) {
  if (api[name] === undefined) throw new Error(`No public ${name} export found at ${entryPath}`)
}

const mockRules = [
  {
    id: 'e2e-http-mock',
    match: { url: `${originBaseUrl}/mock-http*`, method: 'GET' },
    response: {
      status: 207,
      statusText: 'Mock HTTP',
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-mock-kind': 'http' },
      body: 'legacy-http-mock-body'
    }
  },
  {
    id: 'e2e-fetch-mock',
    match: {
      url: `${originBaseUrl}/mock-fetch*`,
      method: 'POST',
      headers: { 'x-mock-match': 'fetch' }
    },
    response: {
      status: 202,
      statusText: 'Mock Fetch',
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-mock-kind': 'fetch' },
      body: 'legacy-fetch-mock-body'
    }
  }
]

const registration = api.register({
  mode: 'legacy',
  devtools: { open: false },
  legacy: { serverPort: 0, mock: mockRules }
})
const ready = await registration.ready
if (ready.mode !== 'legacy') throw new Error(`Expected Legacy, received ${ready.mode}`)

const recorder = await api.SessionRecorder.start({
  directory: sessionDirectory,
  target: ready.target
})

function send(message) {
  return new Promise((resolve, reject) => {
    if (!process.send) {
      reject(new Error('Enhancements consumer lost its IPC channel'))
      return
    }
    process.send(message, (error) => (error ? reject(error) : resolve()))
  })
}

function httpRequest(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.once('error', reject)
      response.once('end', () => {
        resolve({
          status: response.statusCode,
          statusText: response.statusMessage,
          headers: response.headers,
          bodyBase64: Buffer.concat(chunks).toString('base64')
        })
      })
    })
    request.once('error', reject)
    request.end(body)
  })
}

function waitForTerminal(url, operation, timeoutMs = 10_000) {
  let requestId
  let unsubscribe = () => {}
  let timer
  const terminal = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Timed out waiting for a recorded lifecycle: ${url}`))
    }, timeoutMs)
    unsubscribe = recorder.tap.onEvent((event) => {
      if (event.method === 'Network.requestWillBeSent' && event.params?.request?.url === url) {
        requestId = event.params.requestId
        return
      }
      if (!requestId || event.params?.requestId !== requestId) return
      if (event.method === 'Network.loadingFailed') {
        clearTimeout(timer)
        unsubscribe()
        reject(
          new Error(
            `Recorded request failed for ${url}: ${event.params?.errorText ?? 'unknown error'}`
          )
        )
      } else if (event.method === 'Network.loadingFinished') {
        clearTimeout(timer)
        unsubscribe()
        resolve({ requestId, terminalMethod: event.method })
      }
    })
  })

  return Promise.all([Promise.resolve().then(operation), terminal]).then(([result, lifecycle]) => ({
    result,
    ...lifecycle
  }))
}

async function runScenario(message) {
  const url = message.url
  switch (message.scenario) {
    case 'http-text':
    case 'http-binary':
    case 'http-plain':
    case 'mock-http':
      return waitForTerminal(url, () => httpRequest(url, { headers: message.headers ?? {} }))
    case 'fetch-post':
    case 'mock-fetch':
      return waitForTerminal(url, async () => {
        const response = await fetch(url, {
          method: 'POST',
          headers: message.headers ?? {},
          body: message.body
        })
        return {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers),
          body: await response.text()
        }
      })
    default:
      throw new Error(`Unknown enhancements E2E scenario: ${message.scenario}`)
  }
}

let finalized = false
async function finalizeSession() {
  if (finalized) throw new Error('Enhancements session was already finalized')
  finalized = true
  await recorder.close()
  const exported = await api.exportHar(sessionDirectory)
  const dryRun = await api.replay(sessionDirectory, { dryRun: true })
  const realReplay = await api.replay(exported.outputPath, { timeoutMs: 5_000 })
  return {
    manifest: recorder.getManifest(),
    harPath: exported.outputPath,
    dryRun,
    realReplay
  }
}

async function shutdown() {
  if (!finalized) await recorder.close()
  await registration.dispose()
}

if (!process.send) throw new Error('Enhancements consumer must be started with process IPC')

const onMessage = async (message) => {
  if (!message || typeof message !== 'object' || typeof message.id !== 'string') return
  try {
    let result
    if (message.type === 'run') result = await runScenario(message)
    else if (message.type === 'finalize') result = await finalizeSession()
    else if (message.type === 'shutdown') {
      process.off('message', onMessage)
      await shutdown()
      await send({ type: 'command-result', id: message.id, ok: true, result: {} })
      process.disconnect()
      return
    } else {
      throw new Error(`Unknown enhancements E2E command: ${message.type}`)
    }
    await send({ type: 'command-result', id: message.id, ok: true, result })
  } catch (error) {
    await send({
      type: 'command-result',
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.stack : String(error)
    })
  }
}

process.on('message', onMessage)
await send({ type: 'ready', pid: process.pid, sessionInfo: ready })

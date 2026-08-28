import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const backend = process.argv[2]
if (!['native', 'legacy'].includes(backend)) {
  throw new Error('Usage: node manual-evidence-server.mjs <native|legacy>')
}

const consumerRoot = resolve(
  process.env.NND_MANUAL_CONSUMER_ROOT ?? new URL('./consumer', import.meta.url).pathname
)
const evidenceRoot = resolve(
  process.env.NND_MANUAL_EVIDENCE_ROOT ?? new URL('.', import.meta.url).pathname
)
const productCommit = process.env.NND_MANUAL_PRODUCT_COMMIT ?? 'unknown'
const tarballSha256 = process.env.NND_MANUAL_TARBALL_SHA256 ?? 'unknown'
const runtimeRoot = join(evidenceRoot, '.runtime')
const artifactsRoot = join(evidenceRoot, 'artifacts')
const sessionDirectory = join(runtimeRoot, `${backend}-session-${Date.now()}`)
const manualRequire = createRequire(join(consumerRoot, 'consumer.cjs'))
const workspaceRequire = createRequire(
  new URL('../../../packages/network-debugger/package.json', import.meta.url)
)
const api = manualRequire('node-network-devtools')
const { chromium } = workspaceRequire('@playwright/test')
const WebSocket = manualRequire('ws')
const { WebSocketServer } = WebSocket
const packageDirectory = resolve(dirname(manualRequire.resolve('node-network-devtools')), '..')
const packageManifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'))
const { register, SessionRecorder, exportHar, replay } = api

for (const [name, value] of Object.entries({
  register,
  SessionRecorder,
  exportHar,
  replay
})) {
  if (typeof value !== 'function') {
    throw new Error(`The exact packed package does not export ${name}`)
  }
}

await mkdir(runtimeRoot, { recursive: true })
await mkdir(artifactsRoot, { recursive: true })

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

const pathRedactions = [
  [consumerRoot, '<isolated-consumer>'],
  [evidenceRoot, '<evidence-root>']
]

function redactText(value) {
  return pathRedactions.reduce(
    (redacted, [path, replacement]) => redacted.replaceAll(path, replacement),
    value
  )
}

function redactEvidence(value) {
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map(redactEvidence)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [name, redactEvidence(entry)])
    )
  }
  return value
}

function jsonResponse(response, status, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  })
  response.end(body)
}

function listen(server) {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Server did not expose a TCP address'))
        return
      }
      resolvePromise(address.port)
    })
  })
}

function closeServer(server, sockets) {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolvePromise) => {
    server.close(() => resolvePromise())
    for (const socket of sockets) socket.destroy()
  })
}

function httpRequest(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolvePromise, reject) => {
    const secure = new URL(url).protocol === 'https:'
    const request = (secure ? https : http).request(
      url,
      { method, headers, ...(secure ? { rejectUnauthorized: false } : {}) },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        response.once('error', reject)
        response.once('end', () => {
          resolvePromise({
            status: response.statusCode,
            statusText: response.statusMessage,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8')
          })
        })
      }
    )
    request.once('error', reject)
    request.end(body)
  })
}

function webSocketRoundTrip(url, token) {
  return new Promise((resolvePromise, reject) => {
    const socket = new WebSocket(url)
    const messages = []
    socket.once('error', reject)
    socket.once('open', () => {
      socket.send(`client-text:${token}`)
      socket.send(Buffer.from([0, 1, 2, 127, 128, 254, 255]))
    })
    socket.on('message', (data, isBinary) => {
      messages.push({
        isBinary,
        value: isBinary ? Buffer.from(data).toString('base64') : Buffer.from(data).toString('utf8')
      })
      if (messages.length === 2) socket.close(1000, 'manual-evidence-complete')
    })
    socket.once('close', (code, reason) =>
      resolvePromise({ code, reason: reason.toString(), messages })
    )
  })
}

function nativeWebSocketRoundTrip(url, token) {
  return new Promise((resolvePromise, reject) => {
    const socket = new globalThis.WebSocket(url)
    socket.binaryType = 'arraybuffer'
    const messages = []
    socket.addEventListener('error', () => reject(new Error('Native WebSocket failed')))
    socket.addEventListener('open', () => {
      socket.send(`client-text:${token}`)
      socket.send(new Uint8Array([0, 1, 2, 127, 128, 254, 255]))
    })
    socket.addEventListener('message', (event) => {
      const isBinary = typeof event.data !== 'string'
      const value = isBinary ? Buffer.from(event.data).toString('base64') : event.data
      messages.push({ isBinary, value })
      if (messages.length === 2) socket.close(1000, 'manual-evidence-complete')
    })
    socket.addEventListener('close', (event) =>
      resolvePromise({ code: event.code, reason: event.reason, messages })
    )
  })
}

const originSockets = new Set()
const originRecords = []
const webSocketServer = new WebSocketServer({ noServer: true })
const originServer = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? '127.0.0.1'}`)
  const chunks = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const requestBody = Buffer.concat(chunks).toString('utf8')
  const record = {
    sequence: originRecords.length + 1,
    timestamp: new Date().toISOString(),
    method: request.method,
    pathname: url.pathname,
    url: url.href,
    requestBody,
    traceparent: request.headers.traceparent ?? null,
    tracestate: request.headers.tracestate ?? null
  }
  originRecords.push(record)
  const token = url.searchParams.get('token') ?? ''

  if (url.pathname === '/get') {
    const body = `manual-get-response:${token}`
    response.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'x-manual-case': token
    })
    response.end(body)
    return
  }

  if (url.pathname === '/post') {
    const body = JSON.stringify({ token, requestBody })
    response.writeHead(201, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'x-manual-case': token
    })
    response.end(body)
    return
  }

  if (url.pathname === '/sse') {
    const body = `id: 1\nevent: manual\ndata: sse-${token}\n\nid: 2\ndata: complete-${token}\n\n`
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-cache'
    })
    response.end(body)
    return
  }

  if (url.pathname === '/trace') {
    const body = JSON.stringify({
      token,
      traceparent: request.headers.traceparent,
      tracestate: request.headers.tracestate
    })
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body)
    })
    response.end(body)
    return
  }

  if (url.pathname === '/reset') {
    request.socket.destroy()
    return
  }

  if (url.pathname.startsWith('/mock-')) {
    const body = `ORIGIN_LEAK:${url.pathname}`
    response.writeHead(599, {
      'content-type': 'text/plain; charset=utf-8',
      'content-length': Buffer.byteLength(body)
    })
    response.end(body)
    return
  }

  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('not found')
})
originServer.on('connection', (socket) => {
  originSockets.add(socket)
  socket.once('close', () => originSockets.delete(socket))
})
originServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host ?? '127.0.0.1'}`)
  if (url.pathname !== '/websocket') {
    socket.destroy()
    return
  }
  originRecords.push({
    sequence: originRecords.length + 1,
    timestamp: new Date().toISOString(),
    method: request.method,
    pathname: url.pathname,
    url: url.href,
    requestBody: '',
    traceparent: null,
    tracestate: null
  })
  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    webSocketServer.emit('connection', webSocket, request)
  })
})
webSocketServer.on('connection', (socket) => {
  socket.on('message', (data, isBinary) => socket.send(data, { binary: isBinary }))
})
const originPort = await listen(originServer)
const originBaseUrl = `http://127.0.0.1:${originPort}`

const secureOriginSockets = new Set()
const secureOriginServer = https.createServer(
  {
    key: await readFile(new URL('./manual-localhost-key.pem', import.meta.url)),
    cert: await readFile(new URL('./manual-localhost-cert.pem', import.meta.url))
  },
  async (request, response) => {
    const url = new URL(request.url, `https://${request.headers.host ?? '127.0.0.1'}`)
    const chunks = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const requestBody = Buffer.concat(chunks).toString('utf8')
    const token = url.searchParams.get('token') ?? ''
    originRecords.push({
      sequence: originRecords.length + 1,
      timestamp: new Date().toISOString(),
      method: request.method,
      pathname: url.pathname,
      url: url.href,
      requestBody,
      traceparent: request.headers.traceparent ?? null,
      tracestate: request.headers.tracestate ?? null
    })
    if (url.pathname !== '/secure-get') {
      response.writeHead(404).end('not found')
      return
    }
    const body = `manual-https-response:${token}`
    response.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'x-manual-case': token
    })
    response.end(body)
  }
)
secureOriginServer.on('connection', (socket) => {
  secureOriginSockets.add(socket)
  socket.once('close', () => secureOriginSockets.delete(socket))
})
const secureOriginPort = await listen(secureOriginServer)
const secureOriginBaseUrl = `https://127.0.0.1:${secureOriginPort}`

const mockRules = [
  {
    id: 'manual-http-mock',
    match: { url: `${originBaseUrl}/mock-http*`, method: 'GET' },
    response: {
      status: 207,
      statusText: 'Manual Mock HTTP',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-nnd-mock': 'http'
      },
      body: JSON.stringify({ mocked: true, transport: 'http', source: 'node-network-devtools' })
    }
  },
  {
    id: 'manual-fetch-mock',
    match: {
      url: `${originBaseUrl}/mock-fetch*`,
      method: 'POST',
      headers: { 'x-manual-mock': 'fetch' }
    },
    response: {
      status: 202,
      statusText: 'Manual Mock Fetch',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-nnd-mock': 'fetch'
      },
      body: JSON.stringify({ mocked: true, transport: 'fetch', source: 'node-network-devtools' })
    }
  }
]

const originalFunctions = {
  fetch: globalThis.fetch,
  httpRequest: http.request,
  httpsRequest: https.request
}
const registration = register({
  mode: backend === 'legacy' ? 'auto' : 'native',
  inspector: { host: '127.0.0.1', port: 0 },
  devtools: { open: false },
  legacy: {
    serverPort: 0,
    ...(backend === 'legacy' ? { mock: mockRules } : {})
  }
})
const ready = await registration.ready
if (ready.mode !== backend) {
  throw new Error(`Expected ${backend}, selected ${ready.mode}`)
}
const discoveryUrl = new URL(ready.target.discoveryUrl)
const [discovery, discoveryVersion, discoveryProtocol] = await Promise.all([
  fetch(discoveryUrl).then((response) => response.json()),
  fetch(new URL('/json/version', discoveryUrl)).then((response) => response.json()),
  fetch(new URL('/json/protocol', discoveryUrl)).then((response) => response.json())
])
if (!Array.isArray(discovery) || !discovery.some((target) => target.id === ready.target.id)) {
  throw new Error(`Target ${ready.target.id} is absent from discovery`)
}
const networkDomain = discoveryProtocol.domains?.find(
  (domain) => (domain.name ?? domain.domain) === 'Network'
)
if (!networkDomain) throw new Error('/json/protocol does not expose the Network domain')
const discoveryContract = {
  list: {
    ok: true,
    targetCount: discovery.length,
    targetIdMatches: discovery.some((target) => target.id === ready.target.id)
  },
  version: {
    ok: true,
    browser: discoveryVersion.Browser ?? discoveryVersion.browser ?? null,
    protocolVersion:
      discoveryVersion['Protocol-Version'] ?? discoveryVersion.protocolVersion ?? null
  },
  protocol: {
    ok: true,
    domainCount: discoveryProtocol.domains.length,
    networkDomain: true,
    networkCommandCount: networkDomain.commands?.length ?? 0,
    networkEventCount: networkDomain.events?.length ?? 0
  }
}
const recorder = await SessionRecorder.start({
  directory: sessionDirectory,
  target: ready.target
})

const chromiumUserData = await mkdtemp(join(runtimeRoot, `${backend}-chromium-`))
const chromiumOutput = { stdout: '', stderr: '' }
const chromiumProcess = spawn(
  chromium.executablePath(),
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${chromiumUserData}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--no-proxy-server',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-extensions',
    '--disable-sync',
    '--metrics-recording-only',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] }
)
chromiumProcess.stdout.setEncoding('utf8')
chromiumProcess.stderr.setEncoding('utf8')
chromiumProcess.stdout.on('data', (chunk) => (chromiumOutput.stdout += chunk))
chromiumProcess.stderr.on('data', (chunk) => (chromiumOutput.stderr += chunk))

const browserWebSocketUrl = await new Promise((resolvePromise, reject) => {
  const timeout = setTimeout(
    () => reject(new Error(`Chromium did not expose CDP:\n${chromiumOutput.stderr}`)),
    10_000
  )
  const onData = () => {
    const match = chromiumOutput.stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
    if (!match) return
    clearTimeout(timeout)
    chromiumProcess.stderr.off('data', onData)
    resolvePromise(match[1])
  }
  chromiumProcess.stderr.on('data', onData)
  chromiumProcess.once('exit', (code, signal) => {
    clearTimeout(timeout)
    reject(new Error(`Chromium exited before CDP (code=${code}, signal=${signal})`))
  })
})
const frontendHost = new URL(browserWebSocketUrl).host
const targetSocket = ready.target.webSocketDebuggerUrl.replace(/^ws:\/\//, '')
const frontendUrl =
  `http://${frontendHost}/devtools/js_app.html?experiments=true&v8only=true` +
  `&ws=${targetSocket}&hl=en-US`

let scenarioCounter = 0
let finalized
let disposed
const scenarioResults = []

function scenarioToken(scenario) {
  scenarioCounter += 1
  return `${backend}-${scenario}-${String(scenarioCounter).padStart(2, '0')}`
}

async function runScenario(scenario) {
  const token = scenarioToken(scenario)
  let result
  switch (scenario) {
    case 'http-get':
      result = await httpRequest(`${originBaseUrl}/get?token=${encodeURIComponent(token)}`)
      break
    case 'https-get':
      result = await httpRequest(
        `${secureOriginBaseUrl}/secure-get?token=${encodeURIComponent(token)}`
      )
      break
    case 'fetch-post': {
      const response = await fetch(`${originBaseUrl}/post?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain; charset=utf-8', 'x-manual-case': token },
        body: `manual-request-body:${token}`
      })
      result = {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text()
      }
      break
    }
    case 'mock-http':
      if (backend !== 'legacy') throw new Error('Mock is Legacy-only')
      result = await httpRequest(`${originBaseUrl}/mock-http?token=${encodeURIComponent(token)}`)
      break
    case 'mock-fetch': {
      if (backend !== 'legacy') throw new Error('Mock is Legacy-only')
      const response = await fetch(
        `${originBaseUrl}/mock-fetch?token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'text/plain', 'x-manual-mock': 'fetch' },
          body: `must-not-reach-origin:${token}`
        }
      )
      result = {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text()
      }
      break
    }
    case 'trace': {
      const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
      const tracestate = 'vendor=manual-pr64'
      result = await httpRequest(`${originBaseUrl}/trace?token=${encodeURIComponent(token)}`, {
        headers: { traceparent, tracestate }
      })
      break
    }
    case 'failed': {
      let failure
      try {
        await httpRequest(`${originBaseUrl}/reset?token=${encodeURIComponent(token)}`)
      } catch (error) {
        failure = error
      }
      if (!failure) throw new Error('Reset request unexpectedly completed')
      result = {
        failed: true,
        code: failure instanceof Error && 'code' in failure ? failure.code : null,
        message: failure instanceof Error ? failure.message : String(failure)
      }
      break
    }
    case 'sse': {
      const response = await fetch(`${originBaseUrl}/sse?token=${encodeURIComponent(token)}`)
      result = { status: response.status, body: await response.text() }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
      break
    }
    case 'websocket':
      result = await (backend === 'native' ? nativeWebSocketRoundTrip : webSocketRoundTrip)(
        `${originBaseUrl.replace(/^http/, 'ws')}/websocket?token=${encodeURIComponent(token)}`,
        token
      )
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
      break
    default:
      throw new Error(`Unknown manual scenario: ${scenario}`)
  }

  const entry = {
    scenario,
    token,
    result,
    originLeakCount: originRecords.filter((record) => record.pathname.startsWith('/mock-')).length
  }
  scenarioResults.push(entry)
  return entry
}

async function finalizeSession() {
  if (finalized) return finalized
  await recorder.close()
  const exported = await exportHar(sessionDirectory)
  const manifest = JSON.parse(await readFile(join(sessionDirectory, 'manifest.json'), 'utf8'))
  const events = (await readFile(join(sessionDirectory, 'events.ndjson'), 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const har = exported.har
  const requestForPath = (pathname) =>
    events.find((event) => {
      if (event.method !== 'Network.requestWillBeSent') return false
      try {
        return new URL(event.params.request.url).pathname === pathname
      } catch {
        return false
      }
    })
  const failedRequest = requestForPath('/reset')
  const failedRequestId = failedRequest?.params.requestId
  const failedMethods = failedRequestId
    ? events
        .filter((event) => event.params?.requestId === failedRequestId)
        .map((event) => event.method)
    : []
  const webSocketCreated = events.filter((event) => {
    if (event.method !== 'Network.webSocketCreated') return false
    try {
      return new URL(event.params.url).pathname === '/websocket'
    } catch {
      return false
    }
  })
  const webSocketRequestIds = new Set(webSocketCreated.map((event) => event.params.requestId))
  const webSocketMethods = events
    .filter((event) => webSocketRequestIds.has(event.params?.requestId))
    .map((event) => event.method)
  const sseRequest = requestForPath('/sse')
  const sseRequestId = sseRequest?.params.requestId
  const sseMessageCount = events.filter(
    (event) =>
      event.method === 'Network.eventSourceMessageReceived' &&
      event.params?.requestId === sseRequestId
  ).length
  const explicitTraceRecords = originRecords.filter((record) => record.pathname === '/trace')
  const untracedRecords = originRecords.filter(
    (record) => !['/trace', '/websocket'].includes(record.pathname)
  )
  const manualAssertions = {
    discovery: discoveryContract,
    failedLifecycle: {
      requestId: failedRequestId ?? null,
      requestWillBeSent: failedMethods.filter((method) => method === 'Network.requestWillBeSent')
        .length,
      responseReceived: failedMethods.filter((method) => method === 'Network.responseReceived')
        .length,
      loadingFinished: failedMethods.filter((method) => method === 'Network.loadingFinished')
        .length,
      loadingFailed: failedMethods.filter((method) => method === 'Network.loadingFailed').length
    },
    webSocketBoundary: {
      lifecycleCreated: webSocketCreated.length,
      lifecycleClosed: webSocketMethods.filter((method) => method === 'Network.webSocketClosed')
        .length,
      framesSent: webSocketMethods.filter((method) => method === 'Network.webSocketFrameSent')
        .length,
      framesReceived: webSocketMethods.filter(
        (method) => method === 'Network.webSocketFrameReceived'
      ).length,
      expectedFrameCapture: backend === 'legacy'
    },
    sseBoundary: {
      requestCaptured: Boolean(sseRequestId),
      messageEvents: sseMessageCount,
      expectedMessageCapture: backend === 'legacy'
    },
    traceBoundary: {
      explicitTraceRequests: explicitTraceRecords.length,
      explicitTracePreserved: explicitTraceRecords.every(
        (record) =>
          record.traceparent === '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' &&
          record.tracestate === 'vendor=manual-pr64'
      ),
      untracedBusinessRequests: untracedRecords.length,
      untracedHeadersAbsent: untracedRecords.every(
        (record) => record.traceparent === null && record.tracestate === null
      )
    }
  }
  const assertionsPassed =
    manualAssertions.failedLifecycle.requestWillBeSent === 1 &&
    manualAssertions.failedLifecycle.responseReceived === 0 &&
    manualAssertions.failedLifecycle.loadingFinished === 0 &&
    manualAssertions.failedLifecycle.loadingFailed === 1 &&
    manualAssertions.webSocketBoundary.lifecycleCreated === 1 &&
    manualAssertions.webSocketBoundary.lifecycleClosed === 1 &&
    (backend === 'legacy'
      ? manualAssertions.webSocketBoundary.framesSent === 2 &&
        manualAssertions.webSocketBoundary.framesReceived === 2
      : manualAssertions.webSocketBoundary.framesSent === 0 &&
        manualAssertions.webSocketBoundary.framesReceived === 0) &&
    manualAssertions.sseBoundary.requestCaptured &&
    (backend === 'legacy'
      ? manualAssertions.sseBoundary.messageEvents === 2
      : manualAssertions.sseBoundary.messageEvents === 0) &&
    manualAssertions.traceBoundary.explicitTraceRequests === 1 &&
    manualAssertions.traceBoundary.explicitTracePreserved &&
    manualAssertions.traceBoundary.untracedHeadersAbsent
  if (!assertionsPassed) {
    throw new Error(`Manual boundary assertions failed: ${JSON.stringify(manualAssertions)}`)
  }
  const replayableHar = {
    ...har,
    log: {
      ...har.log,
      entries: har.log.entries.filter((entry) => {
        const url = entry.request?.url
        const status = entry.response?.status
        return (
          typeof url === 'string' &&
          url.startsWith(`${originBaseUrl}/`) &&
          Number.isInteger(status) &&
          status >= 200 &&
          status < 400
        )
      })
    }
  }
  const replayableHarPath = join(runtimeRoot, `${backend}-replayable.har`)
  await writeFile(replayableHarPath, `${JSON.stringify(replayableHar, null, 2)}\n`, 'utf8')
  const dryRun = await replay(replayableHarPath, { dryRun: true })
  const realReplay = await replay(replayableHarPath, { timeoutMs: 5_000 })
  const traceContexts = Object.values(manifest.traceIndex).flatMap((entry) => entry.spans)
  finalized = {
    sessionDirectory: redactText(sessionDirectory),
    manualAssertions: { passed: true, ...manualAssertions },
    manifest: {
      schemaVersion: manifest.schemaVersion,
      state: manifest.state,
      stats: manifest.stats,
      issues: manifest.issues,
      traceContexts
    },
    har: {
      version: har.log.version,
      creator: har.log.creator,
      entries: har.log.entries.length,
      statuses: har.log.entries.map((entry) => entry.response.status),
      replayableEntries: replayableHar.log.entries.length
    },
    replay: {
      dryRun: dryRun.dryRun,
      dryRunRequests: dryRun.results.length,
      dryRunPassed: dryRun.results.every((entry) => entry.ok),
      realRequests: realReplay.results.length,
      realPassed: realReplay.results.every((entry) => entry.ok)
    },
    originLeakCount: originRecords.filter((record) => record.pathname.startsWith('/mock-')).length
  }
  await Promise.all([
    writeFile(
      join(artifactsRoot, `${backend}-session-manifest.json`),
      redactText(await readFile(join(sessionDirectory, 'manifest.json'), 'utf8')),
      'utf8'
    ),
    writeFile(
      join(artifactsRoot, `${backend}-events.ndjson`),
      redactText(await readFile(join(sessionDirectory, 'events.ndjson'), 'utf8')),
      'utf8'
    ),
    writeFile(
      join(artifactsRoot, `${backend}-session.har`),
      redactText(await readFile(exported.outputPath, 'utf8')),
      'utf8'
    ),
    writeFile(
      join(artifactsRoot, `${backend}-replayable.har`),
      redactText(await readFile(replayableHarPath, 'utf8')),
      'utf8'
    ),
    writeFile(
      join(artifactsRoot, `${backend}-finalize-summary.json`),
      `${JSON.stringify(finalized, null, 2)}\n`,
      'utf8'
    )
  ])
  return finalized
}

async function endpointClosed(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(750) })
    return false
  } catch {
    return true
  }
}

async function disposeTarget() {
  if (disposed) return disposed
  if (!finalized) await finalizeSession()
  await registration.dispose()
  disposed = {
    registrationState: registration.status().state,
    discoveryClosed: await endpointClosed(ready.target.discoveryUrl),
    targetSocketClosed: await new Promise((resolvePromise) => {
      const socket = new WebSocket(ready.target.webSocketDebuggerUrl)
      const timer = setTimeout(() => {
        socket.terminate()
        resolvePromise(false)
      }, 750)
      socket.once('error', () => {
        clearTimeout(timer)
        resolvePromise(true)
      })
      socket.once('open', () => {
        clearTimeout(timer)
        socket.close()
        resolvePromise(false)
      })
    })
  }
  await writeFile(
    join(artifactsRoot, `${backend}-dispose-summary.json`),
    `${JSON.stringify(disposed, null, 2)}\n`,
    'utf8'
  )
  return disposed
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function controlPage(controlUrl) {
  const capabilities = Object.entries(ready.capabilities)
    .map(
      ([name, supported]) =>
        `<li><span>${escapeHtml(name)}</span><strong>${supported ? 'YES' : 'NO'}</strong></li>`
    )
    .join('')
  const legacyButtons =
    backend === 'legacy'
      ? `
      <button data-scenario="mock-http">Mock HTTP 207</button>
      <button data-scenario="mock-fetch">Mock Fetch 202</button>`
      : ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PR #64 manual evidence — ${backend}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #07111f; color: #eaf2ff; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 80% 0%, #153b5e 0, transparent 38%), #07111f; }
    main { width: min(1180px, calc(100% - 48px)); margin: 0 auto; padding: 36px 0 64px; }
    .eyebrow { color: #63d8ff; text-transform: uppercase; letter-spacing: .14em; font-size: 12px; font-weight: 800; }
    h1 { margin: 8px 0 6px; font-size: 36px; }
    .subtitle { color: #a9bbd1; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: 1.1fr .9fr; gap: 18px; }
    .card { background: rgba(13, 28, 47, .9); border: 1px solid #264765; border-radius: 16px; padding: 20px; box-shadow: 0 18px 50px rgba(0,0,0,.25); }
    h2 { font-size: 17px; margin: 0 0 14px; }
    dl { display: grid; grid-template-columns: 150px 1fr; gap: 9px 14px; margin: 0; font-size: 13px; }
    dt { color: #83a0bc; } dd { margin: 0; font-family: ui-monospace, SFMono-Regular, monospace; overflow-wrap: anywhere; }
    .badge { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 6px 11px; background: #0d513b; color: #8cf4bf; font-weight: 800; }
    .badge::before { content: ''; width: 8px; height: 8px; background: #47e79c; border-radius: 50%; box-shadow: 0 0 12px #47e79c; }
    ul { list-style: none; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    li { display: flex; justify-content: space-between; background: #0a1727; border-radius: 8px; padding: 8px 10px; font-size: 12px; }
    li strong { color: #65e6aa; }
    .actions { display: flex; flex-wrap: wrap; gap: 9px; }
    button, a.action { border: 1px solid #3b678f; color: #eaf2ff; background: #173653; padding: 10px 13px; border-radius: 9px; font: inherit; font-weight: 700; cursor: pointer; text-decoration: none; }
    button:hover, a.action:hover { background: #24547d; }
    button.secondary { background: #352b62; border-color: #6754a1; }
    button.danger { background: #5a2834; border-color: #98495d; }
    #result { min-height: 185px; max-height: 360px; overflow: auto; white-space: pre-wrap; font: 12px/1.55 ui-monospace, SFMono-Regular, monospace; background: #030a12; border-radius: 10px; padding: 14px; color: #b9f4d1; }
    .wide { grid-column: 1 / -1; }
    .proof { display: flex; gap: 12px; margin-top: 16px; color: #a9bbd1; font-size: 12px; }
    .proof span { padding: 7px 9px; border: 1px solid #27445f; border-radius: 7px; }
  </style>
</head>
<body>
<main>
  <div class="eyebrow">PR #64 · Manual acceptance evidence</div>
  <h1>Node Network Devtools v2 · ${backend.toUpperCase()}</h1>
  <p class="subtitle">Exact packed package, standard CDP discovery, real loopback business traffic.</p>
  <section class="grid">
    <article class="card">
      <h2>Runtime identity <span class="badge">READY</span></h2>
      <dl>
        <dt>Product commit</dt><dd>${escapeHtml(productCommit)}</dd>
        <dt>Package</dt><dd>${escapeHtml(packageManifest.name)}@${escapeHtml(packageManifest.version)}</dd>
        <dt>Tarball SHA-256</dt><dd>${escapeHtml(tarballSha256)}</dd>
        <dt>Selected backend</dt><dd>${escapeHtml(ready.mode)}</dd>
        <dt>Fallback code</dt><dd>${escapeHtml(ready.fallbackReason?.code ?? 'none')}</dd>
        <dt>Target id</dt><dd>${escapeHtml(ready.target.id)}</dd>
        <dt>Discovery</dt><dd>${escapeHtml(ready.target.discoveryUrl)}</dd>
        <dt>WebSocket</dt><dd>${escapeHtml(ready.target.webSocketDebuggerUrl)}</dd>
        <dt>API references</dt><dd>fetch=${globalThis.fetch === originalFunctions.fetch}; http.request=${http.request === originalFunctions.httpRequest}; https.request=${https.request === originalFunctions.httpsRequest}</dd>
        <dt>Discovery contract</dt><dd>/json/list=${discoveryContract.list.ok}; /json/version=${discoveryContract.version.ok}; /json/protocol.Network=${discoveryContract.protocol.networkDomain}</dd>
      </dl>
    </article>
    <article class="card">
      <h2>Advertised capabilities</h2>
      <ul>${capabilities}</ul>
      <div class="actions">
        <a class="action" href="${escapeHtml(ready.target.discoveryUrl)}" target="_blank">Open /json/list</a>
        <a class="action" href="${escapeHtml(new URL('/json/version', discoveryUrl))}" target="_blank">Open /json/version</a>
        <a class="action" href="${escapeHtml(new URL('/json/protocol', discoveryUrl))}" target="_blank">Open /json/protocol</a>
        <a class="action" href="${escapeHtml(frontendUrl)}" target="_blank">Open official DevTools</a>
      </div>
    </article>
    <article class="card wide">
      <h2>Manual business scenarios</h2>
      <div class="actions">
        <button data-scenario="http-get">HTTP GET 200</button>
        <button data-scenario="https-get">HTTPS GET 200</button>
        <button data-scenario="fetch-post">Fetch POST 201</button>
        <button data-scenario="trace">Trace correlation</button>
        <button data-scenario="failed">Failed request lifecycle</button>
        <button data-scenario="sse">SSE request${backend === 'legacy' ? ' + messages' : ''}</button>
        <button data-scenario="websocket">WebSocket ${backend === 'legacy' ? 'frames' : 'lifecycle only'}</button>
        ${legacyButtons}
        <button id="finalize" class="secondary">Finalize Session + HAR + Replay</button>
        <button id="dispose" class="danger">Dispose target + verify closed</button>
      </div>
      <div class="proof">
        <span id="scenario-count">0 manual scenarios</span>
        <span id="mock-leaks">0 mock origin leaks</span>
        <span id="session-state">Session recording</span>
      </div>
    </article>
    <article class="card wide">
      <h2>Latest observed result</h2>
      <pre id="result">Choose a scenario. Each click causes this Node process to issue real outbound traffic.</pre>
    </article>
  </section>
</main>
<script>
  const result = document.querySelector('#result')
  const count = document.querySelector('#scenario-count')
  const leaks = document.querySelector('#mock-leaks')
  const sessionState = document.querySelector('#session-state')
  let scenarioCount = 0
  async function post(path) {
    result.textContent = 'Running ' + path + ' …'
    const response = await fetch(path, { method: 'POST' })
    const value = await response.json()
    result.textContent = JSON.stringify(value, null, 2)
    if (!response.ok) throw new Error(value.error || 'Manual action failed')
    return value
  }
  for (const button of document.querySelectorAll('[data-scenario]')) {
    button.addEventListener('click', async () => {
      const value = await post('/api/run/' + button.dataset.scenario)
      scenarioCount += 1
      count.textContent = scenarioCount + ' manual scenarios'
      leaks.textContent = value.originLeakCount + ' mock origin leaks'
    })
  }
  document.querySelector('#finalize').addEventListener('click', async () => {
    const value = await post('/api/finalize')
    sessionState.textContent = 'Session ' + value.manifest.state + ' · HAR ' + value.har.entries + ' · Replay ' + value.replay.realPassed
  })
  document.querySelector('#dispose').addEventListener('click', async () => {
    const value = await post('/api/dispose')
    sessionState.textContent = 'Disposed · discovery closed=' + value.discoveryClosed
  })
</script>
</body>
</html>`
}

const controlSockets = new Set()
let controlUrl
const controlServer = http.createServer(async (request, response) => {
  const url = new URL(request.url, controlUrl ?? 'http://127.0.0.1')
  try {
    if (request.method === 'GET' && url.pathname === '/') {
      const body = controlPage(controlUrl)
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store'
      })
      response.end(body)
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/status') {
      jsonResponse(response, 200, { ready, discovery, frontendUrl, controlUrl })
      return
    }
    if (request.method === 'POST' && url.pathname.startsWith('/api/run/')) {
      jsonResponse(response, 200, await runScenario(url.pathname.slice('/api/run/'.length)))
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/finalize') {
      jsonResponse(response, 200, await finalizeSession())
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/dispose') {
      jsonResponse(response, 200, await disposeTarget())
      return
    }
    jsonResponse(response, 404, { error: 'not found' })
  } catch (error) {
    jsonResponse(response, 500, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
  }
})
controlServer.on('connection', (socket) => {
  controlSockets.add(socket)
  socket.once('close', () => controlSockets.delete(socket))
})
const controlPort = await listen(controlServer)
controlUrl = `http://127.0.0.1:${controlPort}`

const runtimeEvidence = {
  schemaVersion: 1,
  productCommit,
  package: { name: packageManifest.name, version: packageManifest.version },
  tarballSha256,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  backend,
  selectedMode: ready.mode,
  fallbackReason: ready.fallbackReason ?? null,
  capabilities: ready.capabilities,
  target: ready.target,
  discovery,
  discoveryContract,
  frontendUrl,
  controlUrl,
  originalFunctionsPreserved: {
    fetch: globalThis.fetch === originalFunctions.fetch,
    httpRequest: http.request === originalFunctions.httpRequest,
    httpsRequest: https.request === originalFunctions.httpsRequest
  },
  sourceSha256: sha256(await readFile(new URL(import.meta.url)))
}
const publicRuntimeEvidence = redactEvidence(runtimeEvidence)
await writeFile(
  join(artifactsRoot, `${backend}-runtime.json`),
  `${JSON.stringify(publicRuntimeEvidence, null, 2)}\n`,
  'utf8'
)

process.stdout.write(`NND_MANUAL_READY ${JSON.stringify(publicRuntimeEvidence)}\n`)

let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  const errors = []
  if (!finalized) await recorder.close().catch((error) => errors.push(error))
  await registration.dispose().catch((error) => errors.push(error))
  for (const socket of webSocketServer.clients) socket.terminate()
  webSocketServer.close()
  await closeServer(controlServer, controlSockets).catch((error) => errors.push(error))
  await closeServer(secureOriginServer, secureOriginSockets).catch((error) => errors.push(error))
  await closeServer(originServer, originSockets).catch((error) => errors.push(error))
  if (chromiumProcess.exitCode === null && chromiumProcess.signalCode === null) {
    chromiumProcess.kill('SIGTERM')
  }
  if (errors.length) {
    process.stderr.write(`${new AggregateError(errors, 'Manual evidence cleanup failed').stack}\n`)
    process.exitCode = 1
  }
}

process.once('SIGINT', () => void shutdown().finally(() => process.exit()))
process.once('SIGTERM', () => void shutdown().finally(() => process.exit()))

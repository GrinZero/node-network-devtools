'use strict'

const http = require('node:http')
const WebSocket = require('ws')

function serializeError(error) {
  return {
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    code: error?.code
  }
}

function httpRequest(url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.once('error', reject)
      response.once('end', () => {
        resolve({
          status: response.statusCode,
          headers: response.headers,
          bodyBase64: Buffer.concat(chunks).toString('base64')
        })
      })
    })
    request.once('error', reject)
    if (Array.isArray(body)) {
      for (const chunk of body.slice(0, -1)) request.write(chunk)
      request.end(body.at(-1))
    } else {
      request.end(body)
    }
  })
}

function failedHttpRequest(url, { timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const request = http.request(url, { method: 'GET' }, (response) => {
      response.resume()
      response.once('error', (error) => {
        if (settled) return
        settled = true
        resolve({ failed: true, error: serializeError(error) })
      })
      response.once('end', () => {
        if (settled) return
        settled = true
        reject(new Error(`Expected ${url} to fail, but it completed with ${response.statusCode}`))
      })
    })
    request.once('error', (error) => {
      if (settled) return
      settled = true
      resolve({ failed: true, error: serializeError(error) })
    })
    if (timeoutMs !== undefined) {
      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error(`intentional client timeout after ${timeoutMs}ms`))
      })
    }
    request.once('close', () => {
      if (settled) return
      settled = true
      resolve({ failed: true, error: { name: 'Error', message: 'request closed' } })
    })
    request.once('response', () => {
      // A reset/timeout scenario must not unexpectedly complete successfully.
      request.once('finish', () => undefined)
    })
    request.once('abort', reject)
    request.end()
  })
}

function abortResponse(url) {
  return new Promise((resolve, reject) => {
    let settled = false
    const request = http.request(url, { method: 'GET' }, (response) => {
      response.once('data', (chunk) => {
        if (settled) return
        settled = true
        response.destroy(new Error('intentional response abort'))
        request.destroy()
        resolve({ aborted: true, firstChunk: Buffer.from(chunk).toString('utf8') })
      })
      response.once('error', (error) => {
        if (settled) return
        settled = true
        resolve({ aborted: true, error: serializeError(error) })
      })
    })
    request.once('error', (error) => {
      if (settled) return
      settled = true
      resolve({ aborted: true, error: serializeError(error) })
    })
    request.once('close', () => {
      if (settled) return
      settled = true
      resolve({ aborted: true })
    })
    request.once('abort', reject)
    request.end()
  })
}

function nextWebSocketMessage(socket) {
  return new Promise((resolve, reject) => {
    const onMessage = (data, isBinary) => {
      cleanup()
      resolve({ data: Buffer.from(data), isBinary })
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onClose = (code) => {
      cleanup()
      reject(new Error(`WebSocket closed before a message (code=${code})`))
    }
    const cleanup = () => {
      socket.off('message', onMessage)
      socket.off('error', onError)
      socket.off('close', onClose)
    }
    socket.once('message', onMessage)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

async function webSocketRoundTrip(url, token, binaryBase64) {
  const socket = new WebSocket(url, {
    perMessageDeflate: {
      threshold: 0,
      serverNoContextTakeover: true,
      clientNoContextTakeover: true
    }
  })
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })

  const text = `client-text:${token}`
  const textMessage = nextWebSocketMessage(socket)
  socket.send(text)
  const textEcho = await textMessage

  const binary = Buffer.from(binaryBase64, 'base64')
  const binaryMessage = nextWebSocketMessage(socket)
  socket.send(binary)
  const binaryEcho = await binaryMessage

  const closed = new Promise((resolve, reject) => {
    socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
    socket.once('error', reject)
  })
  socket.close(1000, 'scenario-complete')
  const close = await closed

  return {
    text,
    textEcho: textEcho.data.toString('utf8'),
    textEchoIsBinary: textEcho.isBinary,
    binaryBase64,
    binaryEchoBase64: binaryEcho.data.toString('base64'),
    binaryEchoIsBinary: binaryEcho.isBinary,
    extensions: socket.extensions,
    close
  }
}

async function runScenario(message) {
  switch (message.scenario) {
    case 'http-get':
    case 'body':
      return httpRequest(message.url, {
        headers: { 'x-e2e-token': message.token }
      })
    case 'fetch-post': {
      const requestBody = `fetch-request:${message.token}`
      const response = await fetch(message.url, {
        method: 'POST',
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'x-e2e-token': message.token
        },
        body: requestBody
      })
      return {
        status: response.status,
        body: await response.text(),
        requestBody
      }
    }
    case 'http-post-chunks': {
      const chunks = [`http-`, `request:`, message.token]
      const response = await httpRequest(message.url, {
        method: 'POST',
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'x-e2e-token': message.token
        },
        body: chunks
      })
      return { ...response, requestBody: chunks.join('') }
    }
    case 'redirect': {
      const redirect = await httpRequest(message.url, {
        headers: { 'x-e2e-token': message.token }
      })
      const location = redirect.headers.location
      if (!location) throw new Error('redirect response did not include Location')
      const destinationUrl = new URL(location, message.url).href
      const destination = await httpRequest(destinationUrl, {
        headers: { 'x-e2e-token': message.token }
      })
      return { redirect, destination, destinationUrl }
    }
    case 'reset':
      return failedHttpRequest(message.url)
    case 'timeout':
      return failedHttpRequest(message.url, { timeoutMs: 150 })
    case 'abort':
      return abortResponse(message.url)
    case 'sse': {
      const response = await fetch(message.url, {
        headers: { 'x-e2e-token': message.token }
      })
      return { status: response.status, body: await response.text() }
    }
    case 'websocket':
      return webSocketRoundTrip(message.url, message.token, message.binaryBase64)
    case 'concurrent':
      return Promise.all(
        message.urls.map((url) => httpRequest(url, { headers: { 'x-e2e-token': message.token } }))
      )
    default:
      throw new Error(`Unknown Legacy E2E scenario: ${message.scenario}`)
  }
}

function send(message) {
  return new Promise((resolve, reject) => {
    if (!process.send) {
      reject(new Error('Legacy E2E consumer lost its IPC channel'))
      return
    }
    process.send(message, (error) => (error ? reject(error) : resolve()))
  })
}

async function installScenarioController({ handle, ready, consumer }) {
  if (!process.send) throw new Error('Legacy E2E consumer must be started with process IPC')

  const onMessage = async (message) => {
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

    if (message?.type === 'shutdown') {
      process.off('message', onMessage)
      try {
        await handle.dispose()
        await send({ type: 'shutdown-complete' })
      } finally {
        process.disconnect()
      }
    }
  }

  process.on('message', onMessage)
  await send({
    type: 'ready',
    pid: process.pid,
    consumer,
    sessionInfo: ready
  })
}

module.exports = { installScenarioController }

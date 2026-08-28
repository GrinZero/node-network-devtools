import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile } from 'node:fs/promises'
import http from 'node:http'
import { createRequire } from 'node:module'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { installPackedPackage, removePackedInstallation } from './packed-package.mjs'

const TEST_TIMEOUT_MS = 120_000
const IO_TIMEOUT_MS = 10_000
const FIXTURE_DIRECTORY = dirname(fileURLToPath(import.meta.url))

class CdpClient {
  constructor(WebSocket, url) {
    this.WebSocket = WebSocket
    this.url = url
    this.nextId = 0
    this.pending = new Map()
    this.events = []
    this.waiters = new Set()
  }

  async connect() {
    const socket = new this.WebSocket(this.url)
    this.socket = socket
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        socket.terminate()
        reject(new Error(`Timed out connecting to ${this.url}`))
      }, IO_TIMEOUT_MS)
      const cleanup = () => {
        clearTimeout(timer)
        socket.off('open', onOpen)
        socket.off('error', onError)
      }
      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onError = (error) => {
        cleanup()
        reject(error)
      }
      socket.once('open', onOpen)
      socket.once('error', onError)
    })
    socket.on('message', (data) => this.onMessage(data))
    socket.on('error', (error) => this.onDisconnect(error))
    socket.on('close', () => this.onDisconnect(new Error('CDP WebSocket closed')))
    return this
  }

  command(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timed out waiting for ${method} (${id})`))
      }, IO_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer)
          if (message.error) {
            reject(new Error(`${method} failed: ${message.error.message}`))
          } else {
            resolve(message.result)
          }
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      this.socket.send(JSON.stringify({ id, method, params }), (error) => {
        if (!error) return
        const pending = this.pending.get(id)
        this.pending.delete(id)
        pending?.reject(error)
      })
    })
  }

  waitForEvent(method, predicate = () => true) {
    const existing = this.events.find(
      (message) => message.method === method && predicate(message.params)
    )
    if (existing) return Promise.resolve(existing.params)

    return new Promise((resolve, reject) => {
      const waiter = { method, predicate, resolve, reject, timer: undefined }
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter)
        reject(new Error(`Timed out waiting for ${method}`))
      }, IO_TIMEOUT_MS)
      this.waiters.add(waiter)
    })
  }

  onMessage(data) {
    const message = JSON.parse(data.toString())
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      pending.resolve(message)
      return
    }
    if (!message.method) return
    this.events.push(message)
    for (const waiter of [...this.waiters]) {
      if (waiter.method !== message.method || !waiter.predicate(message.params)) continue
      clearTimeout(waiter.timer)
      this.waiters.delete(waiter)
      waiter.resolve(message.params)
    }
  }

  onDisconnect(error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.waiters.clear()
  }

  async close() {
    const socket = this.socket
    if (!socket || socket.readyState === this.WebSocket.CLOSED) return
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        socket.terminate()
        resolve()
      }, 2_000)
      socket.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.close()
    })
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve()
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
}

function requestBuffer(url, timeoutMs = IO_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { agent: false }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.once('error', reject)
      response.once('end', () => resolve({ response, body: Buffer.concat(chunks) }))
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`Timed out requesting ${url}`)))
    request.once('error', reject)
  })
}

function waitForMessage(child, messages, predicate, timeoutMs = IO_TIMEOUT_MS) {
  const existing = messages.find(predicate)
  if (existing) return Promise.resolve(existing)
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.reject(new Error(`Native consumer already exited with ${child.exitCode}`))
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for Native consumer IPC'))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      child.off('message', onMessage)
      child.off('exit', onExit)
    }
    const onMessage = (message) => {
      if (!predicate(message)) return
      cleanup()
      resolve(message)
    }
    const onExit = (code, signal) => {
      cleanup()
      reject(new Error(`Native consumer exited before IPC (code=${code}, signal=${signal})`))
    }
    child.on('message', onMessage)
    child.once('exit', onExit)
  })
}

function send(child, message) {
  return new Promise((resolve, reject) =>
    child.send(message, (error) => (error ? reject(error) : resolve()))
  )
}

function waitForExit(child, timeoutMs = IO_TIMEOUT_MS) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      reject(new Error('Timed out waiting for Native consumer to exit'))
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolve()
    }
    child.once('exit', onExit)
  })
}

test(
  'the packed Native adapter reports a real HTTP lifecycle under this Node runtime',
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const installation = await installPackedPackage('nnd-native-runtime-')
    const consumerRequire = createRequire(join(installation.root, 'consumer.cjs'))
    const WebSocket = consumerRequire('ws')
    const fixture = join(installation.root, 'native-runtime-consumer.cjs')
    await copyFile(join(FIXTURE_DIRECTORY, 'native-runtime-consumer.cjs'), fixture)

    const token = `${process.platform}-${process.version}-${process.pid}`
    const expectedBody = Buffer.from(`native-pack-runtime:${token}`)
    const origin = http.createServer((_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': String(expectedBody.length),
        'x-nnd-pack-token': token
      })
      response.end(expectedBody)
    })
    const messages = []
    let child
    let client

    try {
      await listen(origin)
      const address = origin.address()
      const requestUrl = `http://127.0.0.1:${address.port}/compat?token=${encodeURIComponent(token)}`

      child = spawn(process.execPath, ['--experimental-network-inspection', fixture], {
        cwd: installation.root,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => (stdout += chunk))
      child.stderr.on('data', (chunk) => (stderr += chunk))
      child.on('message', (message) => messages.push(message))

      const readyMessage = await waitForMessage(
        child,
        messages,
        (message) => message?.type === 'ready'
      )
      const ready = readyMessage.ready
      assert.equal(ready.mode, 'native')
      assert.deepEqual(readyMessage.functionsUnchanged, {
        fetch: true,
        httpRequest: true,
        httpsRequest: true
      })
      assert.equal(ready.capabilities.http, true)
      const nodeMajor = Number(process.versions.node.split('.')[0])
      assert.equal(
        ready.capabilities.responseBody,
        nodeMajor >= 24,
        'Node 22 must not advertise cross-transport response bodies; Node 24+ must'
      )
      assert.match(ready.target.webSocketDebuggerUrl, /^ws:\/\/127\.0\.0\.1:\d+\//)
      assert.match(ready.target.discoveryUrl, /^http:\/\/127\.0\.0\.1:\d+\/json\/list$/)

      const discovery = await requestBuffer(ready.target.discoveryUrl)
      assert.equal(discovery.response.statusCode, 200)
      const targets = JSON.parse(discovery.body.toString('utf8'))
      assert.ok(targets.some((target) => target.id === ready.target.id))

      client = await new CdpClient(WebSocket, ready.target.webSocketDebuggerUrl).connect()
      assert.deepEqual(await client.command('Network.enable'), {})

      const requestEventPromise = client.waitForEvent(
        'Network.requestWillBeSent',
        (params) => params.request?.url === requestUrl
      )
      const requestMessageId = randomUUID()
      const resultPromise = waitForMessage(
        child,
        messages,
        (message) => message?.type === 'request-result' && message.id === requestMessageId
      )
      await send(child, { type: 'request', id: requestMessageId, url: requestUrl })
      const resultMessage = await resultPromise
      assert.equal(resultMessage.error, undefined, resultMessage.error)
      assert.equal(resultMessage.result.status, 200)
      assert.deepEqual(Buffer.from(resultMessage.result.bodyBase64, 'base64'), expectedBody)

      const requestEvent = await requestEventPromise
      const requestId = requestEvent.requestId
      const responseEvent = await client.waitForEvent(
        'Network.responseReceived',
        (params) => params.requestId === requestId
      )
      const finishedEvent = await client.waitForEvent(
        'Network.loadingFinished',
        (params) => params.requestId === requestId
      )
      assert.equal(responseEvent.response.status, 200)
      assert.equal(typeof finishedEvent.timestamp, 'number')

      if (ready.capabilities.responseBody) {
        const body = await client.command('Network.getResponseBody', { requestId })
        const observedBody = body.base64Encoded
          ? Buffer.from(body.body, 'base64')
          : Buffer.from(body.body, 'utf8')
        assert.deepEqual(observedBody, expectedBody)
      }

      for (const method of [
        'Network.requestWillBeSent',
        'Network.responseReceived',
        'Network.loadingFinished'
      ]) {
        assert.equal(
          client.events.filter(
            (message) => message.method === method && message.params.requestId === requestId
          ).length,
          1,
          `${method} must be emitted exactly once`
        )
      }

      await client.close()
      client = undefined
      const shutdown = waitForMessage(
        child,
        messages,
        (message) => message?.type === 'shutdown-complete'
      )
      await send(child, { type: 'shutdown' })
      await shutdown
      await waitForExit(child)
      assert.equal(child.exitCode, 0, `stdout:\n${stdout}\nstderr:\n${stderr}`)

      await assert.rejects(
        requestBuffer(ready.target.discoveryUrl, 1_000),
        'dispose must close the Native discovery endpoint before resolving'
      )
    } finally {
      await Promise.allSettled([client?.close(), closeServer(origin)])
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        await waitForExit(child, 2_000).catch(() => child.kill('SIGKILL'))
      }
      await removePackedInstallation(installation)
    }
  }
)

'use strict'

const http = require('node:http')
const https = require('node:https')
const { register } = require('node-network-devtools')

if (!process.send) throw new Error('Native runtime consumer requires an IPC channel')

const originals = {
  fetch: globalThis.fetch,
  httpRequest: http.request,
  httpsRequest: https.request
}

function send(message) {
  return new Promise((resolve, reject) => {
    process.send(message, (error) => (error ? reject(error) : resolve()))
  })
}

function request(url) {
  return new Promise((resolve, reject) => {
    const outgoing = http.get(url, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.once('error', reject)
      response.once('end', () => {
        resolve({
          status: response.statusCode,
          bodyBase64: Buffer.concat(chunks).toString('base64')
        })
      })
    })
    outgoing.once('error', reject)
  })
}

async function main() {
  const registration = register({
    mode: 'native',
    inspector: { host: '127.0.0.1', port: 0 },
    devtools: { open: false }
  })
  const ready = await registration.ready
  await send({
    type: 'ready',
    ready,
    pid: process.pid,
    functionsUnchanged: {
      fetch: globalThis.fetch === originals.fetch,
      httpRequest: http.request === originals.httpRequest,
      httpsRequest: https.request === originals.httpsRequest
    }
  })

  process.on('message', async (message) => {
    if (message?.type === 'request') {
      try {
        await send({ type: 'request-result', id: message.id, result: await request(message.url) })
      } catch (error) {
        await send({
          type: 'request-result',
          id: message.id,
          error: error instanceof Error ? error.stack : String(error)
        })
      }
      return
    }

    if (message?.type === 'shutdown') {
      await registration.dispose()
      await send({ type: 'shutdown-complete' })
      process.removeAllListeners('message')
      process.disconnect()
    }
  })
}

main().catch(async (error) => {
  console.error(error)
  try {
    await send({ type: 'fatal', error: error instanceof Error ? error.stack : String(error) })
  } finally {
    process.exitCode = 1
    process.disconnect()
  }
})

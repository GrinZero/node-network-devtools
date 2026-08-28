import http from 'node:http'
import { gzipSync } from 'node:zlib'

import { WebSocketServer } from 'ws'

const BINARY_BODY = Buffer.from([0x00, 0x01, 0x02, 0x7f, 0x80, 0xfe, 0xff, 0x42])

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function closeHttpServer(server, sockets) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error)
      else resolve()
    })
    for (const socket of sockets) socket.destroy()
  })
}

/**
 * A real loopback origin used by the Legacy protocol suite. Test control stays
 * on process IPC; every entry recorded here is business traffic emitted by the
 * packaged consumer.
 */
export async function startLegacyOriginServer() {
  const sockets = new Set()
  const records = []
  const webSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: {
      threshold: 0,
      serverNoContextTakeover: true,
      clientNoContextTakeover: true
    }
  })

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? '127.0.0.1'}`)
    const token = url.searchParams.get('token') ?? ''
    const record = {
      sequence: records.length + 1,
      timestamp: new Date().toISOString(),
      protocol: 'http',
      method: request.method,
      url: url.href,
      token
    }
    records.push(record)

    try {
      if (url.pathname === '/get' || url.pathname === '/concurrent') {
        const body = `get-response:${token}`
        response.writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          'x-e2e-token': token
        })
        response.end(body)
        return
      }

      if (url.pathname === '/post') {
        const requestBody = await readBody(request)
        const body = JSON.stringify({ token, requestBody: requestBody.toString('utf8') })
        response.writeHead(201, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          'x-e2e-token': token
        })
        response.end(body)
        return
      }

      if (url.pathname === '/text') {
        const body = `legacy-text:${token}:你好`
        response.writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'content-length': Buffer.byteLength(body)
        })
        response.end(body)
        return
      }

      if (url.pathname === '/gzip') {
        const decoded = `legacy-gzip:${token}:压缩内容`
        const body = gzipSync(decoded)
        response.writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'content-encoding': 'gzip',
          'content-length': body.length
        })
        response.end(body)
        return
      }

      if (url.pathname === '/binary') {
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': BINARY_BODY.length
        })
        response.end(BINARY_BODY)
        return
      }

      if (url.pathname === '/redirect') {
        response.writeHead(302, {
          location: `/text?token=${encodeURIComponent(token)}`,
          'content-length': '0'
        })
        response.end()
        return
      }

      if (url.pathname === '/reset') {
        request.socket.destroy(new Error(`intentional reset:${token}`))
        return
      }

      if (url.pathname === '/timeout') {
        // The consumer owns the timeout and destroys this socket. Keeping the
        // origin passive makes the failure a real client timeout.
        return
      }

      if (url.pathname === '/abort') {
        response.writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'transfer-encoding': 'chunked'
        })
        response.flushHeaders()
        response.write(`partial:${token}:`)
        return
      }

      if (url.pathname === '/sse') {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'close'
        })
        response.flushHeaders()

        // Deliberately split one logical event across transport chunks. This
        // verifies streaming parsing rather than parsing a manufactured body.
        const chunks = [
          'id: 1\nevent: alpha\ndata: first',
          '\ndata: line-2\n\n',
          'id: 2\ndata: second\n\n',
          'event: omega\nid: 3\ndata: third\n\n'
        ]
        const writeNext = () => {
          const chunk = chunks.shift()
          if (chunk === undefined) {
            response.end()
            return
          }
          response.write(chunk)
          setImmediate(writeNext)
        }
        writeNext()
        return
      }

      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('not found')
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error)
      if (!response.headersSent) response.writeHead(500)
      response.end(String(error))
    }
  })

  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host ?? '127.0.0.1'}`)
    if (url.pathname !== '/websocket') {
      socket.destroy()
      return
    }
    records.push({
      sequence: records.length + 1,
      timestamp: new Date().toISOString(),
      protocol: 'websocket',
      method: request.method,
      url: url.href,
      token: url.searchParams.get('token') ?? ''
    })
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit('connection', webSocket, request)
    })
  })

  webSocketServer.on('connection', (socket) => {
    socket.on('message', (data, isBinary) => {
      socket.send(data, { binary: isBinary })
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeHttpServer(server, sockets)
    throw new Error('Legacy origin fixture did not expose a TCP address')
  }

  let closed = false
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    binaryBody: BINARY_BODY,
    records,
    async close() {
      if (closed) return
      closed = true
      for (const client of webSocketServer.clients) client.terminate()
      webSocketServer.close()
      await closeHttpServer(server, sockets)
    }
  }
}

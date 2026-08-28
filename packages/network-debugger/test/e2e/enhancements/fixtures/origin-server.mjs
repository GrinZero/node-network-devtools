import http from 'node:http'

export const BINARY_BODY = Buffer.from([0x00, 0x01, 0x02, 0x7f, 0x80, 0xfe, 0xff, 0x42])

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function closeServer(server, sockets) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error)
      else resolve()
    })
    for (const socket of sockets) socket.destroy()
  })
}

/** A real loopback origin. IPC remains the test-control plane. */
export async function startEnhancementsOrigin() {
  const sockets = new Set()
  const records = []

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? '127.0.0.1'}`)
    const body = await readBody(request)
    const token = url.searchParams.get('token') ?? ''
    records.push({
      sequence: records.length + 1,
      method: request.method,
      url: url.href,
      pathname: url.pathname,
      token,
      headers: { ...request.headers },
      bodyBase64: body.toString('base64')
    })

    if (url.pathname === '/text') {
      const result = `session-text:${token}:你好`
      response.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': Buffer.byteLength(result),
        'x-origin': 'enhancements'
      })
      response.end(result)
      return
    }

    if (url.pathname === '/binary') {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': BINARY_BODY.length,
        'x-origin': 'enhancements'
      })
      response.end(BINARY_BODY)
      return
    }

    if (url.pathname === '/plain') {
      const result = `plain-response:${token}`
      response.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': Buffer.byteLength(result),
        'x-origin': 'enhancements'
      })
      response.end(result)
      return
    }

    if (url.pathname === '/post') {
      const result = JSON.stringify({ token, requestBody: body.toString('utf8') })
      response.writeHead(201, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(result),
        'x-origin': 'enhancements'
      })
      response.end(result)
      return
    }

    // These paths are deliberately real and observable. A matching Legacy
    // mock must prevent them from ever reaching this handler.
    if (url.pathname === '/mock-http' || url.pathname === '/mock-fetch') {
      response.writeHead(418, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('mock unexpectedly reached the origin')
      return
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
  })

  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
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
    await closeServer(server, sockets)
    throw new Error('Enhancements origin did not expose a TCP address')
  }

  let closed = false
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    records,
    async close() {
      if (closed) return
      closed = true
      await closeServer(server, sockets)
    }
  }
}

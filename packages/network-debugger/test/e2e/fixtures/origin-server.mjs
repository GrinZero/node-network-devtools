import http from 'node:http'

async function readRequestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function closeServer(server, sockets) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
    for (const socket of sockets) socket.destroy()
  })
}

export async function startOriginServer() {
  const sockets = new Set()
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const token = url.searchParams.get('token') ?? ''

    try {
      if (url.pathname === '/http') {
        const body = `http-response:${token}`
        response.writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          'x-e2e-token': token
        })
        response.end(body)
        return
      }

      if (url.pathname === '/fetch') {
        const requestBody = await readRequestBody(request)
        const body = JSON.stringify({ token, requestBody })
        response.writeHead(201, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          'x-e2e-token': token
        })
        response.end(body)
        return
      }

      if (url.pathname === '/reset') {
        request.socket.destroy(new Error(`intentional reset for ${token}`))
        return
      }

      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('not found')
    } catch (error) {
      if (!response.headersSent) response.writeHead(500)
      response.end(String(error))
    }
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
    throw new Error('Origin fixture did not expose a TCP address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server, sockets)
  }
}

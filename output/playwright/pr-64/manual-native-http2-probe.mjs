import inspector from 'node:inspector'
import http2 from 'node:http2'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const consumerRoot = resolve(
  process.env.NND_MANUAL_CONSUMER_ROOT ?? new URL('./consumer', import.meta.url).pathname
)
const manualRequire = createRequire(`${consumerRoot}/consumer.cjs`)
const { register } = manualRequire('node-network-devtools')

const registration = register({
  mode: 'native',
  inspector: { host: '127.0.0.1', port: 0 },
  devtools: { open: false }
})
const ready = await registration.ready
process.stdout.write(
  `NND_H2_CAPABILITY ${JSON.stringify({
    node: process.version,
    selectedMode: ready.mode,
    http2: ready.capabilities.http2
  })}\n`
)

const cdp = new inspector.Session()
cdp.connect()
for (const method of [
  'Network.requestWillBeSent',
  'Network.responseReceived',
  'Network.dataReceived',
  'Network.loadingFinished',
  'Network.loadingFailed'
]) {
  cdp.on(method, ({ params }) => {
    process.stdout.write(
      `NND_H2_EVENT ${JSON.stringify({
        method,
        requestId: params.requestId,
        url: params.request?.url ?? params.response?.url,
        status: params.response?.status,
        dataLength: params.dataLength,
        errorText: params.errorText
      })}\n`
    )
  })
}
await new Promise((resolvePromise, reject) =>
  cdp.post('Network.enable', {}, (error) => (error ? reject(error) : resolvePromise()))
)

const server = http2.createServer()
server.on('stream', (stream) => {
  stream.respond({ ':status': 200, 'content-type': 'text/plain', 'x-proof': 'h2' })
  stream.end('h2-ok')
})
await new Promise((resolvePromise, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolvePromise)
})
const address = server.address()
if (!address || typeof address === 'string') throw new Error('HTTP/2 server has no port')

const client = http2.connect(`http://127.0.0.1:${address.port}`)
const request = client.request({
  ':method': 'GET',
  ':path': '/native-h2?token=manual-pr64'
})
let body = ''
request.setEncoding('utf8')
request.on('data', (chunk) => {
  body += chunk
})
request.end()
await new Promise((resolvePromise, reject) => {
  request.once('end', resolvePromise)
  request.once('error', reject)
})
process.stdout.write(`NND_H2_PASS ${JSON.stringify({ node: process.version, body })}\n`)

client.close()
await new Promise((resolvePromise) => server.close(resolvePromise))
cdp.disconnect()
await registration.dispose()

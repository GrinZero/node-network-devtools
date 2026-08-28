import { appendFile } from 'node:fs/promises'
import WebSocket from 'ws'

const frontendUrl = process.argv[2]
const recordPath = process.env.NND_E2E_FRONTEND_RECORD
if (!frontendUrl || !recordPath) {
  throw new Error('frontend URL and NND_E2E_FRONTEND_RECORD are required')
}

const frontend = new URL(frontendUrl)
const address = frontend.searchParams.get('ws')
if (!address) throw new Error(`Frontend URL has no ws parameter: ${frontendUrl}`)
const webSocketDebuggerUrl = address.startsWith('ws:') ? address : `ws://${address}`

await new Promise((resolvePromise, rejectPromise) => {
  const socket = new WebSocket(webSocketDebuggerUrl)
  const timeout = setTimeout(() => {
    socket.terminate()
    rejectPromise(new Error(`Timed out resuming ${webSocketDebuggerUrl}`))
  }, 10_000)

  const cleanup = () => clearTimeout(timeout)
  socket.once('error', (error) => {
    cleanup()
    rejectPromise(error)
  })
  socket.once('open', () => {
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.runIfWaitingForDebugger' }))
  })
  socket.on('message', async (data) => {
    const message = JSON.parse(data.toString())
    if (message.id !== 1) return
    try {
      await appendFile(
        recordPath,
        `${JSON.stringify({ frontendUrl, webSocketDebuggerUrl })}\n`,
        'utf8'
      )
      cleanup()
      socket.close()
      resolvePromise()
    } catch (error) {
      cleanup()
      socket.terminate()
      rejectPromise(error)
    }
  })
})

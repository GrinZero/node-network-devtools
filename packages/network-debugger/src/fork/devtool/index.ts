import { Server, WebSocket } from 'ws'
import open, { apps } from 'open'
import { type ChildProcess } from 'child_process'
import { IS_DEV_MODE } from '../../common'
import { REMOTE_DEBUGGER_PORT } from '../../common'
import { log } from '../../utils'
import { BaseDevtoolServer, DevtoolMessage } from './type'

export interface DevtoolServerInitOptions {
  port: number
  autoOpenDevtool?: boolean
  onConnect?: () => void
  onClose?: () => void
}

export interface IDevtoolServer {
  send(message: DevtoolMessage): Promise<any>
  close(): void
  open(): Promise<void>
}
export * from './type'

export class DevtoolServer extends BaseDevtoolServer implements IDevtoolServer {
  private server: Server
  private port: number
  private browser: ChildProcess | null = null
  private socket: Promise<[WebSocket]>

  constructor(props: DevtoolServerInitOptions) {
    super()
    const { port, autoOpenDevtool = true, onConnect, onClose } = props
    this.port = port
    this.server = new Server({ port })
    const { server } = this

    server.on('listening', () => {
      log(`devtool server is listening on port ${port}`)
      autoOpenDevtool && this.open()
    })

    this.socket = new Promise<[WebSocket]>((resolve) => {
      server.on('connection', (socket) => {
        onConnect?.()
        this.socket.then((l) => {
          l[0] = socket
        })
        log('devtool connected')
        socket.on('message', (message) => {
          const msg = JSON.parse(message.toString())
          this.listeners.forEach((listener) => listener(null, msg))
        })
        socket.on('close', () => {
          log('devtool closed')
          onClose?.()
        })
        socket.on('error', (error) => {
          this.listeners.forEach((listener) => listener(error))
        })
        resolve([socket] satisfies [WebSocket])
      })
    })
  }

  public async open() {
    const url = `devtools://devtools/bundled/inspector.html?ws=localhost:${this.port}`
    try {
      if (IS_DEV_MODE) {
        log(`In dev mode, open chrome devtool manually: ${url}`)
        return
      }

      const pro = await open(url, {
        app: {
          name: apps.chrome,
          arguments: [
            process.platform !== 'darwin' ? `--remote-debugging-port=${REMOTE_DEBUGGER_PORT}` : ''
          ]
        },
        wait: true
      })

      cdpConnect: if (process.platform !== 'darwin') {
        const json = await new Promise<{ webSocketDebuggerUrl: string; id: string }[]>(
          (resolve) => {
            let count = 0
            let stop = setInterval(async () => {
              if (count > 5) {
                clearInterval(stop)
                resolve([])
              }
              try {
                count++
                resolve((await fetch(`http://localhost:${REMOTE_DEBUGGER_PORT}/json`)).json())
                clearInterval(stop)
              } catch {
                // ignore
              }
            }, 500)
          }
        )
        const [data] = json
        if (!data) {
          break cdpConnect
        }
        const { id, webSocketDebuggerUrl } = data
        const debuggerWs = new WebSocket(webSocketDebuggerUrl)

        debuggerWs.on('open', () => {
          const navigateCommand = {
            id,
            method: 'Page.navigate',
            params: {
              url
            }
          }
          debuggerWs.send(JSON.stringify(navigateCommand))
          debuggerWs.close()
        })
      }

      log('opened in chrome or click here to open chrome devtool: ', url)
      this.browser = pro
      return
    } catch (error) {
      console.warn(
        "Open devtools failed, but don't worry, you can open it in browser(Chrome or Edge) manually: " +
          url
      )
    }
  }

  public close() {
    this.server.close()
    this.browser && this.browser.kill()
  }

  async send(message: DevtoolMessage) {
    const [socket] = await this.socket
    return socket.send(JSON.stringify(message))
  }
}

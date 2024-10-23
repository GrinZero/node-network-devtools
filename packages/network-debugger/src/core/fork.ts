import { IS_DEV_MODE, READY_MESSAGE, RequestDetail } from '../common'
import { type IncomingMessage } from 'http'
import WebSocket from 'ws'
import { ChildProcess, fork } from 'child_process'
import { __dirname } from '../common'
import { resolve } from 'path'
import { RegisterOptions } from '../common'

export class MainProcess {
  private ws: Promise<WebSocket>
  private options: RegisterOptions
  private cp?: ChildProcess

  constructor(props: RegisterOptions) {
    this.options = props
    this.ws = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`ws://localhost:${props.port}`)
      socket.on('open', () => {
        resolve(socket)
      })
      socket.on('error', (e) => {
        this.openProcess(() => {
          const socket = new WebSocket(`ws://localhost:${props.port}`)
          socket.on('open', () => {
            resolve(socket)
          })
          socket.on('error', reject)
        })
      })
    })
    this.ws.then((ws) => {
      ws.on('error', (e) => {
        console.error('MainProcess Socket Error: ', e)
      })
    })
  }

  private openProcess(callback?: () => void) {
    const forkProcess = () => {
      // fork a new process with options
      const cp = fork(resolve(__dirname, './fork'), {
        env: {
          ...process.env,
          NETWORK_OPTIONS: JSON.stringify(this.options)
        }
      })
      const handleMsg = (e: any) => {
        if (e === READY_MESSAGE) {
          callback && callback()
          cp.off('message', handleMsg)
        }
      }

      cp.on('message', handleMsg)
      this.cp = cp
    }

    if (IS_DEV_MODE) {
      forkProcess()
      return
    }
    forkProcess()
  }

  public async send(data: any) {
    const ws = await this.ws
    ws.send(JSON.stringify(data))
  }

  public registerRequest(request: RequestDetail) {
    this.send({
      type: 'registerRequest',
      data: request
    })
  }

  public updateRequest(request: RequestDetail) {
    this.send({
      type: 'updateRequest',
      data: request
    })
  }

  public endRequest(request: RequestDetail) {
    this.send({
      type: 'endRequest',
      data: request
    })
  }

  public responseRequest(id: string, response: IncomingMessage) {
    const responseBuffer: Buffer[] = []

    response.on('data', (chunk: any) => {
      responseBuffer.push(chunk)
    })

    response.on('end', () => {
      const rawData = Buffer.concat(responseBuffer)
      this.ws.then((ws) => {
        ws.send(
          JSON.stringify({
            type: 'responseData',
            data: {
              id: id,
              rawData: rawData,
              statusCode: response.statusCode,
              headers: response.headers
            }
          }),
          { binary: true }
        )
      })
    })
  }

  public async dispose() {
    const ws = await this.ws
    ws.removeAllListeners()
    ws.terminate()
    if (!this.cp) return
    this.cp.removeAllListeners()
    this.cp.kill()
    this.cp = void 0
  }
}
export { __dirname }

import { IS_DEV_MODE, PORT, READY_MESSAGE, RequestDetail } from '../common'
import { type IncomingMessage } from 'http'
import WebSocket from 'ws'
import { fork } from 'child_process'
import fs from 'fs'
import { LOCK_FILE, __dirname } from '../common'
import { resolve } from 'path'
import { RegisterOptions } from '../common'

export class MainProcess {
  private ws: Promise<WebSocket>
  private options: RegisterOptions

  constructor(props: RegisterOptions) {
    this.options = props
    this.ws = new Promise<WebSocket>((resolve) => {
      const tryResolveSocker = () => {
        this.openProcess(() => {
          const socket = new WebSocket(`ws://localhost:${props.port}`)
          socket.on('open', () => {
            resolve(socket)
          })
          socket.on('error', (e) => {
            console.error('MainProcess Socket Error: ', e)
            if (fs.existsSync(LOCK_FILE)) {
              fs.unlinkSync(LOCK_FILE)
            }
            tryResolveSocker()
          })
        })
      }
      tryResolveSocker()
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
          fs.writeFileSync(LOCK_FILE, String(cp.pid))
          cp.off('message', handleMsg)
        }
      }

      cp.on('message', handleMsg)
    }

    if (IS_DEV_MODE) {
      try {
        if (fs.existsSync(LOCK_FILE)) {
          const pid = fs.readFileSync(LOCK_FILE, 'utf-8')
          process.kill(Number(pid), 'SIGTERM')
        }
      } catch (e) {
        console.error("Don't worry. Error while killing process", e)
      }

      forkProcess()
      return
    }
    if (fs.existsSync(LOCK_FILE)) {
      callback && callback()
      return
    }
    forkProcess()
  }

  private async send(data: any) {
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
}
export { __dirname }

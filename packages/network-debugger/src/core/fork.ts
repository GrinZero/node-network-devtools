import { IS_DEV_MODE, READY_MESSAGE, RequestDetail } from '../common'
import { type IncomingMessage } from 'http'
import WebSocket from 'ws'
import { fork } from 'child_process'
import fs from 'fs'
import { LOCK_FILE } from '../common'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export class MainProcess {
  private ws: Promise<WebSocket>

  constructor({ port = 5270 }: { port: number; serverPort: number }) {
    this.ws = new Promise<WebSocket>((resolve) => {
      const tryResolveSocker = () => {
        this.openProcess(() => {
          const socket = new WebSocket(`ws://localhost:${port}`)
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
      const cp = fork(resolve(__dirname, './fork'))
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

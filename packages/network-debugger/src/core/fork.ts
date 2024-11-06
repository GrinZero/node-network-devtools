import { READY_MESSAGE, RequestDetail } from '../common'
import { type IncomingMessage } from 'http'
import WebSocket from 'ws'
import { ChildProcess, fork } from 'child_process'
import { __dirname } from '../common'
import { resolve as resolvePath } from 'path'
import { RegisterOptions } from '../common'
import fs from 'fs'
import { sleep, checkMainProcessAlive } from '../utils/process'
import { unlinkSafe } from '../utils/file'
import { warn } from '../utils'
import { getCurrentCell } from './hooks/cell'

class ExpectError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export class MainProcess {
  private ws: Promise<WebSocket>
  private options: RegisterOptions
  private cp?: ChildProcess

  constructor(props: RegisterOptions & { key: string }) {
    this.options = props
    this.ws = new Promise<WebSocket>(async (resolve, reject) => {
      const lockFilePath = resolvePath(__dirname, `./${props.key}`)
      if (fs.existsSync(lockFilePath)) {
        // 读取 lock 文件中的进程号
        const pid = fs.readFileSync(lockFilePath, 'utf-8')
        await sleep(1)

        // 检测该进程是否存活且 port 是否被占用
        const isProcessAlice = await checkMainProcessAlive(pid, props.port!)
        if (isProcessAlice) {
          warn(`The main process with same options is already running, skip it.`)
          return
        }
        // 如果进程不存在：
        //   1. 热更新导致 process 重启
        //   2. 上一个进程未成功删除 lock
        // 都应该继续往下
        unlinkSafe(lockFilePath)
      }
      fs.writeFileSync(lockFilePath, `${process.pid}`)
      const socket = new WebSocket(`ws://localhost:${props.port}`)
      socket.on('open', () => {
        unlinkSafe(lockFilePath)
        resolve(socket)
      })
      socket.on('error', () => {
        this.openProcess(() => {
          unlinkSafe(lockFilePath)
          const socket = new WebSocket(`ws://localhost:${props.port}`)
          socket.on('open', () => {
            resolve(socket)
          })
          socket.on('error', reject)
        })
      })
    })
    this.ws
      .then((ws) => {
        ws.on('error', (e) => {
          console.error('MainProcess Socket Error: ', e)
        })
      })
      .catch((e) => {
        if (e instanceof ExpectError) {
          return
        }
        throw e
      })
  }

  private openProcess(callback?: (cp: ChildProcess) => void) {
    const forkProcess = () => {
      // fork a new process with options
      const cp = fork(resolvePath(__dirname, './fork'), {
        env: {
          ...process.env,
          NETWORK_OPTIONS: JSON.stringify(this.options)
        }
      })
      const handleMsg = (e: any) => {
        if (e === READY_MESSAGE) {
          callback && callback(cp)
          cp.off('message', handleMsg)
        }
      }

      cp.on('message', handleMsg)
      this.cp = cp
    }

    forkProcess()
  }

  public async send(data: any) {
    const currentCell = getCurrentCell()
    if (currentCell?.isAborted) {
      return
    }
    const ws = await this.ws.catch((err) => {
      if (err instanceof ExpectError) {
        return null
      }
      throw err
    })
    if (!ws) return
    ws.send(JSON.stringify(data))
  }

  public initRequest(request: RequestDetail) {
    this.send({
      type: 'initRequest',
      data: request
    })
  }

  public registerRequest(request: RequestDetail) {
    const currentCell = getCurrentCell()
    let req = request
    if (currentCell) {
      currentCell.request = req
      const pipes = currentCell.pipes.filter((p) => p.type === 'regsiter').map((p) => p.pipe)
      pipes.forEach((pipe) => {
        req = pipe(req)
      })
      currentCell.request = req
    }

    this.send({
      type: 'registerRequest',
      data: req
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

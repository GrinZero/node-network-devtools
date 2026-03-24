import { READY_MESSAGE, RequestDetail } from '../common'
import { type IncomingMessage } from 'http'
import WebSocket from 'ws'
import { ChildProcess, fork } from 'child_process'
import { __dirname } from '../common'
import { resolve as resolvePath } from 'path'
import { IS_DEV_MODE } from '../common'
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

/**
 * @flow initRequest -> registerRequest -> updateRequest -> endRequest
 */
export type RequestType = 'initRequest' | 'registerRequest' | 'updateRequest' | 'endRequest'

export class MainProcess {
  private ws: Promise<WebSocket>
  private options: RegisterOptions
  private cp?: ChildProcess
  private nativeNetwork?: any

  constructor(props: RegisterOptions & { key: string }) {
    this.options = { ...props }

    try {
      const inspector = require('inspector')
      // Check if native inspector is active and supports Network
      if (inspector.url() && inspector.Network) {
        warn(`[Network Debugger] Detected native Node inspector. Hijacking inspector.Network to forward CDP events to native DevTools.`)
        this.nativeNetwork = { ...inspector.Network }
        // Disable native network tracking to prevent duplicate logs
        const methods = [
          'requestWillBeSent',
          'responseReceived',
          'loadingFinished',
          'loadingFailed',
          'dataSent',
          'dataReceived'
        ]
        methods.forEach((method) => {
          if (typeof (inspector.Network as any)[method] === 'function') {
            ;(inspector.Network as any)[method] = () => {}
          }
        })

        // Since the user is already connected to native devtools, don't open a new browser
        this.options.autoOpenDevtool = false
      }
    } catch (e) {
      warn(`[Network Debugger] Error during native inspector setup: ${e}`)
    }

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
      const setupSocket = (s: WebSocket) => {
        s.on('message', (msg) => {
          try {
            const data = JSON.parse(msg.toString())
            if (data.type === 'cdp' && this.nativeNetwork) {
              const { method, params } = data.data
              if (method && method.startsWith('Network.')) {
                const methodName = method.split('.')[1]
                if (typeof this.nativeNetwork[methodName] === 'function') {
                  try {
                    this.nativeNetwork[methodName](params)
                  } catch (err) {
                    warn(`[Network Debugger] Native network forwarding error for method ${method}: ${err}`)
                  }
                }
              }
            }
          } catch (e) {
            // ignore JSON parse errors
          }
        })
      }

      socket.on('open', () => {
        unlinkSafe(lockFilePath)
        setupSocket(socket)
        resolve(socket)
      })
      socket.on('error', () => {
        this.openProcess(() => {
          unlinkSafe(lockFilePath)
          const socket = new WebSocket(`ws://localhost:${props.port}`)
          socket.on('open', () => {
            setupSocket(socket)
            resolve(socket)
          })
          socket.on('error', reject)
        })
      })
    })
    this.ws
      .then((ws) => {
        this.healthCheck()
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

  public sendRequest(type: RequestType, request: RequestDetail) {
    const currentCell = getCurrentCell()
    let req = request
    if (currentCell) {
      currentCell.request = req
      const pipes = currentCell.pipes.filter((p) => p.type === type).map((p) => p.pipe)
      pipes.forEach((pipe) => {
        req = pipe(req)
      })
      currentCell.request = req
    }

    this.send({
      type,
      data: request
    })
    return this
  }

  private async healthCheck() {
    const ws = await this.ws
    const ping = () => {
      ws.send(
        JSON.stringify({
          type: 'healthcheck',
          data: {}
        })
      )
    }
    ping()
    setInterval(ping, 2000)
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

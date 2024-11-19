import { DevtoolServer } from './devtool'
import { PORT, READY_MESSAGE, RequestDetail } from '../common'
import zlib from 'node:zlib'
import { Server } from 'ws'
import { RequestHeaderPipe } from './pipe'
import { log } from '../utils'
import { ResourceService } from './resource-service'
import { EffectCleaner, PluginInstance } from './module/common'
import { pathToFileURL } from 'url'

export interface RequestCenterInitOptions {
  port: number
  serverPort: number
  autoOpenDevtool?: boolean
  requests?: Record<string, RequestDetail>
}

/**
 * @param data message data
 * @param id message id
 * @param request? request detail
 */
export interface DevtoolMessageListener<T = any> {
  (props: { data: T; request?: RequestDetail; id: string }): void
}

export class RequestCenter {
  public requests: Record<string, RequestDetail>
  public resourceService: ResourceService
  private devtool: DevtoolServer
  private server: Server
  private effects: Array<EffectCleaner> = []
  private listeners: Record<string, DevtoolMessageListener[] | undefined> = {}
  private options: RequestCenterInitOptions
  constructor(options: RequestCenterInitOptions) {
    this.options = options
    const { serverPort, requests, autoOpenDevtool } = options
    this.requests = requests || {}
    this.devtool = new DevtoolServer({
      port: serverPort,
      autoOpenDevtool: autoOpenDevtool
    })
    this.resourceService = new ResourceService()
    this.devtool.on((error, message) => {
      if (error) {
        log(error)
        return
      }

      const listenerList = this.listeners[message.method]
      if (!listenerList) {
        return
      }

      const request = this.getRequest(message.params.requestId)
      listenerList.forEach((listener) => {
        listener({
          data: message.params,
          request,
          id: message.id
        })
      })
    })
    this.server = this.initServer()
  }

  public loadPlugins(plugins: PluginInstance[]) {
    const effects = plugins
      .map((plugin) =>
        plugin({
          devtool: this.devtool,
          core: this
        })
      )
      .filter(Boolean) as Array<EffectCleaner>
    this.effects.push(...effects)
  }

  public on(method: string, listener: DevtoolMessageListener) {
    if (!this.listeners[method]) {
      this.listeners[method] = []
    }
    this.listeners[method]!.push(listener)
  }

  public responseData(data: {
    id: string
    rawData: Array<number>
    statusCode: number
    headers: Record<string, string>
  }) {
    const { id, rawData: _rawData, statusCode, headers } = data
    const request = this.getRequest(id)
    const rawData = Buffer.from(_rawData)
    if (request) {
      request.responseInfo.encodedDataLength = rawData.length
      this.tryDecompression(rawData, (decodedData) => {
        request.responseData = decodedData
        request.responseInfo.dataLength = decodedData.length
        request.responseStatusCode = statusCode
        request.responseHeaders = new RequestHeaderPipe(headers).getData()
        this.updateRequest(request)
        this.endRequest(request)
      })
    }
  }

  public getRequest(id: string): undefined | RequestDetail {
    return this.requests[id]
  }

  public registerRequest(request: RequestDetail) {
    this.requests[request.id] = request
    // replace callFrames' scriptId
    if (request.initiator) {
      request.initiator.stack.callFrames.forEach((frame) => {
        const fileUrl = pathToFileURL(frame.url)
        const scriptId =
          this.resourceService.getScriptIdByUrl(fileUrl.href) ??
          this.resourceService.getScriptIdByUrl(frame.url)
        if (scriptId) {
          frame.scriptId = scriptId
        }
      })
    }
    this.devtool.requestWillBeSent(request)
  }

  public initRequest(request: RequestDetail) {
    this.requests[request.id] = request
  }

  public updateRequest(request: RequestDetail) {
    this.requests[request.id] = request
  }

  public endRequest(request: RequestDetail) {
    request.requestEndTime = request.requestEndTime || Date.now()
    this.devtool.responseReceived(request)
  }

  public close() {
    this.server.close()
    this.devtool.close()
    this.effects.forEach((effect) => effect())
  }

  private initServer() {
    const server = new Server({ port: this.options.port || PORT })
    server.on('connection', (ws) => {
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString())
        const _message = message as { type: string; data: any }
        switch (_message.type) {
          case 'initRequest':
          case 'registerRequest':
          case 'updateRequest':
          case 'endRequest':
            this[_message.type](new RequestDetail(_message.data))
            break
          case 'responseData':
            this.responseData(_message.data)
            break
          default:
            {
              const listenerList = this.listeners[_message.type]
              if (!listenerList) {
                console.warn('unknown message type', _message.type)
                break
              }

              if (!_message.data.requestId) {
                console.warn('requestId is not found', _message)
                break
              }

              const id = _message.data.requestId
              const request = this.getRequest(id)
              listenerList.forEach((listener) => {
                listener({
                  data: _message.data,
                  request,
                  id
                })
              })
            }
            break
        }
      })
    })
    server.on('listening', () => {
      if (process.send) {
        process.send(READY_MESSAGE)
      }
    })

    return server
  }

  private tryDecompression(data: Buffer, callback: (result: Buffer) => void) {
    const decompressors: Array<
      (data: Buffer, cb: (err: Error | null, result: Buffer) => void) => void
    > = [zlib.gunzip, zlib.inflate, zlib.brotliDecompress]

    let attempts = 0

    const tryNext = () => {
      if (attempts >= decompressors.length) {
        callback(data) // 理论上没有压缩
        return
      }

      const decompressor = decompressors[attempts]
      attempts += 1

      decompressor(data, (err, result) => {
        if (!err) {
          callback(result)
        } else {
          tryNext()
        }
      })
    }

    tryNext()
  }
}

import { DevtoolServer } from './devtool'
import { READY_MESSAGE, RequestDetail } from '../common'
import zlib from 'zlib'
import { Server } from 'ws'
import { RequestHeaderPipe } from './pipe'
import { log } from '../utils'
import { ResourceService } from './resource-service'
import { EffectCleaner, PluginInstance } from './module/common'

export interface RequestCenterInitOptions {
  port?: number
  requests?: Record<string, RequestDetail>
}

export type DevtoolMessageListener = <T = any>(props: {
  data: T
  request: RequestDetail
  id: string
}) => void

export class RequestCenter {
  public requests: Record<string, RequestDetail>
  private devtool: DevtoolServer
  private resourceService: ResourceService
  private server: Server
  private effects: Array<EffectCleaner> = []
  private listeners: Record<string, DevtoolMessageListener[] | undefined> = {}
  constructor({ port, requests }: { port: number; requests?: Record<string, RequestDetail> }) {
    this.requests = requests || {}
    this.devtool = new DevtoolServer({
      port
    })
    this.resourceService = new ResourceService(this.devtool)
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
      if (!request) {
        console.log('request not found', message.params.requestId)
        return
      }
      listenerList.forEach((listener) => {
        listener({
          data: message.params,
          request,
          id: message.id
        })
      })
    })
    this.server = this.initServer()
    this.resourceService.init()
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
    request.responseInfo.encodedDataLength = rawData.length
    if (request) {
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

  public getRequest(id: string) {
    return this.requests[id]
  }

  public registerRequest(request: RequestDetail) {
    // 替换callFrames的scriptId
    // TODO: 待优化 特别是scriptId什么时候是数值，什么时候是字符串
    if (request.initiator) {
      request.initiator.stack.callFrames.forEach((frame) => {
        if (frame.url.startsWith('node:')) {
          return
        }
        let scriptId = this.resourceService.getScriptIdByPath(frame.url)
        if (!scriptId && !frame.url.startsWith('file://')) {
          const fileUrl = `file://${frame.url.replace(/\\/g, '/')}`
          scriptId = this.resourceService.getScriptIdByPath(fileUrl)
        }
        frame.scriptId = scriptId ? Number(scriptId) : 0
      })
    }
    this.requests[request.id] = request
    this.devtool.requestWillBeSent(request)
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
    const server = new Server({ port: 5270 })
    server.on('connection', (ws) => {
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString())
        const _message = message as { type: string; data: any }
        switch (_message.type) {
          case 'registerRequest':
          case 'updateRequest':
          case 'endRequest':
          case 'responseData':
            this[_message.type](_message.data)
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

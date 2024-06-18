import { DevtoolServer } from './devtool'
import { READY_MESSAGE, RequestDetail } from '../common'
import type { IncomingMessage } from 'http'
import zlib from 'zlib'
import { Server } from 'ws'
import { RequestHeaderPipe, BodyTransformer } from './pipe'
import { ResourceCenter, genScriptParsed } from '../core/resource'

export interface RequestCenterInitOptions {
  port?: number
  requests?: Record<string, RequestDetail>
}

export class RequestCenter {
  public requests: Record<string, RequestDetail>
  private devtool: DevtoolServer
  private server: Server
  private resourceCenter: ResourceCenter
  constructor({ port, requests }: { port: number; requests?: Record<string, RequestDetail> }) {
    this.requests = requests || {}
    this.devtool = new DevtoolServer({
      port
    })
    this.resourceCenter = new ResourceCenter(this.devtool)
    this.devtool.on((error, message) => {
      if (error) {
        return
      }

      if (message.method === 'Network.getResponseBody') {
        const req = this.getRequest(message.params.requestId)
        if (!req) {
          return
        }

        const body = new BodyTransformer(req).decodeBody()

        this.devtool.send({
          id: message.id,
          result: body
        })
      }
    })
    this.server = this.initServer()
    this.resourceCenter.init()
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

  private getRequest(id: string) {
    return this.requests[id]
  }

  public registerRequest(request: RequestDetail) {
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

  public close() {
    this.server.close()
    this.devtool.close()
  }
}

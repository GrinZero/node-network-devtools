import { ClientRequest, IncomingMessage, RequestOptions } from 'http'
import { Socket } from 'node:net'
import { RequestDetail } from '../common'
import { getTimestamp } from '../utils'
import { MainProcess } from './fork'
import { BINARY_TYPES } from './ws/constants'
import { Receiver } from './ws/reveiver'

export interface RequestFn {
  (options: RequestOptions | string | URL, callback?: (res: IncomingMessage) => void): ClientRequest
  (
    url: string | URL,
    options: RequestOptions,
    callback?: (res: IncomingMessage) => void
  ): ClientRequest
}

function proxyClientRequestFactory(
  actualRequest: ClientRequest,
  requestDetail: RequestDetail,
  mainProcess: MainProcess
) {
  const actualFn = actualRequest.write
  actualRequest.write = (data: any) => {
    try {
      requestDetail.requestData = JSON.parse(data.toString())
    } catch (err) {
      requestDetail.requestData = data
    }

    return actualFn.bind(actualRequest)(data)
  }

  actualRequest.on('error', () => {
    requestDetail.responseStatusCode = 0
    requestDetail.requestEndTime = new Date().getTime()
    mainProcess.endRequest(requestDetail)
  })

  if (requestDetail.isWebSocket()) {
    actualRequest.on('upgrade', (res: IncomingMessage, socket: Socket, head: Buffer) => {
      const originalWrite = socket.write

      if (requestDetail.isHiden()) {
        return
      }

      // plugin中处理
      mainProcess.send({
        type: 'Network.webSocketCreated',
        data: {
          requestId: requestDetail.id,
          url: requestDetail.url,
          initiator: requestDetail.initiator,
          response: res
        }
      })

      const receiver = new Receiver({
        allowSynchronousEvents: true,
        binaryType: BINARY_TYPES[0],
        isServer: false
      })
      const sender = new Receiver({
        allowSynchronousEvents: true,
        binaryType: BINARY_TYPES[0],
        isServer: true
      })

      const receiverHandler = (data: any) => {
        const str = data.toString()
        // const socketMessage = jsonParse(str, str)
        mainProcess.send({
          type: 'Network.webSocketFrameReceived',
          data: {
            requestId: requestDetail.id,
            response: {
              payloadData: str,
              opcode: 1,
              mask: false
            }
          }
        })
      }

      const senderHanlder = (data: any) => {
        const str = data.toString()
        mainProcess.send({
          type: 'Network.webSocketFrameSent',
          data: {
            requestId: requestDetail.id,
            response: {
              payloadData: str,
              opcode: 1,
              mask: true
            }
          }
        })
      }

      receiver.on('message', receiverHandler)
      sender.on('message', senderHanlder)
      let chunk

      socket.write = (data: any, ...rest: any[]) => {
        const buf = Buffer.from(data)
        sender.write(buf)
        return originalWrite.call(socket, data, ...rest)
      }
      socket.addListener('data', (data) => {
        const buf = Buffer.from(data)
        receiver.write(buf)
      })
      socket.addListener('close', () => {
        chunk = socket.read()
        if (chunk !== null) {
          receiver.write(chunk)
          sender.write(chunk)
        }
        receiver.end()
        sender.end()
        receiver.removeAllListeners()
        sender.removeAllListeners()
        mainProcess.send({
          method: 'Network.webSocketClosed',
          params: {
            requestId: requestDetail.id,
            timestamp: getTimestamp()
          }
        })
      })
      socket.addListener('end', () => {
        receiver.end()
        sender.end()
        receiver.removeAllListeners()
        sender.removeAllListeners()
      })
    })
  }

  return actualRequest
}

function proxyCallbackFactory(
  actualCallBack: any,
  requestDetail: RequestDetail,
  mainProcess: MainProcess
) {
  return (response: IncomingMessage) => {
    requestDetail.responseHeaders = response.headers
    if (typeof actualCallBack === 'function') {
      actualCallBack(response)
    }

    mainProcess.responseRequest(requestDetail.id, response)
  }
}

export function requestProxyFactory(
  this: any,
  actualRequestHandler: any,
  isHttps: boolean,
  mainProcess: MainProcess
) {
  const fn: RequestFn = (arg1: any, arg2?: any, arg3?: any) => {
    // #region resolve arguments
    let url: string | URL | undefined
    let options: RequestOptions | string | URL | undefined
    let callback: ((res: IncomingMessage) => void) | undefined

    if (typeof arg1 === 'string' || arg1 instanceof URL) {
      // Signature: (url: string | URL, options: RequestOptions, callback?: (res: IncomingMessage) => void): ClientRequest;
      url = arg1
      options = arg2
      callback = arg3
    } else {
      // Signature: (options: RequestOptions | string | URL, callback?: (res: IncomingMessage) => void): ClientRequest;
      options = arg1
      callback = arg2
    }

    const requestDetail = new RequestDetail()

    if (typeof url === 'string') {
      requestDetail.url = url
      requestDetail.method = 'GET'
    } else if (url instanceof URL) {
      requestDetail.url = url.toString()
      requestDetail.method = 'GET'
    } else if (options && typeof options !== 'string' && !(options instanceof URL)) {
      const connectionType = isHttps ? 'https' : 'http'
      requestDetail.url = `${connectionType}://${options.hostname || options.host}${options.path}`
    }

    if (options && typeof options !== 'string' && !(options instanceof URL)) {
      requestDetail.method = options.method
      requestDetail.requestHeaders = options.headers
    }

    // #endregion

    if (requestDetail.isWebSocket()) {
      requestDetail.url = requestDetail
        .url!.replace('http://', 'ws://')
        .replace('https://', 'wss://')
      mainProcess.initRequest(requestDetail)
    } else {
      mainProcess.initRequest(requestDetail)
      mainProcess.registerRequest(requestDetail)
    }

    const proxyCallback = proxyCallbackFactory(callback, requestDetail, mainProcess)

    requestDetail.loadCallFrames()
    if (typeof arg1 === 'string' || arg1 instanceof URL) {
      // Call actualRequestHandler with 3 parameters
      const request: ClientRequest = actualRequestHandler(
        url!,
        options as RequestOptions,
        proxyCallback
      )
      return proxyClientRequestFactory(request, requestDetail, mainProcess)
    } else {
      // Call actualRequestHandler with 2 parameters
      const request: ClientRequest = actualRequestHandler(options as RequestOptions, proxyCallback)
      return proxyClientRequestFactory(request, requestDetail, mainProcess)
    }
  }

  return fn
}

import { RequestOptions, IncomingMessage, ClientRequest } from 'http'
import { RequestDetail } from '../common'
import { MainProcess } from './fork'

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

  if (requestDetail.requestHeaders['Upgrade'] === 'websocket') {
    actualRequest.on('upgrade', (res, socket, head) => {
      const originalWrite = socket.write
      socket.write = (data: any, ...rest: any[]) => {
        const buf = Buffer.from(data)
        console.log('socket requestDetail', requestDetail)
        console.log('socket.write', buf.toString())
        return originalWrite.call(socket, data, ...rest)
      }
      socket.addListener('data', (data) => {
        const buf = Buffer.from(data)
        console.log('socket.data', buf.toString())
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
      requestDetail.method = options.method
      requestDetail.requestHeaders = options.headers
    }

    // #endregion
    mainProcess.registerRequest(requestDetail)
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

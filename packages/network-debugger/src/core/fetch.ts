import { RequestDetail } from '../common'
import { headersToObject } from '../utils/map'
import { MainProcess } from './fork'
import { setCurrentCell } from './hooks/cell'

export function proxyFetch(mainProcess: MainProcess) {
  if (!globalThis.fetch) {
    return
  }
  const originalFetch = globalThis.fetch

  globalThis['fetch'] = fetchProxyFactory(originalFetch, mainProcess)

  return () => {
    globalThis['fetch'] = originalFetch
  }
}

export function fetchProxyFactory(fetchFn: typeof fetch, mainProcess: MainProcess) {
  return function (request: string | URL | Request, options?: RequestInit) {
    const requestDetail = new RequestDetail()
    requestDetail.requestStartTime = Date.now()
    setCurrentCell({ request: requestDetail, pipes: [], isAborted: false })

    if (typeof request === 'string') {
      requestDetail.url = request
    } else if (request instanceof URL) {
      requestDetail.url = request.toString()
    }

    requestDetail.method = options?.method ?? 'GET'

    const headers = options?.headers
    if (headers instanceof Headers) {
      const headersObj = headersToObject(headers)
      requestDetail.requestHeaders = headersObj
    } else {
      requestDetail.requestHeaders = headers ?? {}
    }
    requestDetail.requestData = options?.body

    const result = fetchFn(request as string | Request, options)
      .then(fetchResponseHandlerFactory(requestDetail, mainProcess))
      .catch(fetchErrorHandlerFactory(requestDetail, mainProcess))
      .finally(() => {
        setCurrentCell(null)
      })

    mainProcess
      .sendRequest('initRequest', requestDetail)
      .sendRequest('registerRequest', requestDetail)

    return result
  }
}

function fetchResponseHandlerFactory(requestDetail: RequestDetail, mainProcess: MainProcess) {
  return (response: Response) => {
    requestDetail.requestEndTime = new Date().getTime()
    requestDetail.responseHeaders = headersToObject(response.headers)
    requestDetail.responseStatusCode = response.status || 0

    response
      .clone()
      .arrayBuffer()
      .then((buffer) => {
        const responseData = Buffer.from(buffer)
        requestDetail.responseData = responseData
        requestDetail.responseInfo.dataLength = responseData.length
        // TODO: use content-encoding to determine the actual length
        requestDetail.responseInfo.encodedDataLength = responseData.length
      })
      .finally(() => {
        mainProcess
          .sendRequest('updateRequest', requestDetail)
          .sendRequest('endRequest', requestDetail)
      })

    return response
  }
}

function fetchErrorHandlerFactory(requestDetail: RequestDetail, mainProcess: MainProcess) {
  return (err: unknown) => {
    requestDetail.requestEndTime = Date.now()
    requestDetail.responseStatusCode = 0
    mainProcess.sendRequest('updateRequest', requestDetail).sendRequest('endRequest', requestDetail)
    throw err
  }
}

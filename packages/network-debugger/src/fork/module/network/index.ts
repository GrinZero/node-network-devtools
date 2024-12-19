import { pathToFileURL } from 'url'
import { RequestDetail } from '../../../common'
import { BodyTransformer, RequestHeaderPipe } from '../../pipe'
import { createPlugin, useHandler } from '../common'
import zlib from 'node:zlib'
import { toMimeType } from '../../devtool'

const frameId = '517.528'
const loaderId = '517.529'

export const networkPlugin = createPlugin(({ devtool, core }) => {
  const requests: Record<string, RequestDetail> = {}

  const getRequest = (id: string) => requests[id]
  const updateRequest = (request: RequestDetail) => {
    requests[request.id] = request
  }
  const endRequest = (request: RequestDetail) => {
    request.requestEndTime = request.requestEndTime || Date.now()
    devtool.updateTimestamp()
    const headers = new RequestHeaderPipe(request.responseHeaders)

    const contentType = headers.getHeader('content-type') || 'text/plain; charset=utf-8'

    const type = (() => {
      if (/image/.test(contentType)) {
        return 'Image'
      }
      if (/javascript/.test(contentType)) {
        return 'Script'
      }
      if (/css/.test(contentType)) {
        return 'Stylesheet'
      }
      if (/html/.test(contentType)) {
        return 'Document'
      }
      return 'Other'
    })()

    devtool.send({
      method: 'Network.responseReceived',
      params: {
        requestId: request.id,
        frameId,
        loaderId,
        timestamp: devtool.timestamp,
        type,
        response: {
          url: request.url,
          status: request.responseStatusCode,
          statusText: request.responseStatusCode === 200 ? 'OK' : '',
          headers: request.responseHeaders,
          connectionReused: false,
          encodedDataLength: request.responseInfo.encodedDataLength,
          charset: 'utf-8',
          mimeType: toMimeType(contentType)
        }
      }
    })

    devtool.updateTimestamp()
    devtool.send({
      method: 'Network.dataReceived',
      params: {
        requestId: request.id,
        timestamp: devtool.timestamp,
        dataLength: request.responseInfo.dataLength,
        encodedDataLength: request.responseInfo.encodedDataLength
      }
    })

    devtool.updateTimestamp()
    devtool.send({
      method: 'Network.loadingFinished',
      params: {
        requestId: request.id,
        timestamp: devtool.timestamp,
        encodedDataLength: request.responseInfo.encodedDataLength
      }
    })
  }

  const tryDecompression = (data: Buffer, callback: (result: Buffer) => void) => {
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

  useHandler<{ requestId: string }>('Network.getResponseBody', ({ data, id }) => {
    const request = getRequest(data.requestId)
    if (!id || !request) {
      console.error('request is not found')
      return
    }
    const body = new BodyTransformer(request).decodeBody()

    devtool.send({
      id,
      result: body
    })
  })

  useHandler<RequestDetail>('initRequest', ({ data }) => {
    const request = new RequestDetail(data)
    if (request.initiator) {
      request.initiator.stack.callFrames.forEach((frame) => {
        const fileUrl = pathToFileURL(frame.url)
        const scriptId =
          core.resourceService.getScriptIdByUrl(fileUrl.href) ??
          core.resourceService.getScriptIdByUrl(frame.url)
        if (scriptId) {
          frame.scriptId = scriptId
        }
      })
    }
    requests[request.id] = request
  })

  useHandler<RequestDetail>('registerRequest', ({ data }) => {
    const request = new RequestDetail(data)

    requests[request.id] = request
    // replace callFrames' scriptId
    if (request.initiator) {
      request.initiator.stack.callFrames.forEach((frame) => {
        const fileUrl = pathToFileURL(frame.url)
        const scriptId =
          core.resourceService.getScriptIdByUrl(fileUrl.href) ??
          core.resourceService.getScriptIdByUrl(frame.url)
        if (scriptId) {
          frame.scriptId = scriptId
        }
      })
    }
    devtool.updateTimestamp()

    const headerPipe = new RequestHeaderPipe(request.requestHeaders)
    const contentType = headerPipe.getHeader('content-type')

    return devtool.send({
      method: 'Network.requestWillBeSent',
      params: {
        requestId: request.id,
        frameId,
        loaderId,
        request: {
          url: request.url,
          method: request.method,
          headers: headerPipe.getData(),
          initialPriority: 'High',
          mixedContentType: 'none',
          ...(request.requestData
            ? {
                postData: contentType?.includes('application/json')
                  ? JSON.stringify(request.requestData)
                  : request.requestData
              }
            : {})
        },
        timestamp: devtool.timestamp,
        wallTime: request.requestStartTime,
        initiator: request.initiator,
        type: request.isWebSocket() ? 'WebSocket' : 'Fetch'
      }
    })
  })

  useHandler<RequestDetail>('endRequest', ({ data }) => {
    const request = new RequestDetail(data)
    endRequest(request)
  })

  useHandler<{
    id: string
    rawData: Array<number>
    statusCode: number
    headers: Record<string, string>
  }>('responseData', ({ data }) => {
    const { id, rawData: _rawData, statusCode, headers } = data
    const request = getRequest(id)
    const rawData = Buffer.from(_rawData)
    if (request) {
      request.responseInfo.encodedDataLength = rawData.length
      tryDecompression(rawData, (decodedData) => {
        request.responseData = decodedData
        request.responseInfo.dataLength = decodedData.length
        request.responseStatusCode = statusCode
        request.responseHeaders = new RequestHeaderPipe(headers).getData()
        updateRequest(request)
        endRequest(request)
      })
    }
  })
})

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

    requestDetail.loadCallFrames()

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

/**
 * Check if the response is a Server-Sent Events (SSE) stream
 */
function isEventStream(response: Response): boolean {
  const contentType = response.headers.get('content-type') || ''
  return contentType.includes('text/event-stream')
}

/**
 * Handle SSE (Server-Sent Events) streaming response
 */
async function handleEventStreamResponse(
  response: Response,
  requestDetail: RequestDetail,
  mainProcess: MainProcess
): Promise<void> {
  const body = response.clone().body
  if (!body) {
    return
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const allChunks: Uint8Array[] = []

  // Send responseReceived first (type: EventSource) so DevTools knows this is an SSE request
  mainProcess.send({
    type: 'eventSourceResponseReceived',
    data: requestDetail
  })

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      if (value) {
        allChunks.push(value)
        buffer += decoder.decode(value, { stream: true })

        // Parse SSE events from buffer
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        let currentEventType = 'message'
        let currentEventData = ''
        let currentEventId = ''

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEventType = line.slice(6).trim()
          } else if (line.startsWith('data:')) {
            currentEventData += (currentEventData ? '\n' : '') + line.slice(5).trim()
          } else if (line.startsWith('id:')) {
            currentEventId = line.slice(3).trim()
          } else if (line === '') {
            // Empty line means end of event
            if (currentEventData) {
              mainProcess.send({
                type: 'eventSourceMessage',
                data: {
                  requestId: requestDetail.id,
                  eventName: currentEventType,
                  eventId: currentEventId,
                  data: currentEventData
                }
              })
            }
            // Reset for next event
            currentEventType = 'message'
            currentEventData = ''
            currentEventId = ''
          }
        }
      }
    }

    // Handle any remaining data in buffer
    if (buffer.trim()) {
      const lines = buffer.split('\n')
      let currentEventType = 'message'
      let currentEventData = ''
      let currentEventId = ''

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEventType = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          currentEventData += (currentEventData ? '\n' : '') + line.slice(5).trim()
        } else if (line.startsWith('id:')) {
          currentEventId = line.slice(3).trim()
        }
      }

      if (currentEventData) {
        mainProcess.send({
          type: 'eventSourceMessage',
          data: {
            requestId: requestDetail.id,
            eventName: currentEventType,
            eventId: currentEventId,
            data: currentEventData
          }
        })
      }
    }

    // Combine all chunks for final response data
    const totalLength = allChunks.reduce((acc, chunk) => acc + chunk.length, 0)
    const combinedArray = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of allChunks) {
      combinedArray.set(chunk, offset)
      offset += chunk.length
    }

    requestDetail.responseData = Buffer.from(combinedArray)
    requestDetail.responseInfo.dataLength = totalLength
    requestDetail.responseInfo.encodedDataLength = totalLength
  } catch (error) {
    // Stream was aborted or errored, still try to save what we have
    if (allChunks.length > 0) {
      const totalLength = allChunks.reduce((acc, chunk) => acc + chunk.length, 0)
      const combinedArray = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of allChunks) {
        combinedArray.set(chunk, offset)
        offset += chunk.length
      }
      requestDetail.responseData = Buffer.from(combinedArray)
      requestDetail.responseInfo.dataLength = totalLength
      requestDetail.responseInfo.encodedDataLength = totalLength
    }
  } finally {
    requestDetail.requestEndTime = Date.now()
    mainProcess.sendRequest('updateRequest', requestDetail).sendRequest('endRequest', requestDetail)
  }
}

function fetchResponseHandlerFactory(requestDetail: RequestDetail, mainProcess: MainProcess) {
  return (response: Response) => {
    requestDetail.requestEndTime = new Date().getTime()
    requestDetail.responseHeaders = headersToObject(response.headers)
    requestDetail.responseStatusCode = response.status || 0

    // Check if this is an SSE stream
    if (isEventStream(response)) {
      // Handle SSE asynchronously without blocking the response
      handleEventStreamResponse(response, requestDetail, mainProcess)
      return response
    }

    // Handle regular response
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

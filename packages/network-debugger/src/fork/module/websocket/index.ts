import { IncomingMessage } from 'http'
import { CDPCallFrame } from '../../../common'
import {
  formatHeadersToHeaderText,
  getTimestamp,
  parseRawHeaders,
  stringifyNestedObj
} from '../../../utils'
import { createPlugin, useHandler } from '../common'

export interface WebSocketFrameSent {
  requestId: string
  response: {
    payloadData: string
    opcode: number
    mask: boolean
  }
}

export interface WebSocketCreated {
  requestId: string
  url: string
  initiator: {
    type: string
    stack: {
      callFrames: CDPCallFrame[]
    }
  }
  response: IncomingMessage
}

export const websocketPlugin = createPlugin(({ devtool }) => {
  useHandler<WebSocketCreated>(
    'Network.webSocketCreated',
    async ({ request, data: { response } }) => {
      if (!request) {
        return
      }

      const convertedResponseHeaders = parseRawHeaders(response.rawHeaders)

      await devtool.send({
        method: 'Network.webSocketCreated',
        params: {
          url: request.url,
          initiator: request.initiator,
          requestId: request.id
        }
      })
      await devtool.send({
        method: 'Network.webSocketWillSendHandshakeRequest',
        params: {
          wallTime: Date.now(),
          timestamp: devtool.getTimestamp(),
          requestId: request.id,
          request: {
            headers: request.requestHeaders
          }
        }
      })

      await devtool.send({
        method: 'Network.webSocketHandshakeResponseReceived',
        params: {
          requestId: request.id,
          response: {
            headers: convertedResponseHeaders,
            headersText: formatHeadersToHeaderText(
              `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n`,
              convertedResponseHeaders
            ),
            status: response.statusCode,
            statusText: response.statusMessage,
            requestHeadersText: formatHeadersToHeaderText(
              `${request.method} ${request.url} HTTP/1.1\r\n`,
              request.requestHeaders
            ),
            requestHeaders: stringifyNestedObj(request.requestHeaders)
          },
          timestamp: devtool.getTimestamp()
        }
      })
    }
  )

  useHandler<WebSocketFrameSent>('Network.webSocketFrameSent', async ({ data }) => {
    if (!data.requestId) {
      return
    }

    await devtool.send({
      method: 'Network.webSocketFrameSent',
      params: {
        requestId: data.requestId,
        response: data.response,
        // Network中数据时间戳
        timestamp: getTimestamp()
      }
    })
  })

  useHandler<WebSocketFrameSent>('Network.webSocketFrameReceived', async ({ request, data }) => {
    if (!request) {
      return
    }
    await devtool.send({
      method: 'Network.webSocketFrameReceived',
      params: {
        requestId: data.requestId,
        response: data.response,
        timestamp: getTimestamp()
      }
    })
  })

  useHandler<WebSocketFrameSent>('Network.webSocketClosed', async ({ request }) => {
    if (!request) {
      return
    }
    await devtool.send({
      method: 'Network.webSocketClosed',
      params: {
        requestId: request.id,
        timestamp: getTimestamp()
      }
    })
  })
})

import { IncomingMessage } from 'http'
import { CDPCallFrame } from '../../../common'
import { converHeaderText, convertRawHeaders } from '../../../utils'
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

      const convertedResponseHeaders = convertRawHeaders(response.rawHeaders)

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
            headersText: converHeaderText(
              `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n`,
              convertedResponseHeaders
            ),
            status: response.statusCode,
            statusText: response.statusMessage,
            requestHeadersText: converHeaderText(
              `${request.method} ${request.url} HTTP/1.1\r\n`,
              request.requestHeaders
            ),
            requestHeaders: request.requestHeaders
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
        timestamp: new Date().getTime() / 1000
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
        timestamp: new Date().getTime() / 1000
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
        timestamp: new Date().getTime() / 1000
      }
    })
  })
})

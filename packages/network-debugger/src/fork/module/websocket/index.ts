import { IncomingMessage } from 'http'
import { CDPCallFrame } from '../../../common'
import {
  formatHeadersToHeaderText,
  getTimestamp,
  parseRawHeaders,
  stringifyNestedObj
} from '../../../utils'
import { createPlugin, useHandler } from '../common'
import { NetworkPluginCore } from '../network'

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

export const websocketPlugin = createPlugin('websocket', ({ devtool, core }) => {
  const networkPlugin = core.usePlugin<NetworkPluginCore>('network')

  useHandler<WebSocketCreated>(
    'Network.webSocketCreated',
    async ({ data: { response, requestId } }) => {
      if (!requestId) {
        return
      }
      const request = networkPlugin.getRequest(requestId)
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
              `${request.method} ${request.url} HTTP/${response.httpVersion}\r\n`,
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

  useHandler<WebSocketFrameSent>('Network.webSocketFrameReceived', async ({ data }) => {
    if (!data.requestId) {
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

  useHandler<WebSocketFrameSent>('Network.webSocketClosed', async ({ data }) => {
    if (!data.requestId) {
      return
    }
    await devtool.send({
      method: 'Network.webSocketClosed',
      params: {
        requestId: data.requestId,
        timestamp: getTimestamp()
      }
    })
  })
})

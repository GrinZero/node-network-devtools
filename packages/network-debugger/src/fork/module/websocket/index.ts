import { converHeaderText } from '../../../utils'
import { createPlugin, useHandler } from '../common'

export interface WebSocketFrameSent {
  requestId: string
  response: {
    payloadData: string
    opcode: number
    mask: boolean
  }
}

export const websocketPlugin = createPlugin(({ devtool }) => {
  useHandler('Network.webSocketCreated', async ({ request }) => {
    if (!request) {
      return
    }

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
    console.log('request', request)

    await devtool.send({
      method: 'Network.webSocketHandshakeResponseReceived',
      params: {
        requestId: request.id,
        response: {
          headers: request.requestHeaders,
          headersText: converHeaderText(
            'HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n',
            request.requestHeaders
          ),
          status: 101,
          statusText: 'Switching Protocols',
          requestHeadersText: converHeaderText(
            `GET ${request.url} HTTP/1.1\r\n`,
            request.requestHeaders
          ),
          requestHeaders: request.requestHeaders
        },
        timestamp: devtool.getTimestamp()
      }
    })
  })

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

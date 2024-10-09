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

    await devtool.send({
      method: 'Network.webSocketHandshakeResponseReceived',
      params: {
        requestId: request.id,
        response: {
          headers: request.requestHeaders,
          headersText:
            'HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: BdgHPiCl4i61N6LUTiuXHmOBn8A=\r\ndate: Wed, 09 Oct 2024 06:24:41 GMT\r\nserver: Fly/4788bbd3b (2024-10-04)\r\nvia: 1.1 fly.io\r\nfly-request-id: 01J9QZ6ZMN6DAME1JQK80MV0XW-sin\r\n\r\n',
          status: 101,
          statusText: 'Switching Protocols',
          requestHeadersText:
            'GET wss://echo.websocket.org/ HTTP/1.1\r\nHost: echo.websocket.org\r\nConnection: Upgrade\r\nPragma: no-cache\r\nCache-Control: no-cache\r\nUser-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36\r\nUpgrade: websocket\r\nOrigin: https://echo.websocket.org\r\nSec-WebSocket-Version: 13\r\nAccept-Encoding: gzip, deflate, br, zstd\r\nAccept-Language: zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7\r\nCookie: _ga=GA1.1.726636010.1726221693; _ga_BZ0LYEZXEJ=GS1.1.1728454968.2.1.1728455003.0.0.0\r\nSec-WebSocket-Key: Z04T3Gfogk/a4MIaTYnpMg==\r\nSec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n\r\n',
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
        timestamp: devtool.getTimestamp()
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
        timestamp: devtool.getTimestamp()
      }
    })
  })
})

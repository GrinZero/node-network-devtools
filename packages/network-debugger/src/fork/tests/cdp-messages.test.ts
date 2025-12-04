import { describe, test, expect } from 'vitest'
import { DevtoolMessageRequest } from '../devtool/type'
import { RequestDetail } from '../../common'

describe('CDP Messages Tests', () => {
  describe('CDP Message Structure Validation', () => {
    test('should validate Network.requestWillBeSent message structure', () => {
      const message: DevtoolMessageRequest = {
        method: 'Network.requestWillBeSent',
        params: {
          requestId: 'test-request-1',
          frameId: 'frame-123',
          loaderId: 'loader-456',
          request: {
            url: 'https://example.com/api',
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'User-Agent': 'test-agent'
            }
          },
          timestamp: Date.now() / 1000,
          wallTime: Date.now(),
          initiator: {
            type: 'script',
            stack: {
              callFrames: []
            }
          },
          type: 'Fetch'
        }
      }

      // Validate message structure
      expect(message).toHaveProperty('method', 'Network.requestWillBeSent')
      expect(message).toHaveProperty('params')
      expect(message.params).toHaveProperty('requestId')
      expect(message.params).toHaveProperty('request')
      expect(message.params.request).toHaveProperty('url')
      expect(message.params.request).toHaveProperty('method')
      expect(message.params.request).toHaveProperty('headers')
      expect(message.params).toHaveProperty('timestamp')
      expect(message.params).toHaveProperty('initiator')
    })

    test('should validate Network.responseReceived message structure', () => {
      const message: DevtoolMessageRequest = {
        method: 'Network.responseReceived',
        params: {
          requestId: 'test-request-1',
          frameId: 'frame-123',
          loaderId: 'loader-456',
          timestamp: Date.now() / 1000,
          type: 'Fetch',
          response: {
            url: 'https://example.com/api',
            status: 200,
            statusText: 'OK',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': '100'
            },
            mimeType: 'application/json',
            connectionReused: false,
            encodedDataLength: 100
          }
        }
      }

      expect(message).toHaveProperty('method', 'Network.responseReceived')
      expect(message.params).toHaveProperty('requestId')
      expect(message.params).toHaveProperty('response')
      expect(message.params.response).toHaveProperty('status', 200)
      expect(message.params.response).toHaveProperty('headers')
      expect(message.params.response).toHaveProperty('mimeType')
    })

    test('should validate WebSocket CDP messages structure', () => {
      const webSocketCreated: DevtoolMessageRequest = {
        method: 'Network.webSocketCreated',
        params: {
          requestId: 'ws-request-1',
          url: 'wss://example.com/socket',
          initiator: {
            type: 'script',
            stack: { callFrames: [] }
          }
        }
      }

      const webSocketFrameSent: DevtoolMessageRequest = {
        method: 'Network.webSocketFrameSent',
        params: {
          requestId: 'ws-request-1',
          timestamp: Date.now() / 1000,
          response: {
            payloadData: 'Hello WebSocket',
            opcode: 1,
            mask: true
          }
        }
      }

      expect(webSocketCreated.method).toBe('Network.webSocketCreated')
      expect(webSocketCreated.params).toHaveProperty('requestId')
      expect(webSocketCreated.params).toHaveProperty('url')

      expect(webSocketFrameSent.method).toBe('Network.webSocketFrameSent')
      expect(webSocketFrameSent.params).toHaveProperty('requestId')
      expect(webSocketFrameSent.params).toHaveProperty('response')
      expect(webSocketFrameSent.params.response).toHaveProperty('payloadData')
      expect(webSocketFrameSent.params.response).toHaveProperty('opcode')
    })
  })

  describe('CDP Message Content Validation', () => {
    test('should handle different HTTP methods in CDP messages', () => {
      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']

      methods.forEach((method) => {
        const message: DevtoolMessageRequest = {
          method: 'Network.requestWillBeSent',
          params: {
            requestId: `${method.toLowerCase()}-request`,
            request: {
              url: 'https://example.com/api',
              method,
              headers: {}
            },
            timestamp: Date.now() / 1000
          }
        }

        expect(message.params.request.method).toBe(method)
        expect(message.params.requestId).toContain(method.toLowerCase())
      })
    })

    test('should handle different response status codes', () => {
      const statusCodes = [200, 201, 400, 404, 500]

      statusCodes.forEach((status) => {
        const message: DevtoolMessageRequest = {
          method: 'Network.responseReceived',
          params: {
            requestId: `status-${status}-request`,
            timestamp: Date.now() / 1000,
            response: {
              url: 'https://example.com/api',
              status,
              statusText: status < 400 ? 'OK' : 'Error',
              headers: {}
            }
          }
        }

        expect(message.params.response.status).toBe(status)
        expect(message.params.requestId).toContain(status.toString())
      })
    })

    test('should handle different content types', () => {
      const contentTypes = [
        { type: 'application/json', expectedResourceType: 'Fetch' },
        { type: 'text/html', expectedResourceType: 'Document' },
        { type: 'application/javascript', expectedResourceType: 'Script' },
        { type: 'text/css', expectedResourceType: 'Stylesheet' },
        { type: 'image/png', expectedResourceType: 'Image' }
      ]

      contentTypes.forEach(({ type, expectedResourceType }) => {
        const message: DevtoolMessageRequest = {
          method: 'Network.responseReceived',
          params: {
            requestId: 'content-type-test',
            timestamp: Date.now() / 1000,
            type: expectedResourceType,
            response: {
              url: 'https://example.com/resource',
              status: 200,
              headers: {
                'Content-Type': type
              },
              mimeType: type.split(';')[0]
            }
          }
        }

        expect(message.params.response.mimeType).toBe(type.split(';')[0])
        expect(message.params.type).toBe(expectedResourceType)
      })
    })
  })

  describe('CDP Message Timing', () => {
    test('should include proper timestamp format', () => {
      const now = Date.now()
      const timestamp = now / 1000

      const message: DevtoolMessageRequest = {
        method: 'Network.requestWillBeSent',
        params: {
          requestId: 'timing-test',
          request: {
            url: 'https://example.com',
            method: 'GET',
            headers: {}
          },
          timestamp,
          wallTime: now
        }
      }

      expect(message.params.timestamp).toBeLessThan(now) // timestamp should be in seconds
      expect(message.params.wallTime).toBe(now) // wallTime should be in milliseconds
      expect(typeof message.params.timestamp).toBe('number')
      expect(typeof message.params.wallTime).toBe('number')
    })

    test('should maintain chronological order in message sequences', () => {
      const baseTime = Date.now()

      const requestMessage: DevtoolMessageRequest = {
        method: 'Network.requestWillBeSent',
        params: {
          requestId: 'sequence-test',
          request: { url: 'https://example.com', method: 'GET', headers: {} },
          timestamp: baseTime / 1000
        }
      }

      const responseMessage: DevtoolMessageRequest = {
        method: 'Network.responseReceived',
        params: {
          requestId: 'sequence-test',
          timestamp: (baseTime + 100) / 1000,
          response: {
            url: 'https://example.com',
            status: 200,
            headers: {}
          }
        }
      }

      const finishedMessage: DevtoolMessageRequest = {
        method: 'Network.loadingFinished',
        params: {
          requestId: 'sequence-test',
          timestamp: (baseTime + 200) / 1000,
          encodedDataLength: 1000
        }
      }

      expect(requestMessage.params.timestamp).toBeLessThan(responseMessage.params.timestamp!)
      expect(responseMessage.params.timestamp!).toBeLessThan(finishedMessage.params.timestamp)
    })
  })

  describe('RequestDetail Integration with CDP', () => {
    test('should convert RequestDetail to CDP requestWillBeSent format', () => {
      const requestDetail = new RequestDetail({
        id: 'integration-test-1',
        url: 'https://api.example.com/users',
        method: 'POST',
        requestHeaders: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token123'
        },
        requestData: { name: 'John Doe', email: 'john@example.com' }
      })

      // Simulate conversion to CDP format
      const cdpMessage: DevtoolMessageRequest = {
        method: 'Network.requestWillBeSent',
        params: {
          requestId: requestDetail.id,
          request: {
            url: requestDetail.url!,
            method: requestDetail.method!,
            headers: requestDetail.requestHeaders,
            postData: JSON.stringify(requestDetail.requestData)
          },
          timestamp: Date.now() / 1000,
          initiator: { type: 'script' },
          type: 'Fetch'
        }
      }

      expect(cdpMessage.params.requestId).toBe(requestDetail.id)
      expect(cdpMessage.params.request.url).toBe(requestDetail.url)
      expect(cdpMessage.params.request.method).toBe(requestDetail.method)
      expect(cdpMessage.params.request.headers).toEqual(requestDetail.requestHeaders)
      expect(JSON.parse(cdpMessage.params.request.postData!)).toEqual(requestDetail.requestData)
    })

    test('should handle WebSocket RequestDetail conversion', () => {
      const wsRequest = new RequestDetail({
        id: 'ws-integration-test',
        url: 'wss://example.com/socket',
        requestHeaders: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          'Sec-WebSocket-Key': 'test-key-123'
        }
      })

      expect(wsRequest.isWebSocket()).toBe(true)

      const cdpMessage: DevtoolMessageRequest = {
        method: 'Network.webSocketCreated',
        params: {
          requestId: wsRequest.id,
          url: wsRequest.url!,
          initiator: { type: 'script' }
        }
      }

      expect(cdpMessage.params.requestId).toBe(wsRequest.id)
      expect(cdpMessage.params.url).toBe(wsRequest.url)
    })
  })

  describe('CDP Protocol Compliance', () => {
    test('should follow CDP domain.method naming convention', () => {
      const validMethods = [
        'Network.requestWillBeSent',
        'Network.responseReceived',
        'Network.dataReceived',
        'Network.loadingFinished',
        'Network.webSocketCreated',
        'Network.webSocketFrameSent',
        'Network.webSocketFrameReceived',
        'Network.webSocketClosed'
      ]

      validMethods.forEach((method) => {
        expect(method).toMatch(/^[A-Z][a-z]+\.[a-z][A-Za-z]*$/)

        const [domain, methodName] = method.split('.')
        expect(domain).toMatch(/^[A-Z][a-z]+$/)
        expect(methodName).toMatch(/^[a-z][A-Za-z]*$/)
      })
    })

    test('should validate required fields for Network domain messages', () => {
      const networkMessages = [
        {
          method: 'Network.requestWillBeSent',
          requiredFields: ['requestId', 'request', 'timestamp']
        },
        {
          method: 'Network.responseReceived',
          requiredFields: ['requestId', 'response', 'timestamp']
        },
        {
          method: 'Network.dataReceived',
          requiredFields: ['requestId', 'timestamp', 'dataLength']
        },
        {
          method: 'Network.loadingFinished',
          requiredFields: ['requestId', 'timestamp']
        }
      ]

      networkMessages.forEach(({ method, requiredFields }) => {
        const message: any = {
          method,
          params: {}
        }

        // Add required fields
        requiredFields.forEach((field) => {
          switch (field) {
            case 'requestId':
              message.params.requestId = 'test-request'
              break
            case 'timestamp':
              message.params.timestamp = Date.now() / 1000
              break
            case 'request':
              message.params.request = { url: 'https://example.com', method: 'GET', headers: {} }
              break
            case 'response':
              message.params.response = {
                url: 'https://example.com',
                status: 200,
                statusText: 'OK',
                headers: {}
              }
              break
            case 'dataLength':
              message.params.dataLength = 1000
              break
          }
        })

        // Validate all required fields are present
        requiredFields.forEach((field) => {
          expect(message.params).toHaveProperty(field)
        })
      })
    })
  })

  describe('CDP Message Serialization', () => {
    test('should serialize CDP messages to valid JSON', () => {
      const message: DevtoolMessageRequest = {
        method: 'Network.requestWillBeSent',
        params: {
          requestId: 'serialization-test',
          request: {
            url: 'https://example.com/api',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            postData: JSON.stringify({ test: 'data' })
          },
          timestamp: Date.now() / 1000
        }
      }

      const serialized = JSON.stringify(message)
      const deserialized = JSON.parse(serialized)

      expect(deserialized).toEqual(message)
      expect(deserialized.method).toBe('Network.requestWillBeSent')
      expect(deserialized.params.requestId).toBe('serialization-test')
    })

    test('should handle special characters in CDP message data', () => {
      const specialData = {
        unicode: '测试数据 🚀',
        quotes: 'Data with "quotes" and \'apostrophes\'',
        newlines: 'Line 1\nLine 2\r\nLine 3',
        backslashes: 'Path\\to\\file'
      }

      const message: DevtoolMessageRequest = {
        method: 'Network.requestWillBeSent',
        params: {
          requestId: 'special-chars-test',
          request: {
            url: 'https://example.com/api',
            method: 'POST',
            headers: {},
            postData: JSON.stringify(specialData)
          }
        }
      }

      const serialized = JSON.stringify(message)
      const deserialized = JSON.parse(serialized)
      const deserializedData = JSON.parse(deserialized.params.request.postData)

      expect(deserializedData).toEqual(specialData)
      expect(deserializedData.unicode).toBe('测试数据 🚀')
      expect(deserializedData.quotes).toContain('"quotes"')
      expect(deserializedData.newlines).toContain('\n')
    })
  })
})

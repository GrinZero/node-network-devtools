import { vi, expect } from 'vitest'
import { DevtoolMessage, DevtoolMessageRequest, DevtoolMessageResponse } from '../devtool/type'
import { RequestDetail } from '../../common'
import { RequestCenter } from '../request-center'

/**
 * Mock DevtoolServer for testing CDP messages
 */
export class MockDevtoolServer {
  public timestamp = 0
  private startTime = Date.now()
  public sentMessages: DevtoolMessage[] = []
  public listeners: ((error: unknown | null, message?: any) => void)[] = []

  constructor() {
    this.updateTimestamp()
  }

  public getTimestamp() {
    this.updateTimestamp()
    return this.timestamp
  }

  public updateTimestamp() {
    this.timestamp = (Date.now() - this.startTime) / 1000
  }

  public on(listener: (error: unknown | null, message?: any) => void) {
    this.listeners.push(listener)
  }

  public async send(message: DevtoolMessage) {
    this.sentMessages.push(message)
    return Promise.resolve(message)
  }

  public close() {
    // Mock implementation
  }

  public async open() {
    // Mock implementation
  }

  // Helper methods for testing
  public clearSentMessages() {
    this.sentMessages = []
  }

  public getLastSentMessage(): DevtoolMessage | undefined {
    return this.sentMessages[this.sentMessages.length - 1]
  }

  public getSentMessagesByMethod(method: string): DevtoolMessage[] {
    return this.sentMessages.filter((msg) => 'method' in msg && msg.method === method)
  }

  public simulateIncomingMessage(message: DevtoolMessageRequest | DevtoolMessageResponse) {
    this.listeners.forEach((listener) => listener(null, message))
  }
}

/**
 * Mock RequestCenter for testing
 */
export class MockRequestCenter {
  private listeners: Record<string, Set<any>> = {}
  private mockDevtool: MockDevtoolServer

  constructor(mockDevtool: MockDevtoolServer) {
    this.mockDevtool = mockDevtool
  }

  public on(method: string, listener: any) {
    if (!this.listeners[method]) {
      this.listeners[method] = new Set()
    }
    this.listeners[method]!.add(listener)
    return () => {
      this.listeners[method]!.delete(listener)
    }
  }

  public emit(method: string, data: any, id?: string) {
    const listeners = this.listeners[method]
    if (listeners) {
      listeners.forEach((listener) => {
        listener({ data, id })
      })
    }
  }

  public usePlugin<T = null>(id: string): T {
    return null as T
  }

  public close() {
    // Mock implementation
  }
}

/**
 * Create a mock request detail for testing
 */
export function createMockRequestDetail(overrides: Partial<RequestDetail> = {}): RequestDetail {
  const defaultRequest = new RequestDetail({
    id: '1',
    url: 'https://example.com/api/test',
    method: 'GET',
    requestHeaders: {
      'Content-Type': 'application/json',
      'User-Agent': 'test-agent'
    },
    requestStartTime: Date.now(),
    ...overrides
  })

  return defaultRequest
}

/**
 * Create a mock WebSocket request detail
 */
export function createMockWebSocketRequest(overrides: Partial<RequestDetail> = {}): RequestDetail {
  return createMockRequestDetail({
    url: 'wss://example.com/websocket',
    requestHeaders: {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Key': 'test-key',
      'Sec-WebSocket-Version': '13'
    },
    ...overrides
  })
}

/**
 * Helper to create CDP message expectations
 */
export interface CDPMessageExpectation {
  method: string
  params?: Record<string, any>
  requiredFields?: string[]
}

/**
 * Assert that a CDP message matches expectations
 */
export function assertCDPMessage(message: DevtoolMessage, expectation: CDPMessageExpectation) {
  if (!('method' in message)) {
    throw new Error('Expected message to have method property')
  }

  if (message.method !== expectation.method) {
    throw new Error(`Expected method ${expectation.method}, got ${message.method}`)
  }

  if (expectation.params) {
    if (!('params' in message)) {
      throw new Error('Expected message to have params property')
    }

    for (const [key, value] of Object.entries(expectation.params)) {
      if (message.params[key] !== value) {
        throw new Error(`Expected params.${key} to be ${value}, got ${message.params[key]}`)
      }
    }
  }

  if (expectation.requiredFields) {
    if (!('params' in message)) {
      throw new Error('Expected message to have params property')
    }

    for (const field of expectation.requiredFields) {
      if (!(field in message.params)) {
        throw new Error(`Expected params to have field ${field}`)
      }
    }
  }
}

/**
 * Create a test plugin context
 */
export function createTestPluginContext(
  mockDevtool?: MockDevtoolServer,
  mockCore?: MockRequestCenter
) {
  const devtool = mockDevtool || new MockDevtoolServer()
  const core = mockCore || new MockRequestCenter(devtool)

  return {
    devtool,
    core,
    plugins: []
  }
}

/**
 * Mock network plugin core for testing
 */
export class MockNetworkPluginCore {
  private requests: Record<string, RequestDetail> = {}

  public getRequest(id: string): RequestDetail | undefined {
    return this.requests[id]
  }

  public addRequest(request: RequestDetail) {
    this.requests[request.id] = request
  }

  public clearRequests() {
    this.requests = {}
  }

  public get resourceService() {
    return {
      getScriptIdByUrl: vi.fn().mockReturnValue('script-id-123')
    }
  }
}

/**
 * Helper to wait for async operations in tests
 */
export function waitForNextTick(): Promise<void> {
  return new Promise((resolve) => process.nextTick(resolve))
}

/**
 * Helper to create CDP Network events
 */
export const CDPNetworkEvents = {
  requestWillBeSent: (requestId: string, url: string, method = 'GET') => ({
    method: 'Network.requestWillBeSent',
    params: {
      requestId,
      frameId: '517.528',
      loaderId: '517.529',
      request: {
        url,
        method,
        headers: {},
        initialPriority: 'High',
        mixedContentType: 'none'
      },
      timestamp: expect.any(Number),
      wallTime: expect.any(Number),
      initiator: expect.any(Object),
      type: 'Fetch'
    }
  }),

  responseReceived: (requestId: string, url: string, status = 200) => ({
    method: 'Network.responseReceived',
    params: {
      requestId,
      frameId: '517.528',
      loaderId: '517.529',
      timestamp: expect.any(Number),
      type: expect.any(String),
      response: {
        url,
        status,
        statusText: status === 200 ? 'OK' : '',
        headers: expect.any(Object),
        connectionReused: false,
        encodedDataLength: expect.any(Number),
        charset: 'utf-8',
        mimeType: expect.any(String)
      }
    }
  }),

  dataReceived: (requestId: string) => ({
    method: 'Network.dataReceived',
    params: {
      requestId,
      timestamp: expect.any(Number),
      dataLength: expect.any(Number),
      encodedDataLength: expect.any(Number)
    }
  }),

  loadingFinished: (requestId: string) => ({
    method: 'Network.loadingFinished',
    params: {
      requestId,
      timestamp: expect.any(Number),
      encodedDataLength: expect.any(Number)
    }
  })
}

/**
 * Helper to create CDP WebSocket events
 */
export const CDPWebSocketEvents = {
  webSocketCreated: (requestId: string, url: string) => ({
    method: 'Network.webSocketCreated',
    params: {
      url,
      initiator: expect.any(Object),
      requestId
    }
  }),

  webSocketWillSendHandshakeRequest: (requestId: string) => ({
    method: 'Network.webSocketWillSendHandshakeRequest',
    params: {
      wallTime: expect.any(Number),
      timestamp: expect.any(Number),
      requestId,
      request: {
        headers: expect.any(Object)
      }
    }
  }),

  webSocketHandshakeResponseReceived: (requestId: string) => ({
    method: 'Network.webSocketHandshakeResponseReceived',
    params: {
      requestId,
      response: expect.objectContaining({
        headers: expect.any(Object),
        headersText: expect.any(String),
        status: expect.any(Number),
        statusText: expect.any(String),
        requestHeadersText: expect.any(String),
        requestHeaders: expect.any(Object)
      }),
      timestamp: expect.any(Number)
    }
  }),

  webSocketFrameSent: (requestId: string) => ({
    method: 'Network.webSocketFrameSent',
    params: {
      requestId,
      response: expect.any(Object),
      timestamp: expect.any(Number)
    }
  }),

  webSocketFrameReceived: (requestId: string) => ({
    method: 'Network.webSocketFrameReceived',
    params: {
      requestId,
      response: expect.any(Object),
      timestamp: expect.any(Number)
    }
  }),

  webSocketClosed: (requestId: string) => ({
    method: 'Network.webSocketClosed',
    params: {
      requestId,
      timestamp: expect.any(Number)
    }
  })
}

import { vi, describe, beforeEach, test, expect } from 'vitest'
import { RequestDetail, __filename, __dirname } from './common'

describe('RequestDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    test('should initialize with a unique id and default properties', () => {
      const requestDetail = new RequestDetail()

      expect(requestDetail.id).toBeDefined()
      expect(requestDetail.responseInfo).toEqual({})
      // initiator is only set when loadCallFrames is called
      expect(requestDetail.initiator).toBeUndefined()
    })

    test('should increment id for each new instance', () => {
      const requestDetail1 = new RequestDetail()
      const requestDetail2 = new RequestDetail()

      // IDs should be different (UUIDs)
      expect(requestDetail1.id).not.toBe(requestDetail2.id)
      expect(requestDetail1.id).toBeDefined()
      expect(requestDetail2.id).toBeDefined()
    })

    test('should copy properties from existing RequestDetail', () => {
      const originalRequest = new RequestDetail()
      originalRequest.url = 'https://example.com'
      originalRequest.method = 'POST'
      originalRequest.responseInfo = { dataLength: 100 }

      const copiedRequest = new RequestDetail(originalRequest)

      expect(copiedRequest.id).toBe(originalRequest.id)
      expect(copiedRequest.url).toBe('https://example.com')
      expect(copiedRequest.method).toBe('POST')
      expect(copiedRequest.responseInfo).toEqual({ dataLength: 100 })
    })
  })

  describe('loadCallFrames', () => {
    test('should set initiator when call frames are available', () => {
      const requestDetail = new RequestDetail()

      // Mock stack trace
      const mockStack = `Error
    at testFunction (/path/to/file.js:10:5)
    at anotherFunction (/path/to/another.js:20:10)`

      requestDetail.loadCallFrames(mockStack)

      expect(requestDetail.initiator).toBeDefined()
      expect(requestDetail.initiator?.type).toBe('script')
      expect(requestDetail.initiator?.stack.callFrames).toHaveLength(2)
      expect(requestDetail.initiator?.stack.callFrames[0]).toMatchObject({
        functionName: 'testFunction',
        url: 'file:///path/to/file.js',
        lineNumber: 10,
        columnNumber: 5
      })
    })

    test('should set initiator even with empty stack (current call frames)', () => {
      const requestDetail = new RequestDetail()

      requestDetail.loadCallFrames('')

      // loadCallFrames will always generate some call frames from the current stack
      expect(requestDetail.initiator).toBeDefined()
      expect(requestDetail.initiator?.type).toBe('script')
      expect(requestDetail.initiator?.stack.callFrames).toBeDefined()
    })
  })

  describe('isWebSocket', () => {
    test('should return true for WebSocket requests with Upgrade header', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { Upgrade: 'websocket' }

      expect(requestDetail.isWebSocket()).toBe(true)
    })

    test('should return true for WebSocket requests with lowercase upgrade header', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { upgrade: 'websocket' }

      expect(requestDetail.isWebSocket()).toBe(true)
    })

    test('should return false for non-WebSocket requests', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { 'Content-Type': 'application/json' }

      expect(requestDetail.isWebSocket()).toBe(false)
    })

    test('should return false when no headers are set', () => {
      const requestDetail = new RequestDetail()

      expect(requestDetail.isWebSocket()).toBe(false)
    })
  })

  describe('isHiden', () => {
    test('should return true for hidden localhost WebSocket requests', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { Upgrade: 'websocket' }
      requestDetail.url = 'http://localhost/'

      expect(requestDetail.isHiden()).toBe(true)
    })

    test('should return true for hidden localhost ws requests', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { Upgrade: 'websocket' }
      requestDetail.url = 'ws://localhost/'

      expect(requestDetail.isHiden()).toBe(true)
    })

    test('should return false for non-localhost WebSocket requests', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { Upgrade: 'websocket' }
      requestDetail.url = 'wss://example.com/socket'

      expect(requestDetail.isHiden()).toBe(false)
    })

    test('should return false for non-WebSocket requests', () => {
      const requestDetail = new RequestDetail()
      requestDetail.url = 'http://localhost/'

      expect(requestDetail.isHiden()).toBe(false)
    })
  })
})

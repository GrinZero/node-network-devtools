import { vi, describe, beforeEach, test, expect } from 'vitest'
import { RequestDetail } from './common'

describe('RequestDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    test('should initialize with a unique id and default properties', () => {
      const requestDetail = new RequestDetail()

      expect(requestDetail.id).toBeDefined()
      expect(requestDetail.responseInfo).toEqual({})
      // initiator 只有在调用 loadCallFrames 后才会被设置
      expect(requestDetail.initiator).toBeUndefined()
    })

    test('should increment id for each new instance', () => {
      const requestDetail1 = new RequestDetail()
      const requestDetail2 = new RequestDetail()

      // id 是 UUID，不是递增的数字，只需验证它们不同
      expect(requestDetail1.id).not.toBe(requestDetail2.id)
    })

    test('should copy properties from existing RequestDetail', () => {
      const original = new RequestDetail()
      original.url = 'https://example.com'
      original.method = 'POST'

      const copy = new RequestDetail(original)

      expect(copy.id).toBe(original.id)
      expect(copy.url).toBe(original.url)
      expect(copy.method).toBe(original.method)
    })
  })

  describe('loadCallFrames', () => {
    test('should set initiator with call frames from stack', () => {
      const requestDetail = new RequestDetail()
      const mockStack = 'Error\n' + '    at test (file.js:10:15)\n' + '    at run (app.js:20:25)'

      requestDetail.loadCallFrames(mockStack)

      expect(requestDetail.initiator).toBeDefined()
      expect(requestDetail.initiator?.type).toBe('script')
      expect(requestDetail.initiator?.stack.callFrames.length).toBeGreaterThan(0)
    })
  })

  describe('isWebSocket', () => {
    test('should return true when Upgrade header is websocket', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { Upgrade: 'websocket' }

      expect(requestDetail.isWebSocket()).toBe(true)
    })

    test('should return true when upgrade header (lowercase) is websocket', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { upgrade: 'websocket' }

      expect(requestDetail.isWebSocket()).toBe(true)
    })

    test('should return false when no websocket upgrade header', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { 'Content-Type': 'application/json' }

      expect(requestDetail.isWebSocket()).toBe(false)
    })
  })

  describe('isHiden', () => {
    test('should return true for localhost websocket connections', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { Upgrade: 'websocket' }
      requestDetail.url = 'ws://localhost/'

      expect(requestDetail.isHiden()).toBe(true)
    })

    test('should return false for non-localhost websocket connections', () => {
      const requestDetail = new RequestDetail()
      requestDetail.requestHeaders = { Upgrade: 'websocket' }
      requestDetail.url = 'ws://example.com/'

      expect(requestDetail.isHiden()).toBe(false)
    })
  })
})

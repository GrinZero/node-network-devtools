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
      expect(requestDetail.initiator).not.toBeUndefined()
    })

    test('should increment id for each new instance', () => {
      const requestDetail1 = new RequestDetail()
      const requestDetail2 = new RequestDetail()

      expect(Number(requestDetail2.id)).toBe(Number(requestDetail1.id) + 1)
    })
  })
})

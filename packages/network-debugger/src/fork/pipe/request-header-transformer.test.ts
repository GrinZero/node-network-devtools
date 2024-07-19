import { RequestHeaderPipe } from './request-header-transformer'
import { describe, test, expect } from 'vitest'

describe('RequestHeaderPipe', () => {
  describe('constructor', () => {
    test('should initialize with empty headers when no headers are provided', () => {
      const requestHeaderPipe = new RequestHeaderPipe()
      expect(requestHeaderPipe.getData()).toEqual({})
    })

    test('should initialize with provided headers', () => {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
      const requestHeaderPipe = new RequestHeaderPipe(headers)
      expect(requestHeaderPipe.getData()).toEqual(headers)
    })
  })

  describe('getHeader', () => {
    test('should return the value of the header if it exists (case-insensitive)', () => {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
      const requestHeaderPipe = new RequestHeaderPipe(headers)

      expect(requestHeaderPipe.getHeader('content-type')).toBe('application/json')
      expect(requestHeaderPipe.getHeader('Content-Type')).toBe('application/json')
    })

    test('should return undefined if the header does not exist', () => {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
      const requestHeaderPipe = new RequestHeaderPipe(headers)

      expect(requestHeaderPipe.getHeader('Authorization')).toBeUndefined()
    })
  })

  describe('getData', () => {
    test('should return all headers', () => {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
      const requestHeaderPipe = new RequestHeaderPipe(headers)

      expect(requestHeaderPipe.getData()).toEqual(headers)
    })
  })

  describe('valueOf', () => {
    test('should return the headers object', () => {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
      const requestHeaderPipe = new RequestHeaderPipe(headers)

      expect(requestHeaderPipe.valueOf()).toEqual(headers)
    })
  })
})

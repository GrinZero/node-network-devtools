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
      expect(requestHeaderPipe.getData()).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json'
      })
    })

    test('should initialize with undefined headers', () => {
      const requestHeaderPipe = new RequestHeaderPipe(undefined)
      expect(requestHeaderPipe.getData()).toEqual({})
    })

    test('should convert non-string header values to strings', () => {
      const headers = {
        'Content-Length': 123,
        'X-Custom-Bool': true,
        'X-Custom-Null': null
      }
      const requestHeaderPipe = new RequestHeaderPipe(headers)
      const data = requestHeaderPipe.getData()

      expect(data['Content-Length']).toBe('123')
      expect(data['X-Custom-Bool']).toBe('true')
      expect(data['X-Custom-Null']).toBe('null')
    })

    test('should create a shallow copy of headers', () => {
      const headers = { 'Content-Type': 'application/json' }
      const requestHeaderPipe = new RequestHeaderPipe(headers)

      // 修改原始对象不应影响 pipe 中的数据
      headers['Content-Type'] = 'text/plain'
      expect(requestHeaderPipe.getData()['Content-Type']).toBe('application/json')
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

    test('should handle mixed case header names', () => {
      const headers = { 'X-Custom-Header': 'value' }
      const requestHeaderPipe = new RequestHeaderPipe(headers)

      expect(requestHeaderPipe.getHeader('x-custom-header')).toBe('value')
      expect(requestHeaderPipe.getHeader('X-CUSTOM-HEADER')).toBe('value')
      expect(requestHeaderPipe.getHeader('X-Custom-Header')).toBe('value')
    })

    test('should return undefined for empty headers', () => {
      const requestHeaderPipe = new RequestHeaderPipe()
      expect(requestHeaderPipe.getHeader('any-header')).toBeUndefined()
    })

    test('should handle headers with empty string values', () => {
      const headers = { 'X-Empty': '' }
      const requestHeaderPipe = new RequestHeaderPipe(headers)
      expect(requestHeaderPipe.getHeader('x-empty')).toBe('')
    })
  })

  describe('getData', () => {
    test('should return all headers', () => {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
      const requestHeaderPipe = new RequestHeaderPipe(headers)

      expect(requestHeaderPipe.getData()).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json'
      })
    })

    test('should return empty object for no headers', () => {
      const requestHeaderPipe = new RequestHeaderPipe()
      expect(requestHeaderPipe.getData()).toEqual({})
    })

    test('should return headers with converted string values', () => {
      const headers = { 'X-Number': 42 }
      const requestHeaderPipe = new RequestHeaderPipe(headers)
      expect(requestHeaderPipe.getData()).toEqual({ 'X-Number': '42' })
    })
  })

  describe('valueOf', () => {
    test('should return the headers object', () => {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
      const requestHeaderPipe = new RequestHeaderPipe(headers)

      expect(requestHeaderPipe.valueOf()).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json'
      })
    })

    test('should return empty object for no headers', () => {
      const requestHeaderPipe = new RequestHeaderPipe()
      expect(requestHeaderPipe.valueOf()).toEqual({})
    })

    test('should return same reference as getData', () => {
      const headers = { 'Content-Type': 'application/json' }
      const requestHeaderPipe = new RequestHeaderPipe(headers)

      expect(requestHeaderPipe.valueOf()).toBe(requestHeaderPipe.getData())
    })
  })

  describe('edge cases', () => {
    test('should handle headers with special characters in values', () => {
      const headers = {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': 'session=abc123; Path=/; HttpOnly'
      }
      const requestHeaderPipe = new RequestHeaderPipe(headers)

      expect(requestHeaderPipe.getHeader('content-type')).toBe('text/html; charset=utf-8')
      expect(requestHeaderPipe.getHeader('set-cookie')).toBe('session=abc123; Path=/; HttpOnly')
    })

    test('should handle headers with numeric keys', () => {
      const headers = { '123': 'numeric-key' }
      const requestHeaderPipe = new RequestHeaderPipe(headers)

      expect(requestHeaderPipe.getHeader('123')).toBe('numeric-key')
    })

    test('should handle many headers', () => {
      const headers: Record<string, string> = {}
      for (let i = 0; i < 100; i++) {
        headers[`X-Header-${i}`] = `value-${i}`
      }
      const requestHeaderPipe = new RequestHeaderPipe(headers)

      expect(requestHeaderPipe.getHeader('x-header-50')).toBe('value-50')
      expect(requestHeaderPipe.getHeader('X-HEADER-99')).toBe('value-99')
    })
  })
})

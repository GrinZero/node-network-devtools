import type { ClientRequest, IncomingMessage } from 'node:http'
import { describe, expect, test, vi } from 'vitest'
import type { RequestFn } from '../core/request'
import {
  findFetchMock,
  findLegacyMock,
  mockableRequestHandler,
  mockedFetchResponse,
  type LegacyMockRule
} from '.'

const rules: readonly LegacyMockRule[] = [
  {
    id: 'service-success',
    match: {
      url: 'http://127.0.0.1:*/service?*',
      method: 'POST',
      headers: { 'x-mode': 'mock' }
    },
    response: {
      status: 201,
      statusText: 'Created by mock',
      headers: { 'content-type': 'application/json', 'x-mock': 'yes' },
      body: '{"mocked":true}'
    }
  }
]

describe('Legacy mocks', () => {
  test('matches URL globs, methods, and case-insensitive request headers', () => {
    expect(
      findLegacyMock(rules, {
        url: 'http://127.0.0.1:43100/service?value=1',
        method: 'post',
        headers: { 'X-Mode': 'mock' }
      })?.id
    ).toBe('service-success')
    expect(
      findLegacyMock(rules, {
        url: 'http://127.0.0.1:43100/service?value=1',
        method: 'GET',
        headers: { 'x-mode': 'mock' }
      })
    ).toBeUndefined()
  })

  test('returns an IncomingMessage-compatible HTTP response without calling the network', async () => {
    const actual = vi.fn() as unknown as RequestFn
    const handler = mockableRequestHandler(actual, false, rules)
    const response = new Promise<{
      status?: number
      headers: IncomingMessage['headers']
      body: string
    }>((resolve) => {
      const request = handler(
        'http://127.0.0.1:43100/service?value=1',
        { method: 'POST', headers: { 'x-mode': 'mock' } },
        (incoming) => {
          const chunks: Buffer[] = []
          incoming.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
          incoming.on('end', () =>
            resolve({
              status: incoming.statusCode,
              headers: incoming.headers,
              body: Buffer.concat(chunks).toString()
            })
          )
        }
      )
      request.write('ignored request payload')
      request.end()
    })

    await expect(response).resolves.toEqual({
      status: 201,
      headers: {
        'content-type': 'application/json',
        'x-mock': 'yes',
        'content-length': '15'
      },
      body: '{"mocked":true}'
    })
    expect(actual).not.toHaveBeenCalled()
  })

  test('delegates unmatched HTTP requests with their original overload', () => {
    const expected = {} as ClientRequest
    const actual = vi.fn(() => expected) as unknown as RequestFn
    const handler = mockableRequestHandler(actual, false, rules)
    const callback = vi.fn()

    expect(handler('http://127.0.0.1:43100/real', callback)).toBe(expected)
    expect(actual).toHaveBeenCalledWith('http://127.0.0.1:43100/real', callback)
  })

  test('mocks Fetch and supports a serialized binary response body', async () => {
    const binaryRule: LegacyMockRule = {
      match: { url: 'https://example.test/binary' },
      response: {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
        bodyBase64: Buffer.from([0, 1, 2, 255]).toString('base64')
      }
    }
    expect(findFetchMock([binaryRule], 'https://example.test/binary')).toBe(binaryRule)
    const response = await mockedFetchResponse(binaryRule)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([0, 1, 2, 255]))
  })
})

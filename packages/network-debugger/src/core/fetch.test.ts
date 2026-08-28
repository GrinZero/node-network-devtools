import { deserialize, serialize } from 'node:v8'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { MainProcess } from './fork'
import { fetchProxyFactory, proxyFetch, SseParser } from './fetch'
import * as cellModule from './hooks/cell'

const cellState = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('./hooks/cell', () => ({
  setCurrentCell: vi.fn((cell: unknown) => {
    cellState.current = cell
  }),
  getCurrentCell: vi.fn(() => cellState.current)
}))

interface JournalEntry {
  transport: 'request' | 'event'
  type: string
  data: any
}

function snapshot<T>(value: T): T {
  return deserialize(serialize(value)) as T
}

function createMainProcess() {
  const journal: JournalEntry[] = []
  const mainProcess: Record<string, any> = {}
  mainProcess.sendRequest = vi.fn((type: string, data: unknown) => {
    journal.push({ transport: 'request', type, data: snapshot(data) })
    return mainProcess
  })
  mainProcess.send = vi.fn(async (event: { type: string; data: unknown }) => {
    journal.push({ transport: 'event', type: event.type, data: snapshot(event.data) })
  })
  return { journal, mainProcess: mainProcess as MainProcess }
}

function fetchMock(response: Response): typeof fetch {
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' }
  })
}

async function waitFor(journal: JournalEntry[], type: string): Promise<JournalEntry> {
  await vi.waitFor(() => expect(journal.some((entry) => entry.type === type)).toBe(true))
  return journal.find((entry) => entry.type === type)!
}

describe('fetch capture', () => {
  let savedFetch: typeof globalThis.fetch | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    cellState.current = null
    savedFetch = globalThis.fetch
  })

  afterEach(() => {
    if (savedFetch) globalThis.fetch = savedFetch
    else Reflect.deleteProperty(globalThis, 'fetch')
  })

  test('installs and unsets the global proxy without overwriting a later owner', () => {
    const original = vi.fn() as unknown as typeof fetch
    globalThis.fetch = original
    const { mainProcess } = createMainProcess()

    const unset = proxyFetch(mainProcess)!
    expect(globalThis.fetch).not.toBe(original)
    unset()
    expect(globalThis.fetch).toBe(original)

    const unsetAgain = proxyFetch(mainProcess)!
    const replacement = vi.fn() as unknown as typeof fetch
    globalThis.fetch = replacement
    unsetAgain()
    expect(globalThis.fetch).toBe(replacement)
  })

  test('does nothing when the runtime has no global fetch', () => {
    Reflect.deleteProperty(globalThis, 'fetch')
    const { mainProcess } = createMainProcess()
    expect(proxyFetch(mainProcess)).toBeUndefined()
  })

  test('captures a Request URL, merged headers, body, and a seconds timestamp', async () => {
    const response = new Response(null, { status: 204 })
    const original = fetchMock(response)
    const { journal, mainProcess } = createMainProcess()
    const request = new Request('http://127.0.0.1:43871/actual?value=1', {
      method: 'PUT',
      headers: { 'X-From-Request': 'base' }
    })
    const before = Date.now() / 1000

    await fetchProxyFactory(original, mainProcess)(request, {
      method: 'PATCH',
      headers: { 'X-From-Options': 'override' },
      body: 'payload'
    })
    const after = Date.now() / 1000

    const detail = journal.find((entry) => entry.type === 'initRequest')!.data
    expect(detail).toMatchObject({
      url: 'http://127.0.0.1:43871/actual?value=1',
      method: 'PATCH',
      requestData: 'payload',
      requestHeaders: {
        'x-from-request': 'base',
        'x-from-options': 'override'
      }
    })
    expect(detail.requestStartTime).toBeGreaterThanOrEqual(before)
    expect(detail.requestStartTime).toBeLessThanOrEqual(after)
    expect(detail.requestStartTime).toBeLessThan(10_000_000_000)
    expect(original).toHaveBeenCalledWith(request, expect.objectContaining({ body: 'payload' }))
  })

  test('emits responseReceived before the terminal body event', async () => {
    const response = new Response('captured body', {
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'text/plain', 'x-result': 'yes' }
    })
    const { journal, mainProcess } = createMainProcess()

    const returned = await fetchProxyFactory(
      fetchMock(response),
      mainProcess
    )('https://example.test/resource')
    const terminal = await waitFor(journal, 'endRequest')

    expect(returned).toBe(response)
    expect(journal.map(({ type }) => type)).toEqual([
      'initRequest',
      'registerRequest',
      'responseReceived',
      'endRequest'
    ])
    const received = journal.find((entry) => entry.type === 'responseReceived')!.data
    expect(received).toMatchObject({
      responseStatusCode: 201,
      responseStatusText: 'Created',
      responseHeaders: { 'content-type': 'text/plain', 'x-result': 'yes' }
    })
    expect(Buffer.from(terminal.data.responseData).toString()).toBe('captured body')
    expect(terminal.data.responseInfo).toEqual({ dataLength: 13, encodedDataLength: 13 })
    expect(terminal.data.requestEndTime).toBeLessThan(10_000_000_000)
    expect(cellState.current).toBeNull()
  })

  test('reports a rejected fetch only as requestFailed and rethrows it', async () => {
    const failure = new Error('connection refused')
    const original = vi.fn().mockRejectedValue(failure) as unknown as typeof fetch
    const { journal, mainProcess } = createMainProcess()

    await expect(
      fetchProxyFactory(original, mainProcess)('http://127.0.0.1:49999/unavailable')
    ).rejects.toBe(failure)

    expect(journal.map(({ type }) => type)).toEqual([
      'initRequest',
      'registerRequest',
      'requestFailed'
    ])
    const failed = journal.at(-1)!.data
    expect(failed.errorText).toBe('connection refused')
    expect(failed.request.requestEndTime).toBeLessThan(10_000_000_000)
    expect(cellState.current).toBeNull()
  })

  test('reports body-capture failure after headers without a successful terminal event', async () => {
    const response = {
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/octet-stream' }),
      clone: () => ({ arrayBuffer: () => Promise.reject(new Error('stream reset')) })
    } as unknown as Response
    const { journal, mainProcess } = createMainProcess()

    await fetchProxyFactory(fetchMock(response), mainProcess)('https://example.test/reset')
    await waitFor(journal, 'requestFailed')

    expect(journal.map(({ type }) => type)).toEqual([
      'initRequest',
      'registerRequest',
      'responseReceived',
      'requestFailed'
    ])
    expect(journal.some(({ type }) => type === 'endRequest')).toBe(false)
    expect(journal.at(-1)!.data).toMatchObject({ errorText: 'stream reset', canceled: true })
  })

  test('SseParser handles split CRLF delimiters, multiline data, and persistent ids', () => {
    const messages: Array<{ eventName: string; eventId: string; data: string }> = []
    const parser = new SseParser((message) => messages.push(message))

    parser.push('id: 7\r')
    parser.push('\nevent: update\r\ndata: first\r')
    parser.push('\ndata: second\r\n\r')
    parser.push('\n: ignored\r\ndata: tail')
    parser.finish()

    expect(messages).toEqual([
      { eventName: 'update', eventId: '7', data: 'first\nsecond' },
      { eventName: 'message', eventId: '7', data: 'tail' }
    ])
  })

  test('SseParser flushes an unterminated final event and ignores events without data', () => {
    const messages: Array<{ eventName: string; eventId: string; data: string }> = []
    const parser = new SseParser((message) => messages.push(message))

    parser.push('event: ignored\n\nid: stable\n')
    parser.finish('data: final')

    expect(messages).toEqual([{ eventName: 'message', eventId: 'stable', data: 'final' }])
  })

  test('streams SSE messages across chunks before one successful terminal event', async () => {
    const chunks = [
      'id: 7\r',
      '\nevent: update\r\ndata: first\r',
      '\ndata: second\r\n\r',
      '\ndata: tail'
    ]
    const response = streamResponse(chunks)
    const { journal, mainProcess } = createMainProcess()

    await fetchProxyFactory(fetchMock(response), mainProcess)('http://127.0.0.1:43777/events')
    const terminal = await waitFor(journal, 'endRequest')

    expect(journal.map(({ type }) => type)).toEqual([
      'initRequest',
      'registerRequest',
      'eventSourceResponseReceived',
      'eventSourceMessage',
      'eventSourceMessage',
      'endRequest'
    ])
    expect(
      journal
        .filter(({ type }) => type === 'eventSourceMessage')
        .map(({ data }) => ({ eventName: data.eventName, eventId: data.eventId, data: data.data }))
    ).toEqual([
      { eventName: 'update', eventId: '7', data: 'first\nsecond' },
      { eventName: 'message', eventId: '7', data: 'tail' }
    ])
    expect(Buffer.from(terminal.data.responseData).toString()).toBe(chunks.join(''))
  })

  test('clears only the async-context cell owned by the completing fetch', async () => {
    let resolveFirst!: (response: Response) => void
    const firstFetch = vi.fn(
      () => new Promise<Response>((resolve) => (resolveFirst = resolve))
    ) as unknown as typeof fetch
    const { mainProcess } = createMainProcess()
    const firstPromise = fetchProxyFactory(firstFetch, mainProcess)('https://example.test/first')
    const firstCell = cellState.current

    cellState.current = { request: 'newer context' }
    resolveFirst(new Response('done'))
    await firstPromise

    expect(cellState.current).toEqual({ request: 'newer context' })
    expect(vi.mocked(cellModule.setCurrentCell)).not.toHaveBeenCalledWith(null)
    expect(firstCell).not.toBeNull()
  })
})

import { pathToFileURL } from 'node:url'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import { RequestDetail } from '../../../common'
import type { LegacyRequestFailure, LegacyResponseData } from '../../../legacy-bridge/contracts'
import { BodyTransformer, RequestHeaderPipe } from '../../pipe'
import { ResourceService } from '../../resource-service'
import { CDP_ERROR_CODES } from '../../devtool'
import { createPlugin, useHandler } from '../common'

const gunzip = promisify(zlib.gunzip)
const inflate = promisify(zlib.inflate)
const brotliDecompress = promisify(zlib.brotliDecompress)
const frameId = 'nnd.legacy.frame'
const loaderId = 'nnd.legacy.loader'
const MAX_RETAINED_REQUESTS = 1_000

interface RequestState {
  request: RequestDetail
  requestSent: boolean
  responseSent: boolean
  terminal?: 'finished' | 'failed'
}

export const toMimeType = (contentType: string) => contentType.split(';')[0] || 'text/plain'

function resourceType(contentType: string, eventSource = false) {
  if (eventSource || /text\/event-stream/i.test(contentType)) return 'EventSource'
  if (/image/i.test(contentType)) return 'Image'
  if (/javascript/i.test(contentType)) return 'Script'
  if (/css/i.test(contentType)) return 'Stylesheet'
  if (/html/i.test(contentType)) return 'Document'
  return 'Other'
}

function wallTime(value: number | undefined): number {
  if (!value) return Date.now() / 1000
  return value > 10_000_000_000 ? value / 1000 : value
}

function statusText(request: RequestDetail): string {
  if (request.responseStatusText) return request.responseStatusText
  if (request.responseStatusCode === 200) return 'OK'
  return ''
}

function bufferFrom(value: unknown): Buffer | undefined {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (
    value &&
    typeof value === 'object' &&
    'type' in value &&
    value.type === 'Buffer' &&
    'data' in value &&
    Array.isArray(value.data)
  ) {
    return Buffer.from(value.data)
  }
  return undefined
}

async function decodeContent(data: Buffer, encoding: string | undefined): Promise<Buffer> {
  const normalized = encoding?.split(',')[0]?.trim().toLowerCase()
  try {
    if (normalized === 'gzip' || normalized === 'x-gzip') return await gunzip(data)
    if (normalized === 'deflate') return await inflate(data)
    if (normalized === 'br') return await brotliDecompress(data)
  } catch {
    // Preserve the actual bytes if a server declared a bad encoding. Capture
    // must not turn a successful application response into a protocol failure.
  }
  return data
}

function requestPostData(request: RequestDetail): string | undefined {
  if (request.requestData === undefined || request.requestData === null) return undefined
  const buffer = bufferFrom(request.requestData)
  return buffer ? buffer.toString('utf8') : String(request.requestData)
}

export const networkPlugin = createPlugin('network', ({ devtool }) => {
  const states = new Map<string, RequestState>()
  const resourceService = new ResourceService()
  const announcedScripts = new Set<string>()

  const stateFor = (input: RequestDetail): RequestState => {
    let state = states.get(input.id)
    const request = new RequestDetail(input)
    if (!state) {
      state = { request, requestSent: false, responseSent: false }
      states.set(input.id, state)
    } else {
      state.request = request
    }
    return state
  }

  const trim = () => {
    if (states.size <= MAX_RETAINED_REQUESTS) return
    for (const [id, state] of states) {
      if (!state.terminal) continue
      states.delete(id)
      if (states.size <= MAX_RETAINED_REQUESTS) break
    }
  }

  const mapInitiatorScripts = async (request: RequestDetail) => {
    for (const frame of request.initiator?.stack.callFrames ?? []) {
      let url = frame.url
      if (url && !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url)) {
        try {
          url = pathToFileURL(url).href
        } catch {
          // Keep the original call-frame URL.
        }
      }
      const scriptId =
        resourceService.getScriptIdByUrl(url) ?? resourceService.getScriptIdByUrl(frame.url)
      if (scriptId) {
        frame.scriptId = scriptId
        if (!announcedScripts.has(scriptId)) {
          const descriptor = resourceService
            .getLocalScriptList()
            .find((script) => script.scriptId === scriptId)
          if (descriptor) {
            announcedScripts.add(scriptId)
            await devtool.send({ method: 'Debugger.scriptParsed', params: { ...descriptor } })
          }
        }
      }
    }
  }

  const emitRequest = async (state: RequestState) => {
    if (state.requestSent) return
    state.requestSent = true
    const request = state.request
    await mapInitiatorScripts(request)
    const headers = new RequestHeaderPipe(request.requestHeaders).getData()
    const postData = requestPostData(request)
    await devtool.send({
      method: 'Network.requestWillBeSent',
      params: {
        requestId: request.id,
        frameId,
        loaderId,
        documentURL: request.url,
        request: {
          url: request.url,
          method: request.method ?? 'GET',
          headers,
          initialPriority: 'High',
          mixedContentType: 'none',
          ...(postData !== undefined ? { postData, hasPostData: true } : {})
        },
        timestamp: devtool.getTimestamp(),
        wallTime: wallTime(request.requestStartTime),
        initiator: request.initiator ?? { type: 'other' },
        type: request.isWebSocket() ? 'WebSocket' : 'Fetch'
      }
    })
  }

  const emitResponse = async (state: RequestState, eventSource = false) => {
    if (state.responseSent) return
    if (!state.requestSent) await emitRequest(state)
    state.responseSent = true
    const request = state.request
    const headers = new RequestHeaderPipe(request.responseHeaders).getData()
    const contentType = String(
      new RequestHeaderPipe(headers).getHeader('content-type') ?? 'text/plain; charset=utf-8'
    )
    await devtool.send({
      method: 'Network.responseReceived',
      params: {
        requestId: request.id,
        frameId,
        loaderId,
        timestamp: devtool.getTimestamp(),
        type: resourceType(contentType, eventSource),
        response: {
          url: request.url,
          status: request.responseStatusCode ?? 0,
          statusText: statusText(request),
          headers,
          connectionReused: false,
          encodedDataLength: request.responseInfo.encodedDataLength ?? 0,
          charset: /charset=([^;]+)/i.exec(contentType)?.[1] ?? 'utf-8',
          mimeType: toMimeType(contentType)
        }
      }
    })
  }

  const finish = async (state: RequestState) => {
    if (state.terminal) return
    await emitResponse(state)
    const request = state.request
    const dataLength =
      request.responseInfo.dataLength ?? bufferFrom(request.responseData)?.length ?? 0
    const encodedDataLength = request.responseInfo.encodedDataLength ?? dataLength
    if (dataLength > 0 || encodedDataLength > 0) {
      await devtool.send({
        method: 'Network.dataReceived',
        params: {
          requestId: request.id,
          timestamp: devtool.getTimestamp(),
          dataLength,
          encodedDataLength
        }
      })
    }
    state.terminal = 'finished'
    await devtool.send({
      method: 'Network.loadingFinished',
      params: {
        requestId: request.id,
        timestamp: devtool.getTimestamp(),
        encodedDataLength
      }
    })
    trim()
  }

  const fail = async (failure: LegacyRequestFailure) => {
    const state = stateFor(failure.request)
    if (state.terminal) return
    if (!state.requestSent) await emitRequest(state)
    if ((state.request.responseStatusCode ?? 0) > 0) await emitResponse(state)
    state.terminal = 'failed'
    await devtool.send({
      method: 'Network.loadingFailed',
      params: {
        requestId: state.request.id,
        timestamp: devtool.getTimestamp(),
        type: 'Fetch',
        errorText: failure.errorText || 'Request failed',
        canceled: Boolean(failure.canceled),
        ...(failure.blockedReason ? { blockedReason: failure.blockedReason } : {})
      }
    })
    trim()
  }

  useHandler<{ requestId?: unknown }>(
    'Network.getResponseBody',
    async ({ data, result, error }) => {
      if (typeof data?.requestId !== 'string') {
        await error?.(CDP_ERROR_CODES.INVALID_PARAMS, 'requestId must be a string.')
        return
      }
      const state = states.get(data.requestId)
      if (!state || state.terminal !== 'finished') {
        await error?.(
          CDP_ERROR_CODES.SERVER_ERROR,
          `No finished request with id ${data.requestId}.`
        )
        return
      }
      const body = new BodyTransformer(state.request).decodeBody()
      await result?.({ body: body.body ?? '', base64Encoded: body.base64Encoded })
    }
  )

  useHandler<{ requestId?: unknown }>(
    'Network.getRequestPostData',
    async ({ data, result, error }) => {
      if (typeof data?.requestId !== 'string') {
        await error?.(CDP_ERROR_CODES.INVALID_PARAMS, 'requestId must be a string.')
        return
      }
      const state = states.get(data.requestId)
      const postData = state ? requestPostData(state.request) : undefined
      if (postData === undefined) {
        await error?.(CDP_ERROR_CODES.SERVER_ERROR, `No request body for ${data.requestId}.`)
        return
      }
      await result?.({ postData })
    }
  )

  useHandler<RequestDetail>('initRequest', ({ data }) => {
    stateFor(data)
  })

  useHandler<RequestDetail>('registerRequest', async ({ data }) => {
    const state = stateFor(data)
    await emitRequest(state)
  })

  useHandler<RequestDetail>('updateRequest', ({ data }) => {
    stateFor(data)
  })

  useHandler<RequestDetail>('responseReceived', async ({ data }) => {
    const state = stateFor(data)
    await emitResponse(state)
  })

  useHandler<RequestDetail>('eventSourceResponseReceived', async ({ data }) => {
    const state = stateFor(data)
    await emitResponse(state, true)
  })

  useHandler<RequestDetail>('endRequest', async ({ data }) => {
    const state = stateFor(data)
    if ((state.request.responseStatusCode ?? 0) === 0) {
      await fail({ request: state.request, errorText: 'Request failed' })
      return
    }
    const body = bufferFrom(state.request.responseData) ?? Buffer.alloc(0)
    state.request.responseData = body
    state.request.responseInfo = {
      dataLength: state.request.responseInfo.dataLength ?? body.length,
      encodedDataLength: state.request.responseInfo.encodedDataLength ?? body.length
    }
    await finish(state)
  })

  useHandler<LegacyResponseData>('responseData', async ({ data }) => {
    const state = states.get(data.id)
    if (!state || state.terminal) return
    const raw = bufferFrom(data.rawData) ?? Buffer.alloc(0)
    const decoded = await decodeContent(raw, data.contentEncoding)
    state.request.responseData = decoded
    state.request.responseStatusCode = data.statusCode
    state.request.responseStatusText = data.statusMessage
    state.request.responseHeaders = new RequestHeaderPipe(data.headers).getData()
    state.request.responseInfo = {
      dataLength: decoded.length,
      encodedDataLength: raw.length
    }
    await finish(state)
  })

  useHandler<LegacyRequestFailure>('requestFailed', async ({ data }) => {
    await fail(data)
  })

  useHandler<{
    requestId: string
    eventName: string
    eventId: string
    data: string
  }>('eventSourceMessage', async ({ data }) => {
    const state = states.get(data.requestId)
    if (!state || state.terminal) return
    await devtool.send({
      method: 'Network.eventSourceMessageReceived',
      params: {
        requestId: data.requestId,
        timestamp: devtool.getTimestamp(),
        eventName: data.eventName,
        eventId: data.eventId,
        data: data.data
      }
    })
  })

  return {
    getRequest(id: string) {
      return states.get(id)?.request
    },
    removeRequest(id: string) {
      states.delete(id)
    },
    resourceService,
    requestCount() {
      return states.size
    }
  }
})

export type NetworkPluginCore = ReturnType<typeof networkPlugin>

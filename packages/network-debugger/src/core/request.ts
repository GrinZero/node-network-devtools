import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http'
import type { Socket } from 'node:net'
import { RequestDetail } from '../common'
import type { LegacyWebSocketHandshake } from '../legacy-bridge/contracts'
import type { MainProcess } from './fork'
import { BINARY_TYPES } from './ws/constants'
import { parsePerMessageDeflate } from './ws/extension'
import PerMessageDeflate from './ws/permessage-deflate'
import { Receiver } from './ws/receiver'
import { isLegacyCaptureSuppressed } from './capture-scope'

export interface RequestFn {
  (options: RequestOptions | string | URL, callback?: (res: IncomingMessage) => void): ClientRequest
  (
    url: string | URL,
    options: RequestOptions,
    callback?: (res: IncomingMessage) => void
  ): ClientRequest
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error || 'Request failed')
}

function responseHandshake(response: IncomingMessage): LegacyWebSocketHandshake {
  return {
    httpVersion: response.httpVersion,
    statusCode: response.statusCode ?? 101,
    statusMessage: response.statusMessage ?? 'Switching Protocols',
    rawHeaders: [...response.rawHeaders],
    headers: { ...response.headers }
  }
}

function framePayload(data: unknown, isBinary: boolean): string {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as any)
  return isBinary ? buffer.toString('base64') : buffer.toString('utf8')
}

function cloneExtensionConfigurations(
  configurations: readonly Record<string, readonly (string | true)[]>[]
): Record<string, (string | true)[]>[] {
  return configurations.map((parameters) =>
    Object.fromEntries(Object.entries(parameters).map(([name, values]) => [name, [...values]]))
  )
}

function negotiatedWebSocketExtensions(response: IncomingMessage): {
  receiver: Record<string, PerMessageDeflate>
  sender: Record<string, PerMessageDeflate>
  cleanupReceiver(): void
  cleanupSender(): void
} {
  let receiverExtension: PerMessageDeflate | undefined
  let senderExtension: PerMessageDeflate | undefined

  try {
    const configurations = parsePerMessageDeflate(response.headers['sec-websocket-extensions'])
    if (configurations) {
      // Incoming bytes are server -> client, while intercepted socket writes
      // are client -> server. Each direction needs its own zlib context.
      receiverExtension = new PerMessageDeflate({}, false)
      receiverExtension.accept(cloneExtensionConfigurations(configurations))
      senderExtension = new PerMessageDeflate({}, true)
      senderExtension.accept(cloneExtensionConfigurations(configurations))
    }
  } catch {
    // The owning WebSocket implementation validates the handshake. Capture is
    // observational and must never crash the application for a bad extension.
    receiverExtension?.cleanup()
    senderExtension?.cleanup()
    receiverExtension = undefined
    senderExtension = undefined
  }

  return {
    receiver: receiverExtension ? { [PerMessageDeflate.extensionName]: receiverExtension } : {},
    sender: senderExtension ? { [PerMessageDeflate.extensionName]: senderExtension } : {},
    cleanupReceiver: () => receiverExtension?.cleanup(),
    cleanupSender: () => senderExtension?.cleanup()
  }
}

function writeCapture(receiver: Receiver, data: unknown): void {
  if (receiver.writableEnded || receiver.destroyed) return
  try {
    // Receiver unmasks client frames in place. Always copy so observation can
    // never mutate the bytes that the application is about to put on the wire.
    receiver.write(Buffer.from(data as any))
  } catch {
    // A malformed frame or socket shutdown must not affect application I/O.
  }
}

function endCapture(receiver: Receiver): void {
  if (receiver.writableEnded || receiver.destroyed) return
  try {
    receiver.end()
  } catch {
    // Capture teardown remains isolated from the application socket.
  }
}

function installWebSocketCapture(
  request: ClientRequest,
  requestDetail: RequestDetail,
  mainProcess: MainProcess
): void {
  request.on('upgrade', (response: IncomingMessage, socket: Socket, head: Buffer) => {
    void mainProcess.send({
      type: 'Network.webSocketCreated',
      data: {
        requestId: requestDetail.id,
        url: requestDetail.url ?? '',
        initiator: requestDetail.initiator,
        response: responseHandshake(response)
      }
    })

    const extensions = negotiatedWebSocketExtensions(response)
    const receiver = new Receiver({
      allowSynchronousEvents: true,
      binaryType: BINARY_TYPES[0],
      extensions: extensions.receiver,
      isServer: false
    })
    const sender = new Receiver({
      allowSynchronousEvents: true,
      binaryType: BINARY_TYPES[0],
      extensions: extensions.sender,
      isServer: true
    })

    // Writable reports parser failures asynchronously. Retaining these
    // listeners is what keeps observational capture errors out of user code.
    receiver.on('error', () => undefined)
    sender.on('error', () => undefined)
    let closeRequested = false
    let closeSent = false
    let receiverSettled = false
    let senderSettled = false
    const sendClosedWhenSettled = () => {
      if (!closeRequested || closeSent || !receiverSettled || !senderSettled) return
      closeSent = true
      void mainProcess.send({
        type: 'Network.webSocketClosed',
        data: { requestId: requestDetail.id }
      })
    }
    const settleReceiver = () => {
      if (receiverSettled) return
      receiverSettled = true
      extensions.cleanupReceiver()
      sendClosedWhenSettled()
    }
    const settleSender = () => {
      if (senderSettled) return
      senderSettled = true
      extensions.cleanupSender()
      sendClosedWhenSettled()
    }
    receiver.once('finish', settleReceiver)
    receiver.once('close', settleReceiver)
    sender.once('finish', settleSender)
    sender.once('close', settleSender)

    receiver.on('message', (data: unknown, isBinary: boolean) => {
      void mainProcess.send({
        type: 'Network.webSocketFrameReceived',
        data: {
          requestId: requestDetail.id,
          response: {
            payloadData: framePayload(data, isBinary),
            opcode: isBinary ? 2 : 1,
            mask: false
          }
        }
      })
    })
    sender.on('message', (data: unknown, isBinary: boolean) => {
      void mainProcess.send({
        type: 'Network.webSocketFrameSent',
        data: {
          requestId: requestDetail.id,
          response: {
            payloadData: framePayload(data, isBinary),
            opcode: isBinary ? 2 : 1,
            mask: true
          }
        }
      })
    })

    const originalWrite = socket.write
    socket.write = function (this: Socket, data: any, ...rest: any[]) {
      writeCapture(sender, data)
      return Reflect.apply(originalWrite, this, [data, ...rest])
    } as typeof socket.write

    if (head.length > 0) writeCapture(receiver, head)
    socket.on('data', (data) => writeCapture(receiver, data))

    const close = () => {
      if (closeRequested) return
      closeRequested = true
      endCapture(receiver)
      endCapture(sender)
      sendClosedWhenSettled()
    }
    socket.on('close', close)
    socket.on('end', close)
  })
}

function initialUrl(
  arg1: RequestOptions | string | URL,
  options: RequestOptions | undefined,
  isHttps: boolean
): string {
  if (typeof arg1 === 'string') return arg1
  if (arg1 instanceof URL) return arg1.toString()
  const protocol = options?.protocol ?? (isHttps ? 'https:' : 'http:')
  const hostname = options?.hostname ?? options?.host ?? 'localhost'
  const port = options?.port === undefined ? '' : `:${options.port}`
  return `${protocol}//${hostname}${port}${options?.path ?? '/'}`
}

function requestOptions(
  arg1: RequestOptions | string | URL,
  arg2: RequestOptions | ((response: IncomingMessage) => void) | undefined
): RequestOptions | undefined {
  if (typeof arg1 === 'string' || arg1 instanceof URL) {
    return typeof arg2 === 'object' ? arg2 : undefined
  }
  return arg1
}

function callbackFrom(
  arg2: RequestOptions | ((response: IncomingMessage) => void) | undefined,
  arg3: ((response: IncomingMessage) => void) | undefined
): ((response: IncomingMessage) => void) | undefined {
  return typeof arg2 === 'function' ? arg2 : arg3
}

function invokeRequest(
  actualRequestHandler: RequestFn,
  thisValue: unknown,
  arg1: RequestOptions | string | URL,
  arg2: RequestOptions | ((response: IncomingMessage) => void) | undefined,
  callback: (response: IncomingMessage) => void
): ClientRequest {
  let args: unknown[]
  if (typeof arg1 === 'string' || arg1 instanceof URL) {
    args = typeof arg2 === 'object' ? [arg1, arg2, callback] : [arg1, callback]
  } else {
    args = [arg1, callback]
  }
  return Reflect.apply(actualRequestHandler, thisValue, args)
}

/**
 * Wrap `http.request`/`https.request` without changing their overload or stream
 * semantics. Capture is registered immediately before `end()` (or before an
 * early response/failure) so every `write()` chunk and `end(body)` mutation is
 * visible in the CDP request.
 */
export function requestProxyFactory(
  this: unknown,
  actualRequestHandler: RequestFn,
  isHttps: boolean,
  mainProcess: MainProcess
): RequestFn {
  const thisValue = this
  return function requestProxy(
    arg1: RequestOptions | string | URL,
    arg2?: RequestOptions | ((response: IncomingMessage) => void),
    arg3?: (response: IncomingMessage) => void
  ): ClientRequest {
    if (isLegacyCaptureSuppressed()) {
      const args =
        typeof arg1 === 'string' || arg1 instanceof URL
          ? typeof arg2 === 'object'
            ? [arg1, arg2, arg3]
            : [arg1, arg2]
          : [arg1, arg2]
      return Reflect.apply(actualRequestHandler, thisValue, args)
    }
    const options = requestOptions(arg1, arg2)
    const actualCallback = callbackFrom(arg2, arg3)
    const detail = new RequestDetail()
    detail.requestStartTime = Date.now() / 1000
    detail.url = initialUrl(arg1, options, isHttps)
    detail.method = options?.method ?? 'GET'
    detail.requestHeaders = { ...(options?.headers ?? {}) }
    detail.responseHeaders = {}
    detail.loadCallFrames()

    let responseStarted = false
    let terminal = false
    let request!: ClientRequest

    const fail = (error: unknown, canceled = false) => {
      if (terminal) return
      terminal = true
      register()
      detail.requestEndTime = Date.now() / 1000
      void mainProcess.send({
        type: 'requestFailed',
        data: { request: detail, errorText: errorText(error), canceled }
      })
    }

    const proxyCallback = (response: IncomingMessage) => {
      responseStarted = true
      register()
      detail.responseHeaders = { ...response.headers }
      detail.responseStatusCode = response.statusCode ?? 0
      detail.responseStatusText = response.statusMessage ?? ''
      mainProcess.responseRequest(detail, response)
      actualCallback?.(response)
    }

    request = invokeRequest(actualRequestHandler, thisValue, arg1, arg2, proxyCallback)

    const protocol = (request as ClientRequest & { protocol?: string }).protocol
    const hostHeader = request.getHeader('host')
    const host =
      typeof hostHeader === 'string' || typeof hostHeader === 'number'
        ? String(hostHeader)
        : (request as ClientRequest & { host?: string }).host
    const path = request.path
    if (protocol && host && path) detail.url = `${protocol}//${host}${path}`
    detail.method = request.method || detail.method || 'GET'
    if (typeof request.getHeaders === 'function') detail.requestHeaders = request.getHeaders()
    if (detail.isWebSocket()) {
      detail.url = detail.url?.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
    }

    mainProcess.sendRequest('initRequest', detail)

    const bodyChunks: Buffer[] = []
    let registered = false
    const appendBody = (chunk: unknown, encoding?: BufferEncoding) => {
      if (chunk === undefined || chunk === null) return
      const value = Buffer.isBuffer(chunk)
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk)
          : Buffer.from(String(chunk), encoding)
      bodyChunks.push(value)
    }
    const register = () => {
      if (registered || detail.isWebSocket()) return
      registered = true
      if (typeof request.getHeaders === 'function') detail.requestHeaders = request.getHeaders()
      if (bodyChunks.length > 0) detail.requestData = Buffer.concat(bodyChunks)
      mainProcess.sendRequest('registerRequest', detail)
    }

    const originalWrite = request.write
    request.write = function (
      this: ClientRequest,
      chunk: any,
      encodingOrCallback?: any,
      callback?: any
    ) {
      appendBody(
        chunk,
        typeof encodingOrCallback === 'string' ? (encodingOrCallback as BufferEncoding) : undefined
      )
      return Reflect.apply(originalWrite, this, arguments)
    } as typeof request.write

    const originalEnd = request.end
    request.end = function (
      this: ClientRequest,
      chunk?: any,
      encodingOrCallback?: any,
      callback?: any
    ) {
      if (typeof chunk !== 'function') {
        appendBody(
          chunk,
          typeof encodingOrCallback === 'string'
            ? (encodingOrCallback as BufferEncoding)
            : undefined
        )
      }
      register()
      return Reflect.apply(originalEnd, this, arguments)
    } as typeof request.end

    request.on('error', (error) => fail(error))
    request.on('abort', () => fail(new Error('Request aborted'), true))
    request.on('response', () => {
      responseStarted = true
    })

    if (detail.isWebSocket()) {
      request.on('upgrade', () => {
        // A successful 101 is terminal for ClientRequest; the upgraded socket
        // owns the rest of the lifecycle. Its later request `close` is not an
        // HTTP loading failure.
        responseStarted = true
        terminal = true
      })
      installWebSocketCapture(request, detail, mainProcess)
    }

    // A request can close without an error before receiving headers (for
    // example, a locally destroyed request). Treat only that state as failure.
    request.on('close', () => {
      if (!responseStarted && !terminal && request.destroyed) {
        fail(new Error('Request closed before a response was received'), true)
      }
    })

    return request
  } as RequestFn
}

/** Node implements `get()` as `request()` followed by `end()`. */
export function getProxyFactory(request: RequestFn): RequestFn {
  return function getProxy(this: unknown, ...args: any[]) {
    const clientRequest = Reflect.apply(request, this, args)
    clientRequest.end()
    return clientRequest
  } as RequestFn
}

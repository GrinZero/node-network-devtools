import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { createServer, type Server as HttpServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import type { DevtoolsTarget } from '../../adapters/types'
import type { CdpId } from '../../legacy-bridge/contracts'
import { log } from '../../utils'
import {
  BaseDevtoolServer,
  type DevtoolCommandContext,
  type DevtoolErrorResponse,
  type DevtoolMessage,
  type DevtoolMessageRequest,
  type DevtoolMessageResponse
} from './type'

const LOOPBACK_HOST = '127.0.0.1'
const PROTOCOL_VERSION = '1.3'
export const MAX_BUFFERED_EVENTS = 1_000
export const MAX_BUFFERED_EVENT_BYTES = 10 * 1024 * 1024

export const CDP_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_ERROR: -32000
})

export interface DevtoolServerInitOptions {
  /** Bind port. `0` asks the operating system for a free port. */
  port: number
  /** Only 127.0.0.1 is accepted; the endpoint is never exposed remotely. */
  host?: '127.0.0.1'
  /** Stable identity supplied by the parent so a restarted child keeps its URL. */
  targetId?: string
  title?: string
  /** @deprecated Browser launching is owned by the caller. */
  autoOpenDevtool?: boolean
  onConnect?: () => void
  onClose?: () => void
}

export interface IDevtoolServer {
  readonly ready?: Promise<DevtoolsTarget>
  readonly target?: DevtoolsTarget
  send(message: DevtoolMessage, client?: WebSocket): Promise<unknown>
  close(): Promise<void> | void
  open(): Promise<DevtoolsTarget | void>
}

export class DevtoolServerClosedError extends Error {
  readonly code = 'NND_LEGACY_TARGET_CLOSED'

  constructor() {
    super('Legacy DevTools target closed before a frontend connection became available.')
    this.name = 'DevtoolServerClosedError'
  }
}

export * from './type'

interface CommandScope {
  client: WebSocket
  id: CdpId
  responded: boolean
}

interface ClientWaiter {
  resolve(client: WebSocket): void
  reject(error: Error): void
}

interface BufferedEvent {
  sequence: number
  method: string
  serialized: string
  bytes: number
}

type BuiltinResult = Record<string, unknown> | void

/**
 * A loopback-only, discoverable CDP target used by the Legacy adapter.
 * Events fan out to every frontend while command responses are single-cast.
 */
export class DevtoolServer extends BaseDevtoolServer implements IDevtoolServer {
  readonly ready: Promise<DevtoolsTarget>

  private readonly host = LOOPBACK_HOST
  private readonly port: number
  private readonly title: string
  private readonly targetId: string
  private readonly webSocketPath: string
  private readonly onConnect?: () => void
  private readonly onClose?: () => void
  private readonly commandScope = new AsyncLocalStorage<CommandScope>()
  private readonly clientWaiters = new Set<ClientWaiter>()
  private readonly networkEnabledClients = new WeakSet<WebSocket>()
  private readonly networkReplayingClients = new WeakSet<WebSocket>()
  private readonly networkReplayCursor = new WeakMap<WebSocket, number>()
  private readonly builtinCommands = this.createBuiltinCommands()
  private readonly eventHistory: BufferedEvent[] = []

  private httpServer?: HttpServer
  private webSocketServer?: WebSocketServer
  private startPromise?: Promise<DevtoolsTarget>
  private closePromise?: Promise<void>
  private rejectStart?: (error: Error) => void
  private _target?: DevtoolsTarget
  private closed = false
  private eventSequence = 0
  private eventHistoryBytes = 0

  constructor(options: DevtoolServerInitOptions) {
    super()
    const port = options.port ?? 0
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new RangeError(`Invalid Legacy target port: ${String(port)}`)
    }
    if (options.host !== undefined && options.host !== LOOPBACK_HOST) {
      throw new Error(`Legacy target host must be ${LOOPBACK_HOST}.`)
    }
    if (options.targetId !== undefined && !/^[A-Za-z0-9._-]+$/.test(options.targetId)) {
      throw new Error(
        'Legacy targetId may contain only letters, numbers, dot, underscore and dash.'
      )
    }

    this.port = port
    this.targetId = options.targetId ?? `node-network-devtools-${randomUUID()}`
    this.title = options.title ?? 'Node Network Devtools (Legacy)'
    this.webSocketPath = `/devtools/page/${this.targetId}`
    this.onConnect = options.onConnect
    this.onClose = options.onClose
    this.ready = this.open()
  }

  get target(): DevtoolsTarget | undefined {
    return this._target
  }

  get clientCount(): number {
    return this.webSocketServer?.clients.size ?? 0
  }

  get bufferedEventCount(): number {
    return this.eventHistory.length
  }

  get bufferedEventBytes(): number {
    return this.eventHistoryBytes
  }

  public open(): Promise<DevtoolsTarget> {
    if (this.startPromise) return this.startPromise
    if (this.closed) return Promise.reject(new DevtoolServerClosedError())

    const webSocketServer = new WebSocketServer({ noServer: true })
    const httpServer = createServer((request, response) => {
      this.handleHttpRequest(request.url, response)
    })
    this.webSocketServer = webSocketServer
    this.httpServer = httpServer

    httpServer.on('upgrade', (request, socket, head) => {
      if (this.getPathname(request.url) !== this.webSocketPath) {
        this.rejectUpgrade(socket)
        return
      }
      webSocketServer.handleUpgrade(request, socket, head, (client) => {
        webSocketServer.emit('connection', client, request)
      })
    })

    webSocketServer.on('connection', (client) => this.attachClient(client))
    webSocketServer.on('error', (error) => this.notifyError(error))

    this.startPromise = new Promise<DevtoolsTarget>((resolve, reject) => {
      let settled = false
      this.rejectStart = (error) => {
        if (settled) return
        settled = true
        reject(error)
      }

      httpServer.once('listening', () => {
        if (settled) return
        const address = httpServer.address()
        if (!address || typeof address === 'string') {
          const error = new Error('Legacy target did not expose a TCP address.')
          settled = true
          reject(error)
          return
        }
        const target = this.createTarget(address)
        this._target = target
        settled = true
        log(`legacy target is listening at ${target.discoveryUrl}`)
        resolve(target)
      })

      httpServer.on('error', (error) => {
        this.notifyError(error)
        this.rejectStart?.(error)
      })

      try {
        httpServer.listen(this.port, this.host)
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error))
        this.notifyError(normalized)
        this.rejectStart?.(normalized)
      }
    })

    return this.startPromise
  }

  /** Broadcast events; route responses only to their source connection. */
  public async send(message: DevtoolMessage, client?: WebSocket): Promise<void> {
    if (this.closed) throw new DevtoolServerClosedError()

    if (this.isResponse(message)) {
      const scope = this.commandScope.getStore()
      if (client) {
        if (scope && client === scope.client && message.id === scope.id) scope.responded = true
        await this.sendJson(client, message)
        return
      }
      if (scope && message.id === scope.id) {
        scope.responded = true
        await this.sendJson(scope.client, message)
        return
      }

      const clients = this.liveClients()
      if (clients.length !== 1) {
        throw new Error(
          `Cannot route CDP response ${String(message.id)} without its source client.`
        )
      }
      await this.sendJson(clients[0], message)
      return
    }

    const serialized = JSON.stringify(message)
    const sequence = this.rememberEvent(message.method, serialized)
    const clients = this.liveClients().filter(
      (connectedClient) =>
        !message.method.startsWith('Network.') ||
        (this.networkEnabledClients.has(connectedClient) &&
          !this.networkReplayingClients.has(connectedClient))
    )
    await Promise.all(
      clients.map(async (connectedClient) => {
        await this.sendSerialized(connectedClient, serialized)
        if (message.method.startsWith('Network.') && sequence !== undefined) {
          this.networkReplayCursor.set(connectedClient, sequence)
        }
      })
    )
  }

  /** Explicit connection wait primitive; event delivery itself never waits. */
  public waitForClient(): Promise<WebSocket> {
    const client = this.liveClients()[0]
    if (client) return Promise.resolve(client)
    if (this.closed) return Promise.reject(new DevtoolServerClosedError())
    return new Promise((resolve, reject) => {
      this.clientWaiters.add({ resolve, reject })
    })
  }

  public close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closed = true
    const closedError = new DevtoolServerClosedError()
    this.rejectStart?.(closedError)
    this.rejectClientWaiters(closedError)

    const webSocketServer = this.webSocketServer
    const httpServer = this.httpServer
    this.webSocketServer = undefined
    this.httpServer = undefined
    this._target = undefined
    this.eventHistory.splice(0)
    this.eventHistoryBytes = 0

    this.closePromise = Promise.all([
      new Promise<void>((resolve) => {
        if (!webSocketServer) {
          resolve()
          return
        }
        for (const client of webSocketServer.clients) client.terminate()
        webSocketServer.close(() => resolve())
      }),
      new Promise<void>((resolve) => {
        if (!httpServer) {
          resolve()
          return
        }
        httpServer.close(() => resolve())
        httpServer.closeAllConnections?.()
      })
    ]).then(() => undefined)

    return this.closePromise
  }

  private createTarget(address: AddressInfo): DevtoolsTarget {
    const authority = `${this.host}:${address.port}`
    const webSocketDebuggerUrl = `ws://${authority}${this.webSocketPath}`
    const frontendQuery = `${authority}${this.webSocketPath}`
    return {
      id: this.targetId,
      title: this.title,
      type: 'node',
      url: process.argv[1] ? `file://${process.argv[1]}` : '',
      webSocketDebuggerUrl,
      devtoolsFrontendUrl: `devtools://devtools/bundled/js_app.html?experiments=true&v8only=true&ws=${frontendQuery}`,
      devtoolsFrontendUrlCompat: `devtools://devtools/bundled/inspector.html?experiments=true&v8only=true&ws=${frontendQuery}`,
      discoveryUrl: `http://${authority}/json/list`
    }
  }

  private handleHttpRequest(rawUrl: string | undefined, response: ServerResponse) {
    const pathname = this.getPathname(rawUrl)
    if (pathname === '/json' || pathname === '/json/list') {
      this.writeJson(response, this._target ? [this._target] : [])
      return
    }
    if (pathname === '/json/version') {
      this.writeJson(response, {
        Browser: 'node-network-devtools/2',
        'Protocol-Version': PROTOCOL_VERSION,
        'User-Agent': `Node.js/${process.version}`,
        'V8-Version': process.versions.v8,
        webSocketDebuggerUrl: this._target?.webSocketDebuggerUrl
      })
      return
    }
    if (pathname === '/json/protocol') {
      this.writeJson(response, LEGACY_CDP_PROTOCOL)
      return
    }

    response.writeHead(404, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    })
    response.end(JSON.stringify({ error: 'Not Found' }))
  }

  private writeJson(response: ServerResponse, value: unknown) {
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    })
    response.end(JSON.stringify(value))
  }

  private getPathname(rawUrl: string | undefined): string | undefined {
    if (!rawUrl) return undefined
    try {
      return new URL(rawUrl, `http://${this.host}`).pathname
    } catch {
      return undefined
    }
  }

  private rejectUpgrade(socket: Duplex) {
    if (socket.writable) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
    }
    socket.destroy()
  }

  private attachClient(client: WebSocket) {
    const waiters = [...this.clientWaiters]
    this.clientWaiters.clear()
    waiters.forEach((waiter) => waiter.resolve(client))
    this.onConnect?.()
    log('devtool connected')

    client.on('message', (data) => {
      void this.handleClientMessage(client, data).catch((error) => this.notifyError(error))
    })
    client.on('close', () => {
      this.networkEnabledClients.delete(client)
      this.networkReplayingClients.delete(client)
      this.networkReplayCursor.delete(client)
      log('devtool closed')
      this.onClose?.()
    })
    client.on('error', (error) => this.notifyError(error))
  }

  private async handleClientMessage(client: WebSocket, data: RawData): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(data.toString())
    } catch {
      await this.sendProtocolError(
        client,
        null,
        CDP_ERROR_CODES.INVALID_REQUEST,
        'Invalid CDP message: expected JSON object.'
      )
      return
    }

    const candidate = parsed as Partial<DevtoolMessageRequest> | null
    const id = candidate && this.isCdpId(candidate.id) ? candidate.id : null
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      await this.sendProtocolError(
        client,
        id,
        CDP_ERROR_CODES.INVALID_REQUEST,
        'Invalid CDP request.'
      )
      return
    }
    if (!this.isCdpId(candidate.id) || typeof candidate.method !== 'string' || !candidate.method) {
      await this.sendProtocolError(
        client,
        id,
        CDP_ERROR_CODES.INVALID_REQUEST,
        'CDP commands require a number|string id and non-empty method.'
      )
      return
    }
    if (
      candidate.params !== undefined &&
      (candidate.params === null ||
        typeof candidate.params !== 'object' ||
        Array.isArray(candidate.params))
    ) {
      await this.sendProtocolError(
        client,
        candidate.id,
        CDP_ERROR_CODES.INVALID_PARAMS,
        'CDP params must be an object.'
      )
      return
    }

    const request: DevtoolMessageRequest & { id: CdpId } = {
      id: candidate.id,
      method: candidate.method,
      params: candidate.params ?? {}
    }
    const scope: CommandScope = { client, id: candidate.id, responded: false }

    await this.commandScope.run(scope, async () => {
      const context = this.createCommandContext(scope, request)
      if (request.method === 'Network.enable') {
        await context.result({})
        this.networkEnabledClients.add(client)
        this.networkReplayingClients.add(client)
        try {
          await this.replayNetworkHistory(client)
        } finally {
          this.networkReplayingClients.delete(client)
        }
        return
      }
      if (request.method === 'Network.disable') {
        await context.result({})
        this.networkEnabledClients.delete(client)
        this.networkReplayingClients.delete(client)
        return
      }
      const builtin = this.builtinCommands.get(request.method)
      if (builtin) {
        try {
          await context.result((await builtin(request.params ?? {})) ?? {})
        } catch (error) {
          await context.error(
            CDP_ERROR_CODES.INTERNAL_ERROR,
            error instanceof Error ? error.message : String(error)
          )
        }
        return
      }

      let handled = false
      try {
        for (const listener of this.listeners) {
          const result = await listener(null, request, context)
          if (result === true) handled = true
        }
      } catch (error) {
        if (!scope.responded) {
          await context.error(
            CDP_ERROR_CODES.INTERNAL_ERROR,
            error instanceof Error ? error.message : String(error)
          )
        }
        return
      }

      if (scope.responded) return
      if (!handled) {
        await context.error(CDP_ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${request.method}`)
        return
      }
      await context.result({})
    })
  }

  private createCommandContext(
    scope: CommandScope,
    request: DevtoolMessageRequest & { id: CdpId }
  ): DevtoolCommandContext {
    const reply = async (message: DevtoolMessageResponse | DevtoolErrorResponse) => {
      if (scope.responded) return
      scope.responded = true
      await this.sendJson(scope.client, { ...message, id: scope.id })
    }
    return {
      client: scope.client,
      id: scope.id,
      method: request.method,
      params: request.params ?? {},
      reply,
      result: (result: unknown = {}) => reply({ id: scope.id, result }),
      error: (code, message, data) =>
        reply({
          id: scope.id,
          error: { code, message, ...(data === undefined ? {} : { data }) }
        })
    }
  }

  private createBuiltinCommands(): Map<
    string,
    (params: Record<string, unknown>) => BuiltinResult | Promise<BuiltinResult>
  > {
    const noopMethods = [
      'Network.setCacheDisabled',
      'Network.setBypassServiceWorker',
      'Network.setExtraHTTPHeaders',
      'Network.setAttachDebugStack',
      'Network.emulateNetworkConditions',
      'Network.emulateNetworkConditionsByRule',
      'Network.overrideNetworkState',
      'Network.setBlockedURLs',
      'Network.clearAcceptedEncodingsOverride',
      'Debugger.disable',
      'Debugger.setPauseOnExceptions',
      'Debugger.setAsyncCallStackDepth',
      'Debugger.setBlackboxPatterns',
      'Runtime.enable',
      'Runtime.disable',
      'Runtime.runIfWaitingForDebugger',
      'Console.enable',
      'Console.disable',
      'Log.enable',
      'Log.disable',
      'Profiler.enable',
      'Profiler.disable',
      'HeapProfiler.enable',
      'HeapProfiler.disable'
    ]
    const commands = new Map<string, () => BuiltinResult>(
      noopMethods.map((method) => [method, () => ({})])
    )
    commands.set('Network.emulateNetworkConditionsByRule', () => ({ ruleIds: [] }))
    commands.set('Debugger.enable', () => ({ debuggerId: this.targetId }))
    commands.set('Schema.getDomains', () => ({
      domains: LEGACY_CDP_PROTOCOL.domains.map(({ domain, version }) => ({ name: domain, version }))
    }))
    return commands
  }

  private isResponse(
    message: DevtoolMessage
  ): message is DevtoolMessageResponse | DevtoolErrorResponse {
    return (
      typeof message === 'object' &&
      message !== null &&
      'id' in message &&
      ('result' in message || 'error' in message)
    )
  }

  private isCdpId(value: unknown): value is CdpId {
    return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
  }

  private liveClients(): WebSocket[] {
    return [...(this.webSocketServer?.clients ?? [])].filter(
      (client) => client.readyState === WebSocket.OPEN
    )
  }

  private rejectClientWaiters(error: Error) {
    const waiters = [...this.clientWaiters]
    this.clientWaiters.clear()
    waiters.forEach((waiter) => waiter.reject(error))
  }

  private async sendProtocolError(
    client: WebSocket,
    id: CdpId | null,
    code: number,
    message: string,
    data?: unknown
  ) {
    await this.sendJson(client, {
      id,
      error: { code, message, ...(data === undefined ? {} : { data }) }
    })
  }

  private sendJson(client: WebSocket, message: DevtoolMessage): Promise<void> {
    return this.sendSerialized(client, JSON.stringify(message))
  }

  private sendSerialized(client: WebSocket, serialized: string): Promise<void> {
    if (client.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('DevTools frontend connection is not open.'))
    }
    return new Promise<void>((resolve, reject) => {
      client.send(serialized, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  private rememberEvent(method: string, serialized: string): number | undefined {
    const bytes = Buffer.byteLength(serialized)
    if (bytes > MAX_BUFFERED_EVENT_BYTES) return undefined
    const sequence = ++this.eventSequence
    this.eventHistory.push({
      sequence,
      method,
      serialized,
      bytes
    })
    this.eventHistoryBytes += bytes

    while (
      this.eventHistory.length > MAX_BUFFERED_EVENTS ||
      this.eventHistoryBytes > MAX_BUFFERED_EVENT_BYTES
    ) {
      const removed = this.eventHistory.shift()
      if (removed) this.eventHistoryBytes -= removed.bytes
    }
    return sequence
  }

  private async replayNetworkHistory(client: WebSocket) {
    while (client.readyState === WebSocket.OPEN) {
      const cursor = this.networkReplayCursor.get(client) ?? 0
      const snapshot = this.eventHistory.filter(
        (event) => event.sequence > cursor && event.method.startsWith('Network.')
      )
      if (snapshot.length === 0) return
      for (const event of snapshot) {
        await this.sendSerialized(client, event.serialized)
        this.networkReplayCursor.set(client, event.sequence)
      }
    }
  }

  private notifyError(error: unknown) {
    for (const listener of this.listeners) {
      void Promise.resolve(listener(error)).catch(() => undefined)
    }
  }
}

const LEGACY_CDP_PROTOCOL = Object.freeze({
  version: { major: '1', minor: '3' },
  domains: [
    {
      domain: 'Network',
      version: '1.3',
      commands: [
        { name: 'enable' },
        { name: 'disable' },
        { name: 'setAttachDebugStack' },
        {
          name: 'emulateNetworkConditionsByRule',
          returns: [{ name: 'ruleIds', type: 'array', items: { type: 'string' } }]
        },
        { name: 'overrideNetworkState' },
        { name: 'clearAcceptedEncodingsOverride' },
        {
          name: 'getResponseBody',
          parameters: [{ name: 'requestId', type: 'string' }],
          returns: [
            { name: 'body', type: 'string' },
            { name: 'base64Encoded', type: 'boolean' }
          ]
        }
      ],
      events: [
        { name: 'requestWillBeSent' },
        { name: 'responseReceived' },
        { name: 'dataReceived' },
        { name: 'loadingFinished' },
        { name: 'loadingFailed' },
        { name: 'eventSourceMessageReceived' },
        { name: 'webSocketCreated' },
        { name: 'webSocketWillSendHandshakeRequest' },
        { name: 'webSocketHandshakeResponseReceived' },
        { name: 'webSocketFrameSent' },
        { name: 'webSocketFrameReceived' },
        { name: 'webSocketClosed' }
      ]
    },
    {
      domain: 'Debugger',
      version: '1.3',
      commands: [
        { name: 'enable' },
        { name: 'disable' },
        {
          name: 'getScriptSource',
          parameters: [{ name: 'scriptId', type: 'string' }],
          returns: [{ name: 'scriptSource', type: 'string' }]
        }
      ],
      events: [{ name: 'scriptParsed' }]
    },
    { domain: 'Runtime', version: '1.3', commands: [{ name: 'enable' }, { name: 'disable' }] },
    { domain: 'Schema', version: '1.3', commands: [{ name: 'getDomains' }] }
  ]
})

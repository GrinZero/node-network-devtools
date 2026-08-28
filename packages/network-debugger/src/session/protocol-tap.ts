import WebSocket, { type RawData } from 'ws'
import type { DevtoolsTarget } from '../adapters/types'
import { withoutLegacyCapture } from '../core/capture-scope'
import type {
  CdpCommandId,
  CdpErrorObject,
  CdpProtocolEvent,
  ProtocolTapCommandOptions,
  ProtocolTapOptions,
  SessionProtocolConnection
} from './types'

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000
const DEFAULT_COMMAND_TIMEOUT_MS = 10_000
const DEFAULT_CLOSE_TIMEOUT_MS = 2_000
const DEFAULT_MAX_PENDING_COMMANDS = 256

export type ProtocolTapErrorCode =
  | 'SESSION_TAP_CLOSED'
  | 'SESSION_TAP_DISCONNECTED'
  | 'SESSION_TAP_CONNECT_TIMEOUT'
  | 'SESSION_TAP_COMMAND_TIMEOUT'
  | 'SESSION_TAP_PENDING_LIMIT'
  | 'SESSION_TAP_PROTOCOL_ERROR'

export class ProtocolTapError extends Error {
  readonly cause?: unknown

  constructor(
    readonly code: ProtocolTapErrorCode,
    message: string,
    cause?: unknown
  ) {
    super(message)
    this.name = 'ProtocolTapError'
    this.cause = cause
  }
}

export class CdpCommandError extends Error {
  constructor(
    readonly method: string,
    readonly commandId: CdpCommandId,
    readonly cdpError: CdpErrorObject
  ) {
    super(`CDP command ${method} failed (${cdpError.code}): ${cdpError.message}`)
    this.name = 'CdpCommandError'
  }
}

interface PendingCommand {
  method: string
  timer: ReturnType<typeof setTimeout>
  resolve(value: unknown): void
  reject(error: Error): void
}

interface CdpResponse {
  id: CdpCommandId
  result?: unknown
  error?: CdpErrorObject
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A small, backend-neutral CDP client used by recording and export features. */
export class ProtocolTap implements SessionProtocolConnection {
  readonly target: DevtoolsTarget

  private readonly connectTimeoutMs: number
  private readonly commandTimeoutMs: number
  private readonly closeTimeoutMs: number
  private readonly maxPendingCommands: number
  private readonly eventListeners = new Set<(event: CdpProtocolEvent) => void | Promise<void>>()
  private readonly methodListeners = new Map<
    string,
    Set<(params: Record<string, unknown>, event: CdpProtocolEvent) => void | Promise<void>>
  >()
  private readonly disconnectListeners = new Set<(error: Error) => void>()
  private readonly errorListeners = new Set<(error: Error) => void>()
  private readonly pending = new Map<CdpCommandId, PendingCommand>()

  private socket?: WebSocket
  private connectPromise?: Promise<this>
  private closePromise?: Promise<void>
  private nextCommandId = 0
  private _state: SessionProtocolConnection['state'] = 'idle'
  private terminalError?: Error

  constructor(target: DevtoolsTarget, options: ProtocolTapOptions = {}) {
    this.target = { ...target }
    this.connectTimeoutMs = positiveInteger(options.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS)
    this.commandTimeoutMs = positiveInteger(options.commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS)
    this.closeTimeoutMs = positiveInteger(options.closeTimeoutMs, DEFAULT_CLOSE_TIMEOUT_MS)
    this.maxPendingCommands = positiveInteger(
      options.maxPendingCommands,
      DEFAULT_MAX_PENDING_COMMANDS
    )
  }

  get state(): SessionProtocolConnection['state'] {
    return this._state
  }

  get pendingCommandCount(): number {
    return this.pending.size
  }

  connect(): Promise<this> {
    if (this._state === 'open') return Promise.resolve(this)
    if (this._state === 'connecting' && this.connectPromise) return this.connectPromise
    if (this._state === 'closing' || this._state === 'closed') {
      return Promise.reject(
        new ProtocolTapError('SESSION_TAP_CLOSED', 'Cannot connect a closed ProtocolTap.')
      )
    }

    this._state = 'connecting'
    this.connectPromise = this.open()
    return this.connectPromise
  }

  private async open(): Promise<this> {
    let socket: WebSocket
    try {
      // In Legacy mode the application HTTP APIs are patched. The recorder's
      // own CDP transport must not appear as business traffic or recursively
      // observe the events it causes itself.
      socket = withoutLegacyCapture(() => new WebSocket(this.target.webSocketDebuggerUrl))
    } catch (error) {
      const wrapped = new ProtocolTapError(
        'SESSION_TAP_DISCONNECTED',
        `Could not create CDP WebSocket ${this.target.webSocketDebuggerUrl}: ${errorMessage(error)}`,
        error
      )
      this.handleDisconnect(wrapped)
      throw wrapped
    }
    this.socket = socket
    socket.on('message', (data) => this.handleMessage(data))
    socket.on('error', (error) => {
      this.handleDisconnect(
        new ProtocolTapError(
          'SESSION_TAP_DISCONNECTED',
          `CDP WebSocket error: ${error.message}`,
          error
        )
      )
    })
    socket.on('close', (code, reason) => {
      this.handleDisconnect(
        new ProtocolTapError(
          'SESSION_TAP_DISCONNECTED',
          `CDP WebSocket closed (${code}): ${reason.toString() || 'no reason'}`
        )
      )
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup()
          reject(
            new ProtocolTapError(
              'SESSION_TAP_CONNECT_TIMEOUT',
              `Timed out after ${this.connectTimeoutMs}ms connecting to ${this.target.webSocketDebuggerUrl}.`
            )
          )
        }, this.connectTimeoutMs)
        const cleanup = () => {
          clearTimeout(timer)
          socket.off('open', onOpen)
          socket.off('close', onClose)
          socket.off('error', onError)
          socket.off('unexpected-response', onUnexpectedResponse)
        }
        const onOpen = () => {
          cleanup()
          resolve()
        }
        const onClose = () => {
          cleanup()
          reject(
            this.terminalError ??
              new ProtocolTapError(
                'SESSION_TAP_DISCONNECTED',
                'CDP WebSocket closed before opening.'
              )
          )
        }
        const onError = (error: Error) => {
          cleanup()
          reject(this.terminalError ?? error)
        }
        const onUnexpectedResponse = (
          _request: import('node:http').ClientRequest,
          response: import('node:http').IncomingMessage
        ) => {
          cleanup()
          reject(
            new ProtocolTapError(
              'SESSION_TAP_DISCONNECTED',
              `Unexpected HTTP ${response.statusCode ?? 0} while connecting to ${this.target.webSocketDebuggerUrl}.`
            )
          )
        }
        socket.once('open', onOpen)
        socket.once('close', onClose)
        socket.once('error', onError)
        socket.once('unexpected-response', onUnexpectedResponse)
      })

      if (this._state === 'closed' || socket.readyState !== WebSocket.OPEN) {
        throw (
          this.terminalError ??
          new ProtocolTapError('SESSION_TAP_DISCONNECTED', 'CDP WebSocket did not remain open.')
        )
      }
      this._state = 'open'
      await this.command('Network.enable')
      return this
    } catch (error) {
      if (this._state !== 'closed') {
        const wrapped =
          error instanceof Error
            ? error
            : new ProtocolTapError('SESSION_TAP_DISCONNECTED', errorMessage(error), error)
        this.handleDisconnect(wrapped)
      }
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate()
      throw this.terminalError ?? error
    }
  }

  command<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    options: ProtocolTapCommandOptions = {}
  ): Promise<T> {
    const socket = this.socket
    if (this._state !== 'open' || !socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        this.terminalError ??
          new ProtocolTapError(
            'SESSION_TAP_CLOSED',
            `Cannot send ${method}: CDP WebSocket is not open.`
          )
      )
    }
    if (this.pending.size >= this.maxPendingCommands) {
      return Promise.reject(
        new ProtocolTapError(
          'SESSION_TAP_PENDING_LIMIT',
          `Cannot send ${method}: pending command limit ${this.maxPendingCommands} reached.`
        )
      )
    }

    const id = this.allocateCommandId()
    const timeoutMs = positiveInteger(options.timeoutMs, this.commandTimeoutMs)
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new ProtocolTapError(
            'SESSION_TAP_COMMAND_TIMEOUT',
            `Timed out after ${timeoutMs}ms waiting for ${method} (${id}).`
          )
        )
      }, timeoutMs)
      this.pending.set(id, {
        method,
        timer,
        resolve: (value) => resolve(value as T),
        reject
      })

      socket.send(JSON.stringify({ id, method, params }), (error) => {
        if (!error) return
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        clearTimeout(pending.timer)
        pending.reject(error)
      })
    })
  }

  onEvent(listener: (event: CdpProtocolEvent) => void | Promise<void>): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  on(
    method: string,
    listener: (params: Record<string, unknown>, event: CdpProtocolEvent) => void | Promise<void>
  ): () => void {
    const listeners = this.methodListeners.get(method) ?? new Set()
    listeners.add(listener)
    this.methodListeners.set(method, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.methodListeners.delete(method)
    }
  }

  onDisconnect(listener: (error: Error) => void): () => void {
    this.disconnectListeners.add(listener)
    return () => this.disconnectListeners.delete(listener)
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closePromise = this.closeSocket()
    return this.closePromise
  }

  private async closeSocket(): Promise<void> {
    if (this._state === 'closed') return
    if (this._state === 'idle') {
      this._state = 'closed'
      return
    }

    this._state = 'closing'
    this.rejectPending(
      new ProtocolTapError('SESSION_TAP_CLOSED', 'ProtocolTap closed before command completion.')
    )
    const socket = this.socket
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      this._state = 'closed'
      return
    }

    await new Promise<void>((resolve) => {
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        socket.off('close', finish)
        resolve()
      }
      const timer = setTimeout(() => {
        socket.terminate()
        finish()
      }, this.closeTimeoutMs)
      socket.once('close', finish)
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate()
      else socket.close()
    })
    this._state = 'closed'
  }

  private allocateCommandId(): number {
    do {
      this.nextCommandId += 1
      if (!Number.isSafeInteger(this.nextCommandId)) this.nextCommandId = 1
    } while (this.pending.has(this.nextCommandId))
    return this.nextCommandId
  }

  private handleMessage(data: RawData): void {
    let message: unknown
    try {
      message = JSON.parse(data.toString())
    } catch (error) {
      const wrapped = new ProtocolTapError(
        'SESSION_TAP_PROTOCOL_ERROR',
        `Received malformed CDP JSON: ${errorMessage(error)}`,
        error
      )
      this.emitError(wrapped)
      this.handleDisconnect(wrapped)
      return
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return
    const value = message as Record<string, unknown>

    if (typeof value.id === 'number' || typeof value.id === 'string') {
      this.handleResponse(value as unknown as CdpResponse)
      return
    }
    if (typeof value.method !== 'string') return
    const event: CdpProtocolEvent = {
      method: value.method,
      params:
        value.params && typeof value.params === 'object' && !Array.isArray(value.params)
          ? (value.params as Record<string, unknown>)
          : {}
    }
    this.emitEvent(event)
  }

  private handleResponse(response: CdpResponse): void {
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    clearTimeout(pending.timer)
    if (response.error) {
      pending.reject(new CdpCommandError(pending.method, response.id, response.error))
    } else {
      pending.resolve(response.result)
    }
  }

  private emitEvent(event: CdpProtocolEvent): void {
    for (const listener of [...this.eventListeners]) this.invokeListener(listener, event)
    for (const listener of [...(this.methodListeners.get(event.method) ?? [])]) {
      this.invokeListener(listener, event.params, event)
    }
  }

  private invokeListener(listener: (...args: any[]) => unknown, ...args: unknown[]): void {
    try {
      const result = listener(...args)
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch((error) => this.emitError(asError(error)))
      }
    } catch (error) {
      this.emitError(asError(error))
    }
  }

  private emitError(error: Error): void {
    for (const listener of [...this.errorListeners]) {
      try {
        listener(error)
      } catch {
        // Error observers must not destabilize the protocol transport.
      }
    }
  }

  private handleDisconnect(error: Error): void {
    if (this._state === 'closed') return
    const intentional = this._state === 'closing'
    this.terminalError = intentional
      ? new ProtocolTapError('SESSION_TAP_CLOSED', 'ProtocolTap closed.')
      : error
    this._state = 'closed'
    this.rejectPending(this.terminalError)
    if (!intentional && this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      this.socket.terminate()
    }
    if (!intentional) {
      for (const listener of [...this.disconnectListeners]) {
        try {
          listener(error)
        } catch (listenerError) {
          this.emitError(asError(listenerError))
        }
      }
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

import type { WebSocket } from 'ws'
import type { CdpId } from '../../legacy-bridge/contracts'

export interface DevtoolMessageRequest {
  id?: CdpId
  method: string
  params?: Record<string, unknown>
}

export interface DevtoolMessageResponse {
  id: CdpId
  result: unknown
  /** @deprecated CDP responses are correlated by `id`, not a method name. */
  method?: string
}

export interface DevtoolErrorResponse {
  id: CdpId | null
  error: {
    code: number
    message?: string
    data?: unknown
  }
}

export type DevtoolMessage = DevtoolMessageRequest | DevtoolMessageResponse | DevtoolErrorResponse

export interface DevtoolCommandContext {
  /** The exact frontend connection that issued this command. */
  client: WebSocket
  id: CdpId
  method: string
  params: Record<string, unknown>
  /** Send a complete response to the issuing connection. First response wins. */
  reply(message: DevtoolMessageResponse | DevtoolErrorResponse): Promise<void>
  /** Resolve the command for the issuing connection. */
  result(result?: unknown): Promise<void>
  /** Reject the command for the issuing connection. */
  error(code: number, message: string, data?: unknown): Promise<void>
}

export type DevtoolProtocolListener = (
  error: unknown | null,
  message?: DevtoolMessage,
  context?: DevtoolCommandContext
) => boolean | void | Promise<boolean | void>

export class BaseDevtoolServer {
  public timestamp = 0
  private readonly startTime = Date.now()
  public readonly listeners: DevtoolProtocolListener[] = []

  public getTimestamp() {
    this.updateTimestamp()
    return this.timestamp
  }

  public updateTimestamp() {
    this.timestamp = (Date.now() - this.startTime) / 1000
  }

  public on(listener: DevtoolProtocolListener) {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index >= 0) this.listeners.splice(index, 1)
    }
  }
}

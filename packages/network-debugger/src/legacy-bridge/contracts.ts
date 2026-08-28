import type { IncomingHttpHeaders } from 'node:http'
import type { Socket } from 'node:net'
import type { RequestDetail } from '../common'
import type { DevtoolsTarget, Diagnostic } from '../adapters/types'

export type CdpId = number | string

export type LegacyRequestEventType =
  | 'initRequest'
  | 'registerRequest'
  | 'updateRequest'
  | 'endRequest'

export interface LegacyResponseData {
  id: string
  rawData: Buffer
  statusCode: number
  statusMessage?: string
  headers: IncomingHttpHeaders | Record<string, string | readonly string[] | undefined>
  contentEncoding?: string
}

export interface LegacyRequestFailure {
  request: RequestDetail
  errorText: string
  canceled?: boolean
  blockedReason?: string
}

/** A deliberately small, structured copy of an HTTP upgrade response. */
export interface LegacyWebSocketHandshake {
  httpVersion: string
  statusCode: number
  statusMessage: string
  rawHeaders: readonly string[]
  headers: IncomingHttpHeaders
}

export interface LegacyWebSocketFrame {
  requestId: string
  response: {
    payloadData: string
    opcode: number
    mask: boolean
  }
}

export type LegacyCaptureEvent =
  | { type: LegacyRequestEventType; data: RequestDetail }
  | { type: 'responseData'; data: LegacyResponseData }
  | { type: 'responseReceived'; data: RequestDetail }
  | { type: 'requestFailed'; data: LegacyRequestFailure }
  | { type: 'eventSourceResponseReceived'; data: RequestDetail }
  | {
      type: 'eventSourceMessage'
      data: { requestId: string; eventName: string; eventId: string; data: string }
    }
  | {
      type: 'Network.webSocketCreated'
      data: {
        requestId: string
        url: string
        initiator?: RequestDetail['initiator']
        response: LegacyWebSocketHandshake
      }
    }
  | { type: 'Network.webSocketFrameSent'; data: LegacyWebSocketFrame }
  | { type: 'Network.webSocketFrameReceived'; data: LegacyWebSocketFrame }
  | { type: 'Network.webSocketClosed'; data: { requestId: string } }

export interface LegacyBridgeOptions {
  host: string
  targetPort: number
  /** Stable across child recovery so the complete WebSocket URL cannot change. */
  targetId?: string
  title?: string
}

export type LegacyParentMessage =
  | { type: 'capture'; event: LegacyCaptureEvent }
  | { type: 'dispose' }

export type LegacyChildMessage =
  | { type: 'ready'; target: DevtoolsTarget }
  | { type: 'diagnostic'; diagnostic: Diagnostic }
  | { type: 'disposed' }

export interface LegacyCaptureSink {
  send(event: LegacyCaptureEvent): Promise<void>
  sendRequest(type: LegacyRequestEventType, request: RequestDetail): LegacyCaptureSink
  responseRequest(
    request: string | RequestDetail,
    response: NodeJS.ReadableStream & {
      statusCode?: number
      statusMessage?: string
      headers: IncomingHttpHeaders
    }
  ): void
}

/**
 * `Socket` is intentionally not part of any bridge event. This alias exists to
 * make accidental transport-object leakage visible in capture code reviews.
 */
export type LegacyLocalSocket = Socket

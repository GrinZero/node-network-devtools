import { fileURLToPath } from 'url'
import { getStackFrames, initiatorStackPipe } from './utils/stack'
import { dirname } from 'path'
import { generateUUID } from './utils'

export interface CDPCallFrame {
  columnNumber: number
  functionName: string
  lineNumber: number
  url: string
  scriptId?: string
}

export class RequestDetail {
  id: string
  constructor(req?: RequestDetail) {
    if (req) {
      this.id = req.id
      this.responseInfo = req.responseInfo
      Object.assign(this, req)
    } else {
      this.id = generateUUID()
      this.responseInfo = {}
    }
  }

  loadCallFrames(_stack?: string) {
    const frames = initiatorStackPipe(getStackFrames(_stack))
    const callFrames = frames.map((frame) => {
      const fileName = frame.fileName || ''
      return {
        columnNumber: frame.columnNumber || 0,
        functionName: frame.functionName || '',
        lineNumber: frame.lineNumber || 0,
        url: fileName.startsWith('/') ? `file://${fileName}` : fileName
      }
    })

    if (callFrames.length > 0) {
      this.initiator = {
        type: 'script',
        stack: {
          callFrames
        }
      }
    }
  }

  isHiden() {
    return this.isWebSocket() && ['http://localhost/', 'ws://localhost/'].includes(this.url!)
  }

  isWebSocket() {
    return (
      this.requestHeaders?.['Upgrade'] === 'websocket' ||
      this.requestHeaders?.['upgrade'] === 'websocket'
    )
  }

  url?: string
  method?: string
  cookies: any

  requestHeaders: any
  requestData: any

  responseData: any
  responseStatusCode?: number
  responseHeaders: any
  responseInfo: Partial<{
    encodedDataLength: number
    dataLength: number
  }>

  requestStartTime?: number
  requestEndTime?: number

  initiator?: {
    type: string
    stack: {
      callFrames: CDPCallFrame[]
    }
  }
}
export const PORT = Number(process.env.NETWORK_PORT || 5270)
export const SERVER_PORT = Number(process.env.NETWORK_SERVER_PORT || 5271)
export const REMOTE_DEBUGGER_PORT = Number(process.env.REMOTE_DEBUGGER_PORT || 9333)
export const IS_DEV_MODE = process.env.NETWORK_DEBUG_MODE === 'true'
export const READY_MESSAGE = 'ready'

export const __filename = fileURLToPath(import.meta.url)
export const __dirname = dirname(__filename)

export interface RegisterOptions {
  /**
   * @description Main Process Port
   * @default 5270
   */
  port?: number
  /**
   * @description CDP Server Port, used for Devtool
   * @link devtools://devtools/bundled/inspector.html?ws=localhost:${serverPort}
   * @default 5271
   */
  serverPort?: number

  /**
   * @description Whether to automatically open Devtool
   * @default true
   */
  autoOpenDevtool?: boolean

  /**
   * @description Options for intercepting different types of requests.
   *   If a property is set to `false`, that specific type of request will not be intercepted.
   *   By default, all are intercepted if not explicitly set.
   */
  intercept?: {
    /**
     * @description Whether to intercept `fetch` requests.
     * @default true
     */
    fetch?: boolean
    /**
     * @description Whether to intercept `http/https` requests.
     * @default true
     */
    normal?: boolean
    /**
     * @description Options for intercepting `undici` requests.
     *   Set to `false` to disable all undici interception.
     *   Otherwise, configure specific undici interception options.
     * @default false
     */
    undici?:
      | false
      | {
          /**
           * @description Whether to intercept `undici`'s `fetch` requests.
           * @default false
           */
          fetch?: false | {}
          /**
           * @description Whether to intercept `undici`'s normal requests.
           * @default false
           */
          normal?: false | {}
        }
  }
}
export const NETWORK_CONTEXT_KEY = 'x-network-context'
export const WS_PROTOCOL = 'ws'

export const CONTEXT_KEY_PORT = 'x-network-context-port'
export const CONTEXT_KEY_SERVER_PORT = 'x-network-context-server-port'
export const CONTEXT_KEY_AUTO_OPEN_DEVTOOL = 'x-network-context-auto-open-devtools'
export const CONTEXT_KEY_INTERCEPT_NORMAL = 'x-network-context-intercept-normal'
export const CONTEXT_KEY_INTERCEPT_FETCH = 'x-network-context-intercept-fetch'
export const CONTEXT_KEY_INTERCEPT_UNDICI_FETCH = 'x-network-context-intercept-undici-fetch'
export const CONTEXT_KEY_HASH = 'x-network-context-hash'

export interface ConnectOptions {
  /**
   * @description Main Process Port
   * @default 5270
   */
  port?: number
}

export interface UnregisterOptions {
  /**
   * @description Main Process Port
   * @default 5270
   */
  port?: number
}

export interface SendMessageOptions {
  /**
   * @description Main Process Port
   * @default 5270
   */
  port?: number
}
export type RequestPipe = (req: RequestDetail) => RequestDetail | null

export interface SetRequestInterceptorOptions {
  /**
   * @description Main Process Port
   * @default 5270
   */
  port?: number
  request?: RequestPipe
}
export interface SetResponseInterceptorOptions {
  /**
   * @description Main Process Port
   * @default 5270
   */
  port?: number
  response?: RequestPipe
}

export interface RemoveRequestInterceptorOptions {
  /**
   * @description Main Process Port
   * @default 5270
   */
  port?: number
}

export interface RemoveResponseInterceptorOptions {
  /**
   * @description Main Process Port
   * @default 5270
   */
  port?: number
}

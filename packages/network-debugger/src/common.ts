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
    return this.requestHeaders?.['Upgrade'] === 'websocket'
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
   * @description The option to intercept a certain packet.
   *   If set false, the packet will not be intercepted.
   */
  intercept?: {
    /**
     * @default true
     */
    fetch?: boolean
    /**
     * @default true
     */
    normal?: boolean
    /**
     * @default false
     */
    undici?:
      | false
      | {
          fetch?: false | {}
          normal?: false | {}
        }
  }
}

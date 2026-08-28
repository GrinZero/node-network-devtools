import { fileURLToPath } from 'url'
import { getStackFrames, initiatorStackPipe } from './utils/stack'
import { dirname } from 'path'
import { generateUUID } from './utils'
import type { AdapterMode, InspectorTargetOptions, NetworkCapability } from './adapters/types'
import type { LegacyMockRule } from './mock'

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
      this.requestHeaders = {}
      this.responseHeaders = {}
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
  responseStatusText?: string
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
export const __filename = fileURLToPath(import.meta.url)
export const __dirname = dirname(__filename)

export interface InterceptOptions {
  /** Whether to intercept the global Fetch implementation. */
  fetch?: boolean
  /** Whether to intercept `http.request` and `https.request`. */
  normal?: boolean
  /** Optional interception for the separately installed `undici` package. */
  undici?:
    | false
    | {
        fetch?: false | true | Record<string, never>
        normal?: false | true | Record<string, never>
      }
}

export interface RegisterOptions {
  /** Select the complete capture/backend implementation. Defaults to `auto`. */
  mode?: AdapterMode

  /** @deprecated Use `mode`. */
  adapter?: AdapterMode

  /** Capabilities that the selected backend must provide. */
  requiredCapabilities?: readonly NetworkCapability[]

  /** @deprecated Use `requiredCapabilities`. */
  requiredFeatures?: readonly NetworkCapability[]

  /** Settings used when a Node Inspector target must be created. */
  inspector?: InspectorTargetOptions

  /** Frontend behavior is opt-in and independent from target ownership. */
  devtools?: {
    open?: boolean
  }

  /** Persist backend-neutral CDP events and response bodies for later export/replay. */
  session?: {
    /** Exact output directory. It must not already contain Session artifacts. */
    directory: string
    bodyCommandTimeoutMs?: number
    /** Export HAR during disposal. `true` writes `<directory>/session.har`. */
    har?: boolean | string
  }

  /** Namespaced Legacy settings. Top-level legacy fields remain supported. */
  legacy?: {
    /** @deprecated The application bridge now uses child-process IPC. */
    port?: number
    /** Legacy CDP target port. Defaults to `0` (an OS-assigned loopback port). */
    serverPort?: number
    intercept?: InterceptOptions
    /** Deterministic outbound request/response mocks. Legacy backend only. */
    mock?: readonly LegacyMockRule[]
  }

  /**
   * @deprecated The application bridge now uses child-process IPC. Move other
   * Legacy settings under `legacy`.
   */
  port?: number
  /**
   * @deprecated Use `legacy.serverPort`. Defaults to `0`.
   */
  serverPort?: number

  /**
   * @deprecated Use `devtools.open`. Defaults to `false`.
   */
  autoOpenDevtool?: boolean

  /**
   * @description Options for intercepting different types of requests.
   *   If a property is set to `false`, that specific type of request will not be intercepted.
   *   By default, all are intercepted if not explicitly set.
   */
  intercept?: InterceptOptions
}

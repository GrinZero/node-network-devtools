import http from 'http'
import https from 'https'
import { syncBuiltinESMExports } from 'node:module'
import { type InterceptOptions } from '../../common'
import { MainProcess } from '../../core/fork'
import { proxyFetch } from '../../core/fetch'
import { getProxyFactory, requestProxyFactory, type RequestFn } from '../../core/request'
import { undiciFetchProxy } from '../../core/undici'
import { mockableRequestHandler, type LegacyMockRule } from '../../mock'
import { generateHash } from '../../utils'
import type {
  AdapterProbe,
  AdapterSession,
  AdapterStartOptions,
  CapabilityMap,
  DebugAdapter,
  Diagnostic
} from '../types'

export const LEGACY_CAPABILITIES: CapabilityMap = Object.freeze({
  http: true,
  https: true,
  fetch: true,
  http2: false,
  responseBody: true,
  requestBody: true,
  websocketLifecycle: true,
  websocketFrames: true,
  sseMessages: true,
  initiator: true
})

export interface LegacyAdapterOptions {
  port?: number
  serverPort?: number
  autoOpenDevtool?: boolean
  intercept?: InterceptOptions
  mock?: readonly LegacyMockRule[]
  diagnostics?: readonly Diagnostic[]
}

function capabilitiesFor(intercept: InterceptOptions = {}): CapabilityMap {
  const normal = intercept.normal !== false
  const fetch = intercept.fetch !== false || Boolean(intercept.undici && intercept.undici.fetch)
  const anyRequest = normal || fetch
  return Object.freeze({
    http: normal,
    https: normal,
    fetch,
    http2: false,
    responseBody: anyRequest,
    requestBody: anyRequest,
    websocketLifecycle: normal,
    websocketFrames: normal,
    sseMessages: fetch,
    initiator: anyRequest
  })
}

/**
 * Compatibility wrapper around the original capture path.
 *
 * All application capture patches live here, while a child-process IPC bridge
 * owns the project CDP target. Native sessions therefore cannot accidentally
 * activate any Legacy interception.
 */
export class LegacyAdapter implements DebugAdapter {
  readonly kind = 'legacy' as const

  constructor(private readonly options: LegacyAdapterOptions = {}) {}

  probe(_options?: AdapterStartOptions): AdapterProbe {
    return {
      kind: this.kind,
      available: true,
      autoSelectable: true,
      capabilities: capabilitiesFor(this.options.intercept),
      diagnostics: []
    }
  }

  async start(_options?: AdapterStartOptions): Promise<AdapterSession> {
    const port = this.options.port
    const serverPort = this.options.serverPort ?? 0
    const autoOpenDevtool = this.options.autoOpenDevtool ?? false
    const intercept = this.options.intercept ?? {}
    const mockRules = this.options.mock ?? []
    const {
      fetch: interceptFetch = true,
      normal: interceptNormal = true,
      undici: interceptUndici = false
    } = intercept
    const interceptUndiciFetch = Boolean(interceptUndici && interceptUndici.fetch)
    const capabilities = capabilitiesFor(intercept)
    const key = generateHash(JSON.stringify({ port, serverPort, autoOpenDevtool }))
    const mainProcess = new MainProcess({ port, serverPort, autoOpenDevtool, key })

    const unsetFetchProxy = interceptFetch
      ? mockRules.length > 0
        ? proxyFetch(mainProcess, mockRules)
        : proxyFetch(mainProcess)
      : undefined
    const originalRequests = new Map<
      typeof http | typeof https,
      { request: RequestFn; get: RequestFn; proxyRequest: RequestFn; proxyGet: RequestFn }
    >()
    const agents = [http, https] as const

    if (interceptNormal) {
      for (const agent of agents) {
        const request = agent.request as RequestFn
        const get = agent.get as RequestFn
        const requestHandler =
          mockRules.length > 0
            ? mockableRequestHandler(request, agent === https, mockRules)
            : request
        const proxyRequest = requestProxyFactory.call(
          agent,
          requestHandler,
          agent === https,
          mainProcess
        )
        const proxyGet = getProxyFactory(proxyRequest)
        originalRequests.set(agent, { request, get, proxyRequest, proxyGet })
        agent.request = proxyRequest as typeof agent.request
        agent.get = proxyGet as typeof agent.get
      }
      syncBuiltinESMExports()
    }

    const unsetUndiciFetch = interceptUndiciFetch
      ? mockRules.length > 0
        ? undiciFetchProxy(mainProcess, mockRules)
        : undiciFetchProxy(mainProcess)
      : undefined
    let disposed = false

    const restoreCapture = () => {
      unsetFetchProxy?.()
      if (interceptNormal) {
        for (const agent of agents) {
          const original = originalRequests.get(agent)
          if (!original) continue
          if (agent.request === original.proxyRequest) {
            agent.request = original.request as typeof agent.request
          }
          if (agent.get === original.proxyGet) {
            agent.get = original.get as typeof agent.get
          }
        }
        originalRequests.clear()
        syncBuiltinESMExports()
      }
      unsetUndiciFetch?.()
    }

    let target
    try {
      target = await mainProcess.ready
    } catch (error) {
      restoreCapture()
      await mainProcess.dispose().catch(() => {})
      throw error
    }

    const diagnostics: Diagnostic[] = [...(this.options.diagnostics ?? [])]
    if (port !== undefined) {
      diagnostics.push({
        code: 'NND_LEGACY_BRIDGE_PORT_DEPRECATED',
        level: 'warn',
        message: 'Legacy bridge port is no longer used because capture now uses child-process IPC.',
        hint: 'Remove legacy.port (or the deprecated top-level port option). Use legacy.serverPort only to pin the CDP target port.'
      })
    }

    return {
      kind: this.kind,
      capabilities,
      diagnostics,
      target,
      onDiagnostic(listener: (diagnostic: Diagnostic) => void) {
        return mainProcess.onDiagnostic(listener)
      },
      onFailure(listener: (error: Error) => void) {
        return mainProcess.onFailure(listener)
      },
      async dispose() {
        if (disposed) return
        disposed = true
        restoreCapture()
        await mainProcess.dispose()
      }
    }
  }
}

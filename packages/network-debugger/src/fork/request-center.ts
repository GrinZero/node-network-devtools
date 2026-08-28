import type { WebSocket } from 'ws'
import type { DevtoolsTarget } from '../adapters/types'
import type { RequestDetail } from '../common'
import type { CdpId, LegacyCaptureEvent } from '../legacy-bridge/contracts'
import { log } from '../utils'
import {
  DevtoolServer,
  type DevtoolCommandContext,
  type DevtoolMessage,
  type DevtoolMessageRequest
} from './devtool'
import type { PluginInstance } from './module/common'

export interface RequestCenterInitOptions {
  /** @deprecated The application-side WebSocket transport has been removed. */
  port?: number
  /** CDP discovery/target port. `0` selects a free loopback port. */
  serverPort?: number
  /** Stable identity used to preserve the target URL across child restarts. */
  targetId?: string
  title?: string
  autoOpenDevtool?: boolean
  requests?: Record<string, RequestDetail>
}

export interface DevtoolMessageListenerProps<T = unknown> {
  data: T
  request?: RequestDetail
  id?: CdpId
  /** Present for frontend commands, absent for capture events. */
  client?: WebSocket
  /** Present for frontend commands. First response wins. */
  reply?: DevtoolCommandContext['reply']
  /** Present for frontend commands. */
  result?: DevtoolCommandContext['result']
  /** Present for frontend commands. */
  error?: DevtoolCommandContext['error']
}

export interface DevtoolMessageListener<T = unknown> {
  (props: DevtoolMessageListenerProps<T>): unknown | Promise<unknown>
}

/**
 * Routes in-process Legacy capture events to plugins and exposes one standard
 * CDP discovery/target server. There is no application-side TCP transport.
 */
export class RequestCenter {
  public readonly ready: Promise<DevtoolsTarget>
  private readonly devtool: DevtoolServer
  private readonly listeners: Record<string, Set<DevtoolMessageListener> | undefined> = {}
  private plugins: PluginInstance<any>[] = []
  private pluginOutputs?: Map<string, unknown>
  private closePromise?: Promise<void>
  private captureQueue: Promise<void> = Promise.resolve()

  constructor(options: RequestCenterInitOptions = {}) {
    this.devtool = new DevtoolServer({
      port: options.serverPort ?? 0,
      targetId: options.targetId,
      title: options.title,
      autoOpenDevtool: options.autoOpenDevtool,
      onConnect: () => {
        void this.dispatch('onConnect', {
          data: null,
          id: 'onConnect'
        }).catch(log)
      }
    })
    this.ready = this.devtool.ready

    this.devtool.on(async (error, message, context) => {
      if (error) {
        log(error)
        return false
      }
      if (!message || !context || !('method' in message) || typeof message.method !== 'string') {
        return false
      }
      const request = message as DevtoolMessageRequest
      return this.dispatchCommand(request.method, request.params ?? {}, request.id, context)
    })
  }

  get target(): DevtoolsTarget | undefined {
    return this.devtool.target
  }

  public loadPlugins(plugins: PluginInstance<any>[]) {
    this.plugins = plugins
    this.pluginOutputs = new Map()

    for (const plugin of plugins) {
      const output = plugin({
        devtool: this.devtool,
        core: this,
        plugins: this.plugins
      })
      this.pluginOutputs.set(plugin.id, output)
    }
  }

  public usePlugin<T = null>(id: string) {
    if (!this.pluginOutputs) return null as T
    return this.pluginOutputs.get(id) as T
  }

  public on<T = unknown>(method: string, listener: DevtoolMessageListener<T>) {
    if (!this.listeners[method]) this.listeners[method] = new Set()
    const listeners = this.listeners[method] as Set<DevtoolMessageListener<T>>
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  /** Deliver an IPC-decoded capture event without another serialization hop. */
  public handleCaptureEvent(event: LegacyCaptureEvent): void {
    if (this.closePromise) return
    this.captureQueue = this.captureQueue
      .then(async () => {
        await this.dispatch(event.type, { data: event.data })
      })
      .catch(log)
  }

  public close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closePromise = (async () => {
      await this.captureQueue
      if (this.pluginOutputs) {
        for (const output of this.pluginOutputs.values()) {
          if (typeof output === 'function') await output()
        }
      }
      for (const key of Object.keys(this.listeners)) this.listeners[key]?.clear()
      await this.devtool.close()
    })()
    return this.closePromise
  }

  private async dispatchCommand(
    method: string,
    params: Record<string, unknown>,
    id: CdpId | undefined,
    context: DevtoolCommandContext
  ): Promise<boolean> {
    if (id === undefined) return false
    const listeners = this.listeners[method]
    if (!listeners?.size) return false

    for (const listener of [...listeners]) {
      await listener({
        data: params,
        id,
        client: context.client,
        reply: context.reply,
        result: context.result,
        error: context.error
      })
    }
    return true
  }

  private async dispatch(
    method: string,
    props: DevtoolMessageListenerProps<any>
  ): Promise<boolean> {
    const listeners = this.listeners[method]
    if (!listeners?.size) return false
    for (const listener of [...listeners]) await listener(props)
    return true
  }
}

// Kept as a type-only compatibility export for plugins compiled against the
// previous RequestCenter module.
export type { DevtoolMessage }

import { DevtoolServer } from './devtool'
import { PORT, READY_MESSAGE, RequestDetail } from '../common'
import zlib from 'node:zlib'
import { Server } from 'ws'
import { log } from '../utils'
import { ResourceService } from './resource-service'
import { EffectCleaner, PluginInstance } from './module/common'

export interface RequestCenterInitOptions {
  port: number
  serverPort: number
  autoOpenDevtool?: boolean
  requests?: Record<string, RequestDetail>
}

/**
 * @param data message data
 * @param id? message id, Only for devtool message
 * @param request? request detail
 */
export interface DevtoolMessageListener<T = any> {
  (props: { data: T; request?: RequestDetail; id?: string }): void
}

export class RequestCenter {
  public resourceService: ResourceService
  private devtool: DevtoolServer
  private server: Server
  private effects: Array<EffectCleaner> = []
  private listeners: Record<string, Set<DevtoolMessageListener> | undefined> = {}
  private options: RequestCenterInitOptions
  constructor(options: RequestCenterInitOptions) {
    this.options = options
    const { serverPort, requests, autoOpenDevtool } = options
    this.devtool = new DevtoolServer({
      port: serverPort,
      autoOpenDevtool: autoOpenDevtool,
      onConnect: () => {
        const listeners = this.listeners['onConnect']
        listeners?.forEach((listener) =>
          listener({
            data: null,
            id: 'onConnect'
          })
        )
      }
    })
    this.resourceService = new ResourceService()
    this.devtool.on((error, message) => {
      if (error) {
        log(error)
        return
      }

      const listenerList = this.listeners[message.method]
      if (!listenerList) {
        return
      }

      listenerList.forEach((listener) => {
        listener({
          data: message.params,
          id: message.id
        })
      })
    })
    this.server = this.initServer()
  }

  #plugins: PluginInstance[] = []
  public loadPlugins(plugins: PluginInstance[]) {
    this.#plugins = plugins
    const effects = plugins
      .map((plugin) =>
        plugin({
          devtool: this.devtool,
          core: this
        })
      )
      .filter(Boolean) as Array<EffectCleaner>
    this.effects.push(...effects)
  }

  public on(method: string, listener: DevtoolMessageListener) {
    if (!this.listeners[method]) {
      this.listeners[method] = new Set()
    }
    this.listeners[method]!.add(listener)
    return () => {
      this.listeners[method]!.delete(listener)
    }
  }

  public close() {
    this.server.close()
    this.devtool.close()
    this.effects.forEach((effect) => effect())
  }

  private initServer() {
    const server = new Server({ port: this.options.port || PORT })
    server.on('connection', (ws) => {
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString())
        const _message = message as { type: string; data: any }
        switch (_message.type) {
          default:
            {
              const listenerList = this.listeners[_message.type]
              if (!listenerList) {
                console.warn('unknown message type', _message.type)
                break
              }

              listenerList.forEach((listener) => {
                listener({
                  data: _message.data
                })
              })
            }
            break
        }
      })
    })
    server.on('listening', () => {
      if (process.send) {
        process.send(READY_MESSAGE)
      }
    })

    return server
  }
}

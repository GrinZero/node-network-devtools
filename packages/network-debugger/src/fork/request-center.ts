import { DevtoolServer } from './devtool'
import { PORT, READY_MESSAGE, RequestDetail } from '../common'
import { Server } from 'ws'
import { log } from '../utils'
import { PluginInstance } from './module/common'

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
  private devtool: DevtoolServer
  private server: Server
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

  #plugins: PluginInstance<any>[] = []
  #pluginOutputs?: Map<string, any>
  public loadPlugins(plugins: PluginInstance<any>[]) {
    this.#plugins = plugins
    this.#pluginOutputs = new Map()

    plugins.forEach((plugin) => {
      const output = plugin({
        devtool: this.devtool,
        core: this,
        plugins: this.#plugins
      })
      this.#pluginOutputs!.set(plugin.id, output)
    })
  }

  public usePlugin<T = null>(id: string) {
    if (!this.#pluginOutputs) {
      return null as T
    }

    const output = this.#pluginOutputs.get(id)
    return output as T
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

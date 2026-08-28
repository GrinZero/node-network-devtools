import type { DevtoolMessage } from '../devtool'
import type { DevtoolMessageListener } from '../request-center'

export interface PluginDevtool {
  timestamp: number
  getTimestamp(): number
  updateTimestamp(): void
  send(message: DevtoolMessage): Promise<unknown>
}

export interface PluginCore {
  on<T = unknown>(method: string, listener: DevtoolMessageListener<T>): unknown
  usePlugin<T = null>(id: string): T
}

export interface PluginContext {
  devtool: PluginDevtool
  core: PluginCore
}
let currentPluginContext: PluginContext | null = null
const initPluginContext = (core: PluginCore, devtool: PluginDevtool) => {
  currentPluginContext = {
    devtool,
    core
  }
}
const resetPluginContext = () => (currentPluginContext = null)

export interface CoreCotext {
  devtool: PluginDevtool
  core: PluginCore
  plugins: PluginInstance<any>[]
}

export type PluginHandler<T> = (props: CoreCotext) => T
export type PluginInstance<T> = {
  (props: CoreCotext): T
  id: string
}

/**
 * @description create a plugin for devtool
 * @param fn
 *  the plugin handler, you can use hook in it.
 *  if you want to do some clean work, you can return a function
 * @example
 * ```ts
 * createPlugin(({ devtool, core }) => {
 *   const store = new Map()
 *   useHandler('Network.requestWillBeSent', ({ id, request }) => {
 *     store.set(id, request)
 *   })
 *   useHandler('Network.loadingFinished', ({ id }) => {
 *     store.delete(id)
 *   })
 *  setInterval(() => {
 *    console.log(store.size)
 *  }, 1000)
 *   return () => {
 *     store.clear()
 *   }
 * })
 * ```
 * @returns PluginInstance
 */
export const createPlugin = <T>(id: string, fn: PluginHandler<T>) => {
  const plugin: Omit<PluginInstance<T>, 'id'> = (props: CoreCotext) => {
    initPluginContext(props.core, props.devtool)
    const output = fn(props)
    resetPluginContext()
    return output
  }
  const instance = Object.assign(plugin, { id })
  return instance as PluginInstance<T>
}

/**
 * @param type the method name of CDP message / custom type from main process
 * @mark all hook can only be used in createPlugin
 * @returns
 */
export const useHandler = <T>(type: string, fn: DevtoolMessageListener<T>) => {
  if (!currentPluginContext) {
    return
  }
  const currentContext = currentPluginContext
  const { core } = currentContext
  return core.on(type, fn)
}

export const useConnect = (fn: () => void) => {
  if (!currentPluginContext) {
    return
  }
  const { core } = currentPluginContext
  return core.on('onConnect', fn)
}

/**
 * @mark all hook can only be used in createPlugin
 */
export const useContext = () => {
  return currentPluginContext!
}

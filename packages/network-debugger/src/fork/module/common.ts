import { DevtoolServer } from '../devtool'
import { DevtoolMessageListener, RequestCenter } from '../request-center'

export interface PluginContext {
  devtool: DevtoolServer
  core: RequestCenter
}
let currentPluginContext: PluginContext | null = null
const initPluginContext = (core: RequestCenter, devtool: DevtoolServer) => {
  currentPluginContext = {
    devtool,
    core
  }
}
const resetPluginContext = () => (currentPluginContext = null)

export interface CoreCotext {
  devtool: DevtoolServer
  core: RequestCenter
}

export type EffectCleaner = () => void
export type PluginHandler = (props: CoreCotext) => EffectCleaner | void
export type PluginInstance = (props: CoreCotext) => EffectCleaner | void

export const createPlugin = (fn: PluginHandler): PluginInstance => {
  return (props: CoreCotext) => {
    initPluginContext(props.core, props.devtool)
    const effectDestroy = fn(props)
    resetPluginContext()
    return effectDestroy
  }
}

export const useHandler = (type: string, fn: DevtoolMessageListener) => {
  if (!currentPluginContext) {
    return
  }
  const currentContext = currentPluginContext
  const { core } = currentContext
  core.on(type, fn)
}

export const useContext = () => {
  return currentPluginContext!
}

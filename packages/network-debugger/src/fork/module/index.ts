import { RequestCenter } from '../request-center'
import { debuggerPlugin } from './debugger'
import { networkPlugin } from './network'
import { websocketPlugin } from './websocket'

export const loadPlugin = (instance: RequestCenter) => {
  instance.loadPlugins([networkPlugin, debuggerPlugin, websocketPlugin])
}

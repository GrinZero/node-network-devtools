import { RequestCenter } from '../request-center'
import { debuggerPlugin } from './debugger'
import { networkPlugin } from './network'
import { websocketPlugin } from './websocket'
import { healthPlugin } from './health'

export const loadPlugin = (instance: RequestCenter) => {
  instance.loadPlugins([healthPlugin, networkPlugin, debuggerPlugin, websocketPlugin])
}

import { RequestCenter } from '../request-center'
import { debuggerPlugin } from './debugger'
import { networkPlugin } from './network'

export const loadPlugin = (instance: RequestCenter) => {
  instance.loadPlugins([networkPlugin, debuggerPlugin])
}

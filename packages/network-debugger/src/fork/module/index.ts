import { RequestCenter } from '../request-center'
import { getHandlerStore } from './common'

import './network'
import './debugger'

export const addListener = (instance: RequestCenter) => {
  const store = getHandlerStore()
  for (const [type, handlers] of store) {
    handlers?.forEach((handler) => {
      instance.on(type, handler)
    })
  }
}

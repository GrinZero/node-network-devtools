import { DevtoolMessageListener } from '../request-center'

const handlerStore = new Map<string, DevtoolMessageListener[]>()

export const createHanlder = (type: string, fn: DevtoolMessageListener) => {
  const handlers = handlerStore.get(type) || []
  handlers.push(fn)
  handlerStore.set(type, handlers)
}

export const getHandlerStore = () => handlerStore

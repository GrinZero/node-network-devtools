import undici from 'undici'
import { MainProcess } from '../fork'
import { fetchProxyFactory } from '../fetch'

const requestProxyFactory = (originalRequest: typeof undici.request, mainProcess: MainProcess) => {}

export const undiciRequestProxy = (mainProcess: MainProcess) => {
  if (!undici.request) {
    return
  }

  const originalRequest = undici.request
  undici['request'] = fetchProxyFactory(
    originalRequest as any,
    mainProcess
  ) as unknown as typeof undici.request

  return () => {
    undici['request'] = originalRequest
  }
}

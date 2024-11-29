import { fetchProxyFactory } from '../fetch'
import undici from 'undici'
import { MainProcess } from '../fork'

export const undiciFetchProxy = (mainProcess: MainProcess) => {
  if (!undici.fetch) {
    return
  }

  const originalFetch = undici.fetch

  undici['fetch'] = fetchProxyFactory(
    originalFetch as typeof globalThis.fetch,
    mainProcess
  ) as typeof undici.fetch

  return () => {
    undici['fetch'] = originalFetch
  }
}

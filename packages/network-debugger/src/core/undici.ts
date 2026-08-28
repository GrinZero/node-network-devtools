import { fetchProxyFactory } from './fetch'
import undici from 'undici'
import { MainProcess } from './fork'
import type { LegacyMockRule } from '../mock'

export const undiciFetchProxy = (
  mainProcess: MainProcess,
  mockRules: readonly LegacyMockRule[] = []
) => {
  if (!undici.fetch) {
    return
  }

  const originalFetch = undici.fetch

  const proxy = (
    mockRules.length > 0
      ? fetchProxyFactory(originalFetch as typeof globalThis.fetch, mainProcess, mockRules)
      : fetchProxyFactory(originalFetch as typeof globalThis.fetch, mainProcess)
  ) as typeof undici.fetch
  undici['fetch'] = proxy

  return () => {
    if (undici.fetch === proxy) undici['fetch'] = originalFetch
  }
}

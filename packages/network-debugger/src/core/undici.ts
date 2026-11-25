import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import undici from 'undici'
import { fetchProxyFactory } from './fetch'
import type { MainProcess } from './fork'
import type { LegacyMockRule } from '../mock'

type UndiciModule = Pick<typeof undici, 'fetch'>

function resolveApplicationUndici(entry: string): UndiciModule | undefined {
  const requireFromApp = createRequire(resolve(entry))
  try {
    const metadata: unknown = requireFromApp('undici/package.json')
    if (
      typeof metadata !== 'object' ||
      metadata === null ||
      !('version' in metadata) ||
      typeof metadata.version !== 'string' ||
      !metadata.version.startsWith('6.')
    ) {
      return
    }

    const candidate: unknown = requireFromApp('undici')
    if (typeof candidate === 'object' && candidate !== null && 'fetch' in candidate) {
      if (typeof candidate.fetch === 'function') return candidate as UndiciModule
    }
  } catch {
    // The application can omit Undici or resolve a copy that cannot be loaded.
    // The debugger still intercepts its own declared peer in either case.
  }
}

export const undiciFetchProxy = (
  mainProcess: MainProcess,
  mockRules: readonly LegacyMockRule[] = [],
  applicationEntry?: string
) => {
  const instances = new Set<UndiciModule>([undici])
  if (applicationEntry !== undefined) {
    const applicationUndici = resolveApplicationUndici(applicationEntry)
    if (applicationUndici) instances.add(applicationUndici)
  }

  const restore: (() => void)[] = []
  for (const instance of instances) {
    const originalFetch = instance.fetch
    if (!originalFetch) continue
    const proxy = (
      mockRules.length > 0
        ? fetchProxyFactory(originalFetch as typeof globalThis.fetch, mainProcess, mockRules)
        : fetchProxyFactory(originalFetch as typeof globalThis.fetch, mainProcess)
    ) as typeof undici.fetch
    if (Reflect.set(instance, 'fetch', proxy)) {
      restore.push(() => {
        if (instance.fetch === proxy) Reflect.set(instance, 'fetch', originalFetch)
      })
    }
  }

  if (restore.length === 0) return
  return () => {
    for (const restoreFetch of restore) restoreFetch()
  }
}

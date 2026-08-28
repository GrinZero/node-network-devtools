export * from './errors'
export * from './loader'
export * from './preload-config'
export * from './types'

import type { NndConfig } from './types'

/** Type helper for nnd.config.mjs/cjs files. */
export function defineConfig<const T extends NndConfig>(config: T): T {
  return config
}

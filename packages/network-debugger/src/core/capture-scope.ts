import { AsyncLocalStorage } from 'node:async_hooks'

const legacyCaptureSuppression = new AsyncLocalStorage<boolean>()

/** Run internal debugger transport setup without observing it as application traffic. */
export function withoutLegacyCapture<T>(operation: () => T): T {
  return legacyCaptureSuppression.run(true, operation)
}

export function isLegacyCaptureSuppressed(): boolean {
  return legacyCaptureSuppression.getStore() === true
}

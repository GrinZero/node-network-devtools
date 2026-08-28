import { expect, it, vi } from 'vitest'
import type { RegistrationHandle } from '../runtime/registration'

const deferred = vi.hoisted(() => {
  let release!: (value: RegistrationHandle) => void
  return {
    promise: new Promise<RegistrationHandle>((resolvePromise) => (release = resolvePromise)),
    release
  }
})

vi.mock('./index', () => ({
  NND_PRELOAD_REPORT_ENV: 'NND_PRELOAD_REPORT',
  NND_READY_PREFIX: '[nnd:ready] ',
  claimPreloadProcess: () => true,
  formatPreloadError: (error: unknown) => String(error),
  preload: () => deferred.promise
}))

it('keeps the side-effect module evaluation pending until preload completes', async () => {
  const original = process.env.NND_PRELOAD_REPORT
  delete process.env.NND_PRELOAD_REPORT
  let imported = false
  const importing = import('./register').then(() => {
    imported = true
  })

  await Promise.resolve()
  await Promise.resolve()
  expect(imported).toBe(false)

  const handle = (() => undefined) as RegistrationHandle
  deferred.release(handle)
  await importing
  expect(imported).toBe(true)

  if (original === undefined) delete process.env.NND_PRELOAD_REPORT
  else process.env.NND_PRELOAD_REPORT = original
})

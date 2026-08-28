import { describe, expect, it, vi } from 'vitest'
import type { ReadyInfo, RegistrationHandle } from '../runtime/registration'
import { NND_PRELOAD_CONFIG_ENV, serializePreloadConfig, type ResolvedNndConfig } from '../config'
import { NND_PRELOAD_PROCESS_ENV, claimPreloadProcess, getPreloadHandle, preload } from './index'

const resolved: ResolvedNndConfig = {
  mode: 'auto',
  open: false,
  wait: true,
  watch: false,
  runner: 'node',
  inspector: { host: '127.0.0.1', port: 0 },
  requiredCapabilities: [],
  legacy: {}
}

const readyInfo: ReadyInfo = {
  mode: 'native',
  target: {
    id: 'target',
    title: 'target',
    type: 'node',
    url: '',
    webSocketDebuggerUrl: 'ws://127.0.0.1:1234/id',
    discoveryUrl: 'http://127.0.0.1:1234/json/list'
  },
  capabilities: {
    http: true,
    https: true,
    fetch: true,
    http2: true,
    responseBody: true,
    requestBody: false,
    websocketLifecycle: false,
    websocketFrames: false,
    sseMessages: false,
    initiator: true
  },
  diagnostics: []
}

function fakeHandle(ready: Promise<ReadyInfo> = Promise.resolve(readyInfo)): RegistrationHandle {
  const handle = (() => undefined) as RegistrationHandle
  Object.defineProperties(handle, {
    ready: { value: ready },
    status: { value: () => ({ state: 'ready' }) },
    openDevtools: { value: vi.fn() },
    dispose: { value: vi.fn() },
    on: { value: vi.fn() }
  })
  return handle
}

describe('preload', () => {
  it('claims only the root process so inherited --import does not register in forks', () => {
    const env: NodeJS.ProcessEnv = {}
    expect(claimPreloadProcess(env)).toBe(true)
    expect(env[NND_PRELOAD_PROCESS_ENV]).toBe('claimed')
    expect(claimPreloadProcess(env)).toBe(false)
  })

  it('registers synchronously from serialized CLI config and only once', async () => {
    const realm = Object.create(null) as typeof globalThis
    const register = vi.fn(() => fakeHandle())
    const env = { [NND_PRELOAD_CONFIG_ENV]: serializePreloadConfig(resolved) }

    const first = preload({ globalObject: realm, env, register })
    const second = preload({ globalObject: realm, env, register })

    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'auto', devtools: { open: false } })
    )
    expect(second).toBe(first)
    const handle = await first
    expect(getPreloadHandle(realm)).toBe(handle)
  })

  it('waits for config discovery, registration, and handle readiness', async () => {
    const realm = Object.create(null) as typeof globalThis
    let releaseConfig!: (value: {
      config: ResolvedNndConfig
      sources: { env: []; cli: [] }
    }) => void
    const configPromise = new Promise<{ config: ResolvedNndConfig; sources: { env: []; cli: [] } }>(
      (resolvePromise) => (releaseConfig = resolvePromise)
    )
    let releaseReady!: (value: ReadyInfo) => void
    const ready = new Promise<ReadyInfo>((resolvePromise) => (releaseReady = resolvePromise))
    const register = vi.fn(() => fakeHandle(ready))
    const resolution = preload({
      globalObject: realm,
      env: {},
      register,
      resolve: vi.fn(() => configPromise)
    })
    let completed = false
    void resolution.then(() => (completed = true))

    await Promise.resolve()
    expect(register).not.toHaveBeenCalled()
    releaseConfig({ config: resolved, sources: { env: [], cli: [] } })
    await Promise.resolve()
    expect(register).toHaveBeenCalledTimes(1)
    expect(completed).toBe(false)
    releaseReady(readyInfo)
    await expect(resolution).resolves.toBe(getPreloadHandle(realm))
    expect(completed).toBe(true)
  })

  it('clears failed state so a corrected import can retry', async () => {
    const realm = Object.create(null) as typeof globalThis
    const register = vi
      .fn<() => RegistrationHandle>()
      .mockReturnValueOnce(fakeHandle(Promise.reject(new Error('not ready'))))
      .mockReturnValueOnce(fakeHandle())
    const env = { [NND_PRELOAD_CONFIG_ENV]: serializePreloadConfig(resolved) }

    await expect(preload({ globalObject: realm, env, register })).rejects.toThrow('not ready')
    await expect(preload({ globalObject: realm, env, register })).resolves.toBeDefined()
    expect(register).toHaveBeenCalledTimes(2)
  })
})

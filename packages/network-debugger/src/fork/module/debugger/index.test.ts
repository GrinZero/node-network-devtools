import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CDP_ERROR_CODES } from '../../devtool'
import type { DevtoolMessageListener } from '../../request-center'
import type { PluginCore } from '../common'
import { debuggerPlugin } from './index'

const handlers = new Map<string, DevtoolMessageListener<any>[]>()
const send = vi.fn().mockResolvedValue(undefined)
const getScriptSource = vi.fn()
const getLocalScriptList = vi.fn()

function loadPlugin() {
  const networkPlugin = {
    getRequest: vi.fn(),
    resourceService: {
      getScriptSource,
      getLocalScriptList,
      getScriptIdByUrl: vi.fn()
    }
  }
  const core: PluginCore = {
    on<T>(method: string, listener: DevtoolMessageListener<T>) {
      const list = handlers.get(method) ?? []
      list.push(listener as DevtoolMessageListener<any>)
      handlers.set(method, list)
      return () => undefined
    },
    usePlugin<T>() {
      return networkPlugin as unknown as T
    }
  }
  debuggerPlugin({
    devtool: {
      send,
      timestamp: 0,
      getTimestamp: () => 0,
      updateTimestamp: () => undefined
    },
    core,
    plugins: [debuggerPlugin]
  })
}

function handler(method: string) {
  const listener = handlers.get(method)?.[0]
  if (!listener) throw new Error(`Missing handler ${method}`)
  return listener
}

beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
  getLocalScriptList.mockReturnValue([])
  loadPlugin()
})

describe('debuggerPlugin v2 command semantics', () => {
  test('registers lazy source and reconnect handlers', () => {
    expect(debuggerPlugin.id).toBe('debugger')
    expect(handlers.has('Debugger.getScriptSource')).toBe(true)
    expect(handlers.has('onConnect')).toBe(true)
  })

  test('resolves getScriptSource through the command result callback', async () => {
    getScriptSource.mockReturnValue('console.log("source")')
    const result = vi.fn().mockResolvedValue(undefined)
    const error = vi.fn().mockResolvedValue(undefined)

    await handler('Debugger.getScriptSource')({
      data: { scriptId: 'script-1' },
      id: 0,
      result,
      error
    })

    expect(getScriptSource).toHaveBeenCalledWith('script-1')
    expect(result).toHaveBeenCalledWith({ scriptSource: 'console.log("source")' })
    expect(error).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ id: 0 }))
  })

  test('rejects invalid params with -32602', async () => {
    const result = vi.fn().mockResolvedValue(undefined)
    const error = vi.fn().mockResolvedValue(undefined)

    await handler('Debugger.getScriptSource')({ data: {}, result, error })

    expect(error).toHaveBeenCalledWith(CDP_ERROR_CODES.INVALID_PARAMS, 'scriptId must be a string.')
    expect(result).not.toHaveBeenCalled()
  })

  test('rejects an unknown lazy script with a server error', async () => {
    getScriptSource.mockReturnValue(null)
    const result = vi.fn().mockResolvedValue(undefined)
    const error = vi.fn().mockResolvedValue(undefined)

    await handler('Debugger.getScriptSource')({
      data: { scriptId: 'missing' },
      result,
      error
    })

    expect(error).toHaveBeenCalledWith(CDP_ERROR_CODES.SERVER_ERROR, 'Unknown script id missing.')
    expect(result).not.toHaveBeenCalled()
  })

  test('reads the current lazy script list on every frontend connection', () => {
    const first = {
      url: 'file:///first.js',
      scriptLanguage: 'JavaScript',
      embedderName: 'file:///first.js',
      scriptId: '1',
      sourceMapURL: '',
      hasSourceURL: false
    }
    const second = {
      ...first,
      url: 'file:///second.js',
      embedderName: 'file:///second.js',
      scriptId: '2'
    }
    getLocalScriptList.mockReturnValueOnce([first]).mockReturnValueOnce([first, second])

    handler('onConnect')({ data: null })
    handler('onConnect')({ data: null })

    expect(getLocalScriptList).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenNthCalledWith(1, {
      method: 'Debugger.scriptParsed',
      params: first
    })
    expect(send).toHaveBeenNthCalledWith(3, {
      method: 'Debugger.scriptParsed',
      params: second
    })
  })

  test('does not announce scripts before lazy registration', () => {
    handler('onConnect')({ data: null })
    expect(send).not.toHaveBeenCalled()
  })
})

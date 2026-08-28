import { CDP_ERROR_CODES } from '../../devtool'
import { createPlugin, useConnect, useHandler } from '../common'
import { NetworkPluginCore } from '../network'
export interface ISciprtParsed {
  url: string
  scriptLanguage: string
  embedderName: string
  scriptId: string
  sourceMapURL: string
  hasSourceURL: boolean
}
export interface ScriptSourceData {
  scriptId: string
}

export const debuggerPlugin = createPlugin('debugger', ({ devtool, core }) => {
  const networkPlugin = core.usePlugin<NetworkPluginCore>('network')

  useHandler<ScriptSourceData>('Debugger.getScriptSource', async ({ data, result, error }) => {
    if (!data || typeof data.scriptId !== 'string') {
      await error?.(CDP_ERROR_CODES.INVALID_PARAMS, 'scriptId must be a string.')
      return
    }
    const { scriptId } = data
    const scriptSource = networkPlugin.resourceService.getScriptSource(scriptId)
    if (typeof scriptSource !== 'string') {
      await error?.(CDP_ERROR_CODES.SERVER_ERROR, `Unknown script id ${scriptId}.`)
      return
    }
    await result?.({ scriptSource })
  })

  useConnect(() => {
    networkPlugin.resourceService.getLocalScriptList().forEach((script) => {
      devtool.send({
        method: 'Debugger.scriptParsed',
        params: { ...script }
      })
    })
  })
})

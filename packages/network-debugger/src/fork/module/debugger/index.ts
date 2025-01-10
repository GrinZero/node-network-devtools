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

  useHandler<ScriptSourceData>('Debugger.getScriptSource', ({ id, data }) => {
    if (!id) {
      return
    }
    const { scriptId } = data
    const scriptSource = networkPlugin.resourceService.getScriptSource(scriptId)
    devtool.send({
      id: id,
      method: 'Debugger.getScriptSourceResponse',
      result: {
        scriptSource
      }
    })
  })

  const scriptList = networkPlugin.resourceService.getLocalScriptList()
  useConnect(() => {
    scriptList.forEach((script) => {
      devtool.send({
        method: 'Debugger.scriptParsed',
        params: script
      })
    })
  })
})

import { createPlugin, useContext, useHandler } from '../common'

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

export const useStore = () => {
  const { devtool } = useContext()
  devtool.send({})
}

export const debuggerPlugin = createPlugin(({ devtool, core }) => {
  useHandler<ScriptSourceData>('Debugger.getScriptSource', ({ id, data }) => {
    const { scriptId } = data
    const scriptSource = core.resourceService.getScriptSource(scriptId)
    devtool.send({
      id: id,
      method: 'Debugger.getScriptSourceResponse',
      result: {
        scriptSource
      }
    })
  })
  const scriptList = core.resourceService.getLocalScriptList()
  scriptList.forEach((script) => {
    devtool.send({
      method: 'Debugger.scriptParsed',
      params: script
    })
  })
})

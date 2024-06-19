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

export const useScriptParsed = (script: ISciprtParsed) => {
  const { devtool } = useContext()
  devtool.send({
    method: 'Debugger.scriptParsed',
    params: script
  })
}

export const debuggerPlugin = createPlugin(({ devtool, core }) => {
  useHandler('Debugger.getScriptSource', ({ id, data }) => {
    const scriptId = (data as ScriptSourceData).scriptId
    const scriptSource = core.resourceService.handleGetScriptSource(scriptId)
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

import fs from 'fs'
import path from 'path'
import { DevtoolServer } from '../fork/devtool'

export function getScriptLanguageByFileName(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'JavaScript'
    case 'ts':
      return 'TypeScript'
    case 'jsx':
      return 'JSX'
    case 'tsx':
      return 'TSX'
    case 'html':
    case 'htm':
      return 'HTML'
    case 'css':
      return 'CSS'
    case 'vue':
      return 'Vue'
    case 'json':
      return 'JSON'
    case 'yaml':
    case 'yml':
      return 'YAML'
    case 'xml':
      return 'XML'
    default:
      return 'Unknown'
  }
}

export class ResourceCenter {
  private pathToScriptId: Map<string, string>
  private scriptIdToPath: Map<string, string>
  private devtool: DevtoolServer

  constructor(devtool: DevtoolServer) {
    this.pathToScriptId = new Map<string, string>()
    this.scriptIdToPath = new Map<string, string>()
    this.devtool = devtool
  }
  // 双向映射
  public addMapping(filePath: string, scriptId: string) {
    this.pathToScriptId.set(filePath, scriptId)
    this.scriptIdToPath.set(scriptId, filePath)
  }
  public getPathByScriptId(scriptId: string) {
    return this.scriptIdToPath.get(scriptId)
  }
  public getScriptIdByPath(filePath: string) {
    return this.pathToScriptId.get(filePath)
  }
  // 传入路径，建立映射
  private getScriptListByTraverseDir(
    directoryPath: string,
    ignoreDict: string[] = ['node_modules']
  ) {
    const scriptList = []
    const stack = [directoryPath]
    while (stack.length > 0) {
      const currentPath = stack.pop()!
      const items = fs.readdirSync(currentPath)
      for (const item of items) {
        if (ignoreDict.includes(item)) {
          continue
        }
        const fullPath = path.join(currentPath, item)
        const stats = fs.statSync(fullPath)
        if (stats.isDirectory()) {
          stack.push(fullPath)
        } else {
          const resolvedPath = path.resolve(fullPath)
          const url = new URL(`file://${resolvedPath.replace(/\\/g, '/')}`)
          scriptList.push({
            url: url.href,
            scriptLanguage: getScriptLanguageByFileName(url.href),
            embedderName: url.href,
            scriptId: scriptList.length,
            // TODO: SourceMap 实际应该是打包后的代码才需要？ 但是这里显示的是实际的代码
            sourceMapURL: '',
            hasSourceURL: false
          })
        }
      }
    }
    return scriptList
  }
  private initScriptMap() {
    // FIXME: 既需要项目路径，又需要当前tools路径，非正确用法
    const scriptList = this.getScriptListByTraverseDir(path.resolve('../..'))
    let scriptId = 0
    scriptList.forEach((script) => {
      scriptId += 1
      this.addMapping(script.url, '' + scriptId)
      this.devtool.send({
        method: 'Debugger.scriptParsed',
        params: script
      })
    })
  }
  private initDevtoolListeners() {
    this.devtool.on((error, message) => {
      if (error) {
        return
      }
      if (message.method === 'Debugger.getScriptSource') {
        console.log(message)
        // 获取脚本内容
        this.devtool.send({
          id: message.id,
          method: 'Debugger.getScriptSource',
          result: {
            // TODO:读取实际脚本内容
            scriptSource: 'var passort=passort'
          }
        })
      }
    })
  }
  public init() {
    // 初始化map
    this.initScriptMap()
    // 初始化监听器
    this.initDevtoolListeners()
  }
}

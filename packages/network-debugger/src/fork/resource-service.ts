import fs from 'fs'
import path from 'path'
import { DevtoolServer } from './devtool'
import { fileURLToPath } from 'url'
import { __dirname } from '../core/fork'

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

export class ResourceService {
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
  public handleGetScriptSource(scriptId: string) {
    const filePath = this.getPathByScriptId(scriptId)
    if (!filePath) {
      return
    }
    const fileSystemPath = fileURLToPath(filePath)
    try {
      const data = fs.readFileSync(fileSystemPath, 'utf-8')
      return data
    } catch (err) {
      console.error('Error reading file:', err)
    }
  }
  private scriptIdCounter = 0
  // 传入路径，建立映射
  private getScriptListByTraverseDir(
    directoryPath: string,
    ignoreDict: string[] = ['node_modules']
  ) {
    const scriptList = []
    const stack = [directoryPath]
    let scriptId = this.scriptIdCounter
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
            scriptId: '' + ++scriptId,
            // TODO: SourceMap?
            sourceMapURL: '',
            hasSourceURL: false
          })
        }
      }
    }
    this.scriptIdCounter += scriptList.length
    return scriptList
  }

  public getLocalScriptList() {
    const scriptList = [
      ...this.getScriptListByTraverseDir(process.cwd()),
      ...this.getScriptListByTraverseDir(__dirname)
    ]
    scriptList.forEach((script) => {
      this.addMapping(script.url, '' + script.scriptId)
    })
    return scriptList
  }
}

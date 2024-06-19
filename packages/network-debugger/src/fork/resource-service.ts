import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { __dirname } from '../core/fork'

function getScriptLanguageByFileName(fileName: string) {
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

export class ScriptMap {
  private pathToScriptId: Map<string, string>
  private scriptIdToPath: Map<string, string>

  constructor() {
    this.pathToScriptId = new Map<string, string>()
    this.scriptIdToPath = new Map<string, string>()
  }

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
}

export class ResourceService {
  private scriptMap: ScriptMap
  private scriptIdCounter: number

  constructor() {
    this.scriptMap = new ScriptMap()
    this.scriptIdCounter = 0
  }

  public getScriptIdByPath(filePath: string) {
    return this.scriptMap.getScriptIdByPath(filePath)
  }

  public getPathByScriptId(scriptId: string) {
    return this.scriptMap.getPathByScriptId(scriptId)
  }

  public getScriptSource(scriptId: string) {
    const filePath = this.scriptMap.getPathByScriptId(scriptId)
    if (!filePath) {
      console.error(`No file path found for script ID: ${scriptId}`)
      return null
    }

    const fileSystemPath = fileURLToPath(filePath)
    try {
      return fs.readFileSync(fileSystemPath, 'utf-8')
    } catch (err) {
      console.error('Error reading file:', err)
      return null
    }
  }

  private traverseDirToMap(directoryPath: string, ignoreList: string[] = ['node_modules']) {
    const scriptList = []
    const stack = [directoryPath]
    let scriptId = this.scriptIdCounter

    while (stack.length > 0) {
      const currentPath = stack.pop()!
      const items = fs.readdirSync(currentPath)

      for (const item of items) {
        if (ignoreList.includes(item)) {
          continue
        }

        const fullPath = path.join(currentPath, item)
        const stats = fs.statSync(fullPath)

        if (stats.isDirectory()) {
          stack.push(fullPath)
        } else {
          const resolvedPath = path.resolve(fullPath)
          const fileUrl = new URL(`file://${resolvedPath.replace(/\\/g, '/')}`)
          const scriptIdStr = `${++scriptId}`

          scriptList.push({
            url: fileUrl.href,
            scriptLanguage: getScriptLanguageByFileName(fileUrl.href),
            embedderName: fileUrl.href,
            scriptId: scriptIdStr,
            // TODO: SourceMap?
            sourceMapURL: '',
            hasSourceURL: false
          })
          this.scriptMap.addMapping(fileUrl.href, scriptIdStr)
        }
      }
    }
    this.scriptIdCounter += scriptList.length
    return scriptList
  }

  public getLocalScriptList() {
    const projectScripts = this.traverseDirToMap(process.cwd())
    const coreScripts = this.traverseDirToMap(__dirname)

    return [...projectScripts, ...coreScripts]
  }
}

import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { __dirname } from '../common'

function getScriptLangByFileName(fileName: string) {
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
  private urlToScriptId: Map<string, string>
  private scriptIdToUrl: Map<string, string>

  constructor() {
    this.urlToScriptId = new Map<string, string>()
    this.scriptIdToUrl = new Map<string, string>()
  }

  public addMapping(filePath: string, scriptId: string) {
    this.urlToScriptId.set(filePath, scriptId)
    this.scriptIdToUrl.set(scriptId, filePath)
  }

  public getUrlByScriptId(scriptId: string) {
    return this.scriptIdToUrl.get(scriptId)
  }

  public getScriptIdByUrl(url: string) {
    return this.urlToScriptId.get(url)
  }
}

export class ResourceService {
  private scriptMap: ScriptMap
  private scriptIdCounter: number

  constructor() {
    this.scriptMap = new ScriptMap()
    this.scriptIdCounter = 0
  }

  public getScriptIdByUrl(url: string) {
    return this.scriptMap.getScriptIdByUrl(url)
  }

  public getUrlByScriptId(scriptId: string) {
    return this.scriptMap.getUrlByScriptId(scriptId)
  }

  public getScriptSource(scriptId: string) {
    const fileUrl = this.scriptMap.getUrlByScriptId(scriptId)
    if (!fileUrl) {
      console.error(`No file path found for script ID: ${scriptId}`)
      return null
    }

    const filePath = fileURLToPath(fileUrl)
    try {
      return fs.readFileSync(filePath, 'utf-8')
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
          const fileUrl = pathToFileURL(resolvedPath)
          const scriptIdStr = `${++scriptId}`
          scriptList.push({
            url: fileUrl.href,
            scriptLanguage: getScriptLangByFileName(fileUrl.href),
            embedderName: fileUrl.href,
            scriptId: scriptIdStr,
            // TODO: SourceMap?
            sourceMapURL: '',
            hasSourceURL: false
            // TODO: is useful?
            // startColumn: 0,
            // startLine: 0,
            // endColumn: 231,
            // endLine: 145,
            // isModule: false,
            // length: 63559,
            // isLiveEdit: false
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

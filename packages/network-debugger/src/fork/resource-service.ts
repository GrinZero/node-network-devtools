import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { __dirname } from '../common'

// Actually Allowed Values: JavaScript, WebAssembly
function getScriptLangByFileName(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'JavaScript'
    case 'wasm':
      return 'WebAssembly'
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

  /**
   * @description Read the last lines of the file
   * @param filePath
   * @param stat
   * @param totalLines
   * @returns string
   */
  readLastLine(filePath: string, stat: fs.Stats, totalLines = 1) {
    const fileSize = stat.size
    const chunkSize = Math.min(1024, fileSize)
    let startPos = fileSize - chunkSize
    let buffer = Buffer.alloc(chunkSize)
    let lines: string[] = []

    const fd = fs.openSync(filePath, 'r')

    while (lines.length < totalLines && startPos >= 0) {
      fs.readSync(fd, buffer, 0, chunkSize, startPos)
      const chunk = buffer.toString('utf8')
      lines = chunk.split('\n').concat(lines)
      startPos -= chunkSize
      if (startPos < 0) {
        startPos = 0
        buffer = Buffer.alloc(fileSize - startPos)
      }
    }

    fs.closeSync(fd)

    // Return the last `totalLines` lines
    return lines.slice(-totalLines).join('\n')
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
          let sourceMapURL = ''
          if (/\.(js|ts)$/.test(resolvedPath)) {
            const lastChunkCode = this.readLastLine(fullPath, stats, 2)
            const sourceMapFilePathMatch = lastChunkCode.match(/sourceMappingURL=(.+)$/m)?.[1] ?? ''
            sourceMapURL = sourceMapFilePathMatch
              ? sourceMapFilePathMatch.startsWith('data:')
                ? // inline sourcemap
                  sourceMapFilePathMatch
                : // file path
                  pathToFileURL(path.join(currentPath, sourceMapFilePathMatch)).href
              : ''
          }
          const url = fileUrl.href
          const scriptLanguage = getScriptLangByFileName(url)
          scriptList.push({
            url,
            scriptLanguage,
            embedderName: fileUrl.href,
            scriptId: scriptIdStr,
            sourceMapURL: sourceMapURL,
            hasSourceURL: Boolean(sourceMapURL)
          })
          this.scriptMap.addMapping(url, scriptIdStr)
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

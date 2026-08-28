import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

export interface ScriptDescriptor {
  url: string
  scriptLanguage: string
  embedderName: string
  scriptId: string
  sourceMapURL: string
  hasSourceURL: boolean
}

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

  /** Add an alternate lookup key without replacing the canonical file URL. */
  public addAlias(alias: string, scriptId: string) {
    this.urlToScriptId.set(alias, scriptId)
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
  private scripts: Map<string, ScriptDescriptor>

  constructor() {
    this.scriptMap = new ScriptMap()
    this.scriptIdCounter = 0
    this.scripts = new Map()
  }

  public getScriptIdByUrl(url: string) {
    const existing = this.scriptMap.getScriptIdByUrl(url)
    if (existing) return existing
    return this.registerScript(url)?.scriptId
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
    if (totalLines <= 0 || stat.size === 0) return ''
    // Source-map directives are short and live at EOF. A bounded tail read
    // avoids the old zero-progress loop for files without a trailing newline.
    const length = Math.min(stat.size, 64 * 1024)
    const start = stat.size - length
    const buffer = Buffer.alloc(length)
    const fd = fs.openSync(filePath, 'r')
    try {
      fs.readSync(fd, buffer, 0, length, start)
    } finally {
      fs.closeSync(fd)
    }
    return buffer.toString('utf8').split(/\r?\n/).slice(-totalLines).join('\n')
  }

  public getLocalScriptList() {
    return [...this.scripts.values()]
  }

  private registerScript(input: string): ScriptDescriptor | undefined {
    let filePath: string
    try {
      filePath = input.startsWith('file:') ? fileURLToPath(input) : path.resolve(input)
    } catch {
      return undefined
    }
    let stat: fs.Stats
    try {
      stat = fs.statSync(filePath)
    } catch {
      return undefined
    }
    if (!stat || typeof stat.isFile !== 'function' || !stat.isFile()) return undefined

    const url = pathToFileURL(filePath).href
    const known = this.scriptMap.getScriptIdByUrl(url)
    if (known) return this.scripts.get(known)

    let sourceMapURL = ''
    if (/\.(?:[cm]?js|ts)$/i.test(filePath)) {
      const tail = this.readLastLine(filePath, stat, 2)
      const sourceMap = tail.match(/sourceMappingURL=(.+)$/m)?.[1]?.trim()
      if (sourceMap) {
        sourceMapURL = sourceMap.startsWith('data:')
          ? sourceMap
          : pathToFileURL(path.resolve(path.dirname(filePath), sourceMap)).href
      }
    }

    const scriptId = `${++this.scriptIdCounter}`
    const descriptor: ScriptDescriptor = {
      url,
      scriptLanguage: getScriptLangByFileName(url),
      embedderName: url,
      scriptId,
      sourceMapURL,
      hasSourceURL: Boolean(sourceMapURL)
    }
    this.scriptMap.addMapping(url, scriptId)
    if (input !== url) this.scriptMap.addAlias(input, scriptId)
    this.scripts.set(scriptId, descriptor)
    return descriptor
  }
}

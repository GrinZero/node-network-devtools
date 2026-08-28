import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ResourceService, ScriptMap } from './resource-service'

let fixtureDir = ''

function fixture(name: string, source = '') {
  const filePath = path.join(fixtureDir, name)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, source)
  return filePath
}

beforeEach(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nnd-resource-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(fixtureDir, { recursive: true, force: true })
})

describe('ScriptMap', () => {
  test('maintains bidirectional mappings and replaces a URL mapping', () => {
    const map = new ScriptMap()
    map.addMapping('file:///one.js', '1')
    map.addMapping('file:///two.js', '2')
    map.addMapping('file:///one.js', '3')

    expect(map.getScriptIdByUrl('file:///one.js')).toBe('3')
    expect(map.getScriptIdByUrl('file:///two.js')).toBe('2')
    expect(map.getUrlByScriptId('1')).toBe('file:///one.js')
    expect(map.getUrlByScriptId('3')).toBe('file:///one.js')
    expect(map.getScriptIdByUrl('file:///missing.js')).toBeUndefined()
  })
})

describe('ResourceService lazy registration', () => {
  test('starts empty and never scans cwd eagerly', () => {
    const unreferenced = fixture('unreferenced.js', 'console.log("not announced")')
    const service = new ResourceService()

    expect(service.getLocalScriptList()).toEqual([])
    expect(service.getUrlByScriptId('1')).toBeUndefined()
    expect(fs.existsSync(unreferenced)).toBe(true)
  })

  test('registers an existing file only when its URL is requested', () => {
    const filePath = fixture('app.js', 'export const value = 1')
    const fileUrl = pathToFileURL(filePath).href
    const service = new ResourceService()

    const id = service.getScriptIdByUrl(fileUrl)

    expect(id).toBe('1')
    expect(service.getScriptIdByUrl(fileUrl)).toBe(id)
    expect(service.getScriptIdByUrl(filePath)).toBe(id)
    expect(service.getUrlByScriptId(id!)).toBe(fileUrl)
    expect(service.getLocalScriptList()).toEqual([
      expect.objectContaining({
        scriptId: id,
        url: fileUrl,
        embedderName: fileUrl,
        scriptLanguage: 'JavaScript'
      })
    ])
  })

  test('does not register missing files, directories, or invalid file URLs', () => {
    const service = new ResourceService()

    expect(service.getScriptIdByUrl(path.join(fixtureDir, 'missing.js'))).toBeUndefined()
    expect(service.getScriptIdByUrl(fixtureDir)).toBeUndefined()
    expect(service.getScriptIdByUrl('file:///%zz')).toBeUndefined()
    expect(service.getLocalScriptList()).toEqual([])
  })

  test.each([
    ['entry.js', 'JavaScript'],
    ['entry.mjs', 'JavaScript'],
    ['entry.cjs', 'JavaScript'],
    ['module.wasm', 'WebAssembly'],
    ['entry.ts', 'Unknown'],
    ['README', 'Unknown']
  ])('classifies %s as %s after lazy registration', (name, language) => {
    const service = new ResourceService()
    const filePath = fixture(name, 'content')

    const id = service.getScriptIdByUrl(filePath)

    expect(service.getLocalScriptList().find((script) => script.scriptId === id)).toMatchObject({
      scriptLanguage: language
    })
  })

  test('resolves an external source map relative to the script', () => {
    const service = new ResourceService()
    const mapPath = fixture('maps/app.js.map', '{}')
    const scriptPath = fixture('maps/app.js', 'console.log(1)\n//# sourceMappingURL=app.js.map\n')

    const id = service.getScriptIdByUrl(scriptPath)
    const descriptor = service.getLocalScriptList().find((script) => script.scriptId === id)

    expect(descriptor).toMatchObject({
      sourceMapURL: pathToFileURL(mapPath).href,
      hasSourceURL: true
    })
  })

  test('preserves inline source maps and reports scripts without maps', () => {
    const service = new ResourceService()
    const inline = 'data:application/json;base64,eyJ2ZXJzaW9uIjozfQ=='
    const inlinePath = fixture('inline.js', `code();\n//# sourceMappingURL=${inline}`)
    const plainPath = fixture('plain.js', 'code();')

    const inlineId = service.getScriptIdByUrl(inlinePath)
    const plainId = service.getScriptIdByUrl(plainPath)
    const scripts = service.getLocalScriptList()

    expect(scripts.find((script) => script.scriptId === inlineId)).toMatchObject({
      sourceMapURL: inline,
      hasSourceURL: true
    })
    expect(scripts.find((script) => script.scriptId === plainId)).toMatchObject({
      sourceMapURL: '',
      hasSourceURL: false
    })
  })

  test('returns source only for a lazily registered script', () => {
    const source = 'export default "source"\n'
    const filePath = fixture('source.js', source)
    const service = new ResourceService()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(service.getScriptSource('missing')).toBeNull()
    const id = service.getScriptIdByUrl(filePath)
    expect(service.getScriptSource(id!)).toBe(source)
    expect(error).toHaveBeenCalledWith('No file path found for script ID: missing')
  })

  test('allocates stable increasing IDs without duplicating aliases', () => {
    const first = fixture('first.js', '')
    const second = fixture('second.js', '')
    const service = new ResourceService()

    expect(service.getScriptIdByUrl(first)).toBe('1')
    expect(service.getScriptIdByUrl(pathToFileURL(first).href)).toBe('1')
    expect(service.getScriptIdByUrl(second)).toBe('2')
    expect(service.getLocalScriptList()).toHaveLength(2)
  })

  test('reads bounded final lines with and without a trailing newline', () => {
    const filePath = fixture('tail.js', 'first\nsecond\nthird')
    const service = new ResourceService()
    const stat = fs.statSync(filePath)

    expect(service.readLastLine(filePath, stat)).toBe('third')
    expect(service.readLastLine(filePath, stat, 2)).toBe('second\nthird')
    expect(service.readLastLine(filePath, stat, 0)).toBe('')
  })
})

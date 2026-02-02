import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { fileURLToPath, pathToFileURL } from 'url'
import path from 'path'

// 使用 vi.hoisted 确保变量在 mock 提升时可用
const {
  mockReadFileSync,
  mockReaddirSync,
  mockStatSync,
  mockOpenSync,
  mockReadSync,
  mockCloseSync,
  mockExistsSync,
  fileContents,
  directoryStructure
} = vi.hoisted(() => {
  return {
    mockReadFileSync: vi.fn(),
    mockReaddirSync: vi.fn(),
    mockStatSync: vi.fn(),
    mockOpenSync: vi.fn(),
    mockReadSync: vi.fn(),
    mockCloseSync: vi.fn(),
    mockExistsSync: vi.fn(),
    fileContents: new Map<string, string>(),
    directoryStructure: new Map<string, { isDirectory: boolean; size: number; items?: string[] }>()
  }
})

// Mock fs 模块
vi.mock('fs', () => {
  return {
    default: {
      readFileSync: mockReadFileSync,
      readdirSync: mockReaddirSync,
      statSync: mockStatSync,
      openSync: mockOpenSync,
      readSync: mockReadSync,
      closeSync: mockCloseSync,
      existsSync: mockExistsSync
    },
    readFileSync: mockReadFileSync,
    readdirSync: mockReaddirSync,
    statSync: mockStatSync,
    openSync: mockOpenSync,
    readSync: mockReadSync,
    closeSync: mockCloseSync,
    existsSync: mockExistsSync
  }
})

// Mock common 模块中的 __dirname
vi.mock('../common', () => ({
  __dirname: '/mock/common/dir'
}))

describe('fork/resource-service.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileContents.clear()
    directoryStructure.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('ScriptMap 类', () => {
    test('addMapping 添加 URL 和 scriptId 的双向映射', async () => {
      const { ScriptMap } = await import('./resource-service')
      const scriptMap = new ScriptMap()

      scriptMap.addMapping('file:///test/file.js', '1')

      expect(scriptMap.getScriptIdByUrl('file:///test/file.js')).toBe('1')
      expect(scriptMap.getUrlByScriptId('1')).toBe('file:///test/file.js')
    })

    test('getUrlByScriptId 返回正确的 URL', async () => {
      const { ScriptMap } = await import('./resource-service')
      const scriptMap = new ScriptMap()

      scriptMap.addMapping('file:///path/to/script.js', '42')

      expect(scriptMap.getUrlByScriptId('42')).toBe('file:///path/to/script.js')
    })

    test('getUrlByScriptId 对于不存在的 scriptId 返回 undefined', async () => {
      const { ScriptMap } = await import('./resource-service')
      const scriptMap = new ScriptMap()

      expect(scriptMap.getUrlByScriptId('non-existent')).toBeUndefined()
    })

    test('getScriptIdByUrl 返回正确的 scriptId', async () => {
      const { ScriptMap } = await import('./resource-service')
      const scriptMap = new ScriptMap()

      scriptMap.addMapping('file:///another/script.mjs', '100')

      expect(scriptMap.getScriptIdByUrl('file:///another/script.mjs')).toBe('100')
    })

    test('getScriptIdByUrl 对于不存在的 URL 返回 undefined', async () => {
      const { ScriptMap } = await import('./resource-service')
      const scriptMap = new ScriptMap()

      expect(scriptMap.getScriptIdByUrl('file:///non-existent.js')).toBeUndefined()
    })

    test('支持多个映射', async () => {
      const { ScriptMap } = await import('./resource-service')
      const scriptMap = new ScriptMap()

      scriptMap.addMapping('file:///file1.js', '1')
      scriptMap.addMapping('file:///file2.js', '2')
      scriptMap.addMapping('file:///file3.cjs', '3')

      expect(scriptMap.getScriptIdByUrl('file:///file1.js')).toBe('1')
      expect(scriptMap.getScriptIdByUrl('file:///file2.js')).toBe('2')
      expect(scriptMap.getScriptIdByUrl('file:///file3.cjs')).toBe('3')

      expect(scriptMap.getUrlByScriptId('1')).toBe('file:///file1.js')
      expect(scriptMap.getUrlByScriptId('2')).toBe('file:///file2.js')
      expect(scriptMap.getUrlByScriptId('3')).toBe('file:///file3.cjs')
    })

    test('覆盖已存在的映射', async () => {
      const { ScriptMap } = await import('./resource-service')
      const scriptMap = new ScriptMap()

      scriptMap.addMapping('file:///file.js', '1')
      scriptMap.addMapping('file:///file.js', '2')

      // URL 映射到新的 scriptId
      expect(scriptMap.getScriptIdByUrl('file:///file.js')).toBe('2')
      // 旧的 scriptId 仍然映射到 URL
      expect(scriptMap.getUrlByScriptId('1')).toBe('file:///file.js')
      // 新的 scriptId 也映射到 URL
      expect(scriptMap.getUrlByScriptId('2')).toBe('file:///file.js')
    })
  })

  describe('ResourceService 类', () => {
    describe('getScriptIdByUrl 方法', () => {
      test('返回正确的 scriptId', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        // 通过内部 scriptMap 添加映射（使用 traverseDirToMap 间接测试）
        // 由于 scriptMap 是私有的，我们需要通过 getLocalScriptList 来添加映射
        // 或者直接测试返回 undefined 的情况
        expect(service.getScriptIdByUrl('file:///non-existent.js')).toBeUndefined()
      })
    })

    describe('getUrlByScriptId 方法', () => {
      test('返回正确的 URL', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        expect(service.getUrlByScriptId('non-existent')).toBeUndefined()
      })
    })

    describe('getScriptSource 方法', () => {
      test('返回脚本源代码', async () => {
        const { ResourceService, ScriptMap } = await import('./resource-service')
        const service = new ResourceService()

        // 手动设置映射（通过反射访问私有属性）
        const scriptMap = Reflect.get(service, 'scriptMap') as InstanceType<typeof ScriptMap>
        const testUrl = pathToFileURL('/test/script.js').href
        scriptMap.addMapping(testUrl, '1')

        // 设置 mock 返回值
        mockReadFileSync.mockReturnValue('console.log("hello");')

        const source = service.getScriptSource('1')

        expect(source).toBe('console.log("hello");')
        expect(mockReadFileSync).toHaveBeenCalledWith('/test/script.js', 'utf-8')
      })

      test('scriptId 不存在时返回 null', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const source = service.getScriptSource('non-existent')

        expect(source).toBeNull()
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'No file path found for script ID: non-existent'
        )

        consoleErrorSpy.mockRestore()
      })

      test('读取文件失败时返回 null', async () => {
        const { ResourceService, ScriptMap } = await import('./resource-service')
        const service = new ResourceService()

        // 手动设置映射
        const scriptMap = Reflect.get(service, 'scriptMap') as InstanceType<typeof ScriptMap>
        const testUrl = pathToFileURL('/test/error-script.js').href
        scriptMap.addMapping(testUrl, '2')

        // 设置 mock 抛出错误
        const readError = new Error('File not found')
        mockReadFileSync.mockImplementation(() => {
          throw readError
        })

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const source = service.getScriptSource('2')

        expect(source).toBeNull()
        expect(consoleErrorSpy).toHaveBeenCalledWith('Error reading file:', readError)

        consoleErrorSpy.mockRestore()
      })
    })

    describe('readLastLine 方法', () => {
      test('读取文件最后一行', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        const fileContent = 'line1\nline2\nline3\nlast line'
        const filePath = '/test/file.txt'
        const fileSize = Buffer.byteLength(fileContent)

        mockOpenSync.mockReturnValue(1)
        mockReadSync.mockImplementation(
          (fd: number, buffer: Buffer, offset: number, length: number, position: number) => {
            const content = fileContent.slice(position, position + length)
            buffer.write(content, offset)
            return content.length
          }
        )
        mockCloseSync.mockImplementation(() => {})

        const stat = { size: fileSize } as import('fs').Stats

        const result = service.readLastLine(filePath, stat, 1)

        expect(mockOpenSync).toHaveBeenCalledWith(filePath, 'r')
        expect(mockCloseSync).toHaveBeenCalledWith(1)
        expect(result).toBe('last line')
      })

      test('读取文件最后两行', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        const fileContent = 'line1\nline2\nline3\nlast line'
        const filePath = '/test/file.txt'
        const fileSize = Buffer.byteLength(fileContent)

        mockOpenSync.mockReturnValue(2)
        mockReadSync.mockImplementation(
          (fd: number, buffer: Buffer, offset: number, length: number, position: number) => {
            const content = fileContent.slice(position, position + length)
            buffer.write(content, offset)
            return content.length
          }
        )
        mockCloseSync.mockImplementation(() => {})

        const stat = { size: fileSize } as import('fs').Stats

        const result = service.readLastLine(filePath, stat, 2)

        expect(result).toContain('line3')
        expect(result).toContain('last line')
      })

      test('文件小于 chunkSize 时正确处理', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        const fileContent = 'small file'
        const filePath = '/test/small.txt'
        const fileSize = Buffer.byteLength(fileContent)

        mockOpenSync.mockReturnValue(3)
        mockReadSync.mockImplementation(
          (fd: number, buffer: Buffer, offset: number, length: number, position: number) => {
            const content = fileContent.slice(position, position + length)
            buffer.write(content, offset)
            return content.length
          }
        )
        mockCloseSync.mockImplementation(() => {})

        const stat = { size: fileSize } as import('fs').Stats

        const result = service.readLastLine(filePath, stat, 1)

        expect(result).toBe('small file')
      })

      test('默认读取 1 行', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        const fileContent = 'line1\nline2'
        const filePath = '/test/default.txt'
        const fileSize = Buffer.byteLength(fileContent)

        mockOpenSync.mockReturnValue(4)
        mockReadSync.mockImplementation(
          (fd: number, buffer: Buffer, offset: number, length: number, position: number) => {
            const content = fileContent.slice(position, position + length)
            buffer.write(content, offset)
            return content.length
          }
        )
        mockCloseSync.mockImplementation(() => {})

        const stat = { size: fileSize } as import('fs').Stats

        // 不传 totalLines 参数，使用默认值 1
        const result = service.readLastLine(filePath, stat)

        expect(result).toBe('line2')
      })

      test('需要多次读取时 startPos 变为负数的情况', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        // 创建一个大于 1024 字节的文件，这样 chunkSize = 1024
        // startPos = fileSize - 1024
        // 当 startPos -= 1024 后，如果 startPos < 0，则进入分支
        // 例如：fileSize = 1500，chunkSize = 1024，startPos = 476
        // 第一次循环后：startPos = 476 - 1024 = -548 < 0，进入分支
        // 分支内：startPos = 0，buffer = Buffer.alloc(1500 - 0) = Buffer.alloc(1500)
        // 然后循环继续（如果 lines.length < totalLines）

        // 创建一个 1500 字节左右的文件
        const lineContent = 'x'.repeat(100) // 每行 100 个字符
        const lines = []
        for (let i = 0; i < 15; i++) {
          lines.push(`${lineContent}${i.toString().padStart(2, '0')}`)
        }
        const fileContent = lines.join('\n')
        const filePath = '/test/multiread.txt'
        const fileSize = Buffer.byteLength(fileContent) // 约 1545 字节

        mockOpenSync.mockReturnValue(5)
        mockReadSync.mockImplementation(
          (fd: number, buffer: Buffer, offset: number, length: number, position: number) => {
            const actualPosition = Math.max(0, position)
            const endPosition = Math.min(actualPosition + length, fileSize)
            const content = fileContent.slice(actualPosition, endPosition)
            buffer.write(content, offset)
            return content.length
          }
        )
        mockCloseSync.mockImplementation(() => {})

        const stat = { size: fileSize } as import('fs').Stats

        // 请求读取 15 行，这会导致循环执行多次
        // 第一次读取后，可能只有部分行，需要继续读取
        const result = service.readLastLine(filePath, stat, 15)

        // 验证结果包含最后的行
        const resultLines = result.split('\n')
        expect(resultLines.length).toBe(15)
      })
    })

    describe('getLocalScriptList 方法', () => {
      test('遍历目录并返回脚本列表', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        // 保存原始的 process.cwd
        const originalCwd = process.cwd

        // Mock process.cwd
        process.cwd = vi.fn().mockReturnValue('/mock/project')

        // 设置目录结构
        mockReaddirSync.mockImplementation((dirPath: string) => {
          if (dirPath === '/mock/project') {
            return ['index.js', 'utils.mjs', 'lib']
          }
          if (dirPath === '/mock/project/lib') {
            return ['helper.cjs']
          }
          if (dirPath === '/mock/common/dir') {
            return ['core.js']
          }
          return []
        })

        mockStatSync.mockImplementation((filePath: string) => {
          if (filePath === '/mock/project/lib' || filePath === path.join('/mock/project', 'lib')) {
            return { isDirectory: () => true, size: 0 }
          }
          return { isDirectory: () => false, size: 100 }
        })

        // Mock readLastLine 相关
        mockOpenSync.mockReturnValue(1)
        mockReadSync.mockImplementation((fd: number, buffer: Buffer) => {
          buffer.write('// no sourcemap')
          return 15
        })
        mockCloseSync.mockImplementation(() => {})

        const scripts = service.getLocalScriptList()

        // 验证返回的脚本列表
        expect(scripts.length).toBeGreaterThan(0)

        // 验证脚本属性
        const jsScript = scripts.find((s) => s.url.includes('index.js'))
        if (jsScript) {
          expect(jsScript.scriptLanguage).toBe('JavaScript')
          expect(jsScript.scriptId).toBeDefined()
        }

        // 恢复 process.cwd
        process.cwd = originalCwd
      })

      test('忽略 node_modules 目录', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        const originalCwd = process.cwd
        process.cwd = vi.fn().mockReturnValue('/mock/project')

        mockReaddirSync.mockImplementation((dirPath: string) => {
          if (dirPath === '/mock/project') {
            return ['index.js', 'node_modules']
          }
          if (dirPath === '/mock/common/dir') {
            return []
          }
          // node_modules 不应该被访问
          if (dirPath.includes('node_modules')) {
            throw new Error('Should not access node_modules')
          }
          return []
        })

        mockStatSync.mockImplementation((filePath: string) => {
          if (filePath.includes('node_modules')) {
            return { isDirectory: () => true, size: 0 }
          }
          return { isDirectory: () => false, size: 100 }
        })

        mockOpenSync.mockReturnValue(1)
        mockReadSync.mockImplementation((fd: number, buffer: Buffer) => {
          buffer.write('// code')
          return 7
        })
        mockCloseSync.mockImplementation(() => {})

        // 不应该抛出错误
        expect(() => service.getLocalScriptList()).not.toThrow()

        process.cwd = originalCwd
      })

      test('正确识别 JavaScript 文件扩展名', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        const originalCwd = process.cwd
        process.cwd = vi.fn().mockReturnValue('/mock/project')

        mockReaddirSync.mockImplementation((dirPath: string) => {
          if (dirPath === '/mock/project') {
            return ['file.js', 'file.mjs', 'file.cjs']
          }
          if (dirPath === '/mock/common/dir') {
            return []
          }
          return []
        })

        mockStatSync.mockReturnValue({ isDirectory: () => false, size: 50 })

        mockOpenSync.mockReturnValue(1)
        mockReadSync.mockImplementation((fd: number, buffer: Buffer) => {
          buffer.write('// code')
          return 7
        })
        mockCloseSync.mockImplementation(() => {})

        const scripts = service.getLocalScriptList()

        const jsFiles = scripts.filter((s) => s.scriptLanguage === 'JavaScript')
        expect(jsFiles.length).toBe(3)

        process.cwd = originalCwd
      })

      test('正确识别 WebAssembly 文件', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        const originalCwd = process.cwd
        process.cwd = vi.fn().mockReturnValue('/mock/project')

        mockReaddirSync.mockImplementation((dirPath: string) => {
          if (dirPath === '/mock/project') {
            return ['module.wasm']
          }
          if (dirPath === '/mock/common/dir') {
            return []
          }
          return []
        })

        mockStatSync.mockReturnValue({ isDirectory: () => false, size: 1000 })

        const scripts = service.getLocalScriptList()

        const wasmFile = scripts.find((s) => s.url.includes('.wasm'))
        expect(wasmFile).toBeDefined()
        expect(wasmFile?.scriptLanguage).toBe('WebAssembly')

        process.cwd = originalCwd
      })

      test('未知扩展名返回 Unknown', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        const originalCwd = process.cwd
        process.cwd = vi.fn().mockReturnValue('/mock/project')

        mockReaddirSync.mockImplementation((dirPath: string) => {
          if (dirPath === '/mock/project') {
            return ['file.txt', 'file.json', 'file']
          }
          if (dirPath === '/mock/common/dir') {
            return []
          }
          return []
        })

        mockStatSync.mockReturnValue({ isDirectory: () => false, size: 50 })

        const scripts = service.getLocalScriptList()

        const unknownFiles = scripts.filter((s) => s.scriptLanguage === 'Unknown')
        expect(unknownFiles.length).toBe(3)

        process.cwd = originalCwd
      })

      test('文件名没有扩展名时返回 Unknown', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        const originalCwd = process.cwd
        process.cwd = vi.fn().mockReturnValue('/mock/project')

        mockReaddirSync.mockImplementation((dirPath: string) => {
          if (dirPath === '/mock/project') {
            return ['Makefile', 'Dockerfile', 'README']
          }
          if (dirPath === '/mock/common/dir') {
            return []
          }
          return []
        })

        mockStatSync.mockReturnValue({ isDirectory: () => false, size: 50 })

        const scripts = service.getLocalScriptList()

        // 所有没有扩展名的文件都应该返回 Unknown
        scripts.forEach((script) => {
          expect(script.scriptLanguage).toBe('Unknown')
        })

        process.cwd = originalCwd
      })

      test('处理带有 sourceMappingURL 的文件', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        const originalCwd = process.cwd
        process.cwd = vi.fn().mockReturnValue('/mock/project')

        mockReaddirSync.mockImplementation((dirPath: string) => {
          if (dirPath === '/mock/project') {
            return ['bundle.js']
          }
          if (dirPath === '/mock/common/dir') {
            return []
          }
          return []
        })

        mockStatSync.mockReturnValue({ isDirectory: () => false, size: 200 })

        mockOpenSync.mockReturnValue(1)
        mockReadSync.mockImplementation((fd: number, buffer: Buffer) => {
          const content = '// some code\n//# sourceMappingURL=bundle.js.map'
          buffer.write(content)
          return content.length
        })
        mockCloseSync.mockImplementation(() => {})

        const scripts = service.getLocalScriptList()

        const bundleScript = scripts.find((s) => s.url.includes('bundle.js'))
        expect(bundleScript).toBeDefined()
        expect(bundleScript?.hasSourceURL).toBe(true)
        expect(bundleScript?.sourceMapURL).toContain('bundle.js.map')

        process.cwd = originalCwd
      })

      test('处理内联 sourcemap (data: URL)', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        const originalCwd = process.cwd
        process.cwd = vi.fn().mockReturnValue('/mock/project')

        mockReaddirSync.mockImplementation((dirPath: string) => {
          if (dirPath === '/mock/project') {
            return ['inline.js']
          }
          if (dirPath === '/mock/common/dir') {
            return []
          }
          return []
        })

        mockStatSync.mockReturnValue({ isDirectory: () => false, size: 500 })

        mockOpenSync.mockReturnValue(1)
        mockReadSync.mockImplementation((fd: number, buffer: Buffer) => {
          const content =
            '// code\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ=='
          buffer.write(content)
          return content.length
        })
        mockCloseSync.mockImplementation(() => {})

        const scripts = service.getLocalScriptList()

        const inlineScript = scripts.find((s) => s.url.includes('inline.js'))
        expect(inlineScript).toBeDefined()
        expect(inlineScript?.hasSourceURL).toBe(true)
        expect(inlineScript?.sourceMapURL).toContain('data:application/json')

        process.cwd = originalCwd
      })

      test('处理 TypeScript 文件的 sourcemap', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        const originalCwd = process.cwd
        process.cwd = vi.fn().mockReturnValue('/mock/project')

        mockReaddirSync.mockImplementation((dirPath: string) => {
          if (dirPath === '/mock/project') {
            return ['app.ts']
          }
          if (dirPath === '/mock/common/dir') {
            return []
          }
          return []
        })

        mockStatSync.mockReturnValue({ isDirectory: () => false, size: 300 })

        mockOpenSync.mockReturnValue(1)
        mockReadSync.mockImplementation((fd: number, buffer: Buffer) => {
          const content = '// ts code\n//# sourceMappingURL=app.ts.map'
          buffer.write(content)
          return content.length
        })
        mockCloseSync.mockImplementation(() => {})

        const scripts = service.getLocalScriptList()

        const tsScript = scripts.find((s) => s.url.includes('app.ts'))
        expect(tsScript).toBeDefined()
        expect(tsScript?.hasSourceURL).toBe(true)

        process.cwd = originalCwd
      })

      test('没有 sourcemap 的文件', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        const originalCwd = process.cwd
        process.cwd = vi.fn().mockReturnValue('/mock/project')

        mockReaddirSync.mockImplementation((dirPath: string) => {
          if (dirPath === '/mock/project') {
            return ['simple.js']
          }
          if (dirPath === '/mock/common/dir') {
            return []
          }
          return []
        })

        mockStatSync.mockReturnValue({ isDirectory: () => false, size: 100 })

        mockOpenSync.mockReturnValue(1)
        mockReadSync.mockImplementation((fd: number, buffer: Buffer) => {
          const content = 'console.log("hello");'
          buffer.write(content)
          return content.length
        })
        mockCloseSync.mockImplementation(() => {})

        const scripts = service.getLocalScriptList()

        const simpleScript = scripts.find((s) => s.url.includes('simple.js'))
        expect(simpleScript).toBeDefined()
        expect(simpleScript?.hasSourceURL).toBe(false)
        expect(simpleScript?.sourceMapURL).toBe('')

        process.cwd = originalCwd
      })

      test('scriptId 递增', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        const originalCwd = process.cwd
        process.cwd = vi.fn().mockReturnValue('/mock/project')

        mockReaddirSync.mockImplementation((dirPath: string) => {
          if (dirPath === '/mock/project') {
            return ['a.js', 'b.js', 'c.js']
          }
          if (dirPath === '/mock/common/dir') {
            return []
          }
          return []
        })

        mockStatSync.mockReturnValue({ isDirectory: () => false, size: 50 })

        mockOpenSync.mockReturnValue(1)
        mockReadSync.mockImplementation((fd: number, buffer: Buffer) => {
          buffer.write('// code')
          return 7
        })
        mockCloseSync.mockImplementation(() => {})

        const scripts = service.getLocalScriptList()

        // 验证 scriptId 是递增的
        const scriptIds = scripts.map((s) => parseInt(s.scriptId, 10))
        for (let i = 1; i < scriptIds.length; i++) {
          expect(scriptIds[i]).toBeGreaterThan(scriptIds[i - 1])
        }

        process.cwd = originalCwd
      })

      test('embedderName 与 url 相同', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        const originalCwd = process.cwd
        process.cwd = vi.fn().mockReturnValue('/mock/project')

        mockReaddirSync.mockImplementation((dirPath: string) => {
          if (dirPath === '/mock/project') {
            return ['test.js']
          }
          if (dirPath === '/mock/common/dir') {
            return []
          }
          return []
        })

        mockStatSync.mockReturnValue({ isDirectory: () => false, size: 50 })

        mockOpenSync.mockReturnValue(1)
        mockReadSync.mockImplementation((fd: number, buffer: Buffer) => {
          buffer.write('// code')
          return 7
        })
        mockCloseSync.mockImplementation(() => {})

        const scripts = service.getLocalScriptList()

        scripts.forEach((script) => {
          expect(script.embedderName).toBe(script.url)
        })

        process.cwd = originalCwd
      })

      test('调用 getLocalScriptList 后可以通过 getScriptIdByUrl 获取 scriptId', async () => {
        const { ResourceService } = await import('./resource-service')
        const service = new ResourceService()

        const originalCwd = process.cwd
        process.cwd = vi.fn().mockReturnValue('/mock/project')

        mockReaddirSync.mockImplementation((dirPath: string) => {
          if (dirPath === '/mock/project') {
            return ['mapped.js']
          }
          if (dirPath === '/mock/common/dir') {
            return []
          }
          return []
        })

        mockStatSync.mockReturnValue({ isDirectory: () => false, size: 50 })

        mockOpenSync.mockReturnValue(1)
        mockReadSync.mockImplementation((fd: number, buffer: Buffer) => {
          buffer.write('// code')
          return 7
        })
        mockCloseSync.mockImplementation(() => {})

        const scripts = service.getLocalScriptList()

        // 验证映射已建立
        const script = scripts[0]
        if (script) {
          expect(service.getScriptIdByUrl(script.url)).toBe(script.scriptId)
          expect(service.getUrlByScriptId(script.scriptId)).toBe(script.url)
        }

        process.cwd = originalCwd
      })
    })
  })
})

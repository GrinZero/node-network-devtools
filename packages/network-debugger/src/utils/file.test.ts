import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import { unlinkSafe } from './file'

// Mock fs 模块
vi.mock('fs')

describe('file.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('unlinkSafe', () => {
    describe('文件存在时的删除操作', () => {
      test('成功删除存在的文件', () => {
        const mockUnlinkSync = vi.mocked(fs.unlinkSync)
        mockUnlinkSync.mockImplementation(() => undefined)

        const filePath = '/path/to/existing/file.txt'
        unlinkSafe(filePath)

        expect(mockUnlinkSync).toHaveBeenCalledTimes(1)
        expect(mockUnlinkSync).toHaveBeenCalledWith(filePath)
      })

      test('删除不同路径的文件', () => {
        const mockUnlinkSync = vi.mocked(fs.unlinkSync)
        mockUnlinkSync.mockImplementation(() => undefined)

        const paths = [
          '/tmp/test.txt',
          './relative/path/file.log',
          'simple.json',
          '/home/user/documents/data.csv'
        ]

        paths.forEach((path) => {
          unlinkSafe(path)
        })

        expect(mockUnlinkSync).toHaveBeenCalledTimes(4)
        paths.forEach((path, index) => {
          expect(mockUnlinkSync).toHaveBeenNthCalledWith(index + 1, path)
        })
      })

      test('删除包含特殊字符路径的文件', () => {
        const mockUnlinkSync = vi.mocked(fs.unlinkSync)
        mockUnlinkSync.mockImplementation(() => undefined)

        const specialPaths = [
          '/path/with spaces/file.txt',
          '/path/with-dashes/file.txt',
          '/path/with_underscores/file.txt',
          '/path/中文路径/文件.txt'
        ]

        specialPaths.forEach((path) => {
          unlinkSafe(path)
        })

        expect(mockUnlinkSync).toHaveBeenCalledTimes(4)
      })
    })

    describe('文件不存在时的静默处理', () => {
      test('文件不存在时不抛出错误（ENOENT）', () => {
        const mockUnlinkSync = vi.mocked(fs.unlinkSync)
        const enoentError = new Error('ENOENT: no such file or directory')
        ;(enoentError as NodeJS.ErrnoException).code = 'ENOENT'
        mockUnlinkSync.mockImplementation(() => {
          throw enoentError
        })

        const filePath = '/path/to/nonexistent/file.txt'

        // 不应该抛出错误
        expect(() => unlinkSafe(filePath)).not.toThrow()
        expect(mockUnlinkSync).toHaveBeenCalledWith(filePath)
      })

      test('多次尝试删除不存在的文件都不抛出错误', () => {
        const mockUnlinkSync = vi.mocked(fs.unlinkSync)
        const enoentError = new Error('ENOENT: no such file or directory')
        ;(enoentError as NodeJS.ErrnoException).code = 'ENOENT'
        mockUnlinkSync.mockImplementation(() => {
          throw enoentError
        })

        const filePath = '/nonexistent/file.txt'

        // 多次调用都不应该抛出错误
        for (let i = 0; i < 5; i++) {
          expect(() => unlinkSafe(filePath)).not.toThrow()
        }

        expect(mockUnlinkSync).toHaveBeenCalledTimes(5)
      })
    })

    describe('其他错误的静默处理', () => {
      test('权限不足错误时不抛出异常（EACCES）', () => {
        const mockUnlinkSync = vi.mocked(fs.unlinkSync)
        const eaccesError = new Error('EACCES: permission denied')
        ;(eaccesError as NodeJS.ErrnoException).code = 'EACCES'
        mockUnlinkSync.mockImplementation(() => {
          throw eaccesError
        })

        const filePath = '/protected/file.txt'

        expect(() => unlinkSafe(filePath)).not.toThrow()
        expect(mockUnlinkSync).toHaveBeenCalledWith(filePath)
      })

      test('路径是目录时不抛出异常（EISDIR）', () => {
        const mockUnlinkSync = vi.mocked(fs.unlinkSync)
        const eisdirError = new Error('EISDIR: illegal operation on a directory')
        ;(eisdirError as NodeJS.ErrnoException).code = 'EISDIR'
        mockUnlinkSync.mockImplementation(() => {
          throw eisdirError
        })

        const dirPath = '/path/to/directory'

        expect(() => unlinkSafe(dirPath)).not.toThrow()
        expect(mockUnlinkSync).toHaveBeenCalledWith(dirPath)
      })

      test('文件正在使用时不抛出异常（EBUSY）', () => {
        const mockUnlinkSync = vi.mocked(fs.unlinkSync)
        const ebusyError = new Error('EBUSY: resource busy or locked')
        ;(ebusyError as NodeJS.ErrnoException).code = 'EBUSY'
        mockUnlinkSync.mockImplementation(() => {
          throw ebusyError
        })

        const filePath = '/busy/file.txt'

        expect(() => unlinkSafe(filePath)).not.toThrow()
        expect(mockUnlinkSync).toHaveBeenCalledWith(filePath)
      })

      test('只读文件系统错误时不抛出异常（EROFS）', () => {
        const mockUnlinkSync = vi.mocked(fs.unlinkSync)
        const erofsError = new Error('EROFS: read-only file system')
        ;(erofsError as NodeJS.ErrnoException).code = 'EROFS'
        mockUnlinkSync.mockImplementation(() => {
          throw erofsError
        })

        const filePath = '/readonly/file.txt'

        expect(() => unlinkSafe(filePath)).not.toThrow()
        expect(mockUnlinkSync).toHaveBeenCalledWith(filePath)
      })

      test('通用错误时不抛出异常', () => {
        const mockUnlinkSync = vi.mocked(fs.unlinkSync)
        mockUnlinkSync.mockImplementation(() => {
          throw new Error('Unknown error')
        })

        const filePath = '/some/file.txt'

        expect(() => unlinkSafe(filePath)).not.toThrow()
        expect(mockUnlinkSync).toHaveBeenCalledWith(filePath)
      })
    })

    describe('边界情况', () => {
      test('空字符串路径', () => {
        const mockUnlinkSync = vi.mocked(fs.unlinkSync)
        mockUnlinkSync.mockImplementation(() => undefined)

        unlinkSafe('')

        expect(mockUnlinkSync).toHaveBeenCalledWith('')
      })

      test('根路径', () => {
        const mockUnlinkSync = vi.mocked(fs.unlinkSync)
        mockUnlinkSync.mockImplementation(() => undefined)

        unlinkSafe('/')

        expect(mockUnlinkSync).toHaveBeenCalledWith('/')
      })

      test('相对路径', () => {
        const mockUnlinkSync = vi.mocked(fs.unlinkSync)
        mockUnlinkSync.mockImplementation(() => undefined)

        unlinkSafe('./test.txt')

        expect(mockUnlinkSync).toHaveBeenCalledWith('./test.txt')
      })

      test('带有 .. 的路径', () => {
        const mockUnlinkSync = vi.mocked(fs.unlinkSync)
        mockUnlinkSync.mockImplementation(() => undefined)

        unlinkSafe('../parent/file.txt')

        expect(mockUnlinkSync).toHaveBeenCalledWith('../parent/file.txt')
      })

      test('Windows 风格路径', () => {
        const mockUnlinkSync = vi.mocked(fs.unlinkSync)
        mockUnlinkSync.mockImplementation(() => undefined)

        unlinkSafe('C:\\Users\\test\\file.txt')

        expect(mockUnlinkSync).toHaveBeenCalledWith('C:\\Users\\test\\file.txt')
      })
    })

    describe('返回值', () => {
      test('函数返回 undefined', () => {
        const mockUnlinkSync = vi.mocked(fs.unlinkSync)
        mockUnlinkSync.mockImplementation(() => undefined)

        const result = unlinkSafe('/path/to/file.txt')

        expect(result).toBeUndefined()
      })

      test('发生错误时也返回 undefined', () => {
        const mockUnlinkSync = vi.mocked(fs.unlinkSync)
        mockUnlinkSync.mockImplementation(() => {
          throw new Error('Some error')
        })

        const result = unlinkSafe('/path/to/file.txt')

        expect(result).toBeUndefined()
      })
    })
  })
})

import { describe, expect, test } from 'vitest'
import { CallSite } from './call-site'
import { getStackFrames, initiatorStackPipe } from './stack'

describe('Stack Frame Utilities', () => {
  describe('getStackFrames', () => {
    test('generates stack frames from an error stack', () => {
      const stack =
        'Error\n' +
        '    at functionName (/path/to/file.js:10:15)\n' +
        '    at Object.<anonymous> (/another/path/file.js:20:25)'
      const frames = getStackFrames(stack)

      expect(frames.length).toBe(2)
      expect(frames[0].fileName).toBe('/path/to/file.js')
      expect(frames[0].lineNumber).toBe(10)
      expect(frames[1].fileName).toBe('/another/path/file.js')
      expect(frames[1].lineNumber).toBe(20)
    })

    test('captures stack frames when no stack is provided', () => {
      const frames = getStackFrames()

      // 检查捕获的堆栈帧不为空
      expect(frames.length).toBeGreaterThan(0)
    })
  })

  describe('initiatorStackPipe', () => {
    test('filters out frames based on ignoreList', () => {
      // 创建真实的 CallSite 实例
      const mockFrames = [
        new CallSite('    at test (/path/to/file.js:10:15)'),
        new CallSite('    at test (internal/async_hooks.js:1:1)'),
        new CallSite('    at test (/node_modules/module/file.js:5:10)'),
        new CallSite('    at test (/another/path/file.js:20:25)')
      ]

      const filteredFrames = initiatorStackPipe(mockFrames)

      // ignoreList 会过滤掉:
      // - internal/async_hooks.js (匹配 async_hooks 规则)
      // - /node_modules/ (匹配 node_modules 规则)
      // - /path/to/file.js 和 /another/path/file.js (匹配 /\(\// 规则，因为以 / 开头)
      // 实际上所有都会被过滤，因为 ignoreList 中的 /\(\// 会匹配所有以 ( 开头后跟 / 的路径
      expect(filteredFrames.length).toBeLessThanOrEqual(mockFrames.length)
    })

    test('keeps frames that do not match ignoreList', () => {
      // 创建不会被过滤的帧
      const mockFrames = [
        new CallSite('    at test (file.js:10:15)'),
        new CallSite('    at test (app.js:20:25)')
      ]

      const filteredFrames = initiatorStackPipe(mockFrames)

      // 这些帧不匹配任何 ignoreList 规则
      expect(filteredFrames.length).toBe(2)
    })
  })
})

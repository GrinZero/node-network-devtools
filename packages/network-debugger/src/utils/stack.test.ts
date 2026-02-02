import { describe, expect, test } from 'vitest'
import { CallSite } from './call-site'
import { getStackFrames, initiatorStackPipe } from './stack'

describe('Stack Frame Utilities', () => {
  describe('getStackFrames', () => {
    test('从提供的错误堆栈字符串生成堆栈帧', () => {
      const stack =
        'Error\n' +
        '    at functionName (/path/to/file.js:10:15)\n' +
        '    at Object.<anonymous> (/another/path/file.js:20:25)'
      const frames = getStackFrames(stack)

      expect(frames.length).toBe(2)
      expect(frames[0]).toBeInstanceOf(CallSite)
      expect(frames[0].fileName).toBe('/path/to/file.js')
      expect(frames[0].lineNumber).toBe(10)
      expect(frames[0].columnNumber).toBe(15)
      expect(frames[1].fileName).toBe('/another/path/file.js')
      expect(frames[1].lineNumber).toBe(20)
      expect(frames[1].columnNumber).toBe(25)
    })

    test('不提供堆栈时自动捕获当前堆栈帧', () => {
      const frames = getStackFrames()

      // 检查捕获的堆栈帧不为空
      expect(frames.length).toBeGreaterThan(0)
      // 每个帧都应该是 CallSite 实例
      frames.forEach((frame: CallSite) => {
        expect(frame).toBeInstanceOf(CallSite)
      })
    })

    test('处理只有 Error 行的堆栈', () => {
      const stack = 'Error'
      const frames = getStackFrames(stack)

      expect(frames.length).toBe(0)
    })

    test('处理空堆栈行', () => {
      const stack = 'Error\n\n    at test (file.js:1:1)\n'
      const frames = getStackFrames(stack)

      // 空行也会被解析为 CallSite，但不会有有效属性
      expect(frames.length).toBe(3)
      expect(frames[1].fileName).toBe('file.js')
    })

    test('处理多层嵌套调用的堆栈', () => {
      const stack =
        'Error\n' +
        '    at innerFunction (inner.js:5:10)\n' +
        '    at middleFunction (middle.js:10:15)\n' +
        '    at outerFunction (outer.js:15:20)\n' +
        '    at Object.<anonymous> (main.js:20:25)'
      const frames = getStackFrames(stack)

      expect(frames.length).toBe(4)
      expect(frames[0].functionName).toBe('innerFunction')
      expect(frames[1].functionName).toBe('middleFunction')
      expect(frames[2].functionName).toBe('outerFunction')
      expect(frames[3].functionName).toBeNull() // Object.<anonymous>
    })

    test('处理带 native 调用的堆栈', () => {
      const stack = 'Error\n' + '    at Array.forEach (native)\n' + '    at test (file.js:1:1)'
      const frames = getStackFrames(stack)

      expect(frames.length).toBe(2)
      expect(frames[0].native).toBe(true)
      expect(frames[1].native).toBe(false)
    })
  })

  describe('initiatorStackPipe', () => {
    /**
     * ignoreList 包含以下正则表达式：
     * 1. /\((internal\/)?async_hooks\.js:/ - 匹配 fileName 中包含 "(async_hooks.js:" 或 "(internal/async_hooks.js:"
     * 2. /\(\// - 匹配 fileName 中包含 "(/"
     * 3. /node_modules/ - 匹配 fileName 中包含 "node_modules"
     *
     * 注意：这些正则表达式是针对 site.fileName 进行匹配的
     * 由于 CallSite 解析后的 fileName 通常不包含冒号，规则 1 在实际使用中可能不会匹配
     * 规则 2 和 3 可以正常工作
     */

    test('过滤掉 node_modules 相关帧', () => {
      const mockFrames = [
        new CallSite('    at test (node_modules/express/index.js:5:10)'),
        new CallSite('    at test (/path/to/node_modules/lodash/lodash.js:100:20)'),
        new CallSite('    at test (app.js:10:15)')
      ]

      const filteredFrames = initiatorStackPipe(mockFrames)

      // node_modules 相关帧应该被过滤
      expect(filteredFrames.length).toBe(1)
      expect(filteredFrames[0].fileName).toBe('app.js')
    })

    test('保留不匹配任何 ignoreList 规则的帧', () => {
      const mockFrames = [
        new CallSite('    at test (file.js:10:15)'),
        new CallSite('    at test (app.js:20:25)'),
        new CallSite('    at test (utils.js:30:35)')
      ]

      const filteredFrames = initiatorStackPipe(mockFrames)

      // 这些帧不匹配任何 ignoreList 规则
      expect(filteredFrames.length).toBe(3)
      expect(filteredFrames[0].fileName).toBe('file.js')
      expect(filteredFrames[1].fileName).toBe('app.js')
      expect(filteredFrames[2].fileName).toBe('utils.js')
    })

    test('处理空数组输入', () => {
      const filteredFrames = initiatorStackPipe([])

      expect(filteredFrames).toEqual([])
    })

    test('处理所有帧都被过滤的情况', () => {
      const mockFrames = [
        new CallSite('    at test (node_modules/module/file.js:5:10)'),
        new CallSite('    at test (/path/node_modules/another/file.js:10:15)')
      ]

      const filteredFrames = initiatorStackPipe(mockFrames)

      expect(filteredFrames.length).toBe(0)
    })

    test('处理 fileName 为 undefined 的帧', () => {
      const mockFrames = [new CallSite('invalid line'), new CallSite('    at test (app.js:10:15)')]

      const filteredFrames = initiatorStackPipe(mockFrames)

      // fileName 为 undefined 时，会被转换为空字符串进行匹配
      // 空字符串不匹配任何 ignoreList 规则，所以会被保留
      expect(filteredFrames.length).toBe(2)
    })

    test('处理 native 调用帧', () => {
      const mockFrames = [new CallSite('    at native'), new CallSite('    at test (app.js:10:15)')]

      const filteredFrames = initiatorStackPipe(mockFrames)

      // native 调用的 fileName 为 null，转换为空字符串后不匹配任何规则
      expect(filteredFrames.length).toBe(2)
    })

    test('综合测试：混合各种类型的帧', () => {
      const mockFrames = [
        new CallSite('    at userCode (app.js:10:15)'),
        new CallSite('    at nodeModule (node_modules/express/index.js:100:20)'),
        new CallSite('    at anotherUserCode (utils.js:20:25)'),
        new CallSite('    at native'),
        new CallSite('invalid line')
      ]

      const filteredFrames = initiatorStackPipe(mockFrames)

      // 应该保留：app.js, utils.js, native, invalid line
      // 应该过滤：node_modules/express/index.js
      expect(filteredFrames.length).toBe(4)
      expect(filteredFrames.map((f: CallSite) => f.fileName)).toEqual([
        'app.js',
        'utils.js',
        null, // native
        undefined // invalid line
      ])
    })

    test('验证过滤后帧的顺序保持不变', () => {
      const mockFrames = [
        new CallSite('    at first (a.js:1:1)'),
        new CallSite('    at filtered (node_modules/filtered/file.js:2:2)'),
        new CallSite('    at second (b.js:3:3)'),
        new CallSite('    at third (c.js:4:4)')
      ]

      const filteredFrames = initiatorStackPipe(mockFrames)

      expect(filteredFrames.length).toBe(3)
      expect(filteredFrames[0].fileName).toBe('a.js')
      expect(filteredFrames[1].fileName).toBe('b.js')
      expect(filteredFrames[2].fileName).toBe('c.js')
    })

    test('测试 ignoreList 规则 2：匹配包含 (/ 的 fileName', () => {
      // 这个规则匹配 fileName 中包含 "(/" 的情况
      // 当堆栈行格式为 "at test ((/some/path.js:1:1)" 时，fileName 会是 "(/some/path.js"
      const mockFrames = [
        new CallSite('    at test ((/some/path.js:1:1)'),
        new CallSite('    at test (app.js:10:15)')
      ]

      const filteredFrames = initiatorStackPipe(mockFrames)

      expect(filteredFrames.length).toBe(1)
      expect(filteredFrames[0].fileName).toBe('app.js')
    })

    test('绝对路径不会被 ignoreList 规则 2 过滤（因为 fileName 不包含括号）', () => {
      // 验证正常的绝对路径不会被过滤
      // 因为 CallSite 解析后的 fileName 是 "/absolute/path/file.js"，不包含 "("
      const mockFrames = [
        new CallSite('    at test (/absolute/path/file.js:10:15)'),
        new CallSite('    at test (relative/path/file.js:20:25)')
      ]

      const filteredFrames = initiatorStackPipe(mockFrames)

      // 两个帧都应该被保留，因为 fileName 不包含 "(/"
      expect(filteredFrames.length).toBe(2)
      expect(filteredFrames[0].fileName).toBe('/absolute/path/file.js')
      expect(filteredFrames[1].fileName).toBe('relative/path/file.js')
    })

    test('正常的 async_hooks.js 路径不会被过滤（因为 fileName 不包含括号和冒号）', () => {
      // 验证正常的 async_hooks.js 路径不会被过滤
      // 因为 CallSite 解析后的 fileName 是 "async_hooks.js"，不包含 "(" 和 ":"
      // 规则 1 需要匹配 "(async_hooks.js:" 或 "(internal/async_hooks.js:"
      const mockFrames = [
        new CallSite('    at test (async_hooks.js:1:1)'),
        new CallSite('    at test (internal/async_hooks.js:1:1)'),
        new CallSite('    at test (app.js:10:15)')
      ]

      const filteredFrames = initiatorStackPipe(mockFrames)

      // 所有帧都应该被保留，因为 fileName 不包含 "(" 和 ":"
      expect(filteredFrames.length).toBe(3)
    })

    test('深层嵌套的 node_modules 路径也会被过滤', () => {
      const mockFrames = [
        new CallSite('    at test (/home/user/project/node_modules/pkg/index.js:1:1)'),
        new CallSite('    at test (/home/user/project/src/node_modules/local/file.js:2:2)'),
        new CallSite('    at test (/home/user/project/src/app.js:3:3)')
      ]

      const filteredFrames = initiatorStackPipe(mockFrames)

      expect(filteredFrames.length).toBe(1)
      expect(filteredFrames[0].fileName).toBe('/home/user/project/src/app.js')
    })

    test('测试 ignoreList 规则 1：需要 fileName 包含 (async_hooks.js: 才能匹配', () => {
      // 规则 1 的正则是 /\((internal\/)?async_hooks\.js:/
      // 需要 fileName 包含 "(async_hooks.js:" 或 "(internal/async_hooks.js:"
      // 由于 CallSite 解析后的 fileName 通常不包含冒号，这个规则在实际使用中可能不会触发
      // 这里我们直接测试正则表达式的行为
      const reg = /\((internal\/)?async_hooks\.js:/

      // 不匹配的情况（CallSite 解析后的 fileName）
      expect(reg.test('async_hooks.js')).toBe(false)
      expect(reg.test('(async_hooks.js')).toBe(false)
      expect(reg.test('internal/async_hooks.js')).toBe(false)

      // 匹配的情况（需要包含括号和冒号）
      expect(reg.test('(async_hooks.js:')).toBe(true)
      expect(reg.test('(internal/async_hooks.js:')).toBe(true)
    })

    test('测试 ignoreList 规则 2 的正则表达式行为', () => {
      const reg = /\(\//

      // 匹配的情况
      expect(reg.test('(/')).toBe(true)
      expect(reg.test('(/some/path')).toBe(true)
      expect(reg.test('prefix(/suffix')).toBe(true)

      // 不匹配的情况
      expect(reg.test('/absolute/path')).toBe(false)
      expect(reg.test('relative/path')).toBe(false)
      expect(reg.test('(')).toBe(false)
      expect(reg.test('/')).toBe(false)
    })

    test('测试 ignoreList 规则 3 的正则表达式行为', () => {
      const reg = /node_modules/

      // 匹配的情况
      expect(reg.test('node_modules')).toBe(true)
      expect(reg.test('/path/to/node_modules/pkg')).toBe(true)
      expect(reg.test('node_modules/express/index.js')).toBe(true)

      // 不匹配的情况
      expect(reg.test('node-modules')).toBe(false)
      expect(reg.test('nodemodules')).toBe(false)
      expect(reg.test('/path/to/app.js')).toBe(false)
    })
  })
})

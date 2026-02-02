import { CallSite } from './call-site'
import { describe, test, expect } from 'vitest'

describe('CallSite', () => {
  describe('构造函数', () => {
    test('使用字符串参数创建实例', () => {
      const line = 'at functionName (/path/to/file.js:10:15)'
      const callSite = new CallSite(line)

      expect(callSite.fileName).toBe('/path/to/file.js')
      expect(callSite.lineNumber).toBe(10)
      expect(callSite.columnNumber).toBe(15)
      expect(callSite.functionName).toBe('functionName')
    })

    test('使用 CallSite 实例参数创建实例（复制属性）', () => {
      const site1 = new CallSite('at functionName (/path/to/file.js:10:15)')
      const site2 = new CallSite(site1)

      expect(site2.fileName).toBe('/path/to/file.js')
      expect(site2.lineNumber).toBe(10)
      expect(site2.columnNumber).toBe(15)
      expect(site2.functionName).toBe('functionName')
      // 当没有对象.方法格式时，typeName 和 methodName 为 null
      expect(site2.typeName).toBeNull()
      expect(site2.methodName).toBeNull()
      expect(site2.native).toBe(false)
    })

    test('使用带对象方法的 CallSite 实例复制', () => {
      const site1 = new CallSite('at MyObject.myMethod (/path/to/file.js:10:15)')
      const site2 = new CallSite(site1)

      expect(site2.fileName).toBe('/path/to/file.js')
      expect(site2.lineNumber).toBe(10)
      expect(site2.columnNumber).toBe(15)
      expect(site2.functionName).toBe('MyObject.myMethod')
      expect(site2.typeName).toBe('MyObject')
      expect(site2.methodName).toBe('myMethod')
      expect(site2.native).toBe(false)
    })
  })

  describe('parse 方法', () => {
    test('解析分隔线', () => {
      const line = '    ----'
      const callSite = new CallSite(line)

      expect(callSite.fileName).toBe('    ----')
      expect(callSite.lineNumber).toBeUndefined()
      expect(callSite.columnNumber).toBeUndefined()
    })

    test('解析更长的分隔线', () => {
      const line = '--------'
      const callSite = new CallSite(line)

      expect(callSite.fileName).toBe('--------')
    })

    test('解析简单的堆栈跟踪行', () => {
      const line = 'at Object.<anonymous> (/path/to/file.js:10:15)'
      const callSite = new CallSite(line)

      expect(callSite.fileName).toBe('/path/to/file.js')
      expect(callSite.lineNumber).toBe(10)
      expect(callSite.columnNumber).toBe(15)
      // Object.<anonymous> 时 functionName 为 null
      expect(callSite.functionName).toBeNull()
      expect(callSite.typeName).toBe('Object')
      // <anonymous> 方法名为 null
      expect(callSite.methodName).toBeNull()
      expect(callSite.native).toBe(false)
    })

    test('解析带函数名的堆栈跟踪行', () => {
      const line = 'at functionName (/path/to/file.js:10:15)'
      const callSite = new CallSite(line)

      expect(callSite.fileName).toBe('/path/to/file.js')
      expect(callSite.lineNumber).toBe(10)
      expect(callSite.columnNumber).toBe(15)
      expect(callSite.functionName).toBe('functionName')
      // 没有对象.方法格式时，typeName 和 methodName 为 null
      expect(callSite.typeName).toBeNull()
      expect(callSite.methodName).toBeNull()
      expect(callSite.native).toBe(false)
    })

    test('解析 native 堆栈跟踪行', () => {
      const line = 'at native'
      const callSite = new CallSite(line)

      // native 调用时，fileName 等属性为 null
      expect(callSite.fileName).toBeNull()
      expect(callSite.lineNumber).toBeNull()
      expect(callSite.columnNumber).toBeNull()
      expect(callSite.functionName).toBeNull()
      expect(callSite.typeName).toBeNull()
      expect(callSite.methodName).toBeNull()
      expect(callSite.native).toBe(true)
    })

    test('解析带对象和方法名的行', () => {
      const line = 'at MyObject.myMethod (/path/to/file.js:10:15)'
      const callSite = new CallSite(line)

      expect(callSite.fileName).toBe('/path/to/file.js')
      expect(callSite.lineNumber).toBe(10)
      expect(callSite.columnNumber).toBe(15)
      expect(callSite.functionName).toBe('MyObject.myMethod')
      expect(callSite.typeName).toBe('MyObject')
      expect(callSite.methodName).toBe('myMethod')
      expect(callSite.native).toBe(false)
    })

    test('解析匿名函数', () => {
      const line = 'at <anonymous> (/path/to/file.js:10:15)'
      const callSite = new CallSite(line)

      expect(callSite.fileName).toBe('/path/to/file.js')
      expect(callSite.lineNumber).toBe(10)
      expect(callSite.columnNumber).toBe(15)
      // <anonymous> 作为函数名时保持原样
      expect(callSite.functionName).toBe('<anonymous>')
      expect(callSite.typeName).toBeNull()
      expect(callSite.methodName).toBeNull()
      expect(callSite.native).toBe(false)
    })

    test('解析带 .Module 的行', () => {
      const line = 'at Module.Module._compile (/path/to/file.js:10:15)'
      const callSite = new CallSite(line)

      expect(callSite.fileName).toBe('/path/to/file.js')
      expect(callSite.lineNumber).toBe(10)
      expect(callSite.columnNumber).toBe(15)
      expect(callSite.functionName).toBe('Module._compile')
      expect(callSite.typeName).toBe('Module')
      expect(callSite.methodName).toBe('_compile')
      expect(callSite.native).toBe(false)
    })

    test('解析带双点号 .. 的行', () => {
      const line = 'at Object..method (/path/to/file.js:10:15)'
      const callSite = new CallSite(line)

      expect(callSite.fileName).toBe('/path/to/file.js')
      expect(callSite.lineNumber).toBe(10)
      expect(callSite.columnNumber).toBe(15)
      expect(callSite.functionName).toBe('Object..method')
      expect(callSite.typeName).toBe('Object')
      // 双点号时，methodName 包含前导点
      expect(callSite.methodName).toBe('.method')
      expect(callSite.native).toBe(false)
    })

    test('解析 Object.<anonymous> 时 methodName 应为 null', () => {
      const line = 'at SomeClass.<anonymous> (/path/to/file.js:10:15)'
      const callSite = new CallSite(line)

      expect(callSite.fileName).toBe('/path/to/file.js')
      expect(callSite.lineNumber).toBe(10)
      expect(callSite.columnNumber).toBe(15)
      expect(callSite.functionName).toBeNull()
      expect(callSite.typeName).toBe('SomeClass')
      expect(callSite.methodName).toBeNull()
      expect(callSite.native).toBe(false)
    })

    test('解析不匹配的行返回原始实例', () => {
      const line = 'this is not a valid stack trace line'
      const callSite = new CallSite(line)

      expect(callSite.fileName).toBeUndefined()
      expect(callSite.lineNumber).toBeUndefined()
      expect(callSite.columnNumber).toBeUndefined()
      expect(callSite.functionName).toBeUndefined()
      expect(callSite.typeName).toBeUndefined()
      expect(callSite.methodName).toBeUndefined()
      expect(callSite.native).toBeUndefined()
    })

    test('解析只有文件名和行号的行（无列号）', () => {
      const line = 'at functionName (/path/to/file.js:10)'
      const callSite = new CallSite(line)

      expect(callSite.fileName).toBe('/path/to/file.js')
      expect(callSite.lineNumber).toBe(10)
      // 无列号时为 null
      expect(callSite.columnNumber).toBeNull()
      expect(callSite.functionName).toBe('functionName')
    })

    test('解析无函数名只有位置的行', () => {
      const line = 'at /path/to/file.js:10:15'
      const callSite = new CallSite(line)

      expect(callSite.fileName).toBe('/path/to/file.js')
      expect(callSite.lineNumber).toBe(10)
      expect(callSite.columnNumber).toBe(15)
      // 无函数名时为 null
      expect(callSite.functionName).toBeNull()
    })

    test('解析嵌套对象方法调用', () => {
      const line = 'at Outer.Inner.method (/path/to/file.js:10:15)'
      const callSite = new CallSite(line)

      expect(callSite.fileName).toBe('/path/to/file.js')
      expect(callSite.lineNumber).toBe(10)
      expect(callSite.columnNumber).toBe(15)
      expect(callSite.functionName).toBe('Outer.Inner.method')
      expect(callSite.typeName).toBe('Outer.Inner')
      expect(callSite.methodName).toBe('method')
      expect(callSite.native).toBe(false)
    })

    test('parse 方法返回 this', () => {
      const callSite = new CallSite('')
      const result = callSite.parse('at functionName (/path/to/file.js:10:15)')

      expect(result).toBe(callSite)
      expect(callSite.fileName).toBe('/path/to/file.js')
    })

    test('解析带括号的函数名', () => {
      const line = 'at Array.forEach (native)'
      const callSite = new CallSite(line)

      expect(callSite.functionName).toBe('Array.forEach')
      expect(callSite.typeName).toBe('Array')
      expect(callSite.methodName).toBe('forEach')
      expect(callSite.native).toBe(true)
    })

    test('解析 Windows 路径', () => {
      const line = 'at functionName (C:\\Users\\test\\file.js:10:15)'
      const callSite = new CallSite(line)

      expect(callSite.fileName).toBe('C:\\Users\\test\\file.js')
      expect(callSite.lineNumber).toBe(10)
      expect(callSite.columnNumber).toBe(15)
      expect(callSite.functionName).toBe('functionName')
    })

    test('解析空字符串', () => {
      const callSite = new CallSite('')

      expect(callSite.fileName).toBeUndefined()
      expect(callSite.lineNumber).toBeUndefined()
      expect(callSite.columnNumber).toBeUndefined()
      expect(callSite.functionName).toBeUndefined()
    })
  })

  describe('valueOf 方法', () => {
    test('返回包含所有属性的对象', () => {
      const callSite = new CallSite('at MyObject.myMethod (/path/to/file.js:10:15)')
      const value = callSite.valueOf()

      expect(value).toEqual({
        fileName: '/path/to/file.js',
        lineNumber: 10,
        functionName: 'MyObject.myMethod',
        typeName: 'MyObject',
        methodName: 'myMethod',
        columnNumber: 15,
        native: false
      })
    })

    test('未解析的实例返回 undefined 属性', () => {
      const callSite = new CallSite('invalid line')
      const value = callSite.valueOf()

      expect(value).toEqual({
        fileName: undefined,
        lineNumber: undefined,
        functionName: undefined,
        typeName: undefined,
        methodName: undefined,
        columnNumber: undefined,
        native: undefined
      })
    })

    test('native 调用的 valueOf', () => {
      const callSite = new CallSite('at native')
      const value = callSite.valueOf()

      expect(value).toEqual({
        fileName: null,
        lineNumber: null,
        functionName: null,
        typeName: null,
        methodName: null,
        columnNumber: null,
        native: true
      })
    })
  })

  describe('toString 方法', () => {
    test('返回 JSON 字符串', () => {
      const callSite = new CallSite('at MyObject.myMethod (/path/to/file.js:10:15)')
      const expectedString = JSON.stringify({
        fileName: '/path/to/file.js',
        lineNumber: 10,
        functionName: 'MyObject.myMethod',
        typeName: 'MyObject',
        methodName: 'myMethod',
        columnNumber: 15,
        native: false
      })

      expect(callSite.toString()).toBe(expectedString)
    })

    test('native 调用的 toString', () => {
      const callSite = new CallSite('at native')
      const result = JSON.parse(callSite.toString())

      expect(result.native).toBe(true)
      // native 调用时 fileName 为 null
      expect(result.fileName).toBeNull()
    })

    test('未解析实例的 toString', () => {
      const callSite = new CallSite('invalid')
      const result = JSON.parse(callSite.toString())

      expect(result.fileName).toBeUndefined()
      expect(result.native).toBeUndefined()
    })
  })
})

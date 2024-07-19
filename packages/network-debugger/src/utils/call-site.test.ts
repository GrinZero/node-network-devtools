import { CallSite } from './call-site'
import { describe, test, expect } from 'vitest'

describe('CallSite', () => {
  test('parses a simple stack trace line', () => {
    const line = 'at Object.<anonymous> (/path/to/file.js:10:15)'
    const callSite = new CallSite(line)

    expect(callSite.fileName).toBe('/path/to/file.js')
    expect(callSite.lineNumber).toBe(10)
    expect(callSite.columnNumber).toBe(15)
    expect(callSite.functionName).toBe(null)
    expect(callSite.typeName).toBe('Object')
    expect(callSite.methodName).toBe(null)
    expect(callSite.native).toBe(false)
  })

  test('parses a stack trace line with a function name', () => {
    const line = 'at functionName (/path/to/file.js:10:15)'
    const callSite = new CallSite(line)

    expect(callSite.fileName).toBe('/path/to/file.js')
    expect(callSite.lineNumber).toBe(10)
    expect(callSite.columnNumber).toBe(15)
    expect(callSite.functionName).toBe('functionName')
    expect(callSite.typeName).toBe(null)
    expect(callSite.methodName).toBe(null)
    expect(callSite.native).toBe(false)
  })

  test('parses a native stack trace line', () => {
    const line = 'at native'
    const callSite = new CallSite(line)

    expect(callSite.fileName).toBe(null)
    expect(callSite.lineNumber).toBe(null)
    expect(callSite.columnNumber).toBe(null)
    expect(callSite.functionName).toBe(null)
    expect(callSite.typeName).toBe(null)
    expect(callSite.methodName).toBe(null)
    expect(callSite.native).toBe(true)
  })

  test('parses a line with object and method name', () => {
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

  test('parses a line with anonymous function', () => {
    const line = 'at <anonymous> (/path/to/file.js:10:15)'
    const callSite = new CallSite(line)

    expect(callSite.fileName).toBe('/path/to/file.js')
    expect(callSite.lineNumber).toBe(10)
    expect(callSite.columnNumber).toBe(15)
    expect(callSite.functionName).toBe('<anonymous>')
    expect(callSite.typeName).toBe(null)
    expect(callSite.methodName).toBe(null)
    expect(callSite.native).toBe(false)
  })

  test('copying properties from another CallSite instance', () => {
    const site1 = new CallSite('at functionName (/path/to/file.js:10:15)')
    const site2 = new CallSite(site1)

    expect(site2.fileName).toBe('/path/to/file.js')
    expect(site2.lineNumber).toBe(10)
    expect(site2.columnNumber).toBe(15)
    expect(site2.functionName).toBe('functionName')
    expect(site2.typeName).toBe(null)
    expect(site2.methodName).toBe(null)
    expect(site2.native).toBe(false)
  })

  test('converts CallSite to string', () => {
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
})

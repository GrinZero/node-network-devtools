import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CallSite } from './call-site'
import { getStackFrames, initiatorStackPipe } from './stack' // Adjust the path as needed

vi.mock('./call-site', () => {
  return {
    CallSite: vi.fn().mockImplementation((line) => {
      const instance = {
        fileName: null,
        lineNumber: null,
        functionName: null,
        typeName: null,
        methodName: null,
        columnNumber: null,
        native: false
      }

      const parseMock = vi.fn((l: string) => instance)

      if (typeof line === 'string') {
        parseMock(line)
      }

      return instance
    })
  }
})

describe('Stack Frame Utilities', () => {
  beforeEach(() => {
    ;(CallSite as any).mockClear()
  })

  describe('getStackFrames', () => {
    test('generates stack frames from an error stack', () => {
      const stack =
        'Error\n' +
        '    at functionName (/path/to/file.js:10:15)\n' +
        '    at Object.<anonymous> (/another/path/file.js:20:25)'
      const frames = getStackFrames(stack)

      expect(CallSite).toHaveBeenCalledTimes(2)
      expect(frames.length).toBe(2)
    })

    test('captures stack frames when no stack is provided', () => {
      const frames = getStackFrames()

      // Expect the captureStackTrace to have been called
      // Since we can't control the stack trace of the current environment in Jest,
      // we'll just check that the frames are not empty.
      expect(frames.length).toBeGreaterThan(0)
    })
  })

  describe('initiatorStackPipe', () => {
    test('filters out frames based on ignoreList', () => {
      const mockFrames = [
        { fileName: '/path/to/file.js', lineNumber: 10 },
        { fileName: '(internal/async_hooks.js:1:1)', lineNumber: 1 },
        { fileName: '/node_modules/module/file.js', lineNumber: 5 },
        { fileName: '/another/path/file.js', lineNumber: 20 }
      ].map((frame) => Object.assign(new CallSite(''), frame))

      const filteredFrames = initiatorStackPipe(mockFrames)

      expect(filteredFrames.length).toBe(2)
      expect(filteredFrames[0].fileName).toBe('/path/to/file.js')
      expect(filteredFrames[1].fileName).toBe('/another/path/file.js')
    })
  })
})

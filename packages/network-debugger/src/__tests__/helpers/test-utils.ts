/**
 * 测试辅助工具
 *
 * 使用 vitest 内置能力和成熟的第三方库进行 mock
 * - vitest: vi.mock(), vi.spyOn(), vi.fn()
 * - memfs: 文件系统 mock
 */

import { vi } from 'vitest'
import { RequestDetail } from '@/common'

/**
 * 创建测试用的 RequestDetail 实例
 */
export function createRequestDetail(overrides?: Partial<RequestDetail>): RequestDetail {
  const detail = new RequestDetail()

  if (overrides) {
    Object.assign(detail, overrides)
  }

  return detail
}

/**
 * 创建模拟的 WebSocket 事件处理器
 */
export function createMockEventEmitter() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>()

  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) {
        handlers.set(event, new Set())
      }
      handlers.get(event)!.add(handler)
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(handler)
    }),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      handlers.get(event)?.forEach((h) => h(...args))
    }),
    removeAllListeners: vi.fn((event?: string) => {
      if (event) {
        handlers.delete(event)
      } else {
        handlers.clear()
      }
    }),
    _handlers: handlers
  }
}

/**
 * 等待所有微任务完成
 */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * 等待指定时间
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 创建模拟的 CDP 消息
 */
export interface MockCDPMessage {
  method?: string
  params?: Record<string, unknown>
  id?: number
  result?: unknown
  error?: { code: number; message?: string }
}

export function createCDPMessage(overrides?: Partial<MockCDPMessage>): MockCDPMessage {
  return {
    method: 'Network.requestWillBeSent',
    params: {},
    ...overrides
  }
}

/**
 * 创建模拟的 HTTP 请求选项
 */
export function createMockRequestOptions(overrides?: Record<string, unknown>) {
  return {
    method: 'GET',
    hostname: 'localhost',
    port: 80,
    path: '/',
    headers: {},
    ...overrides
  }
}

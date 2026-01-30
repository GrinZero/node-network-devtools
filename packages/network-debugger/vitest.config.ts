import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    // 使用 Node.js 环境
    environment: 'node',
    // 测试文件匹配模式
    include: ['src/**/*.test.ts', 'src/**/__tests__/*.test.ts'],
    // 排除文件
    exclude: ['node_modules', 'dist'],
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**', 'src/**/tests/**'],
      // 100% 覆盖率阈值
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100
      }
    },
    // 全局设置
    globals: true,
    // 测试超时时间
    testTimeout: 10000
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
})

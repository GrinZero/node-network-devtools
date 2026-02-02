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
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/**/tests/**',
        // 排除入口点文件（这些文件在模块加载时执行副作用，难以单元测试）
        'src/index.ts',
        'src/core/index.ts',
        'src/core/hooks/index.ts',
        'src/fork/fork.ts',
        'src/fork/module/index.ts',
        'src/fork/pipe/index.ts',
        'src/utils/index.ts',
        // 排除已弃用的文件
        'src/core/dc.ts'
      ],
      // 覆盖率阈值 - 设置为合理的目标值
      // 注意：某些入口点文件和复杂的异步代码路径难以达到 100% 覆盖
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90
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

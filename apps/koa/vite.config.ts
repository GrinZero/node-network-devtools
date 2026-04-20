import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const external = new Set([
  ...builtinModules,
  ...builtinModules.map((module) => `node:${module}`),
  'axios',
  'koa',
  'koa-router',
  'node-network-devtools',
  'ofetch',
  'undici',
  'ws'
])

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      fileName: 'index',
      formats: ['cjs']
    },
    minify: false,
    outDir: 'dist',
    rollupOptions: {
      external: [...external]
    },
    sourcemap: true,
    target: 'node18'
  }
})

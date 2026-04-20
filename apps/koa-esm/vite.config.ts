import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const external = new Set([
  ...builtinModules,
  ...builtinModules.map((module) => `node:${module}`),
  'axios',
  'got',
  'koa',
  'koa-router',
  'node-network-devtools'
])

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      fileName: 'index',
      formats: ['es']
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

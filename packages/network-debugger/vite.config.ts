/// <reference types="vitest" />
import { defineConfig } from 'vite'
import { resolve } from 'path'
import dts from 'vite-plugin-dts'

export default defineConfig(({ mode }) => ({
  build: {
    target: 'es2020',
    outDir: 'dist',
    lib: {
      entry: [resolve(__dirname, 'src/index.ts'), resolve(__dirname, 'src/fork/fork.ts')]
    },
    rollupOptions: {
      external: [
        'http',
        'https',
        'child_process',
        'open',
        'ws',
        'iconv-lite',
        'zlib',
        'fs',
        'path',
        'url',
        'node:zlib',
        'node:diagnostics_channel',
        'node:async_hooks',
        'node:buffer',
        'stream',
        'net'
      ],
      output: {
        globals: {
          http: 'http',
          https: 'https',
          child_process: 'cp',
          open: 'open',
          ws: 'ws',
          'iconv-lite': 'iconv',
          'node:zlib': 'zlib',
          fs: 'fs',
          path: 'path',
          url: 'url',
          'node:diagnostics_channel': 'diagnostics_channel',
          'node:async_hooks': 'async_hooks',
          'node:buffer': 'buffer',
          stream: 'stream',
          net: 'net'
        }
      }
    }
  },
  plugins: [dts()]
}))

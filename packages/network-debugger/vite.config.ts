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
        'node:assert',
        'node:util',
        'node:events',
        'node:url',
        'node:net',
        'node:http',
        'node:tls',
        'node:stream',
        'node:querystring',
        'node:crypto',
        'node:diagnostics_channel',
        'node:async_hooks',
        'node:buffer',
        'stream',
        'net',
        'undici'
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
          net: 'net',
          undici: 'undici',
          'node:util': 'node_util',
          'node:events': 'node_events',
          'node:url': 'node_url',
          'node:net': 'node_net',
          'node:http': 'node_http',
          'node:tls': 'node_tls',
          'node:stream': 'node_stream',
          'node:querystring': 'node_querystring',
          'node:crypto': 'node_crypto'
        }
      }
    }
  },
  plugins: [dts()]
}))

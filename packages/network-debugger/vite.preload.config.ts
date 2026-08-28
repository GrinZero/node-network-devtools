import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/preload/register.ts'),
      formats: ['es'],
      fileName: () => 'register.mjs'
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
        'stream',
        'net',
        'undici',
        'bufferutil',
        /^node:/
      ]
    }
  }
})

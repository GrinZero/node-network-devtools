import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { defineConfig } from '@playwright/test'

const outputDirectory = process.env.NETWORK_DEBUGGER_E2E_ARTIFACT_DIR
  ? resolve(process.env.NETWORK_DEBUGGER_E2E_ARTIFACT_DIR, 'frontend')
  : resolve(tmpdir(), `node-network-devtools-playwright-${process.pid}`)

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.mjs',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: outputDirectory,
  reporter: process.env.CI ? [['line']] : [['list']]
})

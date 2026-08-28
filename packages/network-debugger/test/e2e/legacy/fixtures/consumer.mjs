import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const entryPath = process.env.NETWORK_DEBUGGER_E2E_ENTRY
if (!entryPath) throw new Error('NETWORK_DEBUGGER_E2E_ENTRY is required')

const { register } = await import(pathToFileURL(entryPath).href)
if (typeof register !== 'function') {
  throw new Error(`No public register() export found at ${entryPath}`)
}

const handle = register({
  mode: 'legacy',
  devtools: { open: false },
  legacy: { serverPort: 0 }
})
const ready = await handle.ready
if (ready.mode !== 'legacy') {
  throw new Error(`Expected forced Legacy adapter, received ${ready.mode}`)
}

const require = createRequire(import.meta.url)
const fixtureDirectory = dirname(fileURLToPath(import.meta.url))
const { installScenarioController } = require(resolve(fixtureDirectory, 'scenario-runner.cjs'))
await installScenarioController({ handle, ready, consumer: 'esm' })

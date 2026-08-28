'use strict'

const { resolve } = require('node:path')

const entryPath = process.env.NETWORK_DEBUGGER_E2E_ENTRY
if (!entryPath) throw new Error('NETWORK_DEBUGGER_E2E_ENTRY is required')

const { register } = require(entryPath)
if (typeof register !== 'function') {
  throw new Error(`No public register() export found at ${entryPath}`)
}

const handle = register({
  mode: 'legacy',
  devtools: { open: false },
  legacy: { serverPort: 0 }
})
const readyPromise = handle.ready

Promise.resolve(readyPromise)
  .then(async (ready) => {
    if (ready.mode !== 'legacy') {
      throw new Error(`Expected forced Legacy adapter, received ${ready.mode}`)
    }
    const { installScenarioController } = require(resolve(__dirname, 'scenario-runner.cjs'))
    await installScenarioController({ handle, ready, consumer: 'cjs' })
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })

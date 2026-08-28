'use strict'

const RECORD_PREFIX = '@@NND_E2E@@'
const PRELOAD_STATE = Symbol.for('node-network-devtools.preload.state')

async function reportReady(label, extra = {}) {
  const preloadState = globalThis[PRELOAD_STATE]
  if (!preloadState?.promise) {
    throw new Error('NND preload state is unavailable; the CLI did not inject dist/register.mjs')
  }

  const handle = await preloadState.promise
  const ready = await handle.ready
  const record = {
    type: 'fixture-ready',
    label,
    pid: process.pid,
    ppid: process.ppid,
    argv: process.argv.slice(2),
    execArgv: [...process.execArgv],
    preloadInjected: true,
    mode: ready.mode,
    capabilities: ready.capabilities,
    fallbackReason: ready.fallbackReason ?? null,
    target: {
      id: ready.target.id,
      type: ready.target.type,
      discoveryUrl: ready.target.discoveryUrl,
      webSocketDebuggerUrl: ready.target.webSocketDebuggerUrl
    },
    ...extra
  }
  process.stdout.write(`${RECORD_PREFIX}${JSON.stringify(record)}\n`)
  return { handle, ready, record }
}

function exitCodeFromArgv() {
  const value = process.argv.slice(2).find((argument) => argument.startsWith('--exit-code='))
  if (!value) return 0
  const code = Number(value.slice('--exit-code='.length))
  if (!Number.isInteger(code) || code < 0 || code > 255) {
    throw new Error(`Invalid fixture exit code: ${value}`)
  }
  return code
}

function fail(error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`@@NND_E2E_ERROR@@${message}\n`)
  process.exitCode = 70
}

module.exports = { exitCodeFromArgv, fail, reportReady }

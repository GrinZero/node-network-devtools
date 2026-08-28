const RECORD_PREFIX = '@@NND_E2E@@'
const PRELOAD_STATE = Symbol.for('node-network-devtools.preload.state')
const generation = 'initial-generation'

const preloadState = globalThis[PRELOAD_STATE]
if (!preloadState?.promise) {
  throw new Error('NND preload state is unavailable; the CLI did not inject dist/register.mjs')
}

const handle = await preloadState.promise
const ready = await handle.ready
process.stdout.write(
  `${RECORD_PREFIX}${JSON.stringify({
    type: 'fixture-ready',
    label: 'watch',
    generation,
    pid: process.pid,
    ppid: process.ppid,
    argv: process.argv.slice(2),
    execArgv: [...process.execArgv],
    preloadInjected: true,
    mode: ready.mode,
    capabilities: ready.capabilities,
    fallbackReason: ready.fallbackReason ?? null,
    target: ready.target
  })}\n`
)

setInterval(() => {}, 60_000)

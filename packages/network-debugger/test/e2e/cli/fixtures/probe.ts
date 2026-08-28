type PreloadState = {
  promise: Promise<{
    ready: Promise<{
      mode: string
      capabilities: Record<string, boolean>
      fallbackReason?: unknown
      target: {
        id: string
        type: string
        discoveryUrl: string
        webSocketDebuggerUrl: string
      }
    }>
    dispose(): Promise<void>
  }>
}

const RECORD_PREFIX: string = '@@NND_E2E@@'
const PRELOAD_STATE: symbol = Symbol.for('node-network-devtools.preload.state')

async function main(): Promise<void> {
  const preloadState = (globalThis as Record<PropertyKey, unknown>)[PRELOAD_STATE] as
    | PreloadState
    | undefined
  if (!preloadState?.promise) {
    throw new Error('NND preload state is unavailable; the CLI did not inject dist/register.mjs')
  }

  const handle = await preloadState.promise
  const ready = await handle.ready
  const record = {
    type: 'fixture-ready',
    label: 'tsx',
    pid: process.pid,
    ppid: process.ppid,
    argv: process.argv.slice(2),
    execArgv: [...process.execArgv],
    preloadInjected: true,
    mode: ready.mode,
    capabilities: ready.capabilities,
    fallbackReason: ready.fallbackReason ?? null,
    target: ready.target,
    typescriptExecuted: true
  }
  process.stdout.write(`${RECORD_PREFIX}${JSON.stringify(record)}\n`)
  await handle.dispose()
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`@@NND_E2E_ERROR@@${message}\n`)
  process.exitCode = 70
})

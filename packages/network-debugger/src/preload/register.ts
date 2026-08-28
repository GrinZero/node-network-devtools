import {
  NND_PRELOAD_REPORT_ENV,
  NND_READY_PREFIX,
  claimPreloadProcess,
  formatPreloadError,
  preload
} from './index'

// Side-effect entry for `node --import node-network-devtools/register`.
if (claimPreloadProcess()) {
  try {
    const registration = await preload()
    if (process.env[NND_PRELOAD_REPORT_ENV] === '1') {
      const ready = await registration.ready
      process.stderr.write(
        `${NND_READY_PREFIX}${JSON.stringify({
          mode: ready.mode,
          target: ready.target,
          capabilities: ready.capabilities,
          ...(ready.fallbackReason ? { fallbackReason: ready.fallbackReason } : {})
        })}\n`
      )
    }
  } catch (error) {
    process.stderr.write(`${formatPreloadError(error)}\n`)
    process.exitCode = 1
    throw error
  }
}

import probe from './probe-core.cjs'

try {
  const { handle } = await probe.reportReady('esm')
  process.exitCode = probe.exitCodeFromArgv()
  await handle.dispose()
} catch (error) {
  probe.fail(error)
}

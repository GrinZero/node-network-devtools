'use strict'

const { exitCodeFromArgv, fail, reportReady } = require('./probe-core.cjs')

void reportReady('cjs')
  .then(async ({ handle }) => {
    process.exitCode = exitCodeFromArgv()
    await handle.dispose()
  })
  .catch(fail)

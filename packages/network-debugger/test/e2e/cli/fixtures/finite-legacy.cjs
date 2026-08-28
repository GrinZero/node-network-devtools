'use strict'

// Deliberately do not read the preload state symbol or dispose its internal
// registration handle. A debugging preload must never extend application
// lifetime; the bridge child owns cleanup after the parent IPC disconnects.
process.stdout.write(
  `@@NND_E2E@@${JSON.stringify({
    type: 'finite-legacy',
    pid: process.pid,
    ppid: process.ppid
  })}\n`
)

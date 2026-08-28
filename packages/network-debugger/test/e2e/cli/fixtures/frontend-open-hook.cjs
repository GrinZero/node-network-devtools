'use strict'

const childProcess = require('node:child_process')
const { syncBuiltinESMExports } = require('node:module')

const originalSpawn = childProcess.spawn
const runnerPath = process.env.NND_E2E_FRONTEND_RUNNER

function extractFrontendUrl(argumentsList) {
  for (const argument of argumentsList ?? []) {
    if (typeof argument !== 'string') continue
    const directIndex = argument.indexOf('devtools://')
    if (directIndex >= 0) return argument.slice(directIndex).replace(/["']+$/, '')

    // `open` uses a UTF-16LE encoded PowerShell command on Windows.
    try {
      const decoded = Buffer.from(argument, 'base64').toString('utf16le')
      const match = decoded.match(/devtools:\/\/[^"'\s]+/)
      if (match) return match[0]
    } catch {
      // Not a base64 PowerShell argument.
    }
  }
  return undefined
}

childProcess.spawn = function nndE2eSpawn(command, argumentsList, options) {
  const frontendUrl = extractFrontendUrl(argumentsList)
  if (!frontendUrl) return originalSpawn.call(this, command, argumentsList, options)
  if (!runnerPath) throw new Error('NND_E2E_FRONTEND_RUNNER is required')

  return originalSpawn(process.execPath, [runnerPath, frontendUrl], {
    env: options?.env ?? process.env,
    // The real launcher is detached on Linux. Preserve that lifecycle while
    // avoiding Windows-only spawn flags when the replacement executable is Node.
    detached: options?.detached ?? false,
    stdio: options?.stdio ?? 'ignore'
  })
}

// The CLI imports spawn from `node:child_process`; synchronize the patched CJS
// export before its ESM graph is evaluated.
syncBuiltinESMExports()

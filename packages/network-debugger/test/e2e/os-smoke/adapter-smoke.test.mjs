import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { installPackedPackage, removePackedInstallation } from '../pack/packed-package.mjs'

const execFileAsync = promisify(execFile)
const ROUNDS = Number(process.env.NND_OS_SMOKE_ROUNDS ?? 20)
const CHILD_TIMEOUT_MS = 240_000
const TEST_TIMEOUT_MS = 300_000
const RESULT_PREFIX = 'NND_OS_SMOKE_RESULT '
const CONTROLLER_PATH = fileURLToPath(new URL('./adapter-smoke-controller.mjs', import.meta.url))

assert.ok(Number.isInteger(ROUNDS) && ROUNDS >= 20, 'OS smoke must run at least 20 rounds')

async function runIsolatedController(installation) {
  try {
    return await execFileAsync(
      process.execPath,
      ['--experimental-network-inspection', CONTROLLER_PATH],
      {
        cwd: installation.root,
        env: {
          ...process.env,
          NND_OS_SMOKE_INSTALL_ROOT: installation.root,
          NND_OS_SMOKE_ROUNDS: String(ROUNDS)
        },
        timeout: CHILD_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024
      }
    )
  } catch (error) {
    const output = [error?.stdout, error?.stderr].filter(Boolean).join('\n')
    throw new Error(`Isolated OS smoke controller failed:\n${output}`, { cause: error })
  }
}

function parseResult(stdout) {
  const resultLines = stdout.split(/\r?\n/).filter((line) => line.startsWith(RESULT_PREFIX))

  assert.equal(
    resultLines.length,
    1,
    `expected one structured OS smoke result, received ${resultLines.length}:\n${stdout}`
  )
  return JSON.parse(resultLines[0].slice(RESULT_PREFIX.length))
}

test(
  'an isolated packed-package controller survives 20 Native and Legacy rounds',
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const installation = await installPackedPackage('nnd-os-smoke-')

    try {
      // Only the child loads the installed package. Waiting for execFile to
      // close before cleanup avoids Windows file locks from loaded modules.
      const { stdout } = await runIsolatedController(installation)
      const result = parseResult(stdout)

      assert.equal(result.schemaVersion, 1)
      assert.notEqual(result.controllerPid, process.pid)
      assert.deepEqual(result.package, {
        name: installation.manifest.name,
        version: installation.manifest.version
      })
      assert.equal(result.rounds, ROUNDS)

      for (const mode of ['native', 'legacy']) {
        assert.deepEqual(result.adapters[mode], {
          rounds: ROUNDS,
          targetsDiscovered: ROUNDS,
          endpointsClosed: ROUNDS
        })
      }
    } finally {
      await removePackedInstallation(installation)
    }
  }
)

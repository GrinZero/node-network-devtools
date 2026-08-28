import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'
import test from 'node:test'
import { join } from 'node:path'

import { installPackedPackage, removePackedInstallation } from '../pack/packed-package.mjs'

const ROUNDS = Number(process.env.NND_OS_SMOKE_ROUNDS ?? 20)
const TEST_TIMEOUT_MS = 240_000

assert.ok(Number.isInteger(ROUNDS) && ROUNDS >= 20, 'OS smoke must run at least 20 rounds')

function requestJson(url, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { agent: false }, (response) => {
      const chunks = []
      const socket = response.socket
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.once('error', reject)
      response.once('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let result
        let failure
        if (response.statusCode !== 200) {
          failure = new Error(`${url} returned HTTP ${response.statusCode}: ${text}`)
        } else {
          try {
            result = JSON.parse(text)
          } catch (error) {
            failure = new Error(`${url} returned invalid JSON: ${text}`, { cause: error })
          }
        }

        const settle = () => (failure ? reject(failure) : resolve(result))
        if (socket.destroyed) settle()
        else socket.once('close', settle)
      })
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`Timed out requesting ${url}`)))
    request.once('error', reject)
  })
}

async function assertEndpointClosed(url) {
  let lastResponse
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      lastResponse = await requestJson(url, 500)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.fail(
    `target endpoint remained open after dispose: ${url}\n${JSON.stringify(lastResponse)}`
  )
}

async function runRounds(register, mode) {
  const controllerPid = process.pid
  for (let round = 1; round <= ROUNDS; round += 1) {
    let registration
    let target
    try {
      registration = register({
        mode,
        inspector: { host: '127.0.0.1', port: 0 },
        devtools: { open: false },
        legacy: { serverPort: 0 }
      })
      const ready = await registration.ready
      target = ready.target
      assert.equal(process.pid, controllerPid, `${mode} round ${round} changed controller process`)
      assert.equal(ready.mode, mode, `${mode} round ${round} selected another adapter`)
      assert.equal(registration.status().state, 'ready')
      assert.match(target.discoveryUrl, /^http:\/\/127\.0\.0\.1:\d+\/json\/list$/)
      assert.match(target.webSocketDebuggerUrl, /^ws:\/\/127\.0\.0\.1:\d+\//)

      const targets = await requestJson(target.discoveryUrl)
      assert.ok(Array.isArray(targets), `${mode} round ${round} discovery must be an array`)
      assert.ok(
        targets.some((candidate) => candidate.id === target.id),
        `${mode} round ${round} target is absent from discovery`
      )
    } finally {
      await registration?.dispose()
    }

    assert.equal(registration.status().state, 'disposed')
    await assertEndpointClosed(target.discoveryUrl)
  }
}

test(
  'packed Native and Legacy adapters each survive 20 rounds in one process',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    assert.ok(
      process.execArgv.some((argument) => argument.startsWith('--experimental-network-inspection')),
      'start this controller with --experimental-network-inspection'
    )

    const installation = await installPackedPackage('nnd-os-smoke-')
    t.after(() => removePackedInstallation(installation))
    const consumerRequire = createRequire(join(installation.root, 'consumer.cjs'))
    const { register } = consumerRequire('node-network-devtools')
    assert.equal(typeof register, 'function')

    await t.test(`Native adapter: ${ROUNDS} consecutive rounds`, () =>
      runRounds(register, 'native')
    )
    await t.test(`Legacy adapter: ${ROUNDS} consecutive rounds`, () =>
      runRounds(register, 'legacy')
    )
  }
)

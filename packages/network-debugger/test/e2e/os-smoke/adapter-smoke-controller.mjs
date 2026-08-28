import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import http from 'node:http'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative } from 'node:path'

const PACKAGE_NAME = 'node-network-devtools'
const RESULT_PREFIX = 'NND_OS_SMOKE_RESULT '
const ROUNDS = Number(process.env.NND_OS_SMOKE_ROUNDS ?? 20)
const installationRoot = process.env.NND_OS_SMOKE_INSTALL_ROOT

assert.ok(Number.isInteger(ROUNDS) && ROUNDS >= 20, 'OS smoke must run at least 20 rounds')
assert.ok(installationRoot, 'NND_OS_SMOKE_INSTALL_ROOT is required')
assert.ok(
  process.execArgv.some((argument) => argument.startsWith('--experimental-network-inspection')),
  'the isolated controller requires --experimental-network-inspection'
)

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

        // inspector.close() is synchronous. Do not call it while the discovery
        // socket is still live; this is especially important on Windows.
        const settle = () => (failure ? reject(failure) : resolve(result))
        if (socket.destroyed) {
          settle()
        } else {
          socket.once('close', settle)
          socket.destroy()
        }
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
  const result = { rounds: 0, targetsDiscovered: 0, endpointsClosed: 0 }

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
      result.targetsDiscovered += 1
    } finally {
      await registration?.dispose()
    }

    assert.ok(registration, `${mode} round ${round} did not create a registration`)
    assert.ok(target, `${mode} round ${round} did not expose a target`)
    assert.equal(registration.status().state, 'disposed')
    await assertEndpointClosed(target.discoveryUrl)
    result.endpointsClosed += 1
    result.rounds += 1
  }

  return result
}

const consumerRequire = createRequire(join(installationRoot, 'consumer.cjs'))
const packageDirectory = await realpath(join(installationRoot, 'node_modules', PACKAGE_NAME))
const resolvedEntry = await realpath(consumerRequire.resolve(PACKAGE_NAME))
const entryRelativeToPackage = relative(packageDirectory, resolvedEntry)
assert.ok(
  entryRelativeToPackage &&
    !entryRelativeToPackage.startsWith('..') &&
    !isAbsolute(entryRelativeToPackage),
  `resolved entry is outside the exact packed installation: ${resolvedEntry}`
)

const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'))
assert.equal(manifest.name, PACKAGE_NAME)
const { register } = consumerRequire(PACKAGE_NAME)
assert.equal(typeof register, 'function')

const adapters = {
  native: await runRounds(register, 'native'),
  legacy: await runRounds(register, 'legacy')
}

console.log(
  `${RESULT_PREFIX}${JSON.stringify({
    schemaVersion: 1,
    controllerPid: process.pid,
    package: { name: manifest.name, version: manifest.version },
    rounds: ROUNDS,
    adapters
  })}`
)

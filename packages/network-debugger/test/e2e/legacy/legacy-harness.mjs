import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CdpClient } from '../harness/cdp-client.mjs'
import { startLegacyOriginServer } from './fixtures/origin-server.mjs'

const LEGACY_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIRECTORY = resolve(LEGACY_DIRECTORY, '../../..')
const DEFAULT_TIMEOUT_MS = 12_000

const CONSUMERS = {
  esm: {
    entryPath: resolve(PACKAGE_DIRECTORY, 'dist/index.mjs'),
    fixturePath: resolve(LEGACY_DIRECTORY, 'fixtures/consumer.mjs')
  },
  cjs: {
    entryPath: resolve(PACKAGE_DIRECTORY, 'dist/index.js'),
    fixturePath: resolve(LEGACY_DIRECTORY, 'fixtures/consumer.cjs')
  }
}

function serializeError(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack }
  }
  return { message: String(error) }
}

function waitForExit(child, timeoutMs, label) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out after ${timeoutMs}ms while waiting for ${label}`))
    }, timeoutMs)
    const onExit = (code, signal) => {
      cleanup()
      resolvePromise({ code, signal })
    }
    const cleanup = () => {
      clearTimeout(timer)
      child.off('exit', onExit)
    }
    child.once('exit', onExit)
  })
}

async function fetchJson(url, label) {
  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) })
  } catch (error) {
    throw new Error(`Could not read Legacy ${label} from ${url}: ${error}`, { cause: error })
  }
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`Legacy ${label} returned HTTP ${response.status} from ${url}: ${body}`)
  }
  try {
    return JSON.parse(body)
  } catch (error) {
    throw new Error(`Legacy ${label} was not JSON at ${url}: ${body}`, { cause: error })
  }
}

function assertStandardTarget(target) {
  if (!target || typeof target !== 'object') {
    throw new Error(`registration.ready did not return a target: ${JSON.stringify(target)}`)
  }
  for (const field of [
    'id',
    'title',
    'type',
    'webSocketDebuggerUrl',
    'devtoolsFrontendUrl',
    'discoveryUrl'
  ]) {
    if (typeof target[field] !== 'string' || target[field].length === 0) {
      throw new Error(`Legacy target.${field} must be a non-empty string`)
    }
  }
  if (!/^ws:\/\/127\.0\.0\.1:\d+\//.test(target.webSocketDebuggerUrl)) {
    throw new Error(
      `Legacy target must expose a loopback WebSocket path: ${target.webSocketDebuggerUrl}`
    )
  }
  if (!/^http:\/\/127\.0\.0\.1:\d+\/json\/list$/.test(target.discoveryUrl)) {
    throw new Error(
      `Legacy target must expose standard /json/list discovery: ${target.discoveryUrl}`
    )
  }
}

export class LegacyE2EHarness {
  constructor({ consumer = 'esm', entryPath } = {}) {
    const definition = CONSUMERS[consumer]
    if (!definition) throw new Error(`Unknown Legacy consumer kind: ${consumer}`)
    this.consumer = consumer
    this.entryPath =
      entryPath ??
      process.env[`NETWORK_DEBUGGER_E2E_ENTRY_${consumer.toUpperCase()}`] ??
      definition.entryPath
    this.fixturePath = definition.fixturePath
    this.targetMessages = []
    this.stdout = ''
    this.stderr = ''
    this.closed = false
  }

  async start() {
    await access(this.entryPath).catch(() => {
      throw new Error(
        `Built ${this.consumer.toUpperCase()} package entry is missing at ${this.entryPath}. ` +
          'Run `pnpm --filter node-network-devtools build` before the Legacy E2E suite.'
      )
    })

    this.origin = await startLegacyOriginServer()
    const child = spawn(process.execPath, [this.fixturePath], {
      cwd: PACKAGE_DIRECTORY,
      env: {
        ...process.env,
        NETWORK_DEBUGGER_E2E_ENTRY: this.entryPath
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    this.child = child

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      this.stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      this.stderr += chunk
    })
    child.on('message', (message) => this.targetMessages.push(message))

    const ready = await this.waitForTargetMessage((message) => message?.type === 'ready')
    this.targetPid = ready.pid
    this.sessionInfo = ready.sessionInfo
    if (ready.consumer !== this.consumer) {
      throw new Error(`Expected ${this.consumer} consumer, target reported ${ready.consumer}`)
    }
    if (this.sessionInfo?.mode !== 'legacy') {
      throw new Error(`Forced Legacy selected ${this.sessionInfo?.mode ?? 'no adapter'}`)
    }
    assertStandardTarget(this.sessionInfo.target)

    const discoveryUrl = new URL(this.sessionInfo.target.discoveryUrl)
    this.discovery = {
      list: await fetchJson(discoveryUrl.href, '/json/list'),
      version: await fetchJson(new URL('/json/version', discoveryUrl).href, '/json/version'),
      protocol: await fetchJson(new URL('/json/protocol', discoveryUrl).href, '/json/protocol')
    }

    if (!Array.isArray(this.discovery.list)) {
      throw new Error('Legacy /json/list response must be an array')
    }
    this.discoveredTarget = this.discovery.list.find(
      (target) =>
        target?.id === this.sessionInfo.target.id ||
        target?.webSocketDebuggerUrl === this.sessionInfo.target.webSocketDebuggerUrl
    )
    if (!this.discoveredTarget) {
      throw new Error(
        `registration.ready target is absent from /json/list: ${JSON.stringify(this.discovery.list)}`
      )
    }
    for (const field of ['id', 'title', 'type', 'url', 'webSocketDebuggerUrl']) {
      if (this.discoveredTarget[field] !== this.sessionInfo.target[field]) {
        throw new Error(`registration.ready and /json/list disagree on ${field}`)
      }
    }
    if (!Array.isArray(this.discovery.protocol?.domains)) {
      throw new Error('Legacy /json/protocol must expose a domains array')
    }

    const client = new CdpClient(this.sessionInfo.target.webSocketDebuggerUrl)
    this.client = client
    await client.connect()
    this.networkEnable = await client.command('Network.enable')
    return this
  }

  createToken(prefix) {
    return `${prefix}-${randomUUID()}`
  }

  url(pathname, token, search = {}) {
    const url = new URL(pathname, this.origin.baseUrl)
    url.searchParams.set('token', token)
    for (const [name, value] of Object.entries(search)) {
      url.searchParams.set(name, String(value))
    }
    return url.href
  }

  webSocketUrl(pathname, token) {
    const url = new URL(this.url(pathname, token))
    url.protocol = 'ws:'
    return url.href
  }

  async runScenario(scenario, payload = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const id = randomUUID()
    const resultPromise = this.waitForTargetMessage(
      (message) => message?.type === 'scenario-result' && message.id === id,
      { timeoutMs }
    )

    await new Promise((resolvePromise, reject) => {
      this.child.send({ type: 'run', id, scenario, ...payload }, (error) =>
        error ? reject(error) : resolvePromise()
      )
    })

    const message = await resultPromise
    if (!message.ok) throw new Error(`Legacy target scenario ${scenario} failed:\n${message.error}`)
    return message.result
  }

  waitForTargetMessage(predicate, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const existing = this.targetMessages.find(predicate)
    if (existing) return Promise.resolve(existing)
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return Promise.reject(
        new Error(
          `Legacy target already exited (code=${this.child.exitCode}, signal=${this.child.signalCode}).\n` +
            this.stderr
        )
      )
    }

    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(
          new Error(
            `Timed out after ${timeoutMs}ms waiting for Legacy target IPC. stderr:\n${this.stderr}`
          )
        )
      }, timeoutMs)
      const onMessage = (message) => {
        let matches
        try {
          matches = predicate(message)
        } catch (error) {
          cleanup()
          reject(error)
          return
        }
        if (!matches) return
        cleanup()
        resolvePromise(message)
      }
      const onExit = (code, signal) => {
        cleanup()
        reject(
          new Error(
            `Legacy target exited while waiting for IPC (code=${code}, signal=${signal}).\n` +
              this.stderr
          )
        )
      }
      const onError = (error) => {
        cleanup()
        reject(error)
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.child.off('message', onMessage)
        this.child.off('exit', onExit)
        this.child.off('error', onError)
      }
      this.child.on('message', onMessage)
      this.child.once('exit', onExit)
      this.child.once('error', onError)
    })
  }

  async writeFailureArtifacts(error) {
    const configuredRoot = process.env.NETWORK_DEBUGGER_E2E_ARTIFACT_DIR
    let artifactDirectory
    if (configuredRoot) {
      await mkdir(configuredRoot, { recursive: true })
      artifactDirectory = join(
        configuredRoot,
        `legacy-${this.consumer}-${Date.now()}-${process.pid}-${randomUUID()}`
      )
      await mkdir(artifactDirectory, { recursive: true })
    } else {
      artifactDirectory = await mkdtemp(
        join(tmpdir(), `node-network-devtools-legacy-${this.consumer}-e2e-`)
      )
    }

    await Promise.all([
      this.client?.writeJournal(join(artifactDirectory, 'cdp.ndjson')) ??
        writeFile(join(artifactDirectory, 'cdp.ndjson'), '', 'utf8'),
      writeFile(join(artifactDirectory, 'consumer.stdout.log'), this.stdout, 'utf8'),
      writeFile(join(artifactDirectory, 'consumer.stderr.log'), this.stderr, 'utf8'),
      writeFile(
        join(artifactDirectory, 'consumer-messages.ndjson'),
        this.targetMessages.map((message) => JSON.stringify(message)).join('\n') + '\n',
        'utf8'
      ),
      writeFile(
        join(artifactDirectory, 'origin.ndjson'),
        (this.origin?.records ?? []).map((record) => JSON.stringify(record)).join('\n') + '\n',
        'utf8'
      ),
      writeFile(
        join(artifactDirectory, 'target.json'),
        JSON.stringify(
          {
            registrationTarget: this.sessionInfo?.target,
            discoveredTarget: this.discoveredTarget,
            discovery: this.discovery
          },
          null,
          2
        ),
        'utf8'
      ),
      writeFile(
        join(artifactDirectory, 'metadata.json'),
        JSON.stringify(
          {
            error: serializeError(error),
            node: process.version,
            platform: process.platform,
            consumer: this.consumer,
            entryPath: this.entryPath,
            targetPid: this.targetPid,
            sessionInfo: this.sessionInfo
          },
          null,
          2
        ),
        'utf8'
      )
    ])

    return artifactDirectory
  }

  async close() {
    if (this.closed) return
    this.closed = true
    const errors = []

    try {
      await this.client?.close()
    } catch (error) {
      errors.push(error)
    }

    if (
      this.child &&
      this.child.connected &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    ) {
      try {
        const shutdown = this.waitForTargetMessage(
          (message) => message?.type === 'shutdown-complete',
          { timeoutMs: 4_000 }
        )
        await new Promise((resolvePromise, reject) => {
          this.child.send({ type: 'shutdown' }, (error) =>
            error ? reject(error) : resolvePromise()
          )
        })
        await shutdown
      } catch (error) {
        errors.push(error)
      }
    }

    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      try {
        await waitForExit(this.child, 3_000, 'Legacy target to exit')
      } catch (error) {
        errors.push(error)
        this.child.kill('SIGTERM')
        try {
          await waitForExit(this.child, 2_000, 'Legacy target to terminate')
        } catch (terminationError) {
          errors.push(terminationError)
          this.child.kill('SIGKILL')
        }
      }
    }

    try {
      await this.origin?.close()
    } catch (error) {
      errors.push(error)
    }

    if (errors.length) throw new AggregateError(errors, 'Failed to clean up Legacy E2E harness')
  }
}

export async function withLegacyHarness(testContext, options, callback) {
  const harness = new LegacyE2EHarness(options)
  testContext.after(async () => {
    try {
      await harness.close()
    } catch (error) {
      const artifactDirectory = await harness.writeFailureArtifacts(error).catch(() => undefined)
      if (artifactDirectory) {
        console.error(`Legacy E2E cleanup failure artifacts: ${artifactDirectory}`)
      }
      throw error
    }
  })

  try {
    await harness.start()
    return await callback(harness)
  } catch (error) {
    const artifactDirectory = await harness.writeFailureArtifacts(error).catch(() => undefined)
    if (artifactDirectory) {
      console.error(`Legacy E2E failure artifacts: ${artifactDirectory}`)
      if (error instanceof Error) {
        error.message = `${error.message}\nFailure artifacts: ${artifactDirectory}`
      } else {
        error = new Error(`${String(error)}\nFailure artifacts: ${artifactDirectory}`)
      }
    }
    throw error
  }
}

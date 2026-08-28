import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CdpClient } from '../harness/cdp-client.mjs'
import { startEnhancementsOrigin } from './fixtures/origin-server.mjs'

const DIRECTORY = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIRECTORY = resolve(DIRECTORY, '../../..')
const DEFAULT_TIMEOUT_MS = 15_000

function waitForExit(child, timeoutMs, label) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`))
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

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}: ${text}`)
  return JSON.parse(text)
}

export class EnhancementsHarness {
  constructor() {
    this.entryPath =
      process.env.NETWORK_DEBUGGER_E2E_ENTRY_ESM ?? resolve(PACKAGE_DIRECTORY, 'dist/index.mjs')
    this.fixturePath = resolve(DIRECTORY, 'fixtures/consumer.mjs')
    this.messages = []
    this.stdout = ''
    this.stderr = ''
    this.closed = false
    this.keepArtifacts = false
  }

  async start() {
    await access(this.entryPath).catch(() => {
      throw new Error(
        `Built package entry is missing at ${this.entryPath}. ` +
          'Run `pnpm --filter node-network-devtools build` before this suite.'
      )
    })
    this.temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'node-network-devtools-enhancements-e2e-')
    )
    this.sessionDirectory = join(this.temporaryDirectory, 'session')
    this.origin = await startEnhancementsOrigin()

    const child = spawn(process.execPath, [this.fixturePath], {
      cwd: PACKAGE_DIRECTORY,
      env: {
        ...process.env,
        NETWORK_DEBUGGER_E2E_ENTRY: this.entryPath,
        NETWORK_DEBUGGER_E2E_ORIGIN: this.origin.baseUrl,
        NETWORK_DEBUGGER_E2E_SESSION_DIR: this.sessionDirectory
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => (this.stdout += chunk))
    child.stderr.on('data', (chunk) => (this.stderr += chunk))
    child.on('message', (message) => this.messages.push(message))

    const ready = await this.waitForMessage((message) => message?.type === 'ready')
    this.targetPid = ready.pid
    this.sessionInfo = ready.sessionInfo
    if (this.sessionInfo?.mode !== 'legacy') {
      throw new Error(`Enhancements consumer selected ${this.sessionInfo?.mode ?? 'no backend'}`)
    }
    const target = this.sessionInfo.target
    if (!/^ws:\/\/127\.0\.0\.1:\d+\//.test(target?.webSocketDebuggerUrl ?? '')) {
      throw new Error(`Expected a real loopback CDP target: ${JSON.stringify(target)}`)
    }

    const discovery = await fetchJson(target.discoveryUrl)
    if (!Array.isArray(discovery) || !discovery.some((item) => item.id === target.id)) {
      throw new Error(`Target ${target.id} is absent from /json/list`)
    }
    this.discovery = discovery

    this.client = new CdpClient(target.webSocketDebuggerUrl)
    await this.client.connect()
    this.networkEnable = await this.client.command('Network.enable')
    return this
  }

  createToken(prefix) {
    return `${prefix}-${randomUUID()}`
  }

  url(pathname, token) {
    const url = new URL(pathname, this.origin.baseUrl)
    url.searchParams.set('token', token)
    return url.href
  }

  command(type, payload = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const id = randomUUID()
    const response = this.waitForMessage(
      (message) => message?.type === 'command-result' && message.id === id,
      { timeoutMs }
    )
    return new Promise((resolvePromise, reject) => {
      this.child.send({ type, id, ...payload }, (error) => {
        if (error) reject(error)
        else resolvePromise()
      })
    })
      .then(() => response)
      .then((message) => {
        if (!message.ok) throw new Error(`Enhancements command ${type} failed:\n${message.error}`)
        return message.result
      })
  }

  run(scenario, payload = {}) {
    return this.command('run', { scenario, ...payload })
  }

  finalize() {
    return this.command('finalize', {}, { timeoutMs: 30_000 })
  }

  waitForMessage(predicate, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const existing = this.messages.find(predicate)
    if (existing) return Promise.resolve(existing)
    if (this.child?.exitCode !== null || this.child?.signalCode !== null) {
      return Promise.reject(
        new Error(
          `Enhancements consumer already exited ` +
            `(code=${this.child?.exitCode}, signal=${this.child?.signalCode}).\n${this.stderr}`
        )
      )
    }
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(
          new Error(
            `Timed out after ${timeoutMs}ms waiting for consumer IPC. stderr:\n${this.stderr}`
          )
        )
      }, timeoutMs)
      const onMessage = (message) => {
        if (!predicate(message)) return
        cleanup()
        resolvePromise(message)
      }
      const onExit = (code, signal) => {
        cleanup()
        reject(
          new Error(
            `Enhancements consumer exited while waiting for IPC ` +
              `(code=${code}, signal=${signal}).\n${this.stderr}`
          )
        )
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.child.off('message', onMessage)
        this.child.off('exit', onExit)
      }
      this.child.on('message', onMessage)
      this.child.once('exit', onExit)
    })
  }

  async preserveFailure(error) {
    this.keepArtifacts = true
    if (!this.temporaryDirectory) return undefined
    await mkdir(this.temporaryDirectory, { recursive: true })
    await Promise.all([
      this.client?.writeJournal(join(this.temporaryDirectory, 'raw-cdp.ndjson')),
      writeFile(join(this.temporaryDirectory, 'consumer.stdout.log'), this.stdout, 'utf8'),
      writeFile(join(this.temporaryDirectory, 'consumer.stderr.log'), this.stderr, 'utf8'),
      writeFile(
        join(this.temporaryDirectory, 'consumer-messages.ndjson'),
        this.messages.map((message) => JSON.stringify(message)).join('\n') + '\n',
        'utf8'
      ),
      writeFile(
        join(this.temporaryDirectory, 'origin.ndjson'),
        (this.origin?.records ?? []).map((record) => JSON.stringify(record)).join('\n') + '\n',
        'utf8'
      ),
      writeFile(
        join(this.temporaryDirectory, 'failure.json'),
        JSON.stringify(
          {
            error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
            sessionInfo: this.sessionInfo,
            node: process.version,
            platform: process.platform
          },
          null,
          2
        ),
        'utf8'
      )
    ])
    return this.temporaryDirectory
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

    if (this.child?.connected && this.child.exitCode === null && this.child.signalCode === null) {
      try {
        await this.command('shutdown', {}, { timeoutMs: 6_000 })
      } catch (error) {
        errors.push(error)
      }
    }

    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      try {
        await waitForExit(this.child, 3_000, 'enhancements consumer to exit')
      } catch (error) {
        errors.push(error)
        this.child.kill('SIGTERM')
        try {
          await waitForExit(this.child, 2_000, 'enhancements consumer to terminate')
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

    if (errors.length) this.keepArtifacts = true
    if (!this.keepArtifacts && this.temporaryDirectory) {
      await rm(this.temporaryDirectory, { recursive: true, force: true })
    }
    if (errors.length) {
      throw new AggregateError(errors, 'Failed to clean up enhancements E2E harness')
    }
  }
}

export async function withEnhancementsHarness(testContext, callback) {
  const harness = new EnhancementsHarness()
  testContext.after(async () => {
    try {
      await harness.close()
    } catch (error) {
      const directory = await harness.preserveFailure(error).catch(() => undefined)
      if (directory) console.error(`Enhancements cleanup failure artifacts: ${directory}`)
      throw error
    }
  })

  try {
    await harness.start()
    return await callback(harness)
  } catch (error) {
    const directory = await harness.preserveFailure(error).catch(() => undefined)
    if (directory) {
      console.error(`Enhancements E2E failure artifacts: ${directory}`)
      if (error instanceof Error) error.message += `\nFailure artifacts: ${directory}`
    }
    throw error
  }
}

export async function runNativeMockConflictConsumer() {
  const entryPath =
    process.env.NETWORK_DEBUGGER_E2E_ENTRY_ESM ?? resolve(PACKAGE_DIRECTORY, 'dist/index.mjs')
  await access(entryPath)
  const fixturePath = resolve(DIRECTORY, 'fixtures/native-mock-conflict.mjs')
  const child = spawn(process.execPath, [fixturePath], {
    cwd: PACKAGE_DIRECTORY,
    env: { ...process.env, NETWORK_DEBUGGER_E2E_ENTRY: entryPath },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => (stdout += chunk))
  child.stderr.on('data', (chunk) => (stderr += chunk))
  const exit = await waitForExit(child, DEFAULT_TIMEOUT_MS, 'Native plus Mock consumer')
  return { ...exit, stdout, stderr }
}

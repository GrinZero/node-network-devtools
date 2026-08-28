import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

import { CdpClient } from './cdp-client.mjs'
import { startOriginServer } from '../fixtures/origin-server.mjs'

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = resolve(HARNESS_DIR, '../../..')
const DEFAULT_ENTRY_PATH = resolve(PACKAGE_DIR, 'dist/index.mjs')
const TARGET_PATH = resolve(HARNESS_DIR, '../fixtures/native-target.mjs')
const DEFAULT_TIMEOUT_MS = 10_000

function waitForEmitter({
  emitter,
  event,
  predicate,
  timeoutMs,
  label,
  history,
  endEvent,
  endError
}) {
  const existing = history?.find(predicate)
  if (existing) return Promise.resolve(existing)

  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out after ${timeoutMs}ms while waiting for ${label}`))
    }, timeoutMs)

    const onValue = (value) => {
      let matches
      try {
        matches = predicate(value)
      } catch (error) {
        cleanup()
        reject(error)
        return
      }
      if (!matches) return
      cleanup()
      resolvePromise(value)
    }

    const onError = (error) => {
      cleanup()
      reject(error)
    }

    const onEnd = (...args) => {
      cleanup()
      reject(endError(...args))
    }

    const cleanup = () => {
      clearTimeout(timer)
      emitter.off(event, onValue)
      emitter.off('error', onError)
      if (endEvent) emitter.off(endEvent, onEnd)
    }

    emitter.on(event, onValue)
    emitter.once('error', onError)
    if (endEvent) emitter.once(endEvent, onEnd)
  })
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

function serializeError(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack }
  }
  return { message: String(error) }
}

export class NativeE2EHarness {
  constructor({
    entryPath = process.env.NETWORK_DEBUGGER_E2E_ENTRY ?? DEFAULT_ENTRY_PATH,
    recordSession = false
  } = {}) {
    this.entryPath = entryPath
    this.recordSession = recordSession
    this.targetMessages = []
    this.stdout = ''
    this.stderr = ''
    this.closed = false
    this.keepSessionArtifacts = false
  }

  async start() {
    await access(this.entryPath).catch(() => {
      throw new Error(
        `Built public package entry is missing at ${this.entryPath}. ` +
          'Run `pnpm --filter node-network-devtools build` before the E2E suite.'
      )
    })

    if (this.recordSession) {
      this.temporaryDirectory = await mkdtemp(
        join(tmpdir(), 'node-network-devtools-native-session-e2e-')
      )
      this.sessionDirectory = join(this.temporaryDirectory, 'session')
    }

    this.origin = await startOriginServer()
    const child = spawn(
      process.execPath,
      ['--inspect-wait=127.0.0.1:0', '--experimental-network-inspection', TARGET_PATH],
      {
        cwd: PACKAGE_DIR,
        env: {
          ...process.env,
          NETWORK_DEBUGGER_E2E_ENTRY: pathToFileURL(this.entryPath).href,
          ...(this.sessionDirectory
            ? { NETWORK_DEBUGGER_E2E_SESSION_DIR: this.sessionDirectory }
            : {})
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      }
    )
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

    const inspectorUrl = await this.#waitForInspectorUrl()
    this.inspectorUrl = inspectorUrl
    const client = new CdpClient(inspectorUrl)
    this.client = client
    await client.connect()

    this.networkEnable = await client.command('Network.enable')
    this.runIfWaiting = await client.command('Runtime.runIfWaitingForDebugger')

    const ready = await this.waitForTargetMessage((message) => message?.type === 'ready')
    this.targetPid = ready.pid
    this.sessionInfo = ready.sessionInfo
    this.nativeFunctionsUnchanged = ready.nativeFunctionsUnchanged
    return this
  }

  createToken(prefix) {
    return `${prefix}-${randomUUID()}`
  }

  url(pathname, token) {
    return `${this.origin.baseUrl}${pathname}?token=${encodeURIComponent(token)}`
  }

  async runScenario(scenario, { url, token, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    const id = randomUUID()
    const resultPromise = this.waitForTargetMessage(
      (message) => message?.type === 'scenario-result' && message.id === id,
      { timeoutMs }
    )

    await new Promise((resolvePromise, reject) => {
      this.child.send({ type: 'run', id, scenario, url, token }, (error) =>
        error ? reject(error) : resolvePromise()
      )
    })

    const message = await resultPromise
    if (!message.ok) throw new Error(`Target scenario ${scenario} failed:\n${message.error}`)
    return message.result
  }

  async finalizeSession({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!this.sessionDirectory) throw new Error('Native Session recording is not enabled')
    const id = randomUUID()
    const resultPromise = this.waitForTargetMessage(
      (message) => message?.type === 'session-finalized' && message.id === id,
      { timeoutMs }
    )
    await new Promise((resolvePromise, reject) => {
      this.child.send({ type: 'finalize-session', id }, (error) =>
        error ? reject(error) : resolvePromise()
      )
    })
    const message = await resultPromise
    if (!message.ok) throw new Error(`Native Session finalization failed:\n${message.error}`)
    return message.result
  }

  async waitForRecordedRequest(url, { requireBody = true, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!this.sessionDirectory) throw new Error('Native Session recording is not enabled')

    const manifestPath = resolve(this.sessionDirectory, 'manifest.json')
    const deadline = Date.now() + timeoutMs
    let lastManifest
    let lastReadError

    while (Date.now() < deadline) {
      try {
        lastManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
        lastReadError = undefined
        const request = Object.values(lastManifest.requestIndex ?? {}).find(
          (entry) => entry?.request?.url === url
        )
        const body = request?.requestId ? lastManifest.bodyIndex?.[request.requestId] : undefined

        if (
          request?.response &&
          Number.isFinite(request.finishedTimestamp) &&
          (!requireBody || body)
        ) {
          return { manifest: lastManifest, request, body }
        }
      } catch (error) {
        lastReadError = error
      }

      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
    }

    const observed = lastManifest
      ? JSON.stringify({ stats: lastManifest.stats, issues: lastManifest.issues })
      : lastReadError instanceof Error
        ? lastReadError.message
        : 'no readable manifest'
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for Session to record ${url}. Observed: ${observed}`
    )
  }

  waitForTargetMessage(predicate, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return Promise.reject(
        new Error(
          `Native target already exited (code=${this.child.exitCode}, signal=${this.child.signalCode}).\n` +
            this.stderr
        )
      )
    }
    return waitForEmitter({
      emitter: this.child,
      event: 'message',
      predicate,
      timeoutMs,
      label: 'target IPC message',
      history: this.targetMessages,
      endEvent: 'exit',
      endError: (code, signal) =>
        new Error(
          `Native target exited while waiting for IPC (code=${code}, signal=${signal}).\n` +
            this.stderr
        )
    })
  }

  async writeFailureArtifacts(error) {
    const configuredRoot = process.env.NETWORK_DEBUGGER_E2E_ARTIFACT_DIR
    let artifactDirectory
    if (configuredRoot) {
      await mkdir(configuredRoot, { recursive: true })
      artifactDirectory = join(
        configuredRoot,
        `native-${Date.now()}-${process.pid}-${randomUUID()}`
      )
      await mkdir(artifactDirectory, { recursive: true })
    } else {
      artifactDirectory = await mkdtemp(join(tmpdir(), 'node-network-devtools-native-e2e-'))
    }

    await Promise.all([
      this.client?.writeJournal(join(artifactDirectory, 'cdp.ndjson')) ?? Promise.resolve(),
      writeFile(join(artifactDirectory, 'target.stdout.log'), this.stdout, 'utf8'),
      writeFile(join(artifactDirectory, 'target.stderr.log'), this.stderr, 'utf8'),
      writeFile(
        join(artifactDirectory, 'target-messages.ndjson'),
        this.targetMessages.map((message) => JSON.stringify(message)).join('\n') + '\n',
        'utf8'
      ),
      writeFile(
        join(artifactDirectory, 'metadata.json'),
        JSON.stringify(
          {
            error: serializeError(error),
            node: process.version,
            platform: process.platform,
            inspectorUrl: this.inspectorUrl,
            targetPid: this.targetPid,
            sessionInfo: this.sessionInfo,
            nativeFunctionsUnchanged: this.nativeFunctionsUnchanged
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

    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      try {
        const shutdown = this.waitForTargetMessage(
          (message) => message?.type === 'shutdown-complete',
          { timeoutMs: 3_000 }
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

    try {
      await this.client?.close()
    } catch (error) {
      errors.push(error)
    }

    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      try {
        await waitForExit(this.child, 3_000, 'native target to exit')
      } catch (error) {
        errors.push(error)
        this.child.kill('SIGTERM')
        try {
          await waitForExit(this.child, 2_000, 'native target to terminate')
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

    if (this.temporaryDirectory && !this.keepSessionArtifacts) {
      try {
        await rm(this.temporaryDirectory, { recursive: true, force: true })
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length) throw new AggregateError(errors, 'Failed to clean up native E2E harness')
  }

  async #waitForInspectorUrl({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const existing = this.stderr.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1]
    if (existing) return existing

    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(
          new Error(
            `Timed out after ${timeoutMs}ms waiting for Node Inspector URL. stderr:\n${this.stderr}`
          )
        )
      }, timeoutMs)

      const onData = () => {
        const match = this.stderr.match(/Debugger listening on (ws:\/\/[^\s]+)/)
        if (!match) return
        cleanup()
        resolvePromise(match[1])
      }

      const onExit = (code, signal) => {
        cleanup()
        reject(
          new Error(
            `Native target exited before Inspector startup (code=${code}, signal=${signal}).\n` +
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
        this.child.stderr.off('data', onData)
        this.child.off('exit', onExit)
        this.child.off('error', onError)
      }

      this.child.stderr.on('data', onData)
      this.child.once('exit', onExit)
      this.child.once('error', onError)
    })
  }
}

export async function withNativeHarness(testContext, callback, options = {}) {
  const harness = new NativeE2EHarness(options)
  testContext.after(async () => harness.close())

  try {
    await harness.start()
    return await callback(harness)
  } catch (error) {
    harness.keepSessionArtifacts = true
    const artifactDirectory = await harness.writeFailureArtifacts(error).catch(() => undefined)
    if (artifactDirectory) {
      console.error(`Native E2E failure artifacts: ${artifactDirectory}`)
      if (error instanceof Error) {
        error.message = `${error.message}\nFailure artifacts: ${artifactDirectory}`
        if (harness.sessionDirectory) {
          error.message += `\nNative Session artifacts: ${harness.sessionDirectory}`
        }
      } else {
        error = new Error(`${String(error)}\nFailure artifacts: ${artifactDirectory}`)
      }
    }
    throw error
  }
}

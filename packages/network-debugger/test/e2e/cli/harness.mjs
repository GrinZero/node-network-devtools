import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { access, copyFile, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const CLI_DIR = dirname(fileURLToPath(import.meta.url))

export const PACKAGE_DIR = resolve(CLI_DIR, '../../..')
export const CLI_PATH = resolve(PACKAGE_DIR, 'dist/cli.mjs')
export const REGISTER_PATH = resolve(PACKAGE_DIR, 'dist/register.mjs')
export const FIXTURES_DIR = resolve(CLI_DIR, 'fixtures')
export const FIXTURE_RECORD_PREFIX = '@@NND_E2E@@'

const DEFAULT_TIMEOUT_MS = 15_000

function timeoutError(label, timeoutMs, processState) {
  return new Error(
    `Timed out after ${timeoutMs}ms while waiting for ${label}.\n` +
      `CLI state: ${JSON.stringify(processState)}\n`
  )
}

function parseFixtureRecord(line) {
  const marker = line.indexOf(FIXTURE_RECORD_PREFIX)
  if (marker === -1) return undefined

  const serialized = line.slice(marker + FIXTURE_RECORD_PREFIX.length).trim()
  try {
    return JSON.parse(serialized)
  } catch (error) {
    throw new Error(`Fixture emitted invalid JSON: ${serialized}`, { cause: error })
  }
}

export async function assertCliBuildExists() {
  await Promise.all(
    [CLI_PATH, REGISTER_PATH].map((path) =>
      access(path).catch(() => {
        throw new Error(`Missing built CLI artifact ${path}. Run the package build before CLI E2E.`)
      })
    )
  )
}

export function cleanCliEnvironment(overrides = {}) {
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (key.startsWith('NND_')) delete environment[key]
  }
  delete environment.NODE_OPTIONS
  return { ...environment, ...overrides }
}

export class CliProcess {
  constructor(
    args,
    {
      cwd = PACKAGE_DIR,
      env = cleanCliEnvironment(),
      stdio = ['ignore', 'pipe', 'pipe'],
      nodeArgs = []
    } = {}
  ) {
    this.args = [...args]
    this.cwd = cwd
    this.stdout = ''
    this.stderr = ''
    this.lines = []
    this.records = []
    this.events = new EventEmitter()
    this.closed = undefined

    const child = spawn(process.execPath, [...nodeArgs, CLI_PATH, ...args], {
      cwd,
      env,
      stdio
    })
    this.child = child
    this.#capture(child.stdout, 'stdout')
    this.#capture(child.stderr, 'stderr')
    child.once('error', (error) => this.events.emit('process-error', error))
    child.once('close', (code, signal) => {
      this.closed = { code, signal }
      this.events.emit('process-close', this.closed)
    })
  }

  get pid() {
    return this.child.pid
  }

  get running() {
    return (
      this.closed === undefined && this.child.exitCode === null && this.child.signalCode === null
    )
  }

  output() {
    return { stdout: this.stdout, stderr: this.stderr }
  }

  state() {
    return {
      args: this.args,
      cwd: this.cwd,
      pid: this.pid,
      exitCode: this.child.exitCode,
      signalCode: this.child.signalCode,
      stdout: this.stdout,
      stderr: this.stderr
    }
  }

  waitForLine(predicate, { source, timeoutMs = DEFAULT_TIMEOUT_MS, label = 'CLI output' } = {}) {
    const existing = this.lines.find(
      (item) => (!source || item.source === source) && predicate(item.line, item)
    )
    if (existing) return Promise.resolve(existing)

    if (this.closed) {
      return Promise.reject(
        new Error(`CLI exited before ${label}: ${JSON.stringify(this.closed)}\n${this.stderr}`)
      )
    }

    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(timeoutError(label, timeoutMs, this.state()))
      }, timeoutMs)

      const onLine = (item) => {
        if (source && item.source !== source) return
        let matches
        try {
          matches = predicate(item.line, item)
        } catch (error) {
          cleanup()
          reject(error)
          return
        }
        if (!matches) return
        cleanup()
        resolvePromise(item)
      }
      const onError = (error) => {
        cleanup()
        reject(error)
      }
      const onClose = (result) => {
        cleanup()
        reject(new Error(`CLI exited before ${label}: ${JSON.stringify(result)}\n${this.stderr}`))
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.events.off('line', onLine)
        this.events.off('process-error', onError)
        this.events.off('process-close', onClose)
      }

      this.events.on('line', onLine)
      this.events.once('process-error', onError)
      this.events.once('process-close', onClose)
    })
  }

  waitForRecord(predicate = () => true, options = {}) {
    const existing = this.records.find(predicate)
    if (existing) return Promise.resolve(existing)

    if (this.closed) {
      return Promise.reject(
        new Error(
          `CLI exited before fixture readiness: ${JSON.stringify(this.closed)}\n${this.stderr}`
        )
      )
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const label = options.label ?? 'fixture readiness record'
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(timeoutError(label, timeoutMs, this.state()))
      }, timeoutMs)
      const onRecord = (record) => {
        let matches
        try {
          matches = predicate(record)
        } catch (error) {
          cleanup()
          reject(error)
          return
        }
        if (!matches) return
        cleanup()
        resolvePromise(record)
      }
      const onError = (error) => {
        cleanup()
        reject(error)
      }
      const onClose = (result) => {
        cleanup()
        reject(
          new Error(
            `CLI exited before ${label}: ${JSON.stringify(result)}\nstdout:\n${this.stdout}\nstderr:\n${this.stderr}`
          )
        )
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.events.off('record', onRecord)
        this.events.off('process-error', onError)
        this.events.off('process-close', onClose)
      }

      this.events.on('record', onRecord)
      this.events.once('process-error', onError)
      this.events.once('process-close', onClose)
    })
  }

  waitForExit({ timeoutMs = DEFAULT_TIMEOUT_MS, label = 'CLI exit' } = {}) {
    if (this.closed) return Promise.resolve(this.closed)

    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(timeoutError(label, timeoutMs, this.state()))
      }, timeoutMs)
      const onClose = (result) => {
        cleanup()
        resolvePromise(result)
      }
      const onError = (error) => {
        cleanup()
        reject(error)
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.events.off('process-close', onClose)
        this.events.off('process-error', onError)
      }

      this.events.once('process-close', onClose)
      this.events.once('process-error', onError)
    })
  }

  async terminate(signal = 'SIGTERM', { timeoutMs = 5_000 } = {}) {
    if (!this.running) return this.waitForExit({ timeoutMs, label: 'already-ended CLI' })

    this.child.kill(signal)
    try {
      return await this.waitForExit({ timeoutMs, label: `CLI to handle ${signal}` })
    } catch (error) {
      if (this.running) this.child.kill('SIGKILL')
      await this.waitForExit({ timeoutMs: 2_000, label: 'CLI forced termination' }).catch(() => {})
      throw error
    }
  }

  #capture(stream, source) {
    if (!stream) return
    stream.setEncoding('utf8')
    let pending = ''

    const emitLine = (line) => {
      const item = { source, line }
      this.lines.push(item)
      this.events.emit('line', item)

      let record
      try {
        record = parseFixtureRecord(line)
      } catch (error) {
        this.events.emit('process-error', error)
        return
      }
      if (record === undefined) return
      this.records.push(record)
      this.events.emit('record', record)
    }

    stream.on('data', (chunk) => {
      this[source] += chunk
      pending += chunk
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      lines.forEach(emitLine)
    })
    stream.on('end', () => {
      if (pending) emitLine(pending)
    })
  }
}

export function startCli(args, options) {
  return new CliProcess(args, options)
}

export async function runCli(args, options = {}) {
  const cli = startCli(args, options)
  try {
    const result = await cli.waitForExit({ timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS })
    return { ...result, ...cli.output(), records: [...cli.records] }
  } catch (error) {
    if (cli.running) await cli.terminate().catch(() => {})
    throw error
  }
}

export function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    if (error?.code === 'EPERM') return true
    throw error
  }
}

export async function waitForProcessGone(pid, { timeoutMs = 5_000 } = {}) {
  if (!processExists(pid)) return

  await new Promise((resolvePromise, reject) => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      if (!processExists(pid)) {
        resolvePromise()
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Process ${pid} remained alive for more than ${timeoutMs}ms.`))
        return
      }
      setTimeout(check, 25)
    }
    check()
  })
}

export async function atomicReplace(path, transform) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  const next = await transform()
  await writeFile(temporary, next, 'utf8')
  await rename(temporary, path)
}

export async function temporaryFixtureCopy(sourcePath) {
  const directory = await mkdtemp(join(tmpdir(), 'node-network-devtools-cli-e2e-'))
  const targetPath = join(directory, sourcePath.split(/[\\/]/).at(-1))
  await copyFile(sourcePath, targetPath)
  return {
    directory,
    path: targetPath,
    cleanup: () => rm(directory, { recursive: true, force: true })
  }
}

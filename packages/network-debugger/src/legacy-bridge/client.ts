import { fork as nodeFork, type ChildProcess, type ForkOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve as resolvePath } from 'node:path'
import { deserialize, serialize } from 'node:v8'
import { __dirname } from '../common'
import type { DevtoolsTarget, Diagnostic } from '../adapters/types'
import type {
  LegacyBridgeOptions,
  LegacyCaptureEvent,
  LegacyChildMessage,
  LegacyParentMessage
} from './contracts'

const DEFAULT_MAX_RESTARTS = 3
const DEFAULT_QUEUE_LIMIT = 1_024
const DIAGNOSTIC_HISTORY_LIMIT = 64
export const LEGACY_BRIDGE_OPTIONS_ENV = 'NND_LEGACY_BRIDGE_OPTIONS'

type ForkProcess = (modulePath: string, args: string[], options: ForkOptions) => ChildProcess

export interface LegacyBridgeClientDependencies {
  fork?: ForkProcess
  childEntry?: string
  execArgv?: readonly string[]
  env?: NodeJS.ProcessEnv
  maxRestarts?: number
  queueLimit?: number
  shutdownGraceMs?: number
  shutdownForceMs?: number
  recoveryForceKillMs?: number
}

export type DiagnosticListener = (diagnostic: Diagnostic) => void
export type FailureListener = (error: LegacyBridgeError) => void

interface QueuedParentMessage {
  sequence: number
  message: LegacyParentMessage
}

export class LegacyBridgeError extends Error {
  constructor(
    readonly code:
      | 'NND_LEGACY_CHILD_START_FAILED'
      | 'NND_LEGACY_CHILD_RECOVERY_FAILED'
      | 'NND_LEGACY_DISPOSED',
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message)
    this.name = 'LegacyBridgeError'
  }
}

function optionName(argument: string): string {
  const separator = argument.indexOf('=')
  return separator === -1 ? argument : argument.slice(0, separator)
}

function optionValue(argument: string): string | undefined {
  const separator = argument.indexOf('=')
  return separator === -1 ? undefined : argument.slice(separator + 1)
}

function isProjectPreload(specifier: string): boolean {
  const normalized = specifier.replace(/\\/g, '/').toLowerCase()
  return (
    normalized === 'tsx' ||
    normalized.startsWith('tsx/') ||
    normalized.includes('/node_modules/tsx/') ||
    normalized === 'node-network-devtools/register' ||
    normalized === 'node-network-devtools/preload' ||
    normalized.includes('/node-network-devtools/dist/register.mjs') ||
    normalized.includes('/node-network-devtools/src/preload/register.') ||
    normalized.includes('/node-network-devtools/src/preload/index.') ||
    /(?:^|\/)dist\/register\.mjs(?:[?#].*)?$/.test(normalized) ||
    /(?:^|\/)src\/preload\/(?:register|index)\.[cm]?[jt]s(?:[?#].*)?$/.test(normalized)
  )
}

/**
 * Remove parent-only runtime flags before forking the Legacy backend.
 *
 * The preload process marker remains a second line of defence, but correctness
 * does not depend on an inherited environment claim: the child simply never
 * receives the recursive preload, Inspector pause, or watch flags.
 */
export function sanitizeLegacyExecArgv(execArgv: readonly string[]): string[] {
  const sanitized: string[] = []

  for (let index = 0; index < execArgv.length; index += 1) {
    const argument = execArgv[index]
    const name = optionName(argument)
    const attachedValue = optionValue(argument)

    const isEvalOrPrint = name === '-e' || name === '--eval' || name === '-p' || name === '--print'
    const isAttachedShortEvalOrPrint =
      !argument.startsWith('--') &&
      (argument.startsWith('-e') || argument.startsWith('-p')) &&
      argument.length > 2
    if (isEvalOrPrint || isAttachedShortEvalOrPrint) {
      if (isEvalOrPrint && attachedValue === undefined && execArgv[index + 1] !== undefined)
        index += 1
      continue
    }

    // `--input-type` is meaningful only for string/stdin input and makes a
    // forked file entry fail once its inherited eval/print option is removed.
    if (name === '--input-type') {
      if (attachedValue === undefined && execArgv[index + 1] !== undefined) index += 1
      continue
    }

    if (name.startsWith('--inspect') || name === '--experimental-network-inspection') {
      if (
        attachedValue === undefined &&
        ['--inspect-port', '--inspect-publish-uid'].includes(name) &&
        execArgv[index + 1] &&
        !execArgv[index + 1].startsWith('-')
      ) {
        index += 1
      }
      continue
    }

    if (name === '--watch' || name === '--watch-preserve-output') continue
    if (name === '--watch-path' || name === '--watch-kill-signal') {
      if (attachedValue === undefined && execArgv[index + 1]) index += 1
      continue
    }

    if (
      name === '--import' ||
      name === '--require' ||
      name === '-r' ||
      name === '--loader' ||
      name === '--experimental-loader'
    ) {
      const separateValue = attachedValue === undefined ? execArgv[index + 1] : undefined
      const preload = attachedValue ?? separateValue
      if (preload !== undefined && isProjectPreload(preload)) {
        if (attachedValue === undefined) index += 1
        continue
      }
    }

    sanitized.push(argument)
  }

  return sanitized
}

/** A small NODE_OPTIONS tokenizer supporting the quoting accepted by Node. */
export function tokenizeNodeOptions(value: string): string[] {
  const tokens: string[] = []
  let token = ''
  let quote: '"' | "'" | undefined

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '\\') {
      const next = value[index + 1]
      const escapesOutsideQuote =
        !quote && next !== undefined && (/\s/.test(next) || /['"]/.test(next))
      const escapesActiveQuote = quote !== undefined && next === quote
      const escapesBackslash = next === '\\'
      if (escapesOutsideQuote || escapesActiveQuote || escapesBackslash) {
        token += next
        index += 1
      } else {
        // Backslashes are ordinary path separators unless they escape a quote
        // or unquoted whitespace. In particular, preserve `C:\path` verbatim.
        token += character
      }
      continue
    }
    if (quote) {
      if (character === quote) quote = undefined
      else token += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (/\s/.test(character)) {
      if (token) {
        tokens.push(token)
        token = ''
      }
      continue
    }
    token += character
  }

  if (token) tokens.push(token)
  return tokens
}

function quoteNodeOption(argument: string): string {
  return /^[A-Za-z0-9_./:@%+,=-]+$/.test(argument) ? argument : JSON.stringify(argument)
}

export function sanitizeLegacyEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv = { ...env }
  const nodeOptions = childEnv.NODE_OPTIONS
  if (nodeOptions) {
    const sanitized = sanitizeLegacyExecArgv(tokenizeNodeOptions(nodeOptions))
    if (sanitized.length === 0) delete childEnv.NODE_OPTIONS
    else childEnv.NODE_OPTIONS = sanitized.map(quoteNodeOption).join(' ')
  }
  return childEnv
}

function snapshot<T>(value: T): T {
  // child_process IPC with `serialization: advanced` uses the same V8 value
  // model. Snapshotting queued events now prevents mutable RequestDetail
  // instances from collapsing init/register/end into their final state while
  // preserving Buffer values as Buffers.
  return deserialize(serialize(value)) as T
}

function targetPort(target: DevtoolsTarget): number | undefined {
  try {
    const port = Number(new URL(target.webSocketDebuggerUrl).port)
    return Number.isInteger(port) && port > 0 ? port : undefined
  } catch {
    return undefined
  }
}

function sameTargetEndpoint(expected: DevtoolsTarget, actual: DevtoolsTarget): boolean {
  return (
    expected.webSocketDebuggerUrl === actual.webSocketDebuggerUrl &&
    expected.discoveryUrl === actual.discoveryUrl
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Parent-side owner of the Legacy child and its IPC transport. */
export class LegacyBridgeClient {
  readonly ready: Promise<DevtoolsTarget>

  private readonly options: LegacyBridgeOptions
  private readonly forkProcess: ForkProcess
  private readonly childEntry: string
  private readonly baseExecArgv: readonly string[]
  private readonly baseEnv: NodeJS.ProcessEnv
  private readonly maxRestarts: number
  private readonly queueLimit: number
  private readonly shutdownGraceMs: number
  private readonly shutdownForceMs: number
  private readonly recoveryForceKillMs: number
  private readonly queue: QueuedParentMessage[] = []
  private readonly diagnosticListeners = new Set<DiagnosticListener>()
  private readonly failureListeners = new Set<FailureListener>()
  private readonly diagnosticHistory: Diagnostic[] = []
  private child?: ChildProcess
  private resolveReady!: (target: DevtoolsTarget) => void
  private rejectReady!: (error: Error) => void
  private firstTarget?: DevtoolsTarget
  private currentTargetPort: number
  private currentReady = false
  private restartCount = 0
  private initialReadySettled = false
  private terminal = false
  private disposed = false
  private disposePromise?: Promise<void>
  private recoveryKillTimer?: ReturnType<typeof setTimeout>
  private recoveryGeneration?: number
  private terminalFailure?: LegacyBridgeError
  private generation = 0
  private messageSequence = 0

  constructor(options: LegacyBridgeOptions, dependencies: LegacyBridgeClientDependencies = {}) {
    this.options = {
      ...options,
      targetId: options.targetId ?? `node-network-devtools-${randomUUID()}`
    }
    this.currentTargetPort = options.targetPort
    this.forkProcess = dependencies.fork ?? (nodeFork as ForkProcess)
    this.childEntry = dependencies.childEntry ?? resolvePath(__dirname, './fork')
    this.baseExecArgv = dependencies.execArgv ?? process.execArgv
    this.baseEnv = dependencies.env ?? process.env
    this.maxRestarts = dependencies.maxRestarts ?? DEFAULT_MAX_RESTARTS
    this.queueLimit = Math.max(1, dependencies.queueLimit ?? DEFAULT_QUEUE_LIMIT)
    this.shutdownGraceMs = Math.max(0, dependencies.shutdownGraceMs ?? 1_000)
    this.shutdownForceMs = Math.max(this.shutdownGraceMs, dependencies.shutdownForceMs ?? 1_500)
    this.recoveryForceKillMs = Math.max(0, dependencies.recoveryForceKillMs ?? 500)
    this.ready = new Promise<DevtoolsTarget>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    void this.ready.catch(() => undefined)

    // Fork synchronously so `register(); request()` cannot race process setup.
    this.spawnChild()
  }

  onDiagnostic(listener: DiagnosticListener): () => void {
    this.diagnosticListeners.add(listener)
    for (const diagnostic of this.diagnosticHistory) listener(diagnostic)
    return () => this.diagnosticListeners.delete(listener)
  }

  onFailure(listener: FailureListener): () => void {
    this.failureListeners.add(listener)
    if (this.terminalFailure) {
      try {
        listener(this.terminalFailure)
      } catch {
        // Replayed failure listeners have the same isolation as live ones.
      }
    }
    return () => this.failureListeners.delete(listener)
  }

  async send(event: LegacyCaptureEvent): Promise<void> {
    if (this.disposed || this.terminal) return

    let message: LegacyParentMessage
    try {
      message = snapshot({ type: 'capture', event } satisfies LegacyParentMessage)
    } catch (error) {
      this.emitDiagnostic({
        code: 'NND_LEGACY_CAPTURE_SERIALIZATION_FAILED',
        level: 'error',
        message: `A Legacy capture event could not be serialized: ${errorMessage(error)}`,
        hint: 'Remove stream, socket, function, or other live transport objects from capture data.',
        details: { eventType: event.type }
      })
      return
    }

    const queuedMessage = { sequence: ++this.messageSequence, message }
    if (!this.currentReady || !this.child?.connected) {
      this.enqueue(queuedMessage)
      return
    }
    this.sendToChild(queuedMessage)
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    this.currentReady = false
    this.queue.length = 0
    if (this.recoveryKillTimer) {
      clearTimeout(this.recoveryKillTimer)
      this.recoveryKillTimer = undefined
    }
    this.recoveryGeneration = undefined

    if (!this.initialReadySettled) {
      this.initialReadySettled = true
      this.rejectReady(
        new LegacyBridgeError(
          'NND_LEGACY_DISPOSED',
          'The Legacy bridge was disposed before its target became ready.'
        )
      )
    }

    const child = this.child
    this.child = undefined
    this.disposePromise = child ? this.shutdownChild(child) : Promise.resolve()
    await this.disposePromise
    this.diagnosticListeners.clear()
    this.failureListeners.clear()
    this.diagnosticHistory.length = 0
  }

  private spawnChild(): void {
    if (this.disposed || this.terminal) return
    const generation = ++this.generation
    this.currentReady = false
    const childEnv = sanitizeLegacyEnvironment(this.baseEnv)
    childEnv[LEGACY_BRIDGE_OPTIONS_ENV] = JSON.stringify({
      ...this.options,
      targetPort: this.currentTargetPort
    } satisfies LegacyBridgeOptions)

    let child: ChildProcess
    try {
      child = this.forkProcess(this.childEntry, [], {
        env: childEnv,
        execArgv: sanitizeLegacyExecArgv(this.baseExecArgv),
        serialization: 'advanced',
        stdio: ['inherit', 'inherit', 'inherit', 'ipc']
      })
    } catch (error) {
      this.handleChildFailure(undefined, generation, { error: errorMessage(error) })
      return
    }

    this.child = child
    let failed = false
    const failOnce = (details: Readonly<Record<string, unknown>>) => {
      if (failed) return
      failed = true
      this.handleChildFailure(child, generation, details)
    }

    child.on('message', (message: unknown) => {
      if (generation !== this.generation || this.disposed || this.terminal) return
      this.handleChildMessage(child, generation, message)
    })
    child.once('error', (error) => {
      if (failed) return
      failed = true
      const details = { error: errorMessage(error) }
      if (child.pid === undefined) this.handleChildFailure(child, generation, details)
      else this.terminateChildThenHandleFailure(child, generation, details)
    })
    child.once('exit', (code, signal) => failOnce({ code, signal }))
  }

  private handleChildMessage(child: ChildProcess, generation: number, message: unknown): void {
    if (!message || typeof message !== 'object' || !('type' in message)) return
    const childMessage = message as LegacyChildMessage

    if (childMessage.type === 'diagnostic') {
      this.emitDiagnostic(childMessage.diagnostic)
      return
    }
    if (childMessage.type === 'disposed') return
    if (childMessage.type !== 'ready') return

    const target = childMessage.target
    if (this.firstTarget && !sameTargetEndpoint(this.firstTarget, target)) {
      this.emitDiagnostic({
        code: 'NND_LEGACY_TARGET_CHANGED',
        level: 'error',
        message: 'The recovered Legacy child reported a different DevTools target.',
        hint: 'Keep the original target port available while the Legacy session is active.',
        details: {
          expected: this.firstTarget.webSocketDebuggerUrl,
          actual: target.webSocketDebuggerUrl,
          restartCount: this.restartCount
        }
      })
      this.terminateChildThenHandleFailure(child, generation, { reason: 'target-changed' })
      return
    }

    const boundPort = targetPort(target)
    if (!boundPort) {
      this.terminateChildThenHandleFailure(child, generation, { reason: 'invalid-target-port' })
      return
    }

    if (!this.firstTarget) {
      this.firstTarget = target
      this.currentTargetPort = boundPort
      this.initialReadySettled = true
      this.resolveReady(target)
    } else if (this.restartCount > 0) {
      this.emitDiagnostic({
        code: 'NND_LEGACY_CHILD_RECOVERED',
        level: 'info',
        message: 'The Legacy backend recovered on its original DevTools target.',
        details: { restartCount: this.restartCount, target: target.webSocketDebuggerUrl }
      })
    }

    this.currentReady = true
    this.flushQueue()
    // The debugger backend is auxiliary: once its target is usable, neither
    // the child handle nor its IPC channel may keep an otherwise finite Node
    // application alive. The child observes the eventual IPC disconnect and
    // closes its target before exiting.
    child.unref()
    child.channel?.unref()
  }

  private handleChildFailure(
    child: ChildProcess | undefined,
    generation: number,
    details: Readonly<Record<string, unknown>>
  ): void {
    if (generation !== this.generation || this.disposed || this.terminal) return
    this.currentReady = false
    if (child) {
      child.removeAllListeners()
      if (child.connected) child.disconnect()
      if (!child.killed) child.kill()
    }
    if (this.child === child) this.child = undefined

    if (this.restartCount < this.maxRestarts) {
      this.restartCount += 1
      this.emitDiagnostic({
        code: 'NND_LEGACY_CHILD_RESTARTING',
        level: 'warn',
        message: 'The Legacy backend exited unexpectedly; restarting it.',
        hint: this.firstTarget
          ? 'The recovered child will bind the original DevTools target port.'
          : 'Capture events remain queued while the initial target starts.',
        details: {
          restartCount: this.restartCount,
          maxRestarts: this.maxRestarts,
          phase: this.firstTarget ? 'runtime' : 'startup',
          ...details
        }
      })
      this.spawnChild()
      return
    }

    this.terminal = true
    this.queue.length = 0
    const code = this.firstTarget
      ? 'NND_LEGACY_CHILD_RECOVERY_FAILED'
      : 'NND_LEGACY_CHILD_START_FAILED'
    const message = this.firstTarget
      ? `The Legacy backend could not be recovered after ${this.maxRestarts} restart attempts.`
      : `The Legacy backend could not start after ${this.maxRestarts} restart attempts.`
    const error = new LegacyBridgeError(code, message, {
      restartCount: this.restartCount,
      maxRestarts: this.maxRestarts,
      ...details
    })
    this.emitDiagnostic({
      code,
      level: 'error',
      message,
      hint: 'Inspect the child diagnostics and verify that the configured target port is available.',
      details: error.details
    })
    this.emitFailure(error)
    if (!this.initialReadySettled) {
      this.initialReadySettled = true
      this.rejectReady(error)
    }
  }

  private enqueue(queuedMessage: QueuedParentMessage): void {
    if (this.queue.some(({ sequence }) => sequence === queuedMessage.sequence)) return
    this.queue.push(queuedMessage)
    this.queue.sort((left, right) => left.sequence - right.sequence)
    const dropped = this.queue.length > this.queueLimit ? this.queue.pop() : undefined
    if (dropped) {
      const { message } = dropped
      this.emitDiagnostic({
        code: 'NND_LEGACY_CAPTURE_QUEUE_FULL',
        level: 'warn',
        message: `The Legacy startup queue reached its ${this.queueLimit}-event limit.`,
        hint: 'Wait for the Legacy target to become ready before producing additional traffic.',
        details: {
          queueLimit: this.queueLimit,
          droppedEventType: message.type === 'capture' ? message.event.type : message.type
        }
      })
    }
  }

  private flushQueue(): void {
    while (this.currentReady && this.child?.connected && this.queue.length > 0) {
      const queuedMessage = this.queue.shift()!
      this.sendToChild(queuedMessage)
    }
  }

  private sendToChild(queuedMessage: QueuedParentMessage): void {
    const child = this.child
    if (!child || !child.connected) {
      this.enqueue(queuedMessage)
      return
    }
    const generation = this.generation
    let failed = false
    const fail = (error: unknown, source: 'send-callback' | 'send-throw') => {
      if (failed || this.disposed || this.terminal) return
      failed = true
      this.enqueue(queuedMessage)
      if (generation === this.generation && child === this.child) {
        this.terminateChildThenHandleFailure(child, generation, {
          error: errorMessage(error),
          source
        })
      } else if (this.currentReady) {
        this.flushQueue()
      }
    }
    try {
      child.send(queuedMessage.message, (error) => {
        if (error) fail(error, 'send-callback')
      })
    } catch (error) {
      fail(error, 'send-throw')
    }
  }

  /** Wait for the old process to exit before rebinding its target port. */
  private terminateChildThenHandleFailure(
    child: ChildProcess,
    generation: number,
    details: Readonly<Record<string, unknown>>
  ): void {
    if (generation !== this.generation || this.disposed || this.terminal) return
    if (this.recoveryGeneration === generation) return
    this.recoveryGeneration = generation
    this.currentReady = false
    child.removeAllListeners()
    let completed = false
    const complete = () => {
      if (completed) return
      completed = true
      if (this.recoveryKillTimer) {
        clearTimeout(this.recoveryKillTimer)
        this.recoveryKillTimer = undefined
      }
      if (this.recoveryGeneration === generation) this.recoveryGeneration = undefined
      this.handleChildFailure(child, generation, details)
    }
    child.once('exit', complete)

    if (child.exitCode !== null && child.exitCode !== undefined) {
      complete()
      return
    }
    if (child.connected) child.disconnect()
    try {
      child.kill('SIGTERM')
    } catch {
      // The exit listener remains authoritative if signalling races exit.
    }
    if (completed) return
    this.recoveryKillTimer = setTimeout(() => {
      if (!completed) child.kill('SIGKILL')
    }, this.recoveryForceKillMs)
    this.recoveryKillTimer.unref?.()
  }

  private shutdownChild(child: ChildProcess): Promise<void> {
    // A caller explicitly awaiting dispose expects the acknowledgement/exit
    // handshake to complete. Restore both references in case readiness
    // detached them from the event loop.
    child.ref()
    if (child.connected) child.channel?.ref()

    if (!child.connected && (child.exitCode != null || child.signalCode != null)) {
      child.removeAllListeners()
      return Promise.resolve()
    }

    return new Promise<void>((resolve) => {
      let settled = false
      let graceTimer: ReturnType<typeof setTimeout> | undefined
      let forceTimer: ReturnType<typeof setTimeout> | undefined

      const finish = () => {
        if (settled) return
        settled = true
        if (graceTimer) clearTimeout(graceTimer)
        if (forceTimer) clearTimeout(forceTimer)
        child.removeAllListeners()
        if (child.connected) child.disconnect()
        resolve()
      }
      const onMessage = (message: unknown) => {
        if (
          message &&
          typeof message === 'object' &&
          'type' in message &&
          (message as LegacyChildMessage).type === 'disposed'
        ) {
          // The host acknowledges only after RequestCenter.close(), so its
          // target port is already closed. Still wait for the actual exit;
          // existing grace/force timers prevent an acknowledged orphan.
          if (child.connected) child.disconnect()
        }
      }

      child.on('message', onMessage)
      child.once('exit', finish)

      try {
        if (child.connected) child.send({ type: 'dispose' } satisfies LegacyParentMessage)
      } catch {
        child.kill('SIGTERM')
      }

      if (settled) return
      graceTimer = setTimeout(() => {
        if (!settled) child.kill('SIGTERM')
      }, this.shutdownGraceMs)
      forceTimer = setTimeout(() => {
        if (!settled) child.kill('SIGKILL')
      }, this.shutdownForceMs)
      graceTimer.unref?.()
      forceTimer.unref?.()
    })
  }

  private emitDiagnostic(diagnostic: Diagnostic): void {
    this.diagnosticHistory.push(diagnostic)
    if (this.diagnosticHistory.length > DIAGNOSTIC_HISTORY_LIMIT) this.diagnosticHistory.shift()
    for (const listener of this.diagnosticListeners) {
      try {
        listener(diagnostic)
      } catch {
        // A consumer diagnostic callback must never destabilize capture.
      }
    }
  }

  private emitFailure(error: LegacyBridgeError): void {
    if (this.terminalFailure) return
    this.terminalFailure = error
    for (const listener of this.failureListeners) {
      try {
        listener(error)
      } catch {
        // A consumer failure callback must never destabilize teardown.
      }
    }
  }
}

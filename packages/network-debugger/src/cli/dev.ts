import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import * as nodeInspector from 'node:inspector'
import type { Writable } from 'node:stream'
import { discoverInspectorTarget } from '../adapters/node-native'
import {
  NATIVE_NETWORK_INSPECTION_FLAG,
  getNativeCapabilities,
  hasRequiredNativeMethods,
  isNativeAutoBaseline,
  parseNodeVersion,
  supportsNativeNetworkInspection,
  type NativeNetworkApi
} from '../adapters/node-native/capability'
import { NND_PRELOAD_CONFIG_ENV, serializePreloadConfig, type ResolvedNndConfig } from '../config'
import type { DevtoolsTarget } from '../adapters/types'
import { NND_PRELOAD_REPORT_ENV, NND_READY_PREFIX } from '../preload'
import { openDevtoolsTarget } from '../target/frontend-launcher'
import { NndCliError, formatCliError } from './errors'

export interface DevCommand {
  executable: string
  args: readonly string[]
  cwd: string
  env: NodeJS.ProcessEnv
  open: boolean
  wait: boolean
}

export interface BuildDevCommandOptions {
  entry: string
  applicationArgs?: readonly string[]
  config: ResolvedNndConfig
  cwd?: string
  env?: NodeJS.ProcessEnv
  execPath?: string
  preloadUrl?: string
  nodeVersion?: string
  inspectorNetwork?: NativeNetworkApi
  inspectorAvailable?: boolean
}

export function defaultPreloadUrl(moduleUrl: string = import.meta.url): string {
  return new URL('./register.mjs', moduleUrl).href
}

export function shouldLaunchInspector(
  config: ResolvedNndConfig,
  options: Pick<
    BuildDevCommandOptions,
    'nodeVersion' | 'inspectorNetwork' | 'inspectorAvailable'
  > = {}
): boolean {
  if (config.mode === 'legacy') return false
  if (config.mode === 'native') return true

  const version = parseNodeVersion(options.nodeVersion ?? process.versions.node)
  if (!isNativeAutoBaseline(version)) return false
  const inspectorAvailable = options.inspectorAvailable ?? process.features?.inspector !== false
  if (!inspectorAvailable) return false
  const network =
    options.inspectorNetwork ?? (nodeInspector as unknown as { Network?: NativeNetworkApi }).Network
  if (!hasRequiredNativeMethods(network)) return false
  const capabilities = getNativeCapabilities(version, network)
  return config.requiredCapabilities.every((capability) => capabilities[capability])
}

export function buildDevCommand(options: BuildDevCommandOptions): DevCommand {
  const { config } = options
  const nodeVersionText = options.nodeVersion ?? process.versions.node
  if (
    config.mode === 'native' &&
    !supportsNativeNetworkInspection(parseNodeVersion(nodeVersionText))
  ) {
    throw new NndCliError(
      'NND_CLI_NATIVE_UNSUPPORTED',
      `Node.js ${nodeVersionText} does not support ${NATIVE_NETWORK_INSPECTION_FLAG}. Upgrade to Node.js 20.18+, 22.6+, or a newer release, or use --mode auto/legacy.`,
      {
        nodeVersion: nodeVersionText,
        flag: NATIVE_NETWORK_INSPECTION_FLAG,
        supportedBaselines: ['20.18+', '22.6+', '23+']
      }
    )
  }
  const inspectorAddress = `${config.inspector.host}:${config.inspector.port}`
  const usesInspector = shouldLaunchInspector(config, options)
  const args = usesInspector
    ? [
        NATIVE_NETWORK_INSPECTION_FLAG,
        `${config.wait ? '--inspect-wait' : '--inspect'}=${inspectorAddress}`
      ]
    : []

  if (config.watch) args.push('--watch')
  args.push(`--import=${options.preloadUrl ?? defaultPreloadUrl()}`)
  if (config.runner === 'tsx') args.push('--import=tsx')
  args.push(options.entry, ...(options.applicationArgs ?? []))

  return {
    executable: options.execPath ?? process.execPath,
    args,
    cwd: options.cwd ?? process.cwd(),
    env: {
      ...(options.env ?? process.env),
      [NND_PRELOAD_CONFIG_ENV]: serializePreloadConfig(config),
      [NND_PRELOAD_REPORT_ENV]: '1'
    },
    open: config.open,
    wait: usesInspector && config.wait
  }
}

type SupportedSignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP'

const SIGNAL_EXIT_CODES: Readonly<Record<SupportedSignal, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129
}

export interface SignalSource {
  on(event: SupportedSignal, listener: () => void): unknown
  off(event: SupportedSignal, listener: () => void): unknown
}

export interface RunDevDependencies {
  spawn?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess
  stderr?: Pick<Writable, 'write'>
  signals?: SignalSource
  openInspector?: (inspectorUrl: string) => Promise<void>
  openTarget?: (target: DevtoolsTarget) => Promise<void>
}

async function defaultOpenInspector(inspectorUrl: string): Promise<void> {
  const target = await discoverInspectorTarget(inspectorUrl)
  await openDevtoolsTarget(target)
}

/** Extracts complete Inspector WebSocket URLs even when stderr arrives in chunks. */
export class InspectorUrlParser {
  private pending = ''
  private emitted = new Set<string>()

  push(chunk: string): readonly string[] {
    this.pending = `${this.pending}${chunk}`.slice(-8192)
    const lastNewline = this.pending.lastIndexOf('\n')
    if (lastNewline < 0) return []
    const complete = this.pending.slice(0, lastNewline + 1)
    this.pending = this.pending.slice(lastNewline + 1)
    const found = complete
      .split(/\r?\n/)
      .filter((line) => line.includes('Debugger listening on '))
      .flatMap((line) => line.match(/ws:\/\/[^\s]+/g) ?? [])
    const fresh = found
      .map((url) => url.replace(/[),.;]+$/, ''))
      .filter((url) => {
        if (this.emitted.has(url)) return false
        this.emitted.add(url)
        return true
      })
    return fresh
  }
}

export interface NndReadyMessage {
  mode: 'native' | 'legacy'
  target: DevtoolsTarget
  capabilities: Readonly<Record<string, boolean>>
  fallbackReason?: unknown
}

export class ReadyMessageParser {
  private pending = ''

  push(chunk: string): readonly NndReadyMessage[] {
    this.pending = `${this.pending}${chunk}`.slice(-65_536)
    const lastNewline = this.pending.lastIndexOf('\n')
    if (lastNewline < 0) return []
    const lines = this.pending.slice(0, lastNewline + 1).split(/\r?\n/)
    this.pending = this.pending.slice(lastNewline + 1)
    const messages: NndReadyMessage[] = []
    for (const line of lines) {
      const index = line.indexOf(NND_READY_PREFIX)
      if (index < 0) continue
      try {
        const value = JSON.parse(line.slice(index + NND_READY_PREFIX.length)) as NndReadyMessage
        if (
          (value.mode === 'native' || value.mode === 'legacy') &&
          value.target &&
          typeof value.target.webSocketDebuggerUrl === 'string' &&
          value.capabilities &&
          typeof value.capabilities === 'object'
        ) {
          messages.push(value)
        }
      } catch {
        // The original stderr line remains visible; malformed status data must
        // not crash or hide the child process.
      }
    }
    return messages
  }
}

export function runDevCommand(
  command: DevCommand,
  dependencies: RunDevDependencies = {}
): Promise<number> {
  const spawn = dependencies.spawn ?? nodeSpawn
  const stderr = dependencies.stderr ?? process.stderr
  const signals = dependencies.signals ?? process
  const openInspector = dependencies.openInspector ?? defaultOpenInspector
  const openTarget = dependencies.openTarget ?? openDevtoolsTarget
  if (command.wait && !command.open) {
    stderr.write(
      '[nnd:NND_WAITING_FOR_FRONTEND] Application entry is paused; attach to the Inspector URL or rerun with --open/--no-wait.\n'
    )
  }
  let child: ChildProcess

  try {
    child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: command.env,
      stdio: ['inherit', 'inherit', 'pipe']
    })
  } catch (error) {
    return Promise.reject(
      new NndCliError(
        'NND_CLI_SPAWN_FAILED',
        `Unable to start ${command.executable}.`,
        { executable: command.executable },
        error
      )
    )
  }

  return new Promise<number>((resolvePromise, rejectPromise) => {
    const urlParser = new InspectorUrlParser()
    const readyParser = new ReadyMessageParser()
    let requestedSignal: SupportedSignal | undefined
    let frontendError = false
    let settled = false
    const openedTargets = new Set<string>()

    const signalListeners = new Map<SupportedSignal, () => void>()
    const cleanup = () => {
      for (const [signal, listener] of signalListeners) signals.off(signal, listener)
      signalListeners.clear()
    }
    const settle = (action: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      action()
    }

    for (const signal of Object.keys(SIGNAL_EXIT_CODES) as SupportedSignal[]) {
      const listener = () => {
        requestedSignal = signal
        child.kill(signal)
      }
      signalListeners.set(signal, listener)
      signals.on(signal, listener)
    }

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString()
      stderr.write(text)
      const inspectorUrls = urlParser.push(text)
      const readyMessages = readyParser.push(text)
      if (!command.open) return

      const open = (key: string, action: () => Promise<void>) => {
        if (openedTargets.has(key)) return
        openedTargets.add(key)
        void action().catch((error) => {
          frontendError = true
          stderr.write(
            `${formatCliError(
              new NndCliError(
                'NND_CLI_FRONTEND_OPEN_FAILED',
                `Unable to open DevTools for ${key}.`,
                { target: key },
                error
              )
            )}\n`
          )
          child.kill('SIGTERM')
        })
      }

      // A waiting Native/Auto process must first be attached so preload can
      // execute. No-wait and Legacy modes wait for the authoritative ready target.
      if (command.wait) {
        for (const inspectorUrl of inspectorUrls) {
          open(inspectorUrl, () => openInspector(inspectorUrl))
        }
      }
      for (const ready of readyMessages) {
        open(ready.target.webSocketDebuggerUrl, () => openTarget(ready.target))
      }
    })

    child.once('error', (error) => {
      settle(() =>
        rejectPromise(
          new NndCliError(
            'NND_CLI_SPAWN_FAILED',
            `Unable to start ${command.executable}: ${error.message}`,
            { executable: command.executable },
            error
          )
        )
      )
    })
    child.once('exit', (code, signal) => {
      settle(() => {
        if (frontendError) return resolvePromise(1)
        if (typeof code === 'number') return resolvePromise(code)
        if (requestedSignal) return resolvePromise(SIGNAL_EXIT_CODES[requestedSignal])
        if (signal && signal in SIGNAL_EXIT_CODES) {
          return resolvePromise(SIGNAL_EXIT_CODES[signal as SupportedSignal])
        }
        return resolvePromise(1)
      })
    })
  })
}

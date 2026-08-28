import type { AdapterMode, NetworkCapability } from '../adapters/types'
import { NETWORK_CAPABILITIES } from '../adapters/types'
import type { NndConfig, NndRunner } from '../config'
import { NndCliError } from './errors'

export interface DevInvocation {
  command: 'dev'
  entry: string
  applicationArgs: readonly string[]
  config: NndConfig
  configFile?: string
}

export interface DoctorInvocation {
  command: 'doctor'
  json: boolean
  probeWaitMs: number
  config: NndConfig
  configFile?: string
}

export interface ReplayInvocation {
  command: 'replay'
  source: string
  dryRun: boolean
  stopOnError: boolean
  timeoutMs?: number
  json: boolean
}

export type CliInvocation =
  | DevInvocation
  | DoctorInvocation
  | ReplayInvocation
  | { command: 'help' }
  | { command: 'version' }

const MODES = new Set<AdapterMode>(['auto', 'native', 'legacy'])
const RUNNERS = new Set<NndRunner>(['node', 'tsx'])
const CAPABILITIES = new Set<string>(NETWORK_CAPABILITIES)

interface ParsedOption {
  name: string
  inlineValue?: string
}

function splitOption(argument: string): ParsedOption {
  const equals = argument.indexOf('=')
  if (equals === -1) return { name: argument }
  return { name: argument.slice(0, equals), inlineValue: argument.slice(equals + 1) }
}

function requiredValue(
  option: ParsedOption,
  args: readonly string[],
  index: number
): { value: string; consumed: number } {
  if (option.inlineValue !== undefined) {
    if (!option.inlineValue) {
      throw new NndCliError('NND_CLI_USAGE', `${option.name} requires a value.`)
    }
    return { value: option.inlineValue, consumed: 0 }
  }
  const value = args[index + 1]
  if (value === undefined || value === '--') {
    throw new NndCliError('NND_CLI_USAGE', `${option.name} requires a value.`)
  }
  return { value, consumed: 1 }
}

function parseNonNegativeInteger(value: string, option: string, maximum?: number): number {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0 || (maximum !== undefined && number > maximum)) {
    throw new NndCliError(
      'NND_CLI_INVALID_OPTION',
      `${option} must be an integer from 0${maximum === undefined ? '' : ` to ${maximum}`}.`,
      { option, value }
    )
  }
  return number
}

interface CommonParseState {
  config: NndConfig
  configFile?: string
}

function applyCommonOption(
  option: ParsedOption,
  args: readonly string[],
  index: number,
  state: CommonParseState
): number | undefined {
  switch (option.name) {
    case '--open':
      state.config.open = true
      return 0
    case '--no-open':
      state.config.open = false
      return 0
    case '--wait':
      state.config.wait = true
      return 0
    case '--no-wait':
      state.config.wait = false
      return 0
    case '--watch':
      state.config.watch = true
      return 0
    case '--no-watch':
      state.config.watch = false
      return 0
    case '--runner': {
      const parsed = requiredValue(option, args, index)
      if (!RUNNERS.has(parsed.value as NndRunner)) {
        throw new NndCliError('NND_CLI_INVALID_OPTION', '--runner must be node or tsx.', {
          value: parsed.value
        })
      }
      state.config.runner = parsed.value as NndRunner
      return parsed.consumed
    }
    case '--mode': {
      const parsed = requiredValue(option, args, index)
      if (!MODES.has(parsed.value as AdapterMode)) {
        throw new NndCliError('NND_CLI_INVALID_OPTION', '--mode must be auto, native, or legacy.', {
          value: parsed.value
        })
      }
      state.config.mode = parsed.value as AdapterMode
      return parsed.consumed
    }
    case '--config': {
      const parsed = requiredValue(option, args, index)
      state.configFile = parsed.value
      return parsed.consumed
    }
    case '--inspect-host': {
      const parsed = requiredValue(option, args, index)
      if (!parsed.value) {
        throw new NndCliError('NND_CLI_INVALID_OPTION', '--inspect-host cannot be empty.')
      }
      state.config.inspector = { ...state.config.inspector, host: parsed.value }
      return parsed.consumed
    }
    case '--inspect-port': {
      const parsed = requiredValue(option, args, index)
      state.config.inspector = {
        ...state.config.inspector,
        port: parseNonNegativeInteger(parsed.value, '--inspect-port', 65_535)
      }
      return parsed.consumed
    }
    case '--require':
    case '--required-capability': {
      const parsed = requiredValue(option, args, index)
      if (!CAPABILITIES.has(parsed.value)) {
        throw new NndCliError(
          'NND_CLI_INVALID_OPTION',
          `Unknown network capability: ${parsed.value}.`,
          { value: parsed.value, allowed: [...NETWORK_CAPABILITIES] }
        )
      }
      state.config.requiredCapabilities = [
        ...(state.config.requiredCapabilities ?? []),
        parsed.value as NetworkCapability
      ]
      return parsed.consumed
    }
    default:
      return undefined
  }
}

function parseDev(args: readonly string[]): DevInvocation {
  const state: CommonParseState = { config: {} }
  let entry: string | undefined
  let applicationArgs: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') {
      if (!entry) {
        entry = args[index + 1]
        if (!entry) break
        applicationArgs = args.slice(index + 2)
      } else {
        applicationArgs = args.slice(index + 1)
      }
      break
    }

    if (!entry && argument.startsWith('-')) {
      if (argument === '-h' || argument === '--help') {
        throw new NndCliError('NND_CLI_USAGE', 'Use `nnd help` for usage.')
      }
      const option = splitOption(argument)
      const consumed = applyCommonOption(option, args, index, state)
      if (consumed === undefined) {
        throw new NndCliError('NND_CLI_INVALID_OPTION', `Unknown option: ${option.name}.`, {
          option: option.name
        })
      }
      index += consumed
      continue
    }

    if (!entry) {
      entry = argument
    } else {
      applicationArgs = args.slice(index)
      break
    }
  }

  if (!entry) {
    throw new NndCliError('NND_CLI_USAGE', 'nnd dev requires an entry file.')
  }

  return {
    command: 'dev',
    entry,
    applicationArgs,
    config: state.config,
    ...(state.configFile ? { configFile: state.configFile } : {})
  }
}

function parseDoctor(args: readonly string[]): DoctorInvocation {
  const state: CommonParseState = { config: {} }
  let json = false
  let probeWaitMs = 0

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    const option = splitOption(argument)
    if (option.name === '--json') {
      if (option.inlineValue !== undefined) {
        throw new NndCliError('NND_CLI_INVALID_OPTION', '--json does not accept a value.')
      }
      json = true
      continue
    }
    if (option.name === '--probe-wait') {
      const parsed = requiredValue(option, args, index)
      probeWaitMs = parseNonNegativeInteger(parsed.value, '--probe-wait', 60_000)
      index += parsed.consumed
      continue
    }

    const consumed = applyCommonOption(option, args, index, state)
    if (consumed === undefined) {
      throw new NndCliError('NND_CLI_INVALID_OPTION', `Unknown doctor option: ${option.name}.`, {
        option: option.name
      })
    }
    index += consumed
  }

  return {
    command: 'doctor',
    json,
    probeWaitMs,
    config: state.config,
    ...(state.configFile ? { configFile: state.configFile } : {})
  }
}

function parseReplay(args: readonly string[]): ReplayInvocation {
  let source: string | undefined
  let dryRun = false
  let stopOnError = false
  let timeoutMs: number | undefined
  let json = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!source && argument.startsWith('-')) {
      const option = splitOption(argument)
      if (option.name === '--dry-run') {
        if (option.inlineValue !== undefined) {
          throw new NndCliError('NND_CLI_INVALID_OPTION', '--dry-run does not accept a value.')
        }
        dryRun = true
        continue
      }
      if (option.name === '--stop-on-error') {
        if (option.inlineValue !== undefined) {
          throw new NndCliError(
            'NND_CLI_INVALID_OPTION',
            '--stop-on-error does not accept a value.'
          )
        }
        stopOnError = true
        continue
      }
      if (option.name === '--json') {
        if (option.inlineValue !== undefined) {
          throw new NndCliError('NND_CLI_INVALID_OPTION', '--json does not accept a value.')
        }
        json = true
        continue
      }
      if (option.name === '--timeout') {
        const parsed = requiredValue(option, args, index)
        timeoutMs = parseNonNegativeInteger(parsed.value, '--timeout', 3_600_000)
        if (timeoutMs === 0) {
          throw new NndCliError('NND_CLI_INVALID_OPTION', '--timeout must be greater than zero.')
        }
        index += parsed.consumed
        continue
      }
      throw new NndCliError('NND_CLI_INVALID_OPTION', `Unknown replay option: ${option.name}.`, {
        option: option.name
      })
    }
    if (source) {
      throw new NndCliError('NND_CLI_USAGE', 'nnd replay accepts exactly one source path.')
    }
    source = argument
  }

  if (!source) {
    throw new NndCliError('NND_CLI_USAGE', 'nnd replay requires a Session directory or HAR file.')
  }
  return {
    command: 'replay',
    source,
    dryRun,
    stopOnError,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    json
  }
}

export function parseCliArgs(args: readonly string[]): CliInvocation {
  const [command, ...rest] = args
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    return { command: 'help' }
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    return { command: 'version' }
  }
  if (command === 'dev') return parseDev(rest)
  if (command === 'doctor') return parseDoctor(rest)
  if (command === 'replay') return parseReplay(rest)
  throw new NndCliError('NND_CLI_USAGE', `Unknown command: ${command}.`, { command })
}

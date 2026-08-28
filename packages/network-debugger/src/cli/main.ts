import type { Writable } from 'node:stream'
import { resolve } from 'node:path'
import { resolveConfig } from '../config'
import { detectPackageVersion, formatDoctorReport, runDoctor } from '../diagnostics'
import { replay } from '../replay'
import { parseCliArgs } from './args'
import { buildDevCommand, runDevCommand, type RunDevDependencies } from './dev'
import { formatCliError } from './errors'
import { CLI_HELP } from './help'

export interface RunCliOptions extends RunDevDependencies {
  cwd?: string
  env?: NodeJS.ProcessEnv
  execPath?: string
  /** Dependency override used by compatibility checks and tests. */
  nodeVersion?: string
  preloadUrl?: string
  stdout?: Pick<Writable, 'write'>
  packageVersion?: string
}

export async function runCli(
  args: readonly string[],
  options: RunCliOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr

  try {
    const invocation = parseCliArgs(args)
    if (invocation.command === 'help') {
      stdout.write(CLI_HELP)
      return 0
    }
    if (invocation.command === 'version') {
      stdout.write(`${options.packageVersion ?? detectPackageVersion()}\n`)
      return 0
    }
    if (invocation.command === 'doctor') {
      const report = await runDoctor({
        cwd: options.cwd,
        env: options.env,
        config: invocation.config,
        configFile: invocation.configFile,
        probeWaitMs: invocation.probeWaitMs,
        packageVersion: options.packageVersion
      })
      stdout.write(formatDoctorReport(report, invocation.json))
      return report.ok ? 0 : 1
    }
    if (invocation.command === 'replay') {
      const report = await replay(resolve(options.cwd ?? process.cwd(), invocation.source), {
        dryRun: invocation.dryRun,
        stopOnError: invocation.stopOnError,
        timeoutMs: invocation.timeoutMs
      })
      if (invocation.json) {
        stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      } else {
        stdout.write(
          `${invocation.dryRun ? 'Planned' : 'Replayed'} ${report.results.length} request(s): ${report.succeeded} succeeded, ${report.failed} failed.\n`
        )
        for (const result of report.results) {
          const outcome = result.ok
            ? (result.status ?? 'ready')
            : (result.error ?? result.status ?? 'failed')
          stdout.write(`${result.request.method} ${result.request.url} -> ${outcome}\n`)
        }
      }
      return report.failed === 0 ? 0 : 1
    }

    const resolution = await resolveConfig({
      cwd: options.cwd,
      env: options.env,
      cli: invocation.config,
      configFile: invocation.configFile
    })
    const command = buildDevCommand({
      entry: invocation.entry,
      applicationArgs: invocation.applicationArgs,
      config: resolution.config,
      cwd: options.cwd,
      env: options.env,
      execPath: options.execPath,
      nodeVersion: options.nodeVersion,
      preloadUrl: options.preloadUrl
    })
    return await runDevCommand(command, {
      spawn: options.spawn,
      stderr,
      signals: options.signals,
      openInspector: options.openInspector,
      openTarget: options.openTarget
    })
  } catch (error) {
    stderr.write(`${formatCliError(error)}\n`)
    return 1
  }
}

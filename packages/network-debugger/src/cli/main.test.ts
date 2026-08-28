import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli } from './main'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function output() {
  let value = ''
  return {
    stream: { write: vi.fn((chunk: unknown) => ((value += String(chunk)), true)) },
    value: () => value
  }
}

describe('runCli', () => {
  it('prints help and package version without spawning', async () => {
    const stdout = output()
    await expect(runCli([], { stdout: stdout.stream, stderr: output().stream })).resolves.toBe(0)
    expect(stdout.value()).toContain('nnd dev [options] <entry>')

    const version = output()
    await expect(
      runCli(['--version'], {
        stdout: version.stream,
        stderr: output().stream,
        packageVersion: '9.8.7'
      })
    ).resolves.toBe(0)
    expect(version.value()).toBe('9.8.7\n')
  })

  it('prints a machine-readable doctor report', async () => {
    const stdout = output()
    const exitCode = await runCli(['doctor', '--json', '--mode', 'legacy'], {
      stdout: stdout.stream,
      stderr: output().stream,
      cwd: process.cwd(),
      env: {},
      packageVersion: '1.0.30'
    })
    const report = JSON.parse(stdout.value()) as {
      schemaVersion: number
      ok: boolean
      selection: { selected: string }
    }
    expect(exitCode).toBe(0)
    expect(report).toMatchObject({
      schemaVersion: 1,
      ok: true,
      selection: { selected: 'legacy' }
    })
  })

  it('prints a machine-readable replay dry-run without network I/O', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'nnd-cli-replay-'))
    temporaryDirectories.push(cwd)
    const harPath = join(cwd, 'fixture.har')
    writeFileSync(
      harPath,
      JSON.stringify({
        log: {
          version: '1.2',
          creator: { name: 'fixture', version: '1' },
          pages: [],
          entries: [
            {
              request: {
                method: 'GET',
                url: 'http://127.0.0.1:9/never-opened',
                headers: [],
                queryString: [],
                cookies: [],
                headersSize: -1,
                bodySize: 0
              },
              response: {},
              cache: {},
              timings: {},
              _requestId: 'dry-run'
            }
          ]
        }
      })
    )
    const stdout = output()

    await expect(
      runCli(['replay', '--dry-run', '--json', 'fixture.har'], {
        cwd,
        stdout: stdout.stream,
        stderr: output().stream
      })
    ).resolves.toBe(0)
    expect(JSON.parse(stdout.value())).toMatchObject({
      dryRun: true,
      succeeded: 1,
      failed: 0,
      requests: [{ requestId: 'dry-run', method: 'GET' }]
    })
  })

  it('resolves config and launches the built dev command', async () => {
    const child = new EventEmitter() as ChildProcess
    Object.assign(child, { stderr: new PassThrough(), kill: vi.fn(() => true) })
    const spawn = vi.fn(() => {
      queueMicrotask(() => child.emit('exit', 7, null))
      return child
    })
    const stderr = output()
    const exitCode = await runCli(
      ['dev', '--mode', 'native', '--no-wait', '--runner', 'tsx', 'app.ts', '--', '--port', '3'],
      {
        cwd: '/project',
        env: {},
        execPath: '/node',
        nodeVersion: '24.7.0',
        preloadUrl: 'file:///dist/register.mjs',
        spawn,
        signals: new EventEmitter(),
        stdout: output().stream,
        stderr: stderr.stream
      }
    )

    expect(exitCode).toBe(7)
    expect(spawn).toHaveBeenCalledWith(
      '/node',
      [
        '--experimental-network-inspection',
        '--inspect=127.0.0.1:0',
        '--import=file:///dist/register.mjs',
        '--import=tsx',
        'app.ts',
        '--port',
        '3'
      ],
      expect.objectContaining({ cwd: '/project' })
    )
  })

  it('formats parser failures with stable codes', async () => {
    const stderr = output()
    await expect(runCli(['wat'], { stderr: stderr.stream, stdout: output().stream })).resolves.toBe(
      1
    )
    expect(stderr.value()).toContain('[nnd:NND_CLI_USAGE]')
  })

  it('does not spawn forced Native on a runtime that cannot parse its flag', async () => {
    const stderr = output()
    const spawn = vi.fn()
    const exitCode = await runCli(['dev', '--mode', 'native', 'app.js'], {
      cwd: '/project',
      env: {},
      nodeVersion: '18.20.8',
      spawn,
      stdout: output().stream,
      stderr: stderr.stream
    })

    expect(exitCode).toBe(1)
    expect(spawn).not.toHaveBeenCalled()
    expect(stderr.value()).toContain('[nnd:NND_CLI_NATIVE_UNSUPPORTED]')
    expect(stderr.value()).toContain('Node.js 18.20.8')
  })
})

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  FIXTURES_DIR,
  PACKAGE_DIR,
  REGISTER_PATH,
  assertCliBuildExists,
  atomicReplace,
  cleanCliEnvironment,
  runCli,
  startCli,
  temporaryFixtureCopy,
  waitForProcessGone
} from './harness.mjs'

const TEST_TIMEOUT_MS = 30_000
const CJS_FIXTURE = resolve(FIXTURES_DIR, 'probe.cjs')
const ESM_FIXTURE = resolve(FIXTURES_DIR, 'probe.mjs')
const TS_FIXTURE = resolve(FIXTURES_DIR, 'probe.ts')
const WATCH_FIXTURE = resolve(FIXTURES_DIR, 'watch-entry.mjs')
const NEST_FIXTURE = resolve(FIXTURES_DIR, 'nest-app/dist/main.cjs')
const FRONTEND_OPEN_HOOK = resolve(FIXTURES_DIR, 'frontend-open-hook.cjs')
const FRONTEND_CDP_RUNNER = resolve(FIXTURES_DIR, 'frontend-cdp-runner.mjs')
const FINITE_LEGACY_FIXTURE = resolve(FIXTURES_DIR, 'finite-legacy.cjs')
const WATCH_SUPERVISOR_SETTLE_MS = 500

function importedModules(execArgv) {
  const modules = []
  for (let index = 0; index < execArgv.length; index += 1) {
    const argument = execArgv[index]
    if (argument === '--import' && execArgv[index + 1]) {
      modules.push(execArgv[index + 1])
      index += 1
    } else if (argument.startsWith('--import=')) {
      modules.push(argument.slice('--import='.length))
    }
  }
  return modules
}

function importMatchesPath(specifier, expectedPath) {
  if (specifier.startsWith('file:')) return fileURLToPath(specifier) === expectedPath
  return resolve(specifier) === expectedPath
}

function assertNativeFixture(record, { label, argv = [] } = {}) {
  assert.equal(record.type, 'fixture-ready')
  assert.equal(record.label, label)
  assert.equal(record.preloadInjected, true)
  assert.equal(record.mode, 'native')
  assert.deepEqual(record.argv, argv)
  assert.ok(Number.isInteger(record.pid) && record.pid > 0)
  assert.ok(Number.isInteger(record.ppid) && record.ppid > 0)

  assert.ok(
    record.execArgv.includes('--experimental-network-inspection'),
    `missing experimental network flag in ${JSON.stringify(record.execArgv)}`
  )
  assert.ok(
    record.execArgv.some((argument) => argument === '--inspect=127.0.0.1:0'),
    `missing ephemeral Inspector flag in ${JSON.stringify(record.execArgv)}`
  )
  assert.equal(
    record.execArgv.some((argument) => argument.startsWith('--inspect-wait')),
    false,
    '--no-wait must not inject --inspect-wait'
  )

  const imports = importedModules(record.execArgv)
  assert.ok(
    imports.some((specifier) => importMatchesPath(specifier, REGISTER_PATH)),
    `missing dist/register.mjs preload in ${JSON.stringify(imports)}`
  )
  assert.equal(record.capabilities.http, true)
  assert.equal(record.capabilities.https, true)
  assert.equal(record.capabilities.fetch, true)
  assert.equal(record.fallbackReason, null)
  assert.match(record.target.webSocketDebuggerUrl, /^ws:\/\/127\.0\.0\.1:\d+\//)
  assert.match(record.target.discoveryUrl, /^http:\/\/127\.0\.0\.1:\d+\/json\/list$/)
}

function assertNormalExit(result, code = 0) {
  assert.equal(result.code, code, `unexpected stderr:\n${result.stderr}`)
  assert.equal(result.signal, null)
}

function parseReadyReport(stderr) {
  const prefix = '[nnd:ready] '
  const line = stderr.split(/\r?\n/).find((candidate) => candidate.includes(prefix))
  assert.ok(line, `missing preload readiness report:\n${stderr}`)
  return JSON.parse(line.slice(line.indexOf(prefix) + prefix.length))
}

async function waitForEndpointClosed(url, { timeoutMs = 5_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) })
      await response.arrayBuffer()
    } catch {
      return
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
  throw new Error(`Legacy target remained reachable after its application exited: ${url}`)
}

function runPreloadedNode(execArgv, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, execArgv, {
      cwd: PACKAGE_DIR,
      env: cleanCliEnvironment({
        NND_MODE: 'legacy',
        NND_LEGACY_SERVER_PORT: '0',
        NND_PRELOAD_REPORT: '1'
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      rejectPromise(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      if (timedOut) {
        rejectPromise(
          new Error(
            `Preloaded Node process did not exit naturally within ${timeoutMs}ms.\nstdout:\n${stdout}\nstderr:\n${stderr}`
          )
        )
        return
      }
      resolvePromise({ code, signal, stdout, stderr })
    })
  })
}

async function assertCliReportedNative(cli, fixtureRecord) {
  const { line } = await cli.waitForLine((candidate) => candidate.includes('[nnd:ready] '), {
    source: 'stderr',
    label: 'CLI Native readiness report'
  })
  const ready = JSON.parse(line.slice(line.indexOf('[nnd:ready] ') + '[nnd:ready] '.length))
  assert.equal(ready.mode, 'native')
  assert.equal(ready.target.webSocketDebuggerUrl, fixtureRecord.target.webSocketDebuggerUrl)
  assert.equal(ready.capabilities.http, true)
}

function protectCli(t, cli) {
  const applicationPids = new Set()
  t.after(async () => {
    if (cli.running) await cli.terminate().catch(() => {})
    for (const pid of applicationPids) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error
      }
    }
  })
  return applicationPids
}

test.before(async () => {
  await assertCliBuildExists()
})

test(
  'doctor --json emits a parseable, versioned and internally consistent report',
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const result = await runCli(['doctor', '--json'])
    assertNormalExit(result)
    assert.equal(result.stderr, '')

    const report = JSON.parse(result.stdout)
    assert.equal(report.schemaVersion, 1)
    assert.equal(report.ok, true)
    assert.equal(report.nodeVersion, process.versions.node)
    assert.match(report.packageVersion, /^\d+\.\d+\.\d+/)
    assert.equal(report.inspectorAvailable, true)
    assert.equal(typeof report.experimentalFlag, 'boolean')
    assert.equal(report.native.kind, 'native')
    assert.equal(typeof report.native.available, 'boolean')
    assert.equal(report.selection.requested, 'auto')
    assert.ok(['native', 'legacy'].includes(report.selection.selected))
    assert.equal(report.config.config.inspector.port, 0)
    assert.equal(report.config.config.open, false)
    assert.ok(Array.isArray(report.diagnostics))
    assert.ok(report.diagnostics.some((item) => item.code === 'NND_DOCTOR_NODE_VERSION'))
    assert.ok(report.diagnostics.some((item) => item.code.startsWith('NND_DOCTOR_SELECTED_')))
  }
)

test(
  'dev --open resumes the real inspect-wait target and opens its authoritative target once',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const directory = await mkdtemp(resolve(tmpdir(), 'node-network-devtools-open-e2e-'))
    const frontendRecord = resolve(directory, 'frontend.ndjson')
    const cli = startCli(['dev', '--open', ESM_FIXTURE], {
      nodeArgs: ['--require', FRONTEND_OPEN_HOOK],
      env: cleanCliEnvironment({
        NND_E2E_FRONTEND_RUNNER: FRONTEND_CDP_RUNNER,
        NND_E2E_FRONTEND_RECORD: frontendRecord
      })
    })
    const applicationPids = protectCli(t, cli)
    t.after(() => rm(directory, { recursive: true, force: true }))

    const ready = await cli.waitForRecord((record) => record.label === 'esm')
    applicationPids.add(ready.pid)
    assert.equal(ready.preloadInjected, true)
    assert.equal(ready.mode, 'native')
    assert.ok(
      ready.execArgv.includes('--inspect-wait=127.0.0.1:0'),
      `missing inspect-wait in ${JSON.stringify(ready.execArgv)}`
    )
    assert.equal(
      ready.execArgv.some((argument) => argument === '--inspect=127.0.0.1:0'),
      false
    )
    await assertCliReportedNative(cli, ready)

    const result = await cli.waitForExit()
    assertNormalExit(result)
    await waitForProcessGone(ready.pid)
    applicationPids.clear()

    let recordText
    const deadline = Date.now() + 5_000
    while (recordText === undefined && Date.now() < deadline) {
      try {
        recordText = await readFile(frontendRecord, 'utf8')
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
      }
    }
    assert.ok(recordText, 'frontend CDP runner did not record an opened target')
    const opened = recordText
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    assert.equal(opened.length, 1, `authoritative target opened ${opened.length} times`)
    assert.equal(opened[0].webSocketDebuggerUrl, ready.target.webSocketDebuggerUrl)
    assert.match(opened[0].frontendUrl, /^devtools:\/\//)
  }
)

test(
  'Auto starts Legacy without Native flags when required capabilities cannot be met',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const cli = startCli(['dev', '--no-wait', '--require', 'requestBody', ESM_FIXTURE])
    const applicationPids = protectCli(t, cli)
    const ready = await cli.waitForRecord((record) => record.label === 'esm')
    applicationPids.add(ready.pid)

    assert.equal(ready.mode, 'legacy')
    assert.equal(ready.capabilities.requestBody, true)
    assert.equal(ready.fallbackReason?.code, 'NND_AUTO_FALLBACK')
    assert.equal(ready.execArgv.includes('--experimental-network-inspection'), false)
    assert.equal(
      ready.execArgv.some((argument) => argument.startsWith('--inspect')),
      false,
      `Auto fallback must not create a waiting Native target: ${JSON.stringify(ready.execArgv)}`
    )

    const { line } = await cli.waitForLine((candidate) => candidate.includes('[nnd:ready] '), {
      source: 'stderr',
      label: 'CLI Legacy fallback readiness report'
    })
    const reported = JSON.parse(line.slice(line.indexOf('[nnd:ready] ') + '[nnd:ready] '.length))
    assert.equal(reported.mode, 'legacy')
    assert.equal(reported.fallbackReason.code, 'NND_AUTO_FALLBACK')

    const result = await cli.terminate('SIGTERM')
    assert.deepEqual(result, { code: 143, signal: null })
    await waitForProcessGone(ready.pid)
    applicationPids.clear()
    assert.equal(
      cli.lines.filter((item) => item.line.includes('[nnd:ready] ')).length,
      1,
      'Legacy bridge descendants must not execute the inherited side-effect preload'
    )
  }
)

test(
  'finite Legacy CLI application exits naturally without accessing the preload handle',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const cli = startCli(['dev', '--mode', 'legacy', '--no-wait', FINITE_LEGACY_FIXTURE])
    const applicationPids = protectCli(t, cli)
    const fixture = await cli.waitForRecord((record) => record.type === 'finite-legacy')
    applicationPids.add(fixture.pid)

    const { line } = await cli.waitForLine((candidate) => candidate.includes('[nnd:ready] '), {
      source: 'stderr',
      label: 'finite Legacy readiness report'
    })
    const ready = parseReadyReport(line)
    assert.equal(ready.mode, 'legacy')
    assert.match(ready.target.discoveryUrl, /^http:\/\/127\.0\.0\.1:\d+\/json\/list$/)

    const result = await cli.waitForExit({
      timeoutMs: 10_000,
      label: 'finite Legacy CLI natural exit'
    })
    assertNormalExit({ ...result, stderr: cli.stderr })
    await waitForProcessGone(fixture.pid)
    applicationPids.clear()
    await waitForEndpointClosed(ready.target.discoveryUrl)
    assert.equal(
      cli.lines.filter((item) => item.line.includes('[nnd:ready] ')).length,
      1,
      'the detached Legacy child must not replay the preload entry'
    )
  }
)

test(
  'direct Legacy preload sanitizes eval and print execArgv and leaves no backend orphan',
  { timeout: 75_000 },
  async () => {
    const source =
      "process.stdout.write('@@NND_E2E@@' + JSON.stringify({ type: 'finite-preload', pid: process.pid, ppid: process.ppid }) + '\\n')"

    for (const option of ['-e', '--eval', '-p', '--print']) {
      const result = await runPreloadedNode([`--import=${REGISTER_PATH}`, option, source])
      assertNormalExit(result)
      assert.doesNotMatch(result.stderr, /NND_LEGACY_CHILD_START_FAILED/)
      const records = result.stdout
        .split(/\r?\n/)
        .filter((line) => line.startsWith('@@NND_E2E@@'))
        .map((line) => JSON.parse(line.slice('@@NND_E2E@@'.length)))
      assert.equal(records.length, 1, `${option} evaluation was unexpectedly replayed by a child`)
      assert.equal(records[0].type, 'finite-preload')

      const ready = parseReadyReport(result.stderr)
      assert.equal(ready.mode, 'legacy')
      await waitForProcessGone(records[0].pid)
      await waitForEndpointClosed(ready.target.discoveryUrl)
    }
  }
)

test(
  'dev --no-wait preloads Native into a CJS entry, forwards args and mirrors exit code',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const applicationArgs = ['alpha', 'value with spaces', '--exit-code=23']
    const cli = startCli(['dev', '--no-wait', CJS_FIXTURE, '--', ...applicationArgs])
    const applicationPids = protectCli(t, cli)
    const ready = await cli.waitForRecord((record) => record.label === 'cjs')
    applicationPids.add(ready.pid)
    assertNativeFixture(ready, { label: 'cjs', argv: applicationArgs })
    await assertCliReportedNative(cli, ready)

    const result = await cli.waitForExit()
    assert.equal(result.code, 23, `unexpected CLI output:\n${cli.stdout}\n${cli.stderr}`)
    assert.equal(result.signal, null)
    await waitForProcessGone(ready.pid)
    applicationPids.clear()
  }
)

test(
  'dev --no-wait preloads Native into an ESM entry without source registration',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const applicationArgs = ['--format=esm']
    const cli = startCli(['dev', '--no-wait', ESM_FIXTURE, '--', ...applicationArgs])
    const applicationPids = protectCli(t, cli)
    const ready = await cli.waitForRecord((record) => record.label === 'esm')
    applicationPids.add(ready.pid)
    assertNativeFixture(ready, { label: 'esm', argv: applicationArgs })
    await assertCliReportedNative(cli, ready)

    const result = await cli.waitForExit()
    assert.equal(result.code, 0, `unexpected CLI output:\n${cli.stdout}\n${cli.stderr}`)
    assert.equal(result.signal, null)
    await waitForProcessGone(ready.pid)
    applicationPids.clear()
  }
)

test(
  'dev --runner tsx executes a TypeScript entry with both preloads active',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const applicationArgs = ['--typed-argument', '42']
    const cli = startCli([
      'dev',
      '--runner',
      'tsx',
      '--no-wait',
      TS_FIXTURE,
      '--',
      ...applicationArgs
    ])
    const applicationPids = protectCli(t, cli)
    const ready = await cli.waitForRecord((record) => record.label === 'tsx')
    applicationPids.add(ready.pid)
    assertNativeFixture(ready, { label: 'tsx', argv: applicationArgs })
    await assertCliReportedNative(cli, ready)
    assert.equal(ready.typescriptExecuted, true)
    assert.ok(
      importedModules(ready.execArgv).includes('tsx'),
      `missing tsx preload in ${JSON.stringify(ready.execArgv)}`
    )

    const result = await cli.waitForExit()
    assert.equal(result.code, 0, `unexpected CLI output:\n${cli.stdout}\n${cli.stderr}`)
    assert.equal(result.signal, null)
    await waitForProcessGone(ready.pid)
    applicationPids.clear()
  }
)

test(
  'dev --watch performs one restart after an atomic entry replacement and leaves no child',
  { timeout: 45_000 },
  async (t) => {
    const fixture = await temporaryFixtureCopy(WATCH_FIXTURE)
    const cli = startCli(['dev', '--watch', '--no-wait', fixture.path])
    const observedPids = new Set()

    t.after(async () => {
      if (cli.running) await cli.terminate().catch(() => {})
      for (const pid of observedPids) {
        if (Number.isInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 'SIGKILL')
          } catch (error) {
            if (error?.code !== 'ESRCH') throw error
          }
        }
      }
      await fixture.cleanup()
    })

    const initial = await cli.waitForRecord(
      (record) => record.label === 'watch' && record.generation === 'initial-generation'
    )
    observedPids.add(initial.pid)
    observedPids.add(initial.ppid)
    assertNativeFixture(initial, { label: 'watch' })

    // Node's native watch supervisor has no public "watcher armed" signal.
    // The worker can print readiness before the supervisor consumes its
    // watch:import IPC and creates the directory watcher, so an immediate
    // atomic editor-style replacement can otherwise fall into that window.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, WATCH_SUPERVISOR_SETTLE_MS))
    await atomicReplace(fixture.path, async () => {
      const source = await readFile(fixture.path, 'utf8')
      return source.replace('initial-generation', 'updated-generation')
    })

    const restarted = await cli.waitForRecord(
      (record) =>
        record.label === 'watch' &&
        record.generation === 'updated-generation' &&
        record.pid !== initial.pid,
      { timeoutMs: 25_000, label: 'watch restart readiness' }
    )
    observedPids.add(restarted.pid)
    observedPids.add(restarted.ppid)
    assertNativeFixture(restarted, { label: 'watch' })
    assert.notEqual(restarted.pid, initial.pid)
    assert.equal(restarted.ppid, initial.ppid, 'Node watch supervisor must remain stable')
    await waitForProcessGone(initial.pid)

    const result = await cli.terminate('SIGTERM')
    assert.equal(result.signal, null)
    assert.ok(
      result.code === 0 || result.code === 143,
      `watch supervisor must exit cleanly or preserve SIGTERM semantics; received ${result.code}`
    )
    await waitForProcessGone(restarted.pid)
    await waitForProcessGone(restarted.ppid)
    observedPids.clear()
  }
)

test(
  'compiled Nest-style bootstrap needs no registration edit and receives forwarded SIGTERM',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const cli = startCli(['dev', '--no-wait', NEST_FIXTURE])
    let appPid

    t.after(async () => {
      if (cli.running) await cli.terminate().catch(() => {})
      if (appPid) {
        try {
          process.kill(appPid, 'SIGKILL')
        } catch (error) {
          if (error?.code !== 'ESRCH') throw error
        }
      }
    })

    const ready = await cli.waitForRecord((record) => record.label === 'nest-compiled')
    appPid = ready.pid
    assertNativeFixture(ready, { label: 'nest-compiled' })
    assert.equal(ready.framework, 'nest-style')
    assert.equal(ready.module, 'AppModule')
    assert.equal(ready.listenHost, '127.0.0.1')
    assert.ok(Number.isInteger(ready.listenPort) && ready.listenPort > 0)

    const result = await cli.terminate('SIGTERM')
    assert.deepEqual(result, { code: 143, signal: null })
    await waitForProcessGone(appPid)
    appPid = undefined
  }
)

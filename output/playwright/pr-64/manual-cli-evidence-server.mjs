import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const evidenceRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(evidenceRoot, '../../..')
const nndPath = resolve(evidenceRoot, 'consumer/node_modules/.bin/nnd')
const fixturePath = resolve(repoRoot, 'packages/network-debugger/test/e2e/cli/fixtures/probe.mjs')
const conflictPath = resolve(evidenceRoot, 'manual-native-mock-conflict.mjs')
const artifactPath = resolve(evidenceRoot, 'artifacts/cli-manual-results.json')
const replayFixturePath = resolve(evidenceRoot, 'artifacts/cli-replay-fixture.har')
const openRecordPath = resolve(evidenceRoot, '.runtime/cli-open.ndjson')
const frontendOpenHookPath = resolve(
  repoRoot,
  'packages/network-debugger/test/e2e/cli/fixtures/frontend-open-hook.cjs'
)
const frontendRunnerPath = resolve(
  repoRoot,
  'packages/network-debugger/test/e2e/cli/fixtures/frontend-cdp-runner.mjs'
)
const productCommit = process.env.NND_MANUAL_PRODUCT_COMMIT ?? 'unknown'
const tarballSha256 = process.env.NND_MANUAL_TARBALL_SHA256 ?? 'unknown'

const results = new Map()
const replayOriginRecords = []
let baseUrl

const pathRedactions = [
  [resolve(evidenceRoot, 'consumer'), '<isolated-consumer>'],
  [evidenceRoot, '<evidence-root>'],
  [repoRoot, '<repo-root>']
]

function redactEvidence(value) {
  if (typeof value === 'string') {
    return pathRedactions.reduce(
      (redacted, [path, replacement]) => redacted.replaceAll(path, replacement),
      value
    )
  }
  if (Array.isArray(value)) return value.map(redactEvidence)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [name, redactEvidence(entry)])
    )
  }
  return value
}

function run(command, args, { env = {}, timeoutMs = 20_000 } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      rejectRun(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timeout)
      rejectRun(error)
    })
    child.once('close', (exitCode, signal) => {
      clearTimeout(timeout)
      resolveRun({ exitCode, signal, stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function parseFixtureMarker(stdout, label) {
  const marker = stdout.split('\n').find((line) => line.startsWith('@@NND_E2E@@'))
  assert(marker, `${label} fixture marker missing`)
  return JSON.parse(marker.slice('@@NND_E2E@@'.length))
}

async function waitForFile(path, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
    }
  }
  throw new Error(`Timed out waiting for ${path}`)
}

async function writeReplayFixture() {
  const har = {
    log: {
      version: '1.2',
      creator: { name: 'PR #64 manual evidence', version: '1' },
      pages: [],
      entries: [
        {
          request: {
            method: 'GET',
            url: `${baseUrl}/replay-get?case=cli-public-replay`,
            httpVersion: 'HTTP/1.1',
            headers: [],
            queryString: [{ name: 'case', value: 'cli-public-replay' }],
            cookies: [],
            headersSize: -1,
            bodySize: 0
          },
          response: {},
          cache: {},
          timings: {},
          _requestId: 'cli-replay-get'
        },
        {
          request: {
            method: 'POST',
            url: `${baseUrl}/replay-post?case=cli-public-replay`,
            httpVersion: 'HTTP/1.1',
            headers: [{ name: 'content-type', value: 'text/plain; charset=utf-8' }],
            queryString: [{ name: 'case', value: 'cli-public-replay' }],
            cookies: [],
            headersSize: -1,
            bodySize: 22,
            postData: {
              mimeType: 'text/plain; charset=utf-8',
              text: 'cli-replay-request-body'
            }
          },
          response: {},
          cache: {},
          timings: {},
          _requestId: 'cli-replay-post'
        }
      ]
    }
  }
  await mkdir(dirname(replayFixturePath), { recursive: true })
  await writeFile(replayFixturePath, `${JSON.stringify(har, null, 2)}\n`, 'utf8')
}

async function runCase(id) {
  if (id === 'doctor') {
    const versionExecution = await run(process.execPath, [nndPath, '--version'])
    assert(versionExecution.exitCode === 0, `version exited ${versionExecution.exitCode}`)
    const version = versionExecution.stdout.trim()
    assert(version === '2.0.0', `version must be 2.0.0, got ${version}`)
    const execution = await run(process.execPath, [
      '--experimental-network-inspection',
      nndPath,
      'doctor',
      '--json'
    ])
    assert(execution.exitCode === 0, `doctor exited ${execution.exitCode}`)
    const value = JSON.parse(execution.stdout)
    assert(value.ok === true, 'doctor ok must be true')
    assert(value.packageVersion === '2.0.0', 'packageVersion must be 2.0.0')
    assert(value.experimentalFlag === true, 'experimental flag must be detected')
    assert(value.selection?.selected === 'native', 'doctor must select Native')
    assert(value.networkMethods?.missingRequired?.length === 0, 'required methods must exist')
    return {
      id,
      title: 'CLI version + Native doctor',
      status: 'PASS',
      command: `nnd --version && node --experimental-network-inspection ${nndPath} doctor --json`,
      actual: {
        version,
        schemaVersion: value.schemaVersion,
        ok: value.ok,
        nodeVersion: value.nodeVersion,
        packageVersion: value.packageVersion,
        experimentalFlag: value.experimentalFlag,
        missingRequired: value.networkMethods.missingRequired,
        selection: value.selection,
        capabilities: value.capabilities
      }
    }
  }

  if (id === 'native' || id === 'legacy') {
    const execution = await run(process.execPath, [
      nndPath,
      'dev',
      '--no-wait',
      '--mode',
      id,
      fixturePath
    ])
    assert(execution.exitCode === 0, `${id} dev exited ${execution.exitCode}`)
    const value = parseFixtureMarker(execution.stdout, id)
    assert(value.preloadInjected === true, `${id} preload must be injected`)
    assert(value.mode === id, `${id} selected mode mismatch`)
    assert(value.target?.discoveryUrl, `${id} discovery URL missing`)
    return {
      id,
      title: `Zero-code nnd dev · ${id.toUpperCase()}`,
      status: 'PASS',
      command: `nnd dev --no-wait --mode ${id} ${fixturePath}`,
      actual: {
        type: value.type,
        preloadInjected: value.preloadInjected,
        mode: value.mode,
        execArgv: value.execArgv,
        target: value.target,
        capabilities: value.capabilities
      }
    }
  }

  if (id === 'conflict') {
    const execution = await run(process.execPath, [conflictPath])
    assert(execution.exitCode === 0, `conflict check exited ${execution.exitCode}`)
    const value = JSON.parse(execution.stdout)
    assert(value.code === 'NND_NATIVE_MOCK_CONFLICT', 'explicit conflict code missing')
    return {
      id,
      title: 'Forced Native + Mock conflict',
      status: 'PASS',
      command: `node ${conflictPath}`,
      actual: value
    }
  }

  if (id === 'replay') {
    await writeReplayFixture()
    replayOriginRecords.length = 0
    const dryExecution = await run(process.execPath, [
      nndPath,
      'replay',
      '--dry-run',
      '--json',
      replayFixturePath
    ])
    assert(dryExecution.exitCode === 0, `replay dry-run exited ${dryExecution.exitCode}`)
    const dryRun = JSON.parse(dryExecution.stdout)
    assert(dryRun.dryRun === true, 'CLI replay dry-run flag missing')
    assert(dryRun.succeeded === 2 && dryRun.failed === 0, 'CLI replay dry-run did not pass 2/2')
    assert(replayOriginRecords.length === 0, 'CLI replay dry-run performed network I/O')

    const realExecution = await run(process.execPath, [
      nndPath,
      'replay',
      '--json',
      '--timeout',
      '5000',
      replayFixturePath
    ])
    assert(realExecution.exitCode === 0, `real replay exited ${realExecution.exitCode}`)
    const real = JSON.parse(realExecution.stdout)
    assert(real.dryRun === false, 'real CLI replay was unexpectedly dry')
    assert(real.succeeded === 2 && real.failed === 0, 'real CLI replay did not pass 2/2')
    assert(replayOriginRecords.length === 2, 'real CLI replay did not reach both endpoints')
    assert(
      replayOriginRecords.some(
        (record) => record.method === 'POST' && record.body === 'cli-replay-request-body'
      ),
      'real CLI replay did not preserve the POST body'
    )
    return {
      id,
      title: 'Public nnd replay · dry + real',
      status: 'PASS',
      command: `nnd replay --dry-run --json ${replayFixturePath} && nnd replay --json ${replayFixturePath}`,
      actual: { dryRun, real, originRequests: [...replayOriginRecords] }
    }
  }

  if (id === 'open') {
    await mkdir(dirname(openRecordPath), { recursive: true })
    await rm(openRecordPath, { force: true })
    const execution = await run(
      process.execPath,
      [
        '--require',
        frontendOpenHookPath,
        nndPath,
        'dev',
        '--open',
        '--mode',
        'native',
        fixturePath
      ],
      {
        env: {
          NND_E2E_FRONTEND_RUNNER: frontendRunnerPath,
          NND_E2E_FRONTEND_RECORD: openRecordPath
        }
      }
    )
    assert(execution.exitCode === 0, `nnd dev --open exited ${execution.exitCode}`)
    const value = parseFixtureMarker(execution.stdout, 'open')
    const opened = (await waitForFile(openRecordPath))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    assert(value.preloadInjected === true, 'open case preload must be injected')
    assert(value.mode === 'native', 'open case must select Native')
    assert(opened.length === 1, `authoritative target opened ${opened.length} times`)
    assert(
      opened[0].webSocketDebuggerUrl === value.target.webSocketDebuggerUrl,
      'opened socket does not match the CLI target'
    )
    assert(opened[0].frontendUrl.startsWith('devtools://'), 'opened URL is not DevTools')
    return {
      id,
      title: 'nnd dev --open · authoritative target',
      status: 'PASS',
      command: `nnd dev --open --mode native ${fixturePath}`,
      actual: {
        preloadInjected: value.preloadInjected,
        mode: value.mode,
        inspectWait: value.execArgv.find((argument) => argument.startsWith('--inspect-wait=')),
        target: value.target,
        openedExactlyOnce: opened.length === 1,
        openedFrontend: opened[0],
        launcherVerification: 'OS browser spawn redirected to an exact-target CDP verifier'
      }
    }
  }

  throw new Error(`Unknown case: ${id}`)
}

async function saveResults() {
  await mkdir(dirname(artifactPath), { recursive: true })
  await writeFile(
    artifactPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        productCommit,
        tarballSha256,
        cases: [...results.values()]
      },
      null,
      2
    )}\n`
  )
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function render() {
  const definitions = [
    ['doctor', 'CLI version + doctor'],
    ['native', 'Zero-code Native'],
    ['legacy', 'Zero-code Legacy'],
    ['conflict', 'Native + Mock conflict'],
    ['replay', 'Public replay dry + real'],
    ['open', 'CLI --open authoritative target']
  ]
  const cards = definitions
    .map(([id, title]) => {
      const result = results.get(id)
      return `<article>
        <div class="case-head"><h2>${escapeHtml(title)}</h2><span class="${result ? 'pass' : 'pending'}">${result ? 'PASS' : 'PENDING'}</span></div>
        ${
          result
            ? `<code>${escapeHtml(result.command)}</code><pre>${escapeHtml(JSON.stringify(result.actual, null, 2))}</pre>`
            : `<p>Click the case button to run the exact packed package.</p>`
        }
      </article>`
    })
    .join('')

  return `<!doctype html>
  <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
  <title>PR #64 manual CLI evidence</title><style>
  :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#07111f;color:#e5edf8}
  *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top left,#16345a 0,#07111f 45%);min-height:100vh}
  main{max-width:1500px;margin:auto;padding:30px}.eyebrow{color:#7dd3fc;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
  h1{font-size:35px;margin:8px 0}.identity{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0;color:#b9c8dc}
  .identity code,article code{color:#7dd3fc;overflow-wrap:anywhere}.actions{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}
  button{background:#22c55e;color:#052e16;border:0;border-radius:9px;padding:11px 16px;font-weight:800;cursor:pointer}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}article{background:#0b1b2f;border:1px solid #28435f;border-radius:13px;padding:18px;min-width:0}
  .case-head{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:19px;margin:0 0 12px}.pass,.pending{border-radius:999px;padding:4px 10px;font-size:12px;font-weight:900}.pass{background:#14532d;color:#86efac}.pending{background:#3f3f46;color:#d4d4d8}
  pre{max-height:330px;overflow:auto;background:#050b14;border-radius:9px;padding:12px;color:#c4e7ff;font:13px/1.38 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}.summary{font-weight:800;color:#86efac}
  @media(max-width:900px){.grid,.identity{grid-template-columns:1fr}}
  </style></head><body><main>
  <div class="eyebrow">PR #64 · manual acceptance</div><h1>Exact-package CLI evidence</h1>
  <p class="summary">${results.size}/${definitions.length} cases passed · each button launches the installed tarball, not workspace source.</p>
  <div class="identity"><div>Product commit <code>${escapeHtml(productCommit)}</code></div><div>Package <code>node-network-devtools@2.0.0</code></div><div>Tarball SHA-256 <code>${escapeHtml(tarballSha256)}</code></div><div>Runner <code>${escapeHtml(process.version)} · ${escapeHtml(process.platform)}-${escapeHtml(process.arch)}</code></div></div>
  <div class="actions">${definitions.map(([id, title]) => `<button data-case="${id}">${escapeHtml(title)}</button>`).join('')}</div>
  <section class="grid">${cards}</section>
  <script>
  for (const button of document.querySelectorAll('button')) button.addEventListener('click', async () => {
    button.disabled = true; button.textContent = 'Running…'
    const response = await fetch('/run/' + button.dataset.case, {method:'POST'})
    if (!response.ok) alert(await response.text())
    location.reload()
  })
  </script></main></body></html>`
}

const server = createServer(async (request, response) => {
  if (request.url?.startsWith('/replay-get')) {
    replayOriginRecords.push({ method: request.method, url: request.url, body: '' })
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('cli-replay-get-ok')
    return
  }

  if (request.url?.startsWith('/replay-post')) {
    const chunks = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString('utf8')
    replayOriginRecords.push({ method: request.method, url: request.url, body })
    response.writeHead(201, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ ok: true, body }))
    return
  }

  if (request.method === 'POST' && request.url?.startsWith('/run/')) {
    const id = request.url.slice('/run/'.length)
    try {
      results.set(id, redactEvidence(await runCase(id)))
      await saveResults()
      response.writeHead(204).end()
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(error?.stack ?? String(error))
    }
    return
  }

  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(render())
})

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
  console.log(`NND_CLI_MANUAL_READY ${baseUrl}`)
})

process.once('SIGINT', () => server.close(() => process.exit(0)))
process.once('SIGTERM', () => server.close(() => process.exit(0)))

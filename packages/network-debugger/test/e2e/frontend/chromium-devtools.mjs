import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

const DEFAULT_TIMEOUT_MS = 10_000

// Node's native Network backend does not implement these optional Chromium
// commands yet. The official frontend reports them through console.error while
// continuing to operate normally; every other frontend error remains fatal.
const EXPECTED_PROTOCOL_ERRORS = {
  native: [
    /^Request Network\.(?:configureDurableMessages|setAttachDebugStack|setBlockedURLs|emulateNetworkConditionsByRule|overrideNetworkState|clearAcceptedEncodingsOverride) failed\./
  ],
  // Legacy owns its CDP implementation, so frontend compatibility errors are
  // product failures rather than runtime limitations.
  legacy: []
}

function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Chromium did not exit within ${timeoutMs}ms`))
    }, timeoutMs)
    const onExit = () => {
      cleanup()
      resolve()
    }
    const cleanup = () => {
      clearTimeout(timer)
      child.off('exit', onExit)
    }
    child.once('exit', onExit)
    if (child.exitCode !== null || child.signalCode !== null) onExit()
  })
}

function waitForBrowserWebSocket(child, output, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const current = output.stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1]
  if (current) return Promise.resolve(current)

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for Chromium CDP endpoint. stderr:\n${output.stderr}`))
    }, timeoutMs)

    const onData = () => {
      const match = output.stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (!match) return
      cleanup()
      resolve(match[1])
    }
    const onExit = (code, signal) => {
      cleanup()
      reject(
        new Error(
          `Chromium exited before publishing CDP (code=${code}, signal=${signal}).\n${output.stderr}`
        )
      )
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      clearTimeout(timer)
      child.stderr.off('data', onData)
      child.off('exit', onExit)
      child.off('error', onError)
    }

    child.stderr.on('data', onData)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

function serializeError(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack }
  }
  return { message: String(error) }
}

function toNdjson(values) {
  return values.map((value) => JSON.stringify(value)).join('\n') + (values.length ? '\n' : '')
}

export class ChromiumDevToolsFrontend {
  constructor(inspectorUrl, { backend = 'native' } = {}) {
    if (!Object.hasOwn(EXPECTED_PROTOCOL_ERRORS, backend)) {
      throw new Error(`Unknown DevTools frontend backend: ${backend}`)
    }
    this.inspectorUrl = inspectorUrl
    this.backend = backend
    this.consoleMessages = []
    this.pageErrors = []
    this.crashes = []
    this.externalConnections = []
    this.browserOutput = { stdout: '', stderr: '' }
    this.traceStarted = false
    this.traceStopped = false
    this.closed = false
  }

  async start() {
    this.userDataDirectory = await mkdtemp(join(tmpdir(), 'node-network-devtools-chromium-'))
    const browserProcess = spawn(
      chromium.executablePath(),
      [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${this.userDataDirectory}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--no-sandbox',
        '--no-proxy-server',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-domain-reliability',
        '--disable-extensions',
        '--disable-sync',
        '--metrics-recording-only',
        '--mute-audio',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    this.browserProcess = browserProcess
    browserProcess.stdout.setEncoding('utf8')
    browserProcess.stderr.setEncoding('utf8')
    browserProcess.stdout.on('data', (chunk) => {
      this.browserOutput.stdout += chunk
    })
    browserProcess.stderr.on('data', (chunk) => {
      this.browserOutput.stderr += chunk
    })

    this.browserWebSocketUrl = await waitForBrowserWebSocket(browserProcess, this.browserOutput)
    const browser = await chromium.connectOverCDP(this.browserWebSocketUrl)
    this.browser = browser
    this.browserVersion = browser.version()

    const [context] = browser.contexts()
    if (!context) throw new Error('Chromium did not expose its default browser context')
    this.context = context
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false })
    this.traceStarted = true

    const inspectorSocket = this.inspectorUrl.replace(/^ws:\/\//, '')
    const browserEndpoint = new URL(this.browserWebSocketUrl)
    // Chromium's local remote-debugging server exposes the exact official
    // frontend bundled in this binary. /devtools/ is complete; /bundled/ is
    // not a static asset root on this HTTP server.
    this.frontendUrl =
      `http://${browserEndpoint.host}/devtools/js_app.html?experiments=true&v8only=true` +
      `&ws=${inspectorSocket}&hl=en-US`

    const page = await context.newPage()
    this.page = page
    page.on('console', (message) => {
      this.consoleMessages.push({
        type: message.type(),
        text: message.text(),
        location: message.location()
      })
    })
    page.on('pageerror', (error) => this.pageErrors.push(serializeError(error)))
    page.on('crash', () => this.crashes.push({ timestamp: new Date().toISOString() }))
    const recordExternalConnection = (kind, url) => {
      try {
        const parsed = new URL(url)
        if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
          this.externalConnections.push({ kind, url })
        }
      } catch {
        this.externalConnections.push({ kind, url })
      }
    }
    page.on('request', (request) => recordExternalConnection('request', request.url()))
    page.on('websocket', (socket) => recordExternalConnection('websocket', socket.url()))

    await page.goto(this.frontendUrl, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_TIMEOUT_MS
    })
    await this.openNetworkPanel()
    return this
  }

  async openNetworkPanel() {
    const page = this.page
    const networkTab = page.getByText('Network', { exact: true }).first()
    await networkTab.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS })
    await networkTab.click()
    await page.getByText('Fetch/XHR', { exact: true }).waitFor({
      state: 'visible',
      timeout: DEFAULT_TIMEOUT_MS
    })
  }

  async reload() {
    await this.page.reload({
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_TIMEOUT_MS
    })
    await this.openNetworkPanel()
  }

  async targetState() {
    return this.page.evaluate(async () => {
      const SDK = await import('./core/sdk/sdk.js')
      const targetManager = SDK.TargetManager.TargetManager.instance()
      const target = targetManager.primaryPageTarget()
      return {
        connected: Boolean(target),
        targetCount: targetManager.targets().length,
        type: target?.type(),
        suspended: target?.suspended()
      }
    })
  }

  async requestState(url) {
    return this.page.evaluate(async (requestUrl) => {
      const Logs = await import('./models/logs/logs.js')
      const request = Logs.NetworkLog.NetworkLog.instance()
        .requests()
        .find((candidate) => candidate.url() === requestUrl)
      if (!request) return { found: false }
      return {
        found: true,
        finished: Boolean(request.finished),
        method: request.requestMethod,
        mimeType: request.mimeType,
        statusCode: request.statusCode,
        url: request.url()
      }
    }, url)
  }

  async requestBody(url) {
    return this.page.evaluate(async (requestUrl) => {
      const Logs = await import('./models/logs/logs.js')
      const request = Logs.NetworkLog.NetworkLog.instance()
        .requests()
        .find((candidate) => candidate.url() === requestUrl)
      if (!request) throw new Error(`Network model did not contain ${requestUrl}`)
      if (!request.finished) throw new Error(`Network request was not finished: ${requestUrl}`)
      const content = await request.requestContentData()
      return {
        text: content.text,
        mimeType: content.mimeType,
        charset: content.charset,
        error: content.error ? String(content.error) : undefined
      }
    }, url)
  }

  unexpectedErrors() {
    const browserEndpoint = this.browserWebSocketUrl ? new URL(this.browserWebSocketUrl) : undefined
    const missingFaviconUrl = browserEndpoint
      ? `http://${browserEndpoint.host}/favicon.ico`
      : undefined
    const unexpectedConsole = this.consoleMessages.filter(
      (message) =>
        message.type === 'error' &&
        !EXPECTED_PROTOCOL_ERRORS[this.backend].some((pattern) => pattern.test(message.text)) &&
        !(
          message.location.url === missingFaviconUrl &&
          /^Failed to load resource: .*status of 404/.test(message.text)
        )
    )
    return {
      console: unexpectedConsole,
      page: this.pageErrors,
      crashes: this.crashes,
      externalConnections: this.externalConnections
    }
  }

  assertNoUnexpectedErrors() {
    const errors = this.unexpectedErrors()
    if (
      errors.console.length ||
      errors.page.length ||
      errors.crashes.length ||
      errors.externalConnections.length
    ) {
      throw new Error(`Unexpected DevTools frontend errors:\n${JSON.stringify(errors, null, 2)}`)
    }
  }

  async captureEvidence(testInfo, prefix = `${this.backend}-devtools`) {
    await mkdir(testInfo.outputDir, { recursive: true })
    const attachments = []
    const attachFile = async (name, content, contentType = 'text/plain') => {
      const path = testInfo.outputPath(name)
      await writeFile(path, content)
      await testInfo.attach(name, { path, contentType })
      attachments.push(path)
    }

    if (this.page && !this.page.isClosed()) {
      const screenshotName = `${prefix}-frontend.png`
      const screenshotPath = testInfo.outputPath(screenshotName)
      await this.page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach(screenshotName, {
        path: screenshotPath,
        contentType: 'image/png'
      })
      attachments.push(screenshotPath)
    }

    if (this.traceStarted && !this.traceStopped) {
      const traceName = `${prefix}-trace.zip`
      const tracePath = testInfo.outputPath(traceName)
      await this.context.tracing.stop({ path: tracePath })
      this.traceStopped = true
      await testInfo.attach(traceName, { path: tracePath, contentType: 'application/zip' })
      attachments.push(tracePath)
    }

    await Promise.all([
      attachFile(`${prefix}-console.ndjson`, toNdjson(this.consoleMessages)),
      attachFile(`${prefix}-page-errors.ndjson`, toNdjson(this.pageErrors)),
      attachFile(`${prefix}-chromium.stdout.log`, this.browserOutput.stdout),
      attachFile(`${prefix}-chromium.stderr.log`, this.browserOutput.stderr),
      attachFile(
        `${prefix}-metadata.json`,
        JSON.stringify(
          {
            backend: this.backend,
            playwrightChromium: this.browserVersion,
            chromiumExecutable: chromium.executablePath(),
            frontendUrl: this.frontendUrl,
            inspectorUrl: this.inspectorUrl,
            actualPageUrls: this.context?.pages().map((page) => page.url()) ?? [],
            unexpectedErrors: this.unexpectedErrors()
          },
          null,
          2
        ),
        'application/json'
      )
    ])

    return attachments
  }

  async captureFailure(testInfo, error, targetHarness) {
    const attachments = []
    const attachFile = async (name, content, contentType = 'text/plain') => {
      const path = testInfo.outputPath(name)
      await mkdir(testInfo.outputDir, { recursive: true })
      await writeFile(path, content)
      await testInfo.attach(name, { path, contentType })
      attachments.push(path)
    }

    if (this.page && !this.page.isClosed()) {
      const screenshotPath = testInfo.outputPath('devtools-frontend.png')
      try {
        await this.page.screenshot({ path: screenshotPath, fullPage: true })
        await testInfo.attach('devtools-frontend.png', {
          path: screenshotPath,
          contentType: 'image/png'
        })
        attachments.push(screenshotPath)
      } catch (screenshotError) {
        await attachFile(
          'devtools-screenshot-error.json',
          JSON.stringify(serializeError(screenshotError), null, 2),
          'application/json'
        )
      }
    }

    if (this.traceStarted && !this.traceStopped) {
      const tracePath = testInfo.outputPath('devtools-trace.zip')
      await this.context.tracing.stop({ path: tracePath }).catch(() => undefined)
      this.traceStopped = true
      await testInfo
        .attach('devtools-trace.zip', { path: tracePath, contentType: 'application/zip' })
        .catch(() => {})
    }

    await Promise.all([
      attachFile('frontend-console.ndjson', toNdjson(this.consoleMessages)),
      attachFile('frontend-page-errors.ndjson', toNdjson(this.pageErrors)),
      attachFile('chromium.stdout.log', this.browserOutput.stdout),
      attachFile('chromium.stderr.log', this.browserOutput.stderr),
      attachFile(
        'frontend-metadata.json',
        JSON.stringify(
          {
            error: serializeError(error),
            backend: this.backend,
            playwrightChromium: this.browserVersion,
            chromiumExecutable: chromium.executablePath(),
            frontendUrl: this.frontendUrl,
            inspectorUrl: this.inspectorUrl,
            actualPageUrls: this.context?.pages().map((page) => page.url()) ?? [],
            unexpectedErrors: this.unexpectedErrors()
          },
          null,
          2
        ),
        'application/json'
      ),
      attachFile(`${this.backend}-target.stdout.log`, targetHarness.stdout),
      attachFile(`${this.backend}-target.stderr.log`, targetHarness.stderr),
      attachFile(`${this.backend}-target-messages.ndjson`, toNdjson(targetHarness.targetMessages))
    ])

    if (targetHarness.client) {
      const journalPath = testInfo.outputPath(`${this.backend}-cdp-${randomUUID()}.ndjson`)
      await targetHarness.client.writeJournal(journalPath)
      await testInfo.attach(`${this.backend}-cdp.ndjson`, {
        path: journalPath,
        contentType: 'application/x-ndjson'
      })
      attachments.push(journalPath)
    }
    return attachments
  }

  async close() {
    if (this.closed) return
    this.closed = true
    const errors = []

    if (this.traceStarted && !this.traceStopped) {
      try {
        await this.context.tracing.stop()
        this.traceStopped = true
      } catch (error) {
        errors.push(error)
      }
    }

    try {
      await this.browser?.close()
    } catch (error) {
      errors.push(error)
    }

    if (
      this.browserProcess &&
      this.browserProcess.exitCode === null &&
      this.browserProcess.signalCode === null
    ) {
      this.browserProcess.kill('SIGTERM')
      try {
        await waitForExit(this.browserProcess)
      } catch {
        this.browserProcess.kill('SIGKILL')
        await waitForExit(this.browserProcess, 2_000).catch((error) => errors.push(error))
      }
    }

    if (this.userDataDirectory) {
      try {
        await rm(this.userDataDirectory, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100
        })
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length) throw new AggregateError(errors, 'Failed to clean up Chromium frontend')
  }
}

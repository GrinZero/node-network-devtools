# Node Network Devtools

Inspect outbound Node.js network traffic with the standard Chrome DevTools
Network panel. Version 2 provides two complete, mutually exclusive backends:

- **Native** connects DevTools directly to Node's experimental Network Inspector.
- **Legacy** captures outbound APIs in-process and exposes a standard CDP target
  through an isolated child-process bridge.

The runtime owns a debuggable target, not a Chrome process. Opening DevTools is
explicit and disposal never kills a browser.

## Requirements

- Node.js `>=18.18`.
- Native mode requires a Node release with
  `--experimental-network-inspection`; use `nnd doctor` to inspect the exact
  runtime capability matrix.
- Node 18 and 20 are retained as compatibility lanes even though they are EOL.
- `undici@^6` is a peer dependency so the opt-in Legacy hook observes the same
  package instance as the application. Package managers that disable automatic
  peer installation must install it explicitly, even when that hook stays off.

## Install

```bash
npm install --save-dev node-network-devtools
```

## Zero-code CLI

```bash
# Start a target and wait for a debugger before running the entry point.
npx nnd dev src/app.js

# Open the target explicitly.
npx nnd dev --open src/app.js

# Start immediately, use tsx, or force a backend.
npx nnd dev --no-wait --runner tsx --mode legacy src/app.ts

# Machine-readable environment and selection diagnostics.
npx nnd doctor --json
```

`nnd dev` supports CJS, ESM, tsx, compiled Nest-style applications, application
arguments, signals, and watch restarts without a source-code registration edit.

## Library API

```ts
import { register } from 'node-network-devtools'

const registration = register({
  mode: 'auto',
  requiredCapabilities: ['responseBody'],
  inspector: { host: '127.0.0.1', port: 0 },
  devtools: { open: false }
})

const ready = await registration.ready
console.log(ready.mode, ready.target, ready.capabilities, ready.fallbackReason)

await registration.openDevtools()
await registration.dispose()
```

The returned handle remains callable for v1 compatibility:

```ts
const unregister = register()
unregister()
```

Equal repeated registrations return the same handle. A conflicting concurrent
registration fails with `NND_ALREADY_REGISTERED`.

## Backend capabilities

| Capability             | Native                  | Legacy |
| ---------------------- | ----------------------- | ------ |
| HTTP / HTTPS lifecycle | Yes                     | Yes    |
| Fetch lifecycle        | Runtime-dependent       | Yes    |
| HTTP/2                 | Node 22.20+ (22.x only) | No     |
| Response bodies        | Runtime-dependent       | Yes    |
| Request bodies         | Not advertised          | Yes    |
| WebSocket lifecycle    | Runtime-dependent       | Yes    |
| WebSocket frames       | No                      | Yes    |
| SSE messages           | No                      | Yes    |
| Initiator stack        | Yes                     | Yes    |
| Request/response Mock  | No                      | Yes    |

Native capabilities are probed from the running Node version and Inspector API;
the package does not pretend missing upstream features exist. Forced Native
fails when requirements cannot be met. Auto prefers a proven Native baseline
and otherwise exposes a structured Legacy fallback reason.

Node 22 can expose Native HTTP response bodies while returning an empty Fetch
body. Because `responseBody` covers all advertised transports, the package
conservatively reports that capability as false on Node 22 and enables it only
on the verified Node 24+ baseline.

Native HTTP/2 is conservatively allowlisted only for Node 22.20+ releases in
the 22.x line. A non-empty h2c lifecycle passed on Node 22.22.3, while consuming
a non-empty response with `setEncoding()` crashes the upstream experimental
Inspector on Node 24.16.0 and 26.8.1 with `Missing dataLength`. Other and future
majors remain reported as unsupported until independently verified. Legacy does
not capture HTTP/2.

Legacy interception can be narrowed:

```ts
register({
  mode: 'legacy',
  legacy: {
    intercept: { normal: true, fetch: true, undici: { fetch: true } }
  }
})
```

## Session, HAR, and Replay

Record either backend to a portable Session directory and optionally export HAR
during disposal:

```ts
const registration = register({
  session: {
    directory: '.nnd/sessions/run-001',
    har: true
  }
})

const ready = await registration.ready
console.log(ready.session)
await registration.dispose()
```

The directory contains `manifest.json`, `events.ndjson`, and external files in
`bodies/`. Existing W3C `traceparent`/`tracestate` headers are correlated in the
manifest and HAR without injecting or modifying tracing headers.

Session APIs are also exported directly:

```ts
import { buildHar, exportHar, replay, SessionRecorder } from 'node-network-devtools'

await exportHar('.nnd/sessions/run-001', 'capture.har')
const plan = await replay('capture.har', { dryRun: true })
const result = await replay('.nnd/sessions/run-001')
```

Replay accepts a Session directory, HAR file, or HAR object. It only reissues
HTTP(S), uses manual redirect handling, and removes hop-by-hop plus runtime-owned
`Host`/`Content-Length` headers. The CLI exposes the same operation:

```bash
npx nnd replay --dry-run --json capture.har
npx nnd replay --stop-on-error .nnd/sessions/run-001
```

## Legacy-only Mock

```ts
const registration = register({
  mode: 'auto',
  legacy: {
    mock: [
      {
        id: 'fixture',
        match: {
          url: 'https://api.example.test/v1/*',
          method: 'POST',
          headers: { 'x-test-mode': 'mock' }
        },
        response: {
          status: 201,
          headers: { 'content-type': 'application/json' },
          body: '{"mocked":true}'
        }
      }
    ]
  }
})
```

URL matchers support `*` globs. Use `bodyBase64` for binary responses. Auto
selects Legacy with diagnostic `NND_AUTO_LEGACY_MOCK_REQUIRED`; forcing Native
with rules fails explicitly with `NND_NATIVE_MOCK_CONFLICT`. Mocked HTTP, HTTPS,
global Fetch, and opted-in `undici.fetch` responses still traverse the normal
Network capture lifecycle.

## Configuration file

`nnd.config.mjs`, `nnd.config.cjs`, and `nnd.config.json` are discovered in the
working directory. Precedence is CLI > `NND_*` environment > config file >
defaults.

```js
export default {
  mode: 'auto',
  open: false,
  wait: true,
  inspector: { host: '127.0.0.1', port: 0 },
  requiredCapabilities: ['responseBody'],
  session: { directory: '.nnd/sessions/local', har: true },
  legacy: { serverPort: 0 }
}
```

See the repository's
[v2 migration guide](https://github.com/GrinZero/node-network-devtools/blob/main/docs/v2-migration.md)
for old-option mappings and release compatibility details.

# Configuration options

The v2 API separates backend selection, Inspector target settings, frontend
opening, Legacy hooks, and recording.

```ts
import { register, type RegisterOptions } from 'node-network-devtools'

const options: RegisterOptions = {
  mode: 'auto',
  requiredCapabilities: ['responseBody'],
  inspector: { host: '127.0.0.1', port: 0 },
  devtools: { open: false },
  session: { directory: '.nnd/sessions/local', har: true },
  legacy: {
    serverPort: 0,
    intercept: { normal: true, fetch: true, undici: { fetch: false } }
  }
}

const registration = register(options)
await registration.ready
await registration.dispose()
```

## `mode`

- `auto` (default): prefer a proven Native implementation and expose a
  structured reason when Legacy is selected.
- `native`: require Node's experimental Network Inspector and every requested
  capability; never fall back.
- `legacy`: install project capture hooks and use the project CDP target.

## `requiredCapabilities`

An array containing any of `http`, `https`, `fetch`, `http2`, `responseBody`,
`requestBody`, `websocketLifecycle`, `websocketFrames`, `sseMessages`, or
`initiator`. Selection fails or falls back if a backend does not provide every
required value.

## `inspector`

- `host`: Inspector bind host; defaults to `127.0.0.1`.
- `port`: Inspector port; defaults to `0` for OS assignment.

## `devtools`

- `open`: whether library registration explicitly opens the returned target;
  defaults to `false`.

The backend never owns or kills the resulting browser process.

## `session`

- `directory`: exact output directory for `manifest.json`, `events.ndjson`, and
  `bodies/`. It must not already contain Session artifacts.
- `bodyCommandTimeoutMs`: optional positive timeout for each
  `Network.getResponseBody` command.
- `har`: `true` writes `session.har` in the Session directory during disposal;
  a string writes to that path; false/omitted disables automatic export.

The recorder closes before the backend so outstanding body commands can finish.

## `legacy`

### `serverPort`

Legacy CDP discovery/WebSocket target port. It defaults to `0`. The application
bridge no longer uses a TCP port.

### `intercept`

- `normal`: intercept `http.request/get` and `https.request/get`; default true.
- `fetch`: intercept global Fetch; default true.
- `undici.fetch`: opt into interception of separately installed Undici Fetch;
  default false. `undici@^6` is a package peer so this hook observes the
  application's module instance; install it explicitly when peer auto-install
  is disabled.

Disabled transports are reported as unavailable capabilities for that Legacy
session.

### `mock`

An ordered array of Legacy-only request/response rules:

```ts
{
  id: 'fixture',
  match: {
    url: 'https://api.example.test/*', // exact or `*` glob
    method: 'POST',
    headers: { 'x-test-mode': 'mock' }
  },
  response: {
    status: 201,
    statusText: 'Created',
    headers: { 'content-type': 'application/json' },
    body: '{"mocked":true}',
    // bodyBase64: 'AAEC/w==', // binary alternative
    delayMs: 10
  }
}
```

Auto selects Legacy when rules exist. Forced Native fails synchronously with
`NND_NATIVE_MOCK_CONFLICT`.

## Deprecated v1 fields

- `adapter` → `mode`
- `requiredFeatures` → `requiredCapabilities`
- `autoOpenDevtool` → `devtools.open`
- top-level `serverPort` → `legacy.serverPort`
- top-level `intercept` → `legacy.intercept`
- `port` → remove; child IPC replaced the old 5270 WebSocket bridge

Compatibility fields still work with diagnostics during the v2 migration.

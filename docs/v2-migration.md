# Migrating to Node Network Devtools v2

Version 2 separates runtime selection, network capture, CDP target ownership, and
frontend launching. It keeps the callable v1 cleanup handle, but defaults and
ownership rules are intentionally different.

## Behavioral changes

- `register()` no longer opens Chrome by default. Use `devtools.open: true`,
  `registration.openDevtools()`, or `nnd dev --open`.
- The project no longer starts, retains, navigates, or kills a Chrome process.
- Legacy application-to-target traffic uses child-process IPC. Port 5270, its
  WebSocket bridge, lock file, and health ping no longer exist.
- Native and Legacy are complete, mutually exclusive backends. One request is
  never captured by both in a single registration.
- Inspector and Legacy target ports default to `0`, allowing the OS to bind an
  available loopback port without a probe/bind race.
- Auto prefers a proven Native runtime, then reports a structured reason when it
  uses Legacy. Forced Native never silently falls back.
- The `node-network-devtools/dev` subpath remains as a deprecated compatibility
  alias, but now resolves to the same published `dist` entry as the package root.

## Option mapping

| v1 option          | v2 option              | Notes                                                |
| ------------------ | ---------------------- | ---------------------------------------------------- |
| `adapter`          | `mode`                 | `adapter` still works with a deprecation diagnostic. |
| `requiredFeatures` | `requiredCapabilities` | Old name remains compatible.                         |
| `autoOpenDevtool`  | `devtools.open`        | Default changed from implicit opening to `false`.    |
| `serverPort`       | `legacy.serverPort`    | Default is now `0`.                                  |
| `intercept`        | `legacy.intercept`     | Hooks are installed only when Legacy is selected.    |
| `port`             | Remove                 | The old application bridge port is unused.           |

Before:

```ts
const unregister = register({
  serverPort: 5271,
  autoOpenDevtool: true,
  intercept: { normal: true, fetch: true }
})
```

After:

```ts
const registration = register({
  mode: 'auto',
  devtools: { open: true },
  legacy: {
    serverPort: 0,
    intercept: { normal: true, fetch: true }
  }
})

await registration.ready
await registration.dispose()
```

The old `unregister()` call remains valid, but `await registration.dispose()` is
preferred when teardown order matters.

## Backend selection

Use required capabilities to express behavior the application actually needs:

```ts
register({
  mode: 'auto',
  requiredCapabilities: ['requestBody', 'websocketFrames']
})
```

Those requirements select Legacy today. Native capability values are derived
from both the running Node version and available Inspector methods.

Notable verified boundaries:

- Native network inspection first appears behind the experimental flag in Node
  20.18 and 22.6.
- Auto's proven Native baseline is Node 24.7 and newer.
- Native HTTP/2 capture requires the later runtime implementations (for example,
  Node 24.8+).
- Node 22.22 can retrieve Native HTTP response bodies, but Fetch
  `Network.getResponseBody` returns an empty body in the package E2E. Because the
  public `responseBody` capability spans transports, v2 conservatively reports
  it as false on Node 22 and true only on the verified Node 24+ baseline.
- Native request bodies, WebSocket frames, SSE message parsing, and Mock are not
  advertised. Select Legacy when these are required.

Node 22 and 24 are LTS and Node 26 is Current at the time this plan was
implemented. Node 18 and 20 are EOL; the package retains `>=18.18` compatibility
and CI lanes so existing applications can migrate, but new deployments should
use a maintained release.

## Zero-code startup

Instead of editing the application entry point, prefer:

```bash
nnd dev --open src/server.js
nnd dev --runner tsx src/server.ts -- --port 3000
nnd doctor --json
```

The CLI supplies the correct preloads and Native flag, supports wait/no-wait and
watch behavior, forwards application arguments/signals, and prints the canonical
target selected by the backend.

## Session, HAR, Replay, and Mock

Recording is backend-neutral:

```ts
const registration = register({
  session: { directory: '.nnd/sessions/run-001', har: true }
})
await registration.ready
// application traffic
await registration.dispose()
```

Disposal closes the recorder and body commands, exports HAR when requested, then
closes the backend even when recording fails. The exact output directory must
not already contain `manifest.json` or `events.ndjson`.

Replay can validate without I/O or issue real HTTP(S) requests:

```bash
nnd replay --dry-run --json .nnd/sessions/run-001
nnd replay capture.har
```

Mock rules belong under `legacy.mock`. Configuring them in Auto selects Legacy
with `NND_AUTO_LEGACY_MOCK_REQUIRED`; configuring them with forced Native throws
`NND_NATIVE_MOCK_CONFLICT` before an adapter starts.

## Release gates

The v2 gate builds and packs once, then installs that exact tarball into isolated
CJS and ESM consumers. Pull requests run mandatory Ubuntu protocol tests and a
supported runtime matrix; Node 24 also runs the complete Native, Legacy, CLI,
frontend, Session/HAR/Replay/Mock/Trace gates. Windows and macOS run adapter
smoke loops, while the larger OS/runtime matrix runs nightly. Publishing calls
the same reusable quality workflow and publishes the verified tarball with npm
trusted publishing/provenance rather than rebuilding it.

# Node Network Devtools

Inspect outbound Node.js traffic in the standard Chrome DevTools Network panel.

English | [简体中文](README-zh_CN.md)

[![npm downloads](https://img.shields.io/npm/dm/node-network-devtools?label=npm%20downloads)](https://www.npmjs.com/package/node-network-devtools)

Version 2 has two mutually exclusive backends:

- **Native** connects to Node's experimental Network Inspector without patching
  application network APIs.
- **Legacy** captures HTTP/HTTPS, Fetch, opted-in Undici, WebSocket frames, and
  SSE through a project-owned standard CDP target.

The runtime owns a target, not a Chrome process. Browser opening is explicit,
ports default to OS assignment, and Legacy application transport uses isolated
child-process IPC instead of the old 5270 WebSocket/lock-file design.

## Quick start

```bash
npm install --save-dev node-network-devtools

# Zero-code startup
npx nnd dev --open src/app.js

# Diagnose the actual runtime and adapter capabilities
npx nnd doctor --json
```

Library usage:

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

The handle remains callable for v1 compatibility: `const unregister =
register(); unregister()`.

## Capability summary

| Capability                     | Native            | Legacy |
| ------------------------------ | ----------------- | ------ |
| HTTP / HTTPS / Fetch lifecycle | Runtime-dependent | Yes    |
| HTTP/2                         | Runtime-dependent | No     |
| Response bodies                | Runtime-dependent | Yes    |
| Request bodies                 | Not advertised    | Yes    |
| WebSocket lifecycle / frames   | Lifecycle only    | Yes    |
| SSE messages                   | No                | Yes    |
| Request/response Mock          | No                | Yes    |

Native values are probed from the running Node version and Inspector methods.
Forced Native fails if requirements are missing; Auto returns a structured
reason whenever it uses Legacy.

## Session workflow

Both backends support persistent Network sessions, external response bodies,
HAR 1.2 export, traceparent correlation, and replay:

```ts
const registration = register({
  session: { directory: '.nnd/sessions/run-001', har: true }
})

await registration.ready
// run application traffic
await registration.dispose()
```

```bash
npx nnd replay --dry-run --json .nnd/sessions/run-001
npx nnd replay capture.har
```

Mock is intentionally Legacy-only. Auto selects Legacy when `legacy.mock` rules
are configured; forced Native reports `NND_NATIVE_MOCK_CONFLICT`.

## Documentation

- [npm package guide](packages/network-debugger/README.md)
- [v1 to v2 migration](docs/v2-migration.md)
- [v2 architecture and implementation evidence](docs/v2-implementation-plan.md)

The package requires Node.js `>=18.18`. Node 18 and 20 remain compatibility
lanes for migrations despite being EOL; maintained Node releases are preferred.
`undici@^6` remains a peer dependency so opt-in Legacy interception can patch
the application's package instance.

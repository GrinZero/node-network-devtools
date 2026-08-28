# Node Network Devtools v2 implementation plan

Status: in progress

Started: 2026-08-28

Owner: repository maintainers and Codex implementation session

This document is the authoritative implementation and completion plan for the v2
architecture. A phase is complete only when its code, tests, documentation, and
acceptance evidence are all present in the current worktree. A passing subset of
tests is not sufficient to mark the overall plan complete.

## Goals

1. Make `NodeNativeAdapter` a first-class backend from the first implementation
   phase.
2. Replace mocked "CDP correctness" tests with real protocol end-to-end tests.
3. Separate network capture, CDP target creation, and frontend launching.
4. Stop coupling the debug server lifecycle to a Chrome process.
5. Preserve a Legacy backend for capabilities missing from Node's native network
   inspector.
6. Improve zero-code setup, diagnostics, configuration, watch-mode behavior, and
   package-consumer verification.
7. Add session recording, HAR export, replay, Legacy-only mocking, and trace
   correlation after the runtime and connection layers are stable.

## Explicit non-goals for this plan

- Security hardening as a dedicated workstream.
- Incoming HTTP/server request inspection.
- A custom DevTools frontend.
- Bun or Deno support.
- Native/Legacy hybrid capture for a single session.
- Pretending that Node Native capabilities exist when the selected Node release
  does not provide them.

## Architectural decisions

### One complete backend per session

`NodeNativeAdapter` and `LegacyAdapter` are mutually exclusive complete
backends. Native uses Node's own capture, CDP implementation, and Inspector
target. Legacy uses the existing monkey-patch capture and a project-owned CDP
bridge. They must never emit the same request in one session.

```text
register / preload / CLI
          |
          v
 RuntimeController
  |- ConfigResolver
  |- AdapterSelector
  `- RegistrationHandle
          |
    +-----+-----------+
    |                 |
    v                 v
NodeNativeAdapter   LegacyAdapter
    |                 |
Node Inspector      Legacy capture + bridge
    |                 |
    +--------+--------+
             v
       DevtoolsTarget
          |       |
          v       v
 optional frontend  optional ProtocolTap/session pipeline
```

### Connection ownership

The backend owns a debuggable target, not a browser. Core runtime code must not
start a Chrome remote-debugging server, send `Page.navigate`, retain a browser
process handle, or kill a browser during disposal.

### Capability-driven selection

Selection is based on an explicit, versioned capability matrix verified by E2E
tests. Forced Native fails if requirements are not met. Only Auto may fall back
to Legacy, and it must expose a structured fallback reason.

## Public API target

```ts
const registration = register({
  mode: 'auto',
  requiredCapabilities: ['responseBody'],
  inspector: { host: '127.0.0.1', port: 0 },
  devtools: { open: false }
})

const ready = await registration.ready
console.log(ready.mode, ready.target, ready.capabilities)

await registration.openDevtools()
await registration.dispose()
```

During the compatibility period the returned handle remains callable, so the
existing `const unregister = register(); unregister()` form still works.

Mode semantics:

- `native`: require the experimental flag and required runtime capabilities;
  never silently fall back.
- `legacy`: always use project-owned capture and CDP bridge.
- `auto`: prefer a proven Native baseline, otherwise use Legacy with a visible
  fallback diagnostic.

## Phase 1: Native backend and real Native CDP E2E

### Deliverables

- [x] Define runtime, adapter, target, session, diagnostic, and capability types.
- [x] Implement `AdapterSelector`.
- [x] Implement `NodeNativeAdapter` using `node:inspector`.
- [x] Reuse an existing Inspector endpoint without taking ownership of it.
- [x] Open an Inspector on an OS-assigned port when the adapter owns the target.
- [x] Read the canonical target descriptor from Node's `/json/list` endpoint.
- [x] Return a backward-compatible observable registration handle.
- [x] Ensure Native never patches `fetch`, `http.request`, or `https.request`.
- [x] Ensure Native never forks or starts the Legacy 5270/5271 services.
- [x] Add real Native protocol E2E tests against the built package.
- [x] Add a CI quality workflow that runs the first Native E2E gate.

### Native E2E baseline

- [x] `Network.enable` returns a response with the same command id.
- [x] A real HTTP request emits a valid lifecycle.
- [x] A real Fetch request emits a valid lifecycle.
- [x] A failed request emits `Network.loadingFailed` only.
- [x] `Network.getResponseBody` returns the actual fixture body where supported.
- [x] `Runtime.evaluate('process.pid')` proves the client is attached to the
      target process.
- [x] Initiator data points to a real fixture source location where supported.
- [x] Explicit Native without the required flag fails with an actionable error.
- [x] Auto fallback returns a structured reason.
- [x] Disposal closes only an Inspector created by the adapter.

## Phase 2: target connection and developer experience

### Deliverables

- [x] Add the `nnd` CLI.
- [x] Add a side-effect preload export.
- [x] Add `nnd dev`, `nnd doctor`, and `nnd doctor --json`.
- [x] Launch Native targets with the experimental network-inspection flag.
- [x] Support wait-for-first-frontend and no-wait startup modes.
- [x] Add explicit frontend launching through a separate `FrontendLauncher`.
- [x] Remove the Chrome port 9333 polling and `Page.navigate` implementation.
- [x] Stop retaining or killing a Chrome process.
- [x] Add hosted official DevTools frontend smoke tests.
- [x] Add CJS, ESM, tsx, Nest compiled, and Node watch fixtures.

### Developer-experience acceptance

- [x] `nnd dev app.js` starts a Native-capable target with no source edit.
- [x] `nnd dev --open app.js` explicitly opens the returned target URL.
- [x] Library usage does not open a browser by default.
- [x] Ready output contains mode, target, capabilities, and fallback reason.
- [x] Diagnostics use stable codes and provide actionable hints.
- [x] Repeated registration is idempotent for equal configuration and rejects
      conflicting configuration.

## Phase 3: Legacy adapter and real Legacy CDP E2E

### Deliverables

- [x] Move current capture behavior behind `LegacyAdapter`.
- [x] Complete Auto/Native/Legacy selection and old-option migration.
- [x] Mark current request hooks as Legacy-only.
- [x] Add real Legacy protocol E2E with no mocked server or manufactured CDP
      events.
- [x] Respond to all command ids with a result or a standard CDP error.
- [x] Implement correct `Network.loadingFailed` behavior.
- [x] Preserve HTTP, Fetch, binary, SSE, WebSocket, and initiator behavior.

### Legacy protocol baseline

- [x] HTTP GET and Fetch POST.
- [x] Text, gzip, and binary response bodies.
- [x] Redirect, abort, reset, and timeout behavior.
- [x] SSE event name, id, data, and ordering.
- [x] WebSocket handshake, text frame, binary frame, and close.
- [x] Concurrent requests use stable, distinct request ids.
- [x] CJS and ESM package consumers.

## Phase 4: Legacy transport and discovery

### Deliverables

- [x] Replace the application-to-fork 5270 WebSocket with child-process IPC.
- [x] Remove the lock-file and WebSocket health-ping mechanisms.
- [x] Use a single HTTP server for Legacy target discovery and CDP WebSocket
      upgrade.
- [x] Implement `/json/list`, `/json/version`, and `/json/protocol`.
- [x] Default to port `0`; never probe a free port before binding.
- [x] Support multiple clients and DevTools refresh/reconnect.
- [x] Ensure abnormal bridge exits produce bounded recovery and visible status.
- [x] Ensure disposal leaves no port, timer, child, or pending promise behind.

## Phase 5: compatibility and release gates

### Deliverables

- [x] Maintain a capability matrix backed by tests rather than runtime skipping.
- [x] Add Node 18/20/22/24/26 runtime coverage as appropriate per adapter.
- [x] Run mandatory Ubuntu protocol E2E on pull requests.
- [x] Run Windows and macOS adapter smoke tests.
- [x] Run a complete OS/runtime matrix nightly.
- [x] Build and `npm pack` once, then test the published artifact as CJS and ESM
      consumers.
- [x] Make npm publishing depend on the same reusable quality workflow.
- [x] Document Native/Legacy differences and migration from old options.

## Phase 6: session and debugging enhancements

### Deliverables

- [x] Add a common protocol event journal/tap for both backends.
- [x] Store sessions as `manifest.json`, `events.ndjson`, and external body files.
- [x] Export valid HAR with matching text and binary bodies.
- [x] Replay requests from a session or HAR, including dry-run mode.
- [x] Implement request/response mocking for Legacy only.
- [x] Reject Native plus Mock as an explicit capability conflict.
- [x] Correlate existing `traceparent` values without injecting tracing by
      default.
- [x] Add real-network E2E for Session, HAR, Replay, Mock, and Trace.

## E2E architecture

Protocol E2E uses a thin raw WebSocket CDP client for both backends. It must
spawn a real packaged consumer, connect to the real endpoint, trigger a real
loopback request, and assert observed protocol invariants. It must not import a
backend plugin directly.

The fixture controller communicates with target applications over process IPC so
test-control traffic does not pollute Network events. Each scenario uses a unique
URL/query token and waits on explicit events instead of fixed sleeps.

Frontend smoke tests use the official DevTools frontend bundled with the exact
Playwright Chromium revision pinned in the lockfile. Chromium's loopback
remote-debugging HTTP server serves those generated assets locally. The tests
verify frontend connection, Network model population, response body retrieval,
reconnect, console errors, page errors, and the absence of non-loopback
frontend traffic. The source-only `chrome-devtools-frontend` npm tarball is not
treated as a runnable frontend build.

Required failure artifacts:

- Complete CDP inbound/outbound NDJSON journal.
- Target stdout and stderr.
- Session descriptor and capability selection.
- Playwright trace, screenshot, console, and page errors for frontend tests.

## CI target matrix

Pull-request minimum:

| Job              | Runtime and platform                       |
| ---------------- | ------------------------------------------ |
| Unit             | Node 20/22/24/26 on Ubuntu                 |
| Legacy runtime   | Node 18/20/22/24/26 on Ubuntu              |
| Native runtime   | supported Node 22/24/26 releases on Ubuntu |
| Adapter OS smoke | Node 24 on Windows and macOS               |
| Frontend smoke   | Node 24 on Ubuntu, Native and Legacy       |
| Pack consumer    | CJS and ESM from the generated tarball     |

The runtime E2E controller should use `node:test` so evidence for Node 18 does not
depend on the Vitest controller's own minimum runtime.

## Suggested source layout

```text
packages/network-debugger/
  src/
    runtime/
    adapters/
      node-native/
      legacy/
    target/
    diagnostics/
    config/
    session/
    preload/
    cli/
    legacy-bridge/
  test/e2e/
    fixtures/
    harness/
    contracts/
    protocol/
    frontend/
```

## Final completion audit

Before declaring the overall plan complete, inspect current evidence for every
checkbox above and additionally prove:

- [x] Native requests appear exactly once and never pass through Legacy code.
- [x] Native does not change the references of supported network APIs.
- [x] Legacy retains every previously documented capability.
- [x] Both backends connect through actual standard targets.
- [x] The project no longer owns a Chrome process.
- [x] Protocol E2E contains no `vi.mock`, fake WebSocket server, or hand-written
      `Network.*` event used as product evidence.
- [x] Both protocol suites pass 50 consecutive runs without a failure or leaked
      process.
- [ ] Windows and macOS smoke suites pass 20 consecutive runs.
- [x] Frontend smoke passes 10 consecutive runs.
- [ ] Pull requests and publishing are blocked by the verified quality workflow.
- [x] Documentation describes actual current capabilities, not intended ones.
- [x] Every planned artifact exists in the packed npm output when required.

## Progress log

- 2026-08-28: Plan established from repository inspection, Node official
  network-inspection capabilities, and a successful local Node 24.16 Native CDP
  probe. Phase 1 started.
- 2026-08-28: Phase 1 requirement audit passed. Evidence: 886 unit tests; clean
  Vite build plus declaration emit; four real built-package Native CDP E2E
  scenarios; ten consecutive E2E repetitions; owned/reused Inspector lifecycle
  tests; public forced-Native and Auto-fallback tests; and a pull-request quality
  workflow running unit, build, and Native E2E. Node 24.16 emits Native
  `wallTime` in epoch milliseconds, so the Native-only E2E records and validates
  that upstream deviation without transforming the direct Inspector protocol.
- 2026-08-28: Phase 2 requirement audit passed. Evidence: 910 unit tests; clean
  declaration and dual-runtime builds including ESM-only preload; four real
  Native protocol scenarios; eight built-package CLI E2E scenarios covering
  doctor, real `--open`/Inspector-wait resume, Auto-to-Legacy fallback, CJS,
  ESM, tsx, watch, compiled Nest-style startup, signals, and orphan cleanup;
  and an official pinned Chromium DevTools frontend smoke that populated its
  real Network model, retrieved two response bodies across a reload/reconnect,
  rejected non-loopback frontend traffic, and passed ten consecutive runs. The
  CI quality job installs that pinned browser and runs all Phase 1/2 gates.
- 2026-08-28: Phase 3 requirement audit passed. Legacy capture is isolated behind
  its adapter and uses a real built-package CDP target. Evidence: eight protocol
  scenarios pass for both CJS and ESM consumers and ten consecutive repetitions
  completed 80/80; coverage includes HTTP, Fetch POST (including multi-chunk
  request bodies), text/gzip/binary bodies, redirect/reset/timeout/abort, SSE,
  WebSocket text/binary/close, 20 concurrent command ids, response-body retrieval,
  standard CDP errors, and initiators. The official frontend also passed ten
  consecutive Legacy runs and a combined Native/Legacy reconnect run.
- 2026-08-28: Phase 4 requirement audit passed. The Legacy application bridge now
  uses advanced-serialization child IPC and a single loopback HTTP/WebSocket target
  on an OS-assigned port; the old 5270 transport, lock file, and health endpoint are
  gone. Fifty-five target/discovery tests and 25 IPC lifecycle tests cover bounded
  queues/history, multi-client isolation, stable target recovery, child flag
  sanitization, and terminal diagnostics. A CLI shutdown race found by full E2E was
  fixed by making the dedicated bridge close and exit on parent IPC disconnect;
  the focused regression and the complete 8/8 CLI suite leave no matching child.
- 2026-08-28: Phase 6 requirement audit passed. A backend-neutral real CDP
  `ProtocolTap` records atomic manifests, NDJSON events, integrity-indexed external
  bodies, and existing trace context; HAR 1.2 export preserves text/binary bodies,
  while library and `nnd replay` APIs support Session/HAR dry-run and real replay.
  Legacy-only HTTP/Fetch/Undici mocks traverse normal capture, Auto exposes a
  structured reason, and forced Native fails with `NND_NATIVE_MOCK_CONFLICT`.
  Twenty-two Session unit/integration tests and the full unit suite passed. The
  built-package enhancement E2E passed 2/2 and then 20/20 across ten repetitions,
  covering six real business requests/bodies, HAR, Replay, HTTP+Fetch Mock,
  traceparent/tracestate, and zero origin leakage. That gate exposed and verified
  the fix for an internal ProtocolTap self-observation recursion: the final
  manifest contains exactly six requests, six bodies, zero failures, and no child
  process leak.
- 2026-08-28: Phase 5 requirement audit passed. The reusable quality workflow
  builds and packs exactly once, then gates isolated CJS/ESM consumers, Ubuntu
  Native/Legacy/CLI/enhancement protocol suites, the official frontend, Node
  20/22/24/26 unit lanes, Legacy Node 18/20/22/24/26, Native Node 22/24/26, and
  Windows/macOS Node 24 20-round adapter smoke. Nightly adds Legacy on both OSes
  for all five runtimes and Native for 22/24/26. Local exact-tarball evidence was
  green across those available runtimes and macOS smoke; Node 22's incomplete
  Native Fetch body caused the public cross-transport `responseBody` capability
  to be conservatively disabled there. Publishing consumes the same SHA-256
  verified artifact through the reusable gate with OIDC/provenance and checks
  its release tag. That phase-5 candidate `node-network-devtools-2.0.0.tgz` installed in CJS
  and ESM consumers, exposed all five exports/two bins, contained 187 files, and
  passed `npm publish --dry-run` without performing a real publish.
- 2026-08-28: Final local audit passed on the post-review tree. Three independent
  reviews found and drove fixes for the Node `--import` minimum (`>=18.18`),
  side-effect preload declarations, stale published-site instructions, missing
  packed LICENSE, finite Legacy/`-e`/`-p` process lifetime, and negotiated
  `permessage-deflate` capture. The final local gate passed 60 files/833 unit
  tests, declaration plus CJS/ESM builds with no TypeScript diagnostic, all
  Native/Legacy/enhancement/CLI/official-frontend E2E, and the nine-page
  VuePress build. Native and Legacy protocol suites each passed 50 consecutive
  final-tree runs; frontend, enhancement, and CLI suites each passed 10
  consecutive runs; the watcher-specific regression passed 50; macOS packed
  Native and Legacy adapters each passed 20 rounds; and no matching process
  remained. The current exact `node-network-devtools-2.0.0.tgz` installs in CJS
  and ESM consumers, passes packed Native/Legacy runtime tests plus publish
  dry-run, contains 190 files including LICENSE, and has SHA-256
  `df5e666727df06563e20194d0f777c2b17cb18942c28eba4be22a9316e8f9df0`.
  Windows 20-round evidence and the active required `Quality Gate` repository
  ruleset remain deliberately unchecked until the pushed branch succeeds in
  GitHub Actions.

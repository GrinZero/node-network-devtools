# Phase 6 enhancements E2E

This suite is a black-box acceptance gate for Session, HAR, Replay, Legacy Mock,
and trace correlation. It loads the built ESM package, starts a real Legacy CDP
target, connects both a raw CDP client and `SessionRecorder`, and sends business
traffic to a real loopback origin. Process IPC is used only for test control.

Run it after building the package:

```sh
pnpm --filter node-network-devtools build
node --test packages/network-debugger/test/e2e/enhancements/enhancements.test.mjs
```

The suite verifies:

- `manifest.json`, ordered `events.ndjson`, content-addressed body files, and
  body integrity hashes;
- HAR 1.2 text and binary bodies plus POST data;
- Session dry-run planning and real HAR replay against the loopback origin;
- real `http.request` and Fetch calls intercepted by Legacy Mock without origin
  leakage;
- correlation of an existing `traceparent`/`tracestate` and absence of implicit
  trace-header injection; and
- the stable Native-plus-Mock conflict through a separate built consumer.

On failure, the harness prints a temporary artifact directory containing the
session, raw CDP journal, consumer logs, IPC messages, and origin request log.

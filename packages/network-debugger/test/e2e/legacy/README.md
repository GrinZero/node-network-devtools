# Real Legacy protocol E2E

This suite starts the built ESM or CommonJS public package in a real child
process with `mode: "legacy"`. Test control uses the child's IPC channel. HTTP,
Fetch, SSE, and WebSocket traffic goes to a real loopback origin and is observed
only through a raw WebSocket CDP client.

The contract intentionally requires the v2 Legacy architecture:

- `legacy.serverPort: 0` binds the target on an OS-assigned port;
- `registration.ready.target` agrees with `/json/list`;
- `/json/version` and `/json/protocol` are served by the same endpoint;
- every CDP command id receives either `result` or a standard `error`;
- failed requests terminate with `Network.loadingFailed`, never a manufactured
  successful lifecycle.

No test imports Legacy plugins, mocks the bridge, or manufactures protocol
events. On failure the harness writes the raw CDP journal, origin journal,
consumer stdout/stderr, IPC records, and target discovery metadata to a temporary
artifact directory (or `NETWORK_DEBUGGER_E2E_ARTIFACT_DIR` when configured).

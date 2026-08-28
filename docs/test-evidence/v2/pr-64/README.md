# PR #64 manual acceptance evidence

Result: **14/14 manual test cases passed**.

This is the human-observable acceptance layer for the automated v2 suite. The
run used the exact packed package from the tested product commit, an isolated
consumer, real loopback traffic, the public CLI/runtime APIs, standard CDP
discovery, and the official Chromium DevTools Network panel. The evidence set
contains 26 privacy-reviewed screenshots, 17 structured artifacts, five
reproduction harnesses, two test-only localhost certificate inputs, and a
checksum manifest.

## Evidence identity

| Field                 | Value                                                              |
| --------------------- | ------------------------------------------------------------------ |
| Pull request          | [#64](https://github.com/GrinZero/node-network-devtools/pull/64)   |
| Tested product commit | `449d47db89109e826eb0e7e0584777365eac3f9b`                         |
| Installed package     | `node-network-devtools@2.0.0`                                      |
| Packed files          | 190                                                                |
| Tarball SHA-256       | `e97dc360d2fcd5d141b13bca490f603b802dc7fe94f3b6a06a690c7a7f48e2ac` |
| Harness SHA-256       | `46f81eb2930040a31f402cf4cb113758628eb72c9db27617babba1d3df31af27` |
| Primary runtime       | Node.js `v24.16.0`, `darwin-arm64`                                 |
| Compatibility probe   | Node.js `v22.22.3`, `v24.16.0`, and `v26.8.1`                      |
| Browser               | Chrome for Testing `151.0.7922.34`                                 |
| Browser automation    | `@playwright/cli 0.1.18`, engine `1.63.0-alpha-2026-08-05`         |
| Test date             | 2026-08-28 (Asia/Shanghai)                                         |

The package was built and packed at the tested product commit, hashed, and
installed into an otherwise empty consumer. The harness imports only the public
exports from that installed tarball. The package identity is repeated in the
[Native runtime artifact](../../../../output/playwright/pr-64/artifacts/native-runtime.json),
[Legacy runtime artifact](../../../../output/playwright/pr-64/artifacts/legacy-runtime.json),
and [manifest](../../../../output/playwright/pr-64/manifest.json).

## Method and trust boundary

- Playwright operated visible scenario controls and the official Chromium
  DevTools frontend. Every click caused the isolated consumer process to issue
  real outbound traffic; the screenshots are not a mock DevTools UI.
- Computer Use was used for the exploratory integrated-terminal CLI pass. The
  final repeatable CLI proof was rerun through a Playwright control page and
  persisted as both a screenshot and structured JSON.
- HTTP, HTTPS, Fetch, SSE, WebSocket, failed requests, mocks, and replay all used
  local loopback servers. HTTPS used the retained test-only localhost
  certificate; its client explicitly disabled trust verification for that
  fixture only.
- The harness fetched and asserted the complete `/json/list`, `/json/version`,
  and `/json/protocol` contracts, including the Network domain. Raw discovery
  screenshots containing a local file URL were deliberately excluded; the
  privacy-safe capability page, version page, and structured response retain
  the same protocol assertions.
- Session manifests, raw CDP events, HAR files, replay summaries, CLI results,
  capability-boundary assertions, and disposal probes are committed alongside
  the screenshots. Only local filesystem prefixes were redacted; protocol
  methods, statuses, bodies, counters, and lifecycle semantics were preserved.
- [`checksums.sha256`](../../../../output/playwright/pr-64/checksums.sha256)
  covers all 51 retained files in the evidence bundle other than
  `.gitignore` and the checksum file itself. Screenshots satisfy the requested
  visual-evidence option; no video is committed.

## Test cases

| ID    | Manual action                                                                                                               | Expected result                                                                                                                  | Observed result and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Status   |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| MT-01 | Run `nnd --version`, then run `nnd doctor --json` with Node network inspection enabled.                                     | Version is `2.0.0`; doctor is healthy, has no missing requirement, and selects Native.                                           | `version=2.0.0`, `ok=true`, `experimentalFlag=true`, `missingRequired=[]`, `selected=native`. [Screenshot](../../../../output/playwright/pr-64/screenshots/MT-01-cli-version-doctor-native.png) · [CLI JSON](../../../../output/playwright/pr-64/artifacts/cli-manual-results.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **PASS** |
| MT-02 | Run public `nnd dev` in Native and Legacy modes, force Native with a mock rule, and run `nnd dev --open`.                   | Both modes inject the preload and expose a target; invalid Native + Mock fails; `--open` launches exactly the advertised target. | Six visible CLI cases passed. Native received inspection/import flags; Legacy received the import; conflict returned `NND_NATIVE_MOCK_CONFLICT`; the OS launch was redirected to an exact-target CDP verifier and occurred once. [Screenshot](../../../../output/playwright/pr-64/screenshots/MT-02-cli-zero-code-and-conflict.png) · [CLI JSON](../../../../output/playwright/pr-64/artifacts/cli-manual-results.json)                                                                                                                                                                                                                                                                                                                                                                         | **PASS** |
| MT-03 | Register the exact package in Native mode and inspect identity, public references, target, and capabilities.                | Native is ready without fallback; public networking functions remain unpatched; only verified capabilities are advertised.       | Native selected; original `fetch`, `http.request`, and `https.request` references were preserved. Node 24 correctly reports `http2=false`, `requestBody=false`, `websocketFrames=false`, and `sseMessages=false`. [Screenshot](../../../../output/playwright/pr-64/screenshots/MT-03-native-runtime-and-capabilities.png) · [Runtime JSON](../../../../output/playwright/pr-64/artifacts/native-runtime.json)                                                                                                                                                                                                                                                                                                                                                                                   | **PASS** |
| MT-04 | Fetch the Native target's `/json/list`, `/json/version`, and `/json/protocol` endpoints.                                    | One matching Node target is discoverable; version metadata is valid; the protocol exposes the Network domain.                    | Target count `1`, matching id, browser `node.js/v24.16.0`, protocol `1.1`, Network domain present with 6 commands and 8 events. [Capability/discovery screenshot](../../../../output/playwright/pr-64/screenshots/MT-03-native-runtime-and-capabilities.png) · [Version screenshot](../../../../output/playwright/pr-64/screenshots/MT-04-native-version.png) · [Structured contract/runtime JSON](../../../../output/playwright/pr-64/artifacts/native-runtime.json)                                                                                                                                                                                                                                                                                                                           | **PASS** |
| MT-05 | Open official DevTools and trigger real HTTP GET, HTTPS GET, and Fetch POST requests; inspect list, headers, and response.  | Each request appears once with correct status and metadata; response bodies are readable.                                        | Requests returned `200`, `200`, and `201`; the Fetch headers carry the correlation token and its response echoes the manual value. Native does not claim request-body retrieval. [List](../../../../output/playwright/pr-64/screenshots/MT-05-native-devtools-network-list.png) · [Headers](../../../../output/playwright/pr-64/screenshots/MT-05-native-fetch-headers.png) · [Response](../../../../output/playwright/pr-64/screenshots/MT-05-native-fetch-response.png) · [Events](../../../../output/playwright/pr-64/artifacts/native-events.ndjson)                                                                                                                                                                                                                                        | **PASS** |
| MT-06 | Reload official Native DevTools, reconnect to the same target, and trigger another GET.                                     | The frontend reconnects and captures post-reload traffic without replaying old rows as new requests.                             | A new `native-http-get-08` request appears with status `200` after reload/reconnect. [Screenshot](../../../../output/playwright/pr-64/screenshots/MT-06-native-devtools-reload-reconnect.png) · [Session manifest](../../../../output/playwright/pr-64/artifacts/native-session-manifest.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **PASS** |
| MT-07 | Register in Auto mode with Legacy mock rules and inspect backend selection and capabilities.                                | Auto selects Legacy with an explicit reason and exposes its larger detail-level capability set.                                  | Backend `legacy`; reason `NND_AUTO_LEGACY_MOCK_REQUIRED`; request-body, WebSocket-frame, and SSE-message capture enabled. [Screenshot](../../../../output/playwright/pr-64/screenshots/MT-07-legacy-runtime-and-capabilities.png) · [Runtime JSON](../../../../output/playwright/pr-64/artifacts/legacy-runtime.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **PASS** |
| MT-08 | Fetch the Legacy target's `/json/list`, `/json/version`, and `/json/protocol` endpoints.                                    | One matching project-owned CDP target is discoverable on loopback and the protocol exposes Network.                              | Target count `1`, matching id, browser `node-network-devtools/2`, protocol `1.3`, Network domain present with 7 commands and 12 events. [Capability/discovery screenshot](../../../../output/playwright/pr-64/screenshots/MT-07-legacy-runtime-and-capabilities.png) · [Version screenshot](../../../../output/playwright/pr-64/screenshots/MT-08-legacy-version.png) · [Structured contract/runtime JSON](../../../../output/playwright/pr-64/artifacts/legacy-runtime.json)                                                                                                                                                                                                                                                                                                                   | **PASS** |
| MT-09 | In official DevTools, trigger Legacy HTTP GET, HTTPS GET, and Fetch POST; inspect list, Payload, and Response.              | Statuses are correct and both POST request body and response body are available.                                                 | Fetch is `201`; Payload contains `manual-request-body:legacy-fetch-post-03`; Response contains the matching echo. [List](../../../../output/playwright/pr-64/screenshots/MT-09-legacy-devtools-network-list.png) · [Payload](../../../../output/playwright/pr-64/screenshots/MT-09-legacy-fetch-payload.png) · [Response](../../../../output/playwright/pr-64/screenshots/MT-09-legacy-fetch-response.png) · [Events](../../../../output/playwright/pr-64/artifacts/legacy-events.ndjson)                                                                                                                                                                                                                                                                                                       | **PASS** |
| MT-10 | Trigger matching Legacy mock rules through `http.request` and Fetch; inspect status, body, headers, and origin counter.     | HTTP returns `207`, Fetch returns `202`, and neither request reaches the origin server.                                          | Both responses traverse the normal Network path; mock bodies/headers are visible and `originLeakCount=0`. [HTTP](../../../../output/playwright/pr-64/screenshots/MT-10-legacy-mock-http-response.png) · [Fetch](../../../../output/playwright/pr-64/screenshots/MT-10-legacy-mock-fetch-response.png) · [Summary](../../../../output/playwright/pr-64/artifacts/legacy-finalize-summary.json)                                                                                                                                                                                                                                                                                                                                                                                                   | **PASS** |
| MT-11 | Trigger SSE and WebSocket exchanges on both backends and inspect the visible detail tabs and protocol counters.             | Native reports only what upstream provides; Legacy exposes SSE messages and sent/received WebSocket frames.                      | Native: one create/close pair, zero frames, SSE request visible with zero message events. Legacy: two SSE messages plus 2 sent and 2 received frames. [Native lifecycle](../../../../output/playwright/pr-64/screenshots/MT-11-native-websocket-lifecycle.png) · [Legacy SSE](../../../../output/playwright/pr-64/screenshots/MT-11-legacy-sse-eventstream.png) · [Legacy WebSocket](../../../../output/playwright/pr-64/screenshots/MT-11-legacy-websocket-messages.png) · [Native assertion](../../../../output/playwright/pr-64/artifacts/native-finalize-summary.json) · [Legacy assertion](../../../../output/playwright/pr-64/artifacts/legacy-finalize-summary.json)                                                                                                                     | **PASS** |
| MT-12 | Finalize both recordings; inspect Session, HAR, trace correlation, library replay, and public CLI replay in dry/real modes. | Manifests complete without body errors; HAR is coherent; explicit trace context survives; dry and real replay both pass.         | Native replay `5/5 + 5/5`; Legacy replay `6/6 + 6/6`; public CLI replay `2/2 + 2/2` and preserved the POST body; trace headers were preserved only on the explicitly traced request. [Native](../../../../output/playwright/pr-64/screenshots/MT-12-native-session-har-replay-trace.png) · [Legacy](../../../../output/playwright/pr-64/screenshots/MT-12-legacy-session-har-replay-trace.png) · [CLI](../../../../output/playwright/pr-64/artifacts/cli-manual-results.json) · [Native summary](../../../../output/playwright/pr-64/artifacts/native-finalize-summary.json) · [Legacy summary](../../../../output/playwright/pr-64/artifacts/legacy-finalize-summary.json)                                                                                                                     | **PASS** |
| MT-13 | Trigger a connection-reset failure on both backends and probe Native HTTP/2 on Node 22, 24, and 26.                         | Failed requests emit exactly one terminal failure; HTTP/2 is advertised only where its complete lifecycle is verified.           | Both backends emitted one `requestWillBeSent` and one `loadingFailed`, with no response/finished event. Node 22.22.3 completed HTTP/2 with body `h2-ok`; Node 24.16/26.8 reproduced the upstream Inspector `Missing dataLength` crash and correctly advertised `http2=false`. [Native failure](../../../../output/playwright/pr-64/screenshots/MT-13-native-failed-request.png) · [Legacy failure](../../../../output/playwright/pr-64/screenshots/MT-13-legacy-failed-request.png) · [Native boundary](../../../../output/playwright/pr-64/screenshots/MT-13-native-boundary-assertions.png) · [Legacy boundary](../../../../output/playwright/pr-64/screenshots/MT-13-legacy-boundary-assertions.png) · [HTTP/2 probe](../../../../output/playwright/pr-64/artifacts/native-http2-probe.json) | **PASS** |
| MT-14 | Dispose each registration, then probe discovery HTTP and the target WebSocket.                                              | State becomes disposed and both endpoints reject new connections.                                                                | Both summaries report `registrationState=disposed`, `discoveryClosed=true`, and `targetSocketClosed=true`. [Native](../../../../output/playwright/pr-64/screenshots/MT-14-native-dispose-cleanup.png) · [Legacy](../../../../output/playwright/pr-64/screenshots/MT-14-legacy-dispose-cleanup.png) · [Native JSON](../../../../output/playwright/pr-64/artifacts/native-dispose-summary.json) · [Legacy JSON](../../../../output/playwright/pr-64/artifacts/legacy-dispose-summary.json)                                                                                                                                                                                                                                                                                                        | **PASS** |

## Representative visual evidence

<details>
<summary>CLI, runtime selection, and discovery</summary>

![CLI version and doctor](../../../../output/playwright/pr-64/screenshots/MT-01-cli-version-doctor-native.png)

![Six exact-package CLI cases](../../../../output/playwright/pr-64/screenshots/MT-02-cli-zero-code-and-conflict.png)

![Native runtime identity and capabilities](../../../../output/playwright/pr-64/screenshots/MT-03-native-runtime-and-capabilities.png)

![Legacy runtime identity and capabilities](../../../../output/playwright/pr-64/screenshots/MT-07-legacy-runtime-and-capabilities.png)

</details>

<details>
<summary>Official DevTools request details</summary>

![Native DevTools Network list](../../../../output/playwright/pr-64/screenshots/MT-05-native-devtools-network-list.png)

![Native Fetch response](../../../../output/playwright/pr-64/screenshots/MT-05-native-fetch-response.png)

![Legacy Fetch payload](../../../../output/playwright/pr-64/screenshots/MT-09-legacy-fetch-payload.png)

![Legacy Fetch response](../../../../output/playwright/pr-64/screenshots/MT-09-legacy-fetch-response.png)

![Legacy mock HTTP response](../../../../output/playwright/pr-64/screenshots/MT-10-legacy-mock-http-response.png)

![Legacy SSE messages](../../../../output/playwright/pr-64/screenshots/MT-11-legacy-sse-eventstream.png)

![Legacy WebSocket messages](../../../../output/playwright/pr-64/screenshots/MT-11-legacy-websocket-messages.png)

</details>

<details>
<summary>Recording, boundaries, failure, and cleanup</summary>

![Native Session, HAR, Replay, and Trace](../../../../output/playwright/pr-64/screenshots/MT-12-native-session-har-replay-trace.png)

![Legacy Session, HAR, Replay, and Trace](../../../../output/playwright/pr-64/screenshots/MT-12-legacy-session-har-replay-trace.png)

![Native capability boundary assertions](../../../../output/playwright/pr-64/screenshots/MT-13-native-boundary-assertions.png)

![Legacy failed-request lifecycle](../../../../output/playwright/pr-64/screenshots/MT-13-legacy-failed-request.png)

![Native disposal and closed endpoints](../../../../output/playwright/pr-64/screenshots/MT-14-native-dispose-cleanup.png)

![Legacy disposal and closed endpoints](../../../../output/playwright/pr-64/screenshots/MT-14-legacy-dispose-cleanup.png)

</details>

## Structured evidence summary

| Backend | Requests | Events | Bodies | Failed/body errors | HAR statuses                                  | Replay dry/real | Dispose                   |
| ------- | -------: | -----: | -----: | -----------------: | --------------------------------------------- | --------------- | ------------------------- |
| Native  |        9 |     24 |      6 |              1 / 0 | `200,200,201,200,0,200,0,0,200`               | 5/5, 5/5        | discovery + socket closed |
| Legacy  |       12 |     54 |     10 |              1 / 0 | `200,200,200,200,200,201,200,0,200,0,207,202` | 6/6, 6/6        | discovery + socket closed |

The zero-status HAR entries are intentionally incomplete SSE, WebSocket, or
failed-request lifecycles. Their exact terminal-event assertions are recorded in
the finalize summaries. There were no response-body retrieval errors and no
mock-origin leaks.

The HTTP/2 compatibility probe deserves separate emphasis. A non-empty h2c
response completed `requestWillBeSent -> responseReceived -> loadingFinished`
on Node 22.22.3. The same exact package and request reproduced an upstream
`node:internal/inspector/network_http2` crash on Node 24.16.0 and 26.8.1.
Consequently, commit `449d47d` changed the public capability matrix from an
open-ended minimum-version claim to the verified Node 22.20+ 22.x line. This is
consistent with Node's still-open
[network-inspection stabilization tracker](https://github.com/nodejs/node/issues/53946)
and avoids promising behavior that the runtime cannot safely deliver.

## Reproduction

The retained harnesses are
[`manual-evidence-server.mjs`](../../../../output/playwright/pr-64/manual-evidence-server.mjs),
[`manual-cli-evidence-server.mjs`](../../../../output/playwright/pr-64/manual-cli-evidence-server.mjs),
[`manual-cli-case.sh`](../../../../output/playwright/pr-64/manual-cli-case.sh),
[`manual-native-mock-conflict.mjs`](../../../../output/playwright/pr-64/manual-native-mock-conflict.mjs),
and
[`manual-native-http2-probe.mjs`](../../../../output/playwright/pr-64/manual-native-http2-probe.mjs).

To reproduce:

1. Check out product commit `449d47db89109e826eb0e7e0584777365eac3f9b`,
   install from the lockfile, build, and pack `packages/network-debugger`.
2. Verify the tarball SHA-256 above, then install it into an empty consumer.
3. Set `NND_MANUAL_CONSUMER_ROOT`, `NND_MANUAL_PRODUCT_COMMIT`, and
   `NND_MANUAL_TARBALL_SHA256`. Start the Native harness with
   `--experimental-network-inspection`, or start the Legacy harness normally.
4. Open the printed control URL. Click one scenario at a time and inspect the
   printed official DevTools URL.
5. Run the CLI evidence server's six visible cases and the three-version HTTP/2
   probe. Compare all retained files with `checksums.sha256`.

## Scope

- All business traffic was loopback-only. Public-network and production
  endpoints were intentionally out of scope.
- Native limitations are visible results, not simulated features. On the
  primary Node 24 run, request bodies, WebSocket frames, SSE messages, and
  HTTP/2 are not advertised. Those detail-level claims are tested on Legacy or
  on the verified Node 22 HTTP/2 runtime.
- This manual run covers macOS arm64. The PR quality workflow remains responsible
  for the repeatable Linux, macOS, Windows, and supported-Node automation.

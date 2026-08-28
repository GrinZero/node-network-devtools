# Official DevTools frontend smoke

This test uses the official DevTools frontend bundled with the Chromium revision pinned by
`@playwright/test@1.62.1` (Playwright Chromium build 1234 / Chrome for Testing 151.0.7922.34).
The Chromium remote-debugging server hosts that exact build locally, and both Native and Legacy
smokes open:

```text
http://<chromium-rdp-host>/devtools/js_app.html?experiments=true&v8only=true&ws=<target-host/path>&hl=en-US
```

The browser serves `/devtools/js_app.html`, its generated entrypoints, and model modules itself;
there is no copied or third-party frontend. Chromium is launched with external networking disabled
and the frontend, target, and origin all use bundled assets or `127.0.0.1`, so the test requires no
internet access.
The test also records frontend resource requests and WebSockets and fails if any use a non-loopback
host.

The pinned frontend model API used by the smoke is deliberately small:

```js
const Logs = await import('./models/logs/logs.js')
const requests = Logs.NetworkLog.NetworkLog.instance().requests()
const content = await request.requestContentData()

const SDK = await import('./core/sdk/sdk.js')
const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget()
```

Each smoke performs the request/body assertion twice: once after the initial connection, then again
after reloading the frontend and confirming that it recreated one active `node` target. Both
requests carry different generated tokens. The Legacy smoke starts the built public package with
forced Legacy and `serverPort: 0`, connects through its standard discovered target, and keeps two
additional raw CDP clients connected. Those clients deliberately issue different commands with the
same numeric command id, proving that a successful body response and an unknown-method error are
returned only to their issuing connections while the official frontend also requests the body.

`chrome-devtools-frontend@1.0.1684555` was evaluated but cannot be served directly: its npm
tarball contains TypeScript sources and `front_end/entrypoint_template.html`, but no generated
`js_app.html`, JavaScript entrypoint, or generated CSS modules. Building it requires Chromium's
GN/depot_tools toolchain. The Playwright Chromium bundle is therefore the reproducible runnable
frontend pin for this test; an old third-party prebuilt package must not be substituted.

Run after building the package and installing Playwright Chromium:

```sh
pnpm --filter node-network-devtools build
pnpm exec playwright install chromium
pnpm exec playwright test -c test/e2e/frontend/playwright.config.mjs
```

Run only the forced-Legacy smoke with:

```sh
pnpm exec playwright test -c test/e2e/frontend/playwright.config.mjs legacy-frontend.spec.mjs
```

Suggested package script:

```json
"test:e2e:frontend": "playwright test -c test/e2e/frontend/playwright.config.mjs"
```

CI should install the pinned browser before the offline test phase with
`pnpm exec playwright install --with-deps chromium`, build `node-network-devtools`, run this script
on the Node version that provides `--experimental-network-inspection`, and upload
`NETWORK_DEBUGGER_E2E_ARTIFACT_DIR` with `if: always()`.

The Legacy smoke attaches a full-page screenshot, Playwright trace, browser/frontend logs, metadata,
and both raw-client CDP journals on success. On failure both smokes attach the same frontend evidence
plus target logs and the primary CDP NDJSON journal.

The Chromium asset server has no `/favicon.ico`; that one exact local 404 is ignored. Known failures
of optional Network commands not implemented by Node Native are allowlisted only for the Native
smoke. Legacy owns its CDP implementation and has no protocol-error allowlist. Every other frontend
console error, page error, renderer crash, or non-loopback connection fails either smoke.

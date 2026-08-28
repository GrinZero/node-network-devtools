# Get Started

Node Network Devtools is a network debugging tool that integrates Chrome Devtools. It provides a network debugging experience equivalent to a browser, and is ultra easy to access. It is free of proxy competition and trouble.

Node.js `>=18.18` is required.

## Install

::: code-tabs

@tab pnpm

```bash:no-line-numbers
pnpm add -D node-network-devtools
```

@tab yarn

```bash:no-line-numbers
yarn add -D node-network-devtools
```

@tab npm

```bash:no-line-numbers
npm i -D node-network-devtools
```

:::

## Usage

The CLI is the recommended zero-code entry point. `--open` opens the exact
Inspector or Legacy target after it is ready; without it, the CLI prints the
target and leaves browser ownership to you.

```bash
npx nnd dev --open src/app.js
npx nnd dev --no-wait --runner tsx src/app.ts -- --port 3000
npx nnd doctor --json
```

Native/Auto starts paused by default so the frontend cannot miss startup
traffic. Add `--no-wait` when the application should start immediately.

Library registration is also available for ESM and CommonJS applications:

::: code-tabs

@tab typescript

```typescript
import { register } from 'node-network-devtools'

const registration = register({
  mode: 'auto',
  devtools: { open: true }
})

const ready = await registration.ready
console.log(ready.mode, ready.target.discoveryUrl)

// Call during application shutdown.
await registration.dispose()
```

@tab javascript

```javascript
const { register } = require('node-network-devtools')

const registration = register({
  mode: 'legacy',
  devtools: { open: true }
})

registration.ready.then(({ mode, target }) => {
  console.log(mode, target.discoveryUrl)
})
```

:::

Browser opening is opt-in and target ports default to an OS-assigned port. See
[configuration options](./options.md) and the
[v1 to v2 migration guide](https://github.com/GrinZero/node-network-devtools/blob/main/docs/v2-migration.md).

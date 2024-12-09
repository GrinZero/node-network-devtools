# Get Started

Node Network Devtools is a network debugging tool that integrates Chrome Devtools. It provides a network debugging experience equivalent to a browser, and is ultra easy to access. It is free of proxy competition and trouble.

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

Node.js programs that support both ESM and CommonJS standards only need to introduce and call the 'register' method in the entry file.

::: code-tabs

@tab typescript

```typescript
import { register } from 'node-network-devtools'
register()
```

@tab javascript

```javascript
const { register } = require('node-network-devtools')
register()
```

:::

If you want to use options, you can go to [options](./options.md) to see the details.

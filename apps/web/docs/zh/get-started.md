# 快速开始

Node Network Devtools 是一款软集成了 Chrome Devtools 的网络调试工具。它提供了相当于浏览器的网络调试体验，并且非常容易接入。

要求 Node.js `>=18.18`。

## 安装

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

## 使用

推荐使用 CLI 零代码接入。`--open` 会在 Inspector 或 Legacy target 就绪后打开
准确的调试地址；不传该参数时，CLI 只输出 target，浏览器进程仍由你管理。

```bash
npx nnd dev --open src/app.js
npx nnd dev --no-wait --runner tsx src/app.ts -- --port 3000
npx nnd doctor --json
```

Native/Auto 默认会先暂停应用，避免 DevTools 前端错过启动阶段的请求；希望应用立即
运行时可添加 `--no-wait`。

ESM 和 CommonJS 应用也可以使用库 API：

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

// 在应用退出流程中调用。
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

浏览器打开行为需要显式启用，target 端口默认由操作系统分配。完整配置见
[选项](./options.md) 和
[v1 到 v2 迁移指南](https://github.com/GrinZero/node-network-devtools/blob/main/docs/v2-migration.md)。

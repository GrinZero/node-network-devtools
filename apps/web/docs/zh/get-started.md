# 快速开始

Node Network Devtools 是一款软集成了 Chrome Devtools 的网络调试工具。它提供了相当于浏览器的网络调试体验，并且非常容易接入。

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

支持 esm 和 commonjs 标准的nodejs程序，只需要在入口文件中引入并调用`register`方法即可。

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

如果需要使用选项，可以前往 [选项](./options.md) 查看详细说明。

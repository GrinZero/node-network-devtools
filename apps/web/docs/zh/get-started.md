# 快速开始

Node Network Devtools 是一款软集成了 Chrome Devtools 的网络调试工具。它提供了相当于浏览器的网络调试体验，并且非常容易接入。

## 安装

<CodeGroup>
  <CodeGroupItem title="pnpm">

```bash:no-line-numbers
pnpm add node-network-devtools
```

  </CodeGroupItem>

  <CodeGroupItem title="yarn">

```bash:no-line-numbers
yarn add node-network-devtools
```

  </CodeGroupItem>

  <CodeGroupItem title="npm" active>

```bash:no-line-numbers
npm i node-network-devtools
```

  </CodeGroupItem>
</CodeGroup>

## 配置

将此文件添加到`.gitignore`文件中。虽然这不会对使用产生任何影响，但建议这样做。

```
request-center.lock
```

## 使用

支持 esm 和 commonjs 标准的nodejs程序，只需要在入口文件中引入并调用`register`方法即可。

<CodeGroup>
  <CodeGroupItem title="typescript">

```typescript
import { register } from 'node-network-devtools'
register()
```

  </CodeGroupItem>

  <CodeGroupItem title="javascript" active>

```javascript
const { register } = require('node-network-devtools')
register()
```

  </CodeGroupItem>
</CodeGroup>

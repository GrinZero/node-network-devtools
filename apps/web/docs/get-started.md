# Get Started

Node Network Devtools is a network debugging tool that integrates Chrome Devtools. It provides a network debugging experience equivalent to a browser, and is ultra easy to access. It is free of proxy competition and trouble.

## Install

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

## Config

Add this code to your `.gitignore` file. Although this will not have any impact on operation, it is recommended that you do so.

```
request-center.lock
```

## Usage

Node.js programs that support both ESM and CommonJS standards only need to introduce and call the 'register' method in the entry file.

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

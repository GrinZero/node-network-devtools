# 配置选项

v2 API 将后端选择、Inspector target、前端打开方式、Legacy hook 和会话记录分开配置。

```ts
import { register, type RegisterOptions } from 'node-network-devtools'

const options: RegisterOptions = {
  mode: 'auto',
  requiredCapabilities: ['responseBody'],
  inspector: { host: '127.0.0.1', port: 0 },
  devtools: { open: false },
  session: { directory: '.nnd/sessions/local', har: true },
  legacy: {
    serverPort: 0,
    intercept: { normal: true, fetch: true, undici: { fetch: false } }
  }
}

const registration = register(options)
await registration.ready
await registration.dispose()
```

## `mode`

- `auto`（默认）：优先选择经过验证的 Native 实现；切换到 Legacy 时会返回结构化原因。
- `native`：要求 Node 的实验性 Network Inspector 和所有指定能力，绝不静默回退。
- `legacy`：安装项目自己的捕获 hook，并使用项目提供的标准 CDP target。

## `requiredCapabilities`

数组成员可以是 `http`、`https`、`fetch`、`http2`、`responseBody`、
`requestBody`、`websocketLifecycle`、`websocketFrames`、`sseMessages` 或
`initiator`。如果后端缺少任一必需能力，选择过程会失败或回退。

## `inspector`

- `host`：Inspector 绑定地址，默认为 `127.0.0.1`。
- `port`：Inspector 端口，默认为 `0`，即交给操作系统分配。

## `devtools`

- `open`：库注册完成后是否显式打开返回的 target，默认为 `false`。

后端不会持有或结束由此打开的浏览器进程。

## `session`

- `directory`：`manifest.json`、`events.ndjson` 和 `bodies/` 的准确输出目录；
  该目录不能已经包含 Session 产物。
- `bodyCommandTimeoutMs`：每次 `Network.getResponseBody` 命令的可选正数超时。
- `har`：`true` 表示在释放时将 `session.har` 写入 Session 目录；字符串表示
  指定路径；省略或设为 `false` 则不自动导出。

记录器会先于后端关闭，以便未完成的 body 命令能够正常结束。

## `legacy`

### `serverPort`

Legacy CDP discovery/WebSocket target 的端口，默认为 `0`。应用与桥接子进程之间
已经改用 IPC，不再占用旧的 TCP 端口。

### `intercept`

- `normal`：捕获 `http.request/get` 和 `https.request/get`，默认开启。
- `fetch`：捕获全局 Fetch，默认开启。
- `undici.fetch`：捕获单独安装的 Undici Fetch，默认关闭，需要显式选择。
  `undici@^6` 是 package peer，确保 hook 使用应用的同一个模块实例；关闭 peer
  自动安装时需要手动安装。

关闭的传输会在该 Legacy 会话中报告为不可用能力。

### `mock`

按顺序匹配的 Legacy 专用请求/响应规则：

```ts
{
  id: 'fixture',
  match: {
    url: 'https://api.example.test/*', // 精确地址或 `*` glob
    method: 'POST',
    headers: { 'x-test-mode': 'mock' }
  },
  response: {
    status: 201,
    statusText: 'Created',
    headers: { 'content-type': 'application/json' },
    body: '{"mocked":true}',
    // bodyBase64: 'AAEC/w==', // 二进制响应可用此字段
    delayMs: 10
  }
}
```

配置规则后，Auto 会选择 Legacy。强制 Native 会同步抛出
`NND_NATIVE_MOCK_CONFLICT`。

## 已弃用的 v1 字段

- `adapter` → `mode`
- `requiredFeatures` → `requiredCapabilities`
- `autoOpenDevtool` → `devtools.open`
- 顶层 `serverPort` → `legacy.serverPort`
- 顶层 `intercept` → `legacy.intercept`
- `port` → 删除；子进程 IPC 已取代旧的 5270 WebSocket bridge

迁移到 v2 期间，这些兼容字段仍然可用，并会产生诊断信息。

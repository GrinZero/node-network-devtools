# Node Network Devtools

在标准 Chrome DevTools Network 面板中查看 Node.js 发出的网络请求。

[English](README.md) | 简体中文

v2 提供两个互斥、完整的后端：

- **Native**：直接连接 Node 实验性的 Network Inspector，不修改应用网络 API。
- **Legacy**：通过项目自有的标准 CDP Target，捕获 HTTP/HTTPS、Fetch、可选
  Undici、WebSocket 帧和 SSE 消息。

运行时只拥有调试 Target，不拥有 Chrome 进程。打开浏览器必须显式选择；端口默认
交给操作系统分配；Legacy 应用传输已从旧的 5270 WebSocket/锁文件改为隔离的子进程
IPC。

## 快速开始

```bash
npm install --save-dev node-network-devtools

# 不改业务源码直接启动并打开 DevTools
npx nnd dev --open src/app.js

# 查看当前 Node 与后端的真实能力
npx nnd doctor --json
```

库 API：

```ts
import { register } from 'node-network-devtools'

const registration = register({
  mode: 'auto',
  requiredCapabilities: ['responseBody'],
  inspector: { host: '127.0.0.1', port: 0 },
  devtools: { open: false }
})

const ready = await registration.ready
console.log(ready.mode, ready.target, ready.capabilities, ready.fallbackReason)

await registration.openDevtools()
await registration.dispose()
```

为了兼容 v1，返回值仍然可以直接调用：`const unregister = register();
unregister()`。

## 能力概览

| 能力                          | Native                 | Legacy |
| ----------------------------- | ---------------------- | ------ |
| HTTP / HTTPS / Fetch 生命周期 | 取决于 Node 版本       | 支持   |
| HTTP/2                        | 仅 Node 22.20+（22.x） | 不支持 |
| 响应 Body                     | 取决于 Node 版本       | 支持   |
| 请求 Body                     | 不声明支持             | 支持   |
| WebSocket 生命周期 / 帧       | 仅生命周期             | 支持   |
| SSE 消息                      | 不支持                 | 支持   |
| 请求/响应 Mock                | 不支持                 | 支持   |

Native 能力根据实际 Node 版本和 Inspector 方法探测。强制 Native 时缺少能力会直接
失败；Auto 改用 Legacy 时会返回结构化原因，不会静默降级。

Native HTTP/2 采用保守白名单：仅 Node 22.20+ 的 22.x 版本声明支持。Node 22.22.3
已通过非空 h2c 生命周期实测；Node 24.16.0 与 26.8.1 在通过 `setEncoding()` 消费
非空响应时，会触发上游实验性 Inspector 的 `Missing dataLength` 崩溃。其他及未来
大版本在独立验证前一律报告为不支持；Legacy 也不捕获 HTTP/2。

## Session、HAR 与 Replay

两个后端都可以持久化 Network Session、外置保存响应 Body、导出 HAR 1.2、关联已有
`traceparent`，并回放请求：

```ts
const registration = register({
  session: { directory: '.nnd/sessions/run-001', har: true }
})

await registration.ready
// 执行业务请求
await registration.dispose()
```

```bash
npx nnd replay --dry-run --json .nnd/sessions/run-001
npx nnd replay capture.har
```

Mock 明确只属于 Legacy。Auto 配置 `legacy.mock` 时会选择 Legacy；强制 Native 会返回
`NND_NATIVE_MOCK_CONFLICT`。

## 文档

- [npm 包完整用法](packages/network-debugger/README.md)
- [v1 到 v2 迁移说明](docs/v2-migration.md)
- [v2 架构、Plan 与验收证据](docs/v2-implementation-plan.md)

发布包要求 Node.js `>=18.18`。Node 18/20 虽已 EOL，仍保留迁移兼容测试；新项目建议
使用仍在维护的 Node 版本。`undici@^6` 是 peer dependency，确保选择 Legacy
Undici 捕获时修改的是应用使用的同一个包实例。

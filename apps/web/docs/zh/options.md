# 选项

## RegisterOptions

`RegisterOptions` 接口用于配置网络调试器的注册选项。以下是各个选项的详细说明及其默认值。

### 示例

以下是一个使用 `RegisterOptions` 的示例：

```typescript
import { RegisterOptions, register } from 'node-network-devtools'

const options: RegisterOptions = {
  port: 5270,
  serverPort: 5271,
  autoOpenDevtool: true,
  intercept: {
    fetch: true,
    normal: true
  }
}

// 使用 options 进行网络调试器的注册
register(options)
```

### port

- **描述**: 主进程端口
- **默认值**: `5270`

### serverPort

- **描述**: CDP 服务器端口，用于 Devtool
- **链接**: [devtools://devtools/bundled/inspector.html?ws=localhost:${serverPort}](devtools://devtools/bundled/inspector.html?ws=localhost:${serverPort})
- **默认值**: `5271`

### autoOpenDevtool

- **描述**: 是否自动打开 Devtool
- **默认值**: `true`

### intercept

- **描述**: 拦截特定数据包的选项。如果设置为 `false`，则不会拦截该数据包。

#### intercept.fetch

- **默认值**: `true`

- **描述**: 是否拦截 globalThis.fetch

#### intercept.normal

- **默认值**: `true`

- **描述**: 是否拦截 http/https 基础包发出的请求

#### intercept.undici

- **默认值**: `false`
- **选项**:
  - `fetch`: `false` 或 `{}`，默认不拦截。用于拦截`undici.fetch`
  - `normal`: `false` 或 `{}`，默认不拦截。用于拦截`undici.request`

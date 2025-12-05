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

- **描述**: 用于拦截不同类型请求的选项。
  如果某个属性设置为 `false`，则不会拦截该特定类型的请求。
  默认情况下，如果未明确设置，则全部拦截。

#### intercept.fetch

- **描述**: 是否拦截 `fetch` 请求。
- **默认值**: `true`

#### intercept.normal

- **描述**: 是否拦截 `http/https` 请求。
- **默认值**: `true`

#### intercept.undici

- **描述**: `undici` 请求的拦截选项。设置为 `false` 以禁用所有 `undici` 拦截。否则，请配置特定的 `undici` 拦截选项。
- **默认值**: `false`
- **选项**:
  - `fetch`: 是否拦截 `undici` 的 `fetch` 请求。默认为 `false`。
  - `normal`: 是否拦截 `undici` 的普通请求。默认为 `false`。

## ConnectOptions

`ConnectOptions` 接口配置连接到网络调试器的选项。

### port

- **描述**: 主进程端口
- **默认值**: `5270`

## UnregisterOptions

`UnregisterOptions` 接口配置取消注册网络调试器的选项。

### port

- **描述**: 主进程端口
- **默认值**: `5270`

## SendMessageOptions

`SendMessageOptions` 接口配置发送消息的选项。

### port

- **描述**: 主进程端口
- **默认值**: `5270`

## SetRequestInterceptorOptions

`SetRequestInterceptorOptions` 接口配置设置请求拦截器的选项。

### port

- **描述**: 主进程端口
- **默认值**: `5270`

### request

- **描述**: 一个用于拦截和修改传出请求的函数。

## SetResponseInterceptorOptions

`SetResponseInterceptorOptions` 接口配置设置响应拦截器的选项。

### port

- **描述**: 主进程端口
- **默认值**: `5270`

### response

- **描述**: 一个用于拦截和修改传入响应的函数。

## RemoveRequestInterceptorOptions

`RemoveRequestInterceptorOptions` 接口配置移除请求拦截器的选项。

### port

- **描述**: 主进程端口
- **默认值**: `5270`

## RemoveResponseInterceptorOptions

`RemoveResponseInterceptorOptions` 接口配置移除响应拦截器的选项。

### port

- **描述**: 主进程端口
- **默认值**: `5270`
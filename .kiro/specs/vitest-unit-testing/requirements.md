# 需求文档

## 简介

为 `network-debugger` 包引入 Vitest 测试框架，实现无需浏览器的单元测试环境，目标是达到主线程代码（`src/core/`）和子线程代码（`src/fork/`）100% 的单元测试覆盖率。

## 术语表

- **Vitest**: 基于 Vite 的现代化测试框架，支持 TypeScript 和 ESM
- **Test_Runner**: Vitest 测试运行器，负责执行测试用例
- **Coverage_Reporter**: 覆盖率报告生成器，用于统计代码覆盖率
- **Mock_System**: 模拟系统，用于模拟外部依赖（如 WebSocket、HTTP、文件系统等）
- **Main_Thread_Code**: 主线程代码，位于 `src/core/` 目录，包含请求代理、fetch 拦截等功能
- **Fork_Thread_Code**: 子线程/fork 代码，位于 `src/fork/` 目录，包含 DevTools 服务器、请求中心等功能
- **Unit_Test**: 单元测试，针对单个函数或类的独立测试
- **Coverage_Threshold**: 覆盖率阈值，测试必须达到的最低覆盖率百分比
- **CDP**: Chrome DevTools Protocol，Chrome 开发者工具协议，用于与 DevTools 前端通信
- **CDP_Message**: CDP 消息，包含 method、params、id、result、error 等字段
- **Request_Lifecycle**: 请求生命周期，从请求发起到完成的完整过程
- **Message_Ordering**: 消息顺序，CDP 消息必须按照协议规定的顺序发送

## 需求

### 需求 1：Vitest 测试框架配置

**用户故事：** 作为开发者，我希望配置 Vitest 测试框架，以便能够运行无需浏览器的单元测试。

#### 验收标准

1. THE Test_Runner SHALL 支持 TypeScript 文件的直接测试，无需预编译
2. THE Test_Runner SHALL 支持 ESM 模块格式
3. THE Test_Runner SHALL 配置 Node.js 环境而非浏览器环境
4. WHEN 运行 `pnpm test` 命令时，THE Test_Runner SHALL 执行所有 `.test.ts` 后缀的测试文件
5. THE Coverage_Reporter SHALL 生成覆盖率报告，包含行覆盖率、分支覆盖率和函数覆盖率
6. THE Coverage_Reporter SHALL 配置 100% 的覆盖率阈值

### 需求 2：Mock 系统配置

**用户故事：** 作为开发者，我希望能够模拟外部依赖，以便在不依赖真实网络和浏览器的情况下进行测试。

#### 验收标准

1. THE Mock_System SHALL 支持模拟 WebSocket 连接
2. THE Mock_System SHALL 支持模拟 HTTP/HTTPS 请求
3. THE Mock_System SHALL 支持模拟 Node.js 子进程（child_process.fork）
4. THE Mock_System SHALL 支持模拟文件系统操作
5. THE Mock_System SHALL 支持模拟 `open` 包（用于打开浏览器）
6. WHEN 测试需要模拟外部依赖时，THE Mock_System SHALL 提供清晰的 mock 接口

### 需求 3：主线程代码单元测试

**用户故事：** 作为开发者，我希望为主线程代码编写单元测试，以确保请求拦截和代理功能的正确性。

#### 验收标准

1. THE Unit_Test SHALL 覆盖 `src/core/index.ts` 中的 `register` 函数
2. THE Unit_Test SHALL 覆盖 `src/core/fetch.ts` 中的 `proxyFetch` 和 `fetchProxyFactory` 函数
3. THE Unit_Test SHALL 覆盖 `src/core/request.ts` 中的 `requestProxyFactory` 函数
4. THE Unit_Test SHALL 覆盖 `src/core/fork.ts` 中的 `MainProcess` 类
5. THE Unit_Test SHALL 覆盖 `src/core/undici.ts` 中的 `undiciFetchProxy` 函数
6. THE Unit_Test SHALL 覆盖 `src/core/hooks/` 目录下的所有 hook 函数
7. THE Unit_Test SHALL 覆盖 `src/core/ws/` 目录下的 WebSocket 相关工具函数
8. WHEN 测试主线程代码时，THE Unit_Test SHALL 验证请求拦截的正确性
9. WHEN 测试主线程代码时，THE Unit_Test SHALL 验证请求数据的正确传递

### 需求 4：子线程代码单元测试

**用户故事：** 作为开发者，我希望为子线程代码编写单元测试，以确保 DevTools 服务和请求处理的正确性。

#### 验收标准

1. THE Unit_Test SHALL 覆盖 `src/fork/request-center.ts` 中的 `RequestCenter` 类
2. THE Unit_Test SHALL 覆盖 `src/fork/resource-service.ts` 中的 `ResourceService` 和 `ScriptMap` 类
3. THE Unit_Test SHALL 覆盖 `src/fork/devtool/index.ts` 中的 `DevtoolServer` 类
4. THE Unit_Test SHALL 覆盖 `src/fork/devtool/type.ts` 中的 `BaseDevtoolServer` 类
5. THE Unit_Test SHALL 覆盖 `src/fork/module/` 目录下的所有插件模块
6. THE Unit_Test SHALL 覆盖 `src/fork/pipe/` 目录下的所有转换器
7. WHEN 测试子线程代码时，THE Unit_Test SHALL 验证 DevTools 消息的正确处理
8. WHEN 测试子线程代码时，THE Unit_Test SHALL 验证请求数据的正确转换

### 需求 5：工具函数单元测试

**用户故事：** 作为开发者，我希望为工具函数编写单元测试，以确保基础功能的正确性。

#### 验收标准

1. THE Unit_Test SHALL 覆盖 `src/utils/call-site.ts` 中的 `CallSite` 类
2. THE Unit_Test SHALL 覆盖 `src/utils/stack.ts` 中的 `getStackFrames` 和 `initiatorStackPipe` 函数
3. THE Unit_Test SHALL 覆盖 `src/utils/header.ts` 中的所有头部处理函数
4. THE Unit_Test SHALL 覆盖 `src/utils/json.ts` 中的 `jsonParse` 函数
5. THE Unit_Test SHALL 覆盖 `src/utils/map.ts` 中的 `headersToObject` 函数
6. THE Unit_Test SHALL 覆盖 `src/utils/generate.ts` 中的 `generateUUID` 和 `generateHash` 函数
7. THE Unit_Test SHALL 覆盖 `src/utils/file.ts` 中的 `unlinkSafe` 函数
8. THE Unit_Test SHALL 覆盖 `src/utils/process.ts` 中的 `sleep` 和 `checkMainProcessAlive` 函数
9. THE Unit_Test SHALL 覆盖 `src/common.ts` 中的 `RequestDetail` 类

### 需求 6：测试覆盖率要求

**用户故事：** 作为开发者，我希望确保测试覆盖率达到 100%，以保证代码质量。

#### 验收标准

1. THE Coverage_Reporter SHALL 报告主线程代码（`src/core/`）的覆盖率达到 100%
2. THE Coverage_Reporter SHALL 报告子线程代码（`src/fork/`）的覆盖率达到 100%
3. THE Coverage_Reporter SHALL 报告工具函数（`src/utils/`）的覆盖率达到 100%
4. THE Coverage_Reporter SHALL 报告公共模块（`src/common.ts`）的覆盖率达到 100%
5. IF 覆盖率低于 100%，THEN THE Test_Runner SHALL 报告测试失败
6. THE Coverage_Reporter SHALL 生成 HTML 格式的覆盖率报告以便查看详情

### 需求 7：CDP 协议正确性测试

**用户故事：** 作为开发者，我希望验证 CDP 协议消息的顺序一致性和属性正确性，以确保与 Chrome DevTools 的兼容性。

#### 验收标准

1. THE Unit_Test SHALL 验证 HTTP 请求生命周期的 CDP 消息顺序：`Network.requestWillBeSent` → `Network.responseReceived` → `Network.dataReceived` → `Network.loadingFinished`
2. THE Unit_Test SHALL 验证同一请求的所有 CDP 消息中 `requestId` 保持一致
3. THE Unit_Test SHALL 验证 WebSocket 生命周期的 CDP 消息顺序：`Network.requestWillBeSent` → `Network.webSocketCreated` → `Network.webSocketWillSendHandshakeRequest` → `Network.webSocketHandshakeResponseReceived` → `Network.webSocketFrameSent/Received` → `Network.webSocketClosed`
4. THE Unit_Test SHALL 验证 `requestId` 在整个会话中的全局唯一性
5. THE Unit_Test SHALL 验证同一请求的 CDP 消息序列中 `timestamp` 单调递增
6. THE Unit_Test SHALL 验证 `Debugger.scriptParsed` 消息包含有效的 `scriptId` 和 `url`，且可通过 `Debugger.getScriptSource` 获取源代码
7. THE Unit_Test SHALL 验证带有 `id` 的请求消息的响应包含相同的 `id` 字段，以及 `result` 或 `error` 字段
8. THE Unit_Test SHALL 验证 `initiator.stack.callFrames` 中的调用帧包含有效的位置信息和 `scriptId`（如果脚本已解析）

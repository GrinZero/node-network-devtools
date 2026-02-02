# 实施任务

## 任务 1: Vitest 测试框架配置

- [x] 1.1 安装 Vitest 及相关依赖

  - 安装 `vitest`、`@vitest/coverage-v8`、`fast-check` 到 devDependencies
  - 更新 `package.json` 添加测试脚本命令

- [x] 1.2 创建 Vitest 配置文件

  - 创建 `vitest.config.ts` 配置文件
  - 配置 Node.js 环境、测试文件匹配模式
  - 配置 100% 覆盖率阈值

- [x] 1.3 配置 TypeScript 支持
  - 确保 Vitest 可以直接运行 TypeScript 测试文件
  - 配置路径别名支持

## 任务 2: Mock 系统配置（使用第三方库）

- [x] 2.1 配置 Mock 策略
  - 使用 vitest 内置 `vi.mock()`, `vi.spyOn()`, `vi.fn()`
  - 安装 `memfs` 用于文件系统 mock
  - 创建测试辅助工具 `test-utils.ts`

## 任务 3: 工具函数单元测试

- [x] 3.1 编写 `call-site.ts` 测试

  - 测试 `CallSite` 类的所有方法
  - 迁移现有测试到新框架

- [x] 3.2 编写 `stack.ts` 测试

  - 测试 `getStackFrames` 函数
  - 测试 `initiatorStackPipe` 函数
  - 迁移现有测试到新框架

- [x] 3.3 编写 `header.ts` 测试

  - 测试所有头部处理函数
  - 测试边界情况

- [x] 3.4 编写 `json.ts` 测试

  - 测试 `jsonParse` 函数
  - 测试有效/无效 JSON 输入

- [x] 3.5 编写 `map.ts` 测试

  - 测试 `headersToObject` 函数
  - 测试各种 Headers 输入

- [x] 3.6 编写 `generate.ts` 测试

  - 测试 `generateUUID` 函数唯一性
  - 测试 `generateHash` 函数一致性

- [x] 3.7 编写 `file.ts` 测试

  - 测试 `unlinkSafe` 函数
  - 测试文件不存在时的静默处理

- [x] 3.8 编写 `process.ts` 测试

  - 测试 `sleep` 函数
  - 测试 `checkMainProcessAlive` 函数

- [x] 3.9 编写 `common.ts` 测试
  - 测试 `RequestDetail` 类
  - 迁移现有测试到新框架

## 任务 4: 主线程代码单元测试

- [x] 4.1 编写 `core/index.ts` 测试

  - 测试 `register` 函数
  - 测试请求拦截注册流程

- [x] 4.2 编写 `core/fetch.ts` 测试

  - 测试 `proxyFetch` 函数
  - 测试 `fetchProxyFactory` 函数

- [x] 4.3 编写 `core/request.ts` 测试

  - 测试 `requestProxyFactory` 函数
  - 测试 HTTP/HTTPS 请求代理

- [x] 4.4 编写 `core/fork.ts` 测试

  - 测试 `MainProcess` 类
  - 测试子进程通信

- [x] 4.5 编写 `core/undici.ts` 测试

  - 测试 `undiciFetchProxy` 函数
  - 测试 undici fetch 拦截

- [x] 4.6 编写 `core/hooks/` 测试

  - 测试 `cell.ts` 中的 Cell 类
  - 测试 `useAbortRequest.ts`
  - 测试 `useRegisterRequest.ts`
  - 测试 `useRequestPipe.ts`

- [x] 4.7 编写 `core/ws/` 测试
  - 测试 `buffer-util.ts`
  - 测试 `constants.ts`
  - 测试 `limiter.ts`
  - 测试 `permessage-deflate.ts`
  - 测试 `receiver.ts`
  - 测试 `validation.ts`

## 任务 5: 子线程代码单元测试

- [x] 5.1 编写 `fork/request-center.ts` 测试

  - 测试 `RequestCenter` 类
  - 测试插件加载和消息分发

- [x] 5.2 编写 `fork/resource-service.ts` 测试

  - 测试 `ResourceService` 类
  - 测试 `ScriptMap` 类

- [x] 5.3 编写 `fork/devtool/` 测试

  - 测试 `DevtoolServer` 类
  - 测试 `BaseDevtoolServer` 类

- [x] 5.4 编写 `fork/module/` 测试

  - 测试 `common.ts` 中的插件工具
  - 测试 `health` 插件
  - 测试 `network` 插件
  - 测试 `debugger` 插件
  - 测试 `websocket` 插件

- [x] 5.5 编写 `fork/pipe/` 测试
  - 测试 `BodyTransformer` 类
  - 测试 `RequestHeaderPipe` 类

## 任务 6: CDP 协议正确性测试

- [x] 6.1 编写 HTTP 请求生命周期顺序测试

  - 验证 `Network.requestWillBeSent` → `Network.responseReceived` → `Network.dataReceived` → `Network.loadingFinished` 顺序
  - 使用属性测试验证任意请求的消息顺序

- [x] 6.2 编写 WebSocket 生命周期顺序测试

  - 验证 WebSocket 相关 CDP 消息的正确顺序
  - 测试握手、帧传输、关闭的完整流程

- [x] 6.3 编写 requestId 一致性测试

  - 验证同一请求的所有消息中 requestId 一致
  - 验证 requestId 全局唯一性

- [x] 6.4 编写 timestamp 单调递增测试

  - 验证同一请求的消息序列中 timestamp 单调递增
  - 使用属性测试验证任意消息序列

- [x] 6.5 编写 Debugger 消息正确性测试

  - 验证 `Debugger.scriptParsed` 消息格式
  - 验证 `Debugger.getScriptSource` 响应正确性

- [x] 6.6 编写 CDP 响应格式测试

  - 验证带 id 的请求响应包含相同 id
  - 验证 result/error 字段格式

- [x] 6.7 编写 initiator 调用栈测试
  - 验证 callFrames 包含有效位置信息
  - 验证 scriptId 正确关联

## 任务 7: 属性测试实现

- [x] 7.1 实现 Property 7: JSON 解析往返一致性

  - 使用 fast-check 生成任意有效 JSON
  - 验证解析后再序列化的等价性

- [x] 7.2 实现 Property 8: Headers 转换完整性

  - 使用 fast-check 生成任意 Headers
  - 验证转换后包含所有原始键值对

- [x] 7.3 实现 Property 9: UUID 唯一性

  - 生成大量 UUID 验证唯一性
  - 使用属性测试验证

- [x] 7.4 实现 Property 10: Hash 一致性

  - 验证相同输入产生相同 hash
  - 验证不同输入产生不同 hash

- [x] 7.5 实现 Property 11: RequestHeaderPipe 大小写不敏感

  - 使用 fast-check 生成任意头部名称
  - 验证大小写不敏感查询

- [x] 7.6 实现 Property 13-19: CDP 协议属性测试
  - 实现 HTTP 请求生命周期消息顺序属性测试
  - 实现 WebSocket 生命周期消息顺序属性测试
  - 实现 requestId 一致性属性测试
  - 实现 timestamp 单调递增属性测试

## 任务 8: 覆盖率验证和文档

- [x] 8.1 运行完整测试套件

  - 执行所有测试
  - 生成覆盖率报告

- [x] 8.2 验证 100% 覆盖率

  - 检查 src/core/ 覆盖率
  - 检查 src/fork/ 覆盖率
  - 检查 src/utils/ 覆盖率
  - 检查 src/common.ts 覆盖率

- [x] 8.3 补充缺失的测试
  - 根据覆盖率报告补充测试
  - 确保所有分支都被覆盖

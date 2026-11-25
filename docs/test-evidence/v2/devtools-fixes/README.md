# 2.0.0 DevTools 复测报告

2026-11-25（Asia/Taipei） · macOS arm64

DevTools 检查 **76/76**，页面异常 **0**。仓库 E2E **37/37**，协议补测 **8/8**，示例路由 **30/30**，独立 NestJS E2E **1/1**，主包单元测试 **842/842**。

## 修复复验

- Legacy WebSocket 的握手头按 CDP 字符串类型发送。Chrome 151 和 158 均显示 HTTP 101、双向文本及二进制帧。刷新及历史握手回放期间未重现前端异常。
- Koa 与调试器各自加载独立的 Undici v6 实例。启用 Legacy 拦截后，`/undici` 触发的出站 GET 200 进入 Network。注销时恢复原有函数。
- NestJS 示例断言 `GET /` 返回 HTTP 200 和帖子 JSON。Chrome 测试使用临时配置与测试钥匙串，复测结束后已核对进程清理。

## DevTools 截图

两张截图直接采集自 Chrome 打开的 `devtools://devtools/bundled/` 窗口，连接实际 Node CDP 目标。[PR #66 的截图评论](https://github.com/GrinZero/node-network-devtools/pull/66#issuecomment-7161553619)

## 版本矩阵

| Chrome        | Node    | Legacy | Native |
| ------------- | ------- | -----: | -----: |
| 158.0.8127.37 | 18.18.0 |    8/8 |      — |
| 158.0.8127.37 | 20.20.2 |    8/8 |      — |
| 158.0.8127.37 | 22.22.3 |    8/8 |    7/7 |
| 158.0.8127.37 | 24.16.0 |    8/8 |    7/7 |
| 158.0.8127.37 | 26.8.1  |    8/8 |    7/7 |
| 151.0.7922.34 | 24.16.0 |    8/8 |    7/7 |

按仓库发布矩阵，Node 18 和 20 测 Legacy。

## 用例结果

| 用例                        | 实测结果                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MT-01、MT-02 · CLI          | 版本、doctor、零代码启动、冲突、`--open` 与 replay 专项 6/6。                                                                                                    |
| MT-03、MT-04 · Native       | 保留网络函数原始引用。Discovery 返回唯一匹配的 target，提供 Network domain。                                                                                     |
| MT-05 · Native HTTP         | HTTP GET 200、HTTPS GET 200、Fetch POST 201。Node 24/26 可查看 Fetch Response，Node 22 的响应体能力按原定义关闭。                                                |
| MT-06 · 刷新重连            | 刷新后新 GET 只出现一次。Legacy 历史 WebSocket 回放无 DevTools 异常。                                                                                            |
| MT-07、MT-08 · Legacy       | 带 Mock 的 Auto 选择 Legacy。Discovery 返回唯一匹配的 target，提供 Network domain。                                                                              |
| MT-09 · Legacy HTTP         | HTTP GET 200、HTTPS GET 200、Fetch POST 201。Headers、Payload 与 Preview 可见。                                                                                  |
| MT-10 · Mock                | HTTP 返回 207，Fetch 返回 202。实际 origin 命中数为 0。                                                                                                          |
| MT-11 · SSE、WebSocket      | Legacy 可查看 SSE 消息与双向文本和二进制帧。Native 按运行时能力显示。Node 22 的 WebSocket 可见 HTTP 握手行。                                                     |
| MT-12 · Trace、Session、HAR | Trace 请求头可见。录制完成，响应体错误数为 0。dry-run 和实际 replay 均通过。                                                                                     |
| MT-13 · 失败及 HTTP/2       | 连接重置只触发一次 `loadingFailed`。Node 22.22.3 的 Native HTTP/2 显示 200。Node 24/26 的上游 Inspector 仍抛出 `Missing dataLength in event`，因此能力保持关闭。 |
| MT-14 · Dispose             | 全部适用组合为 `disposed`。HTTP Discovery 与 CDP WebSocket 均关闭。                                                                                              |

协议补测覆盖 UTF-8、gzip、二进制响应、分块 POST、重定向、取消、重置、超时、20 个并发请求、CommonJS 入口与 Native Initiator。示例路由包括 Koa 12 项、Koa ESM 15 项、NestJS 3 项。

## 候选包标识

- 实测代码提交 `94a2013963a8631bc4f4eb4dd65e35c21f804e75`。
- 实测安装包 `node-network-devtools@2.0.0` 的 SHA-256 为 `758190cb17ced34f97f04b9dc9fc2d07e18937a4d466ec29dd1a42f3056f81a0`。
- 打包内容与构建目录的 187 个 `dist/` 文件逐个校验一致。

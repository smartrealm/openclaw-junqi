# OpenClaw Stop 会话身份围栏规格

日期：2026-08-03

## 目标

在不扩展 OpenClaw `sessions.abort` 协议的前提下，使 JunQi 的本地 Task Stop checkpoint
与用户实际操作的 sessionId 精确绑定，并清除已证明无引用的旧 Run 创建入口。

## SSIF-01 - Stop 透传本地会话身份

### 当前

`gateway.abortChat(sessionKey)` 只将 key 传给 `TaskExecutionCoordinator.requestStop`。普通
Composer、Jarvis 语音、Quick Chat、Quick Chat 清理和原生会话生命周期调用方已分别知道或能
确定 sessionId，却没有传递该值。

### 目标

`gateway.abortChat(sessionKey, sessionId?)` 只将第二个参数用于本地
`requestStop(sessionKey, sessionId)`。所有可用的调用方传递其已验证的当前 sessionId；未知
身份保持 undefined，不能查询、猜测或复用旧身份。

### 验收

- [x] 已轮换 sessionId 的同 key checkpoint 不会因当前 Stop 被选择。
- [x] 具备 sessionId 的五个 Stop 路径都向 Gateway facade 传入该值。
- [x] 无 sessionId 的 key-only 事件仍只在唯一、同 runtime 的存量 checkpoint 上恢复既有行为。

## SSIF-02 - 原生 RPC 契约不漂移

### 目标

`sessions.abort` 的 payload 继续只使用 OpenClaw 支持的 key、可选 runId、可选 agentId 和
既有明确选择的 clearQueued；普通 Stop 不新增 sessionId 或 clearQueued。

### 验收

- [x] 回归测试确认 sessionId 不进入 `OpenClawSessionAbortClient` 请求参数。
- [x] 原有 runId 精确终止、acknowledgement reconciliation 和 checkpoint-before-abort 顺序保持。

## SSIF-03 - 删除无引用旧入口

### 当前

`TaskExecutionCoordinator.beginRun` 没有消费者；发送和 steer 均有自己的受控状态机入口。

### 目标

删除该方法及其只为该方法存在的依赖，不创建兼容包装或空实现。

### 验收

- [x] 全仓库搜索不再存在 `TaskExecutionCoordinator.beginRun` 或
  `taskExecutionCoordinator.beginRun` 调用与定义。
- [x] `prepareSend`、`prepareSteer`、工具事件、history reconciliation 的运行路径保持可测。

## 非目标

- 不新增、重定义或模拟 OpenClaw Task、Tool、Queue、Talk 或 VoiceWake 协议。
- 不改变 Stop 对 Gateway followup/lane queue 的默认保留行为。
- 不更改 checkpoint 的存储格式、跨 WebView CAS 协调或历史 Tool call recovery 语义。

# OpenClaw Stop 跨入口请求状态围栏规格

日期：2026-08-04

## 目标

让 Quick Chat 和原生会话生命周期入口与主 Composer 使用同一活动请求判定：请求正发送或正
流式输出时都进入既有的 `gateway.abortChat` 控制面。

## 约束

1. 仅 `typingBySession` 或 `sendingBySession` 为真的会话可触发远端 Stop。
2. Quick Chat 的组件级 `sending` 仅用于重复提交保护，不能作为远端活动 Run 的证据。
3. 远端 Stop 只能调用既有 `gateway.abortChat`；该 facade 继续保留 Task checkpoint、会话
   identity、精确 Run 确认和 history reconciliation。
4. OpenClaw `sessions.abort` 仍只使用其官方的 `key` 与可选 `runId`，并继续省略
   `clearQueued`。
5. 无活动请求时，不发送远端 abort；Quick Chat 销毁仍必须释放 Gateway client lease。
6. `gateway.abortChat` 必须接收显式、非空会话键；不得将缺失目标回落到 `agent:main:main`
   或其他 JunQi 生成的默认键。校验发生在本地 Stop checkpoint 和 Gateway 请求之前。

## 验收条件

- Quick Chat 在仅 `sendingBySession` 为真时展示 Stop 控件并调用既有 Stop facade。
- Quick Chat 窗口销毁在仅 `sendingBySession` 为真时先发起同一 Stop，再释放 lease。
- 协作插件不可用时，原生 reset/delete 在仅 `sendingBySession` 为真时先调用既有 Stop，再
  运行原生 mutation。
- 两个状态均为假时，以上入口不发远端 Stop。
- 空或仅空白的 Stop 目标不写入本地 checkpoint，也不发送 `sessions.abort`；显式目标继续保持
  checkpoint、Run 查询和 Gateway 请求的同一会话身份。
- 定向回归、TypeScript、前端完整测试、构建、OpenClaw 文档校验、Rust library 验证和
  `git diff --check` 通过。

## 非目标

- 不把本地状态解释为 Gateway 已中止。
- 不改动 OpenClaw 协议、Tauri IPC、Rust 宿主、发送队列所有权或 Task checkpoint schema。
- 不以 JunQi 默认会话键替代 OpenClaw 会话选择或 Stop 路由。

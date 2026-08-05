# OpenClaw Composer 队列权威对齐规格

日期：2026-08-03

## 目标

让 JunQi 普通 Composer 发送始终进入当前 OpenClaw Gateway 的原生会话队列，保留
Gateway 对 `steer`、`followup`、`collect`、`interrupt`、排队 turn 取消身份和
幂等键的权威解释。JunQi 本地队列只保留给用户明确选择的本地暂存和正在执行的
破坏性会话变更保护。

同时，灵动岛预览必须由主窗口的唯一可见性运行时拥有，预览结束或关闭时不得留下
无活动的辅助窗口。

## 约束

1. 普通 Composer 发送不得因本地 `typingBySession` 为真而自动进入 renderer 队列；
   必须携带既有 `clientMessageId` 调用 `chat.send`，由 Gateway 决定实际 queue mode。
2. `delivery: 'steer'` 继续走原生 `sessions.steer`；本地显式 queue 和
   `sessionMutationGate` 继续保留原有本地队列保护，不能因本修复丢失用户输入。
3. 不新增、猜测或修改 OpenClaw queue mode、配置字段、队列位置、run 状态或取消 RPC。
   Gateway acknowledgment、transcript 和已有 reconciliation 仍是远端送达的唯一依据。
4. 灵动岛预览是 JunQi 的桌面展示功能，不是 OpenClaw 状态。Settings 只能发出预览
   intent；`DynamicIslandRuntime` 必须是预览可见性状态、自动收起和后续窗口生命周期的
   唯一拥有者。辅助窗口的既有即时关闭仍须同时通知该运行时。
5. 预览不改变用户的 `dynamicIslandEnabled` 偏好；用户关闭预览只结束本次预览。常规
   灵动岛的隐藏操作维持既有“关闭功能”语义。

## 验收条件

- 忙碌 Session 的正常 Composer 发送调用 Gateway，且不写入 JunQi 本地 `messageQueue`。
- 显式本地队列和会话 mutation 栅栏仍将输入保存在本地可见队列。
- 所有 Gateway 队列发送保留调用方生成的 `clientMessageId`，供上游排队 turn 的去重和
  `chat.abort` 精确取消使用。
- 预览由主窗口运行时启动；在预览时限结束或辅助窗口关闭后，运行时收起辅助窗口，且
  不修改灵动岛启用设置。
- 定向回归、TypeScript、边界检查、全量前端和 Rust 测试、构建、OpenClaw 文档校验、
  协作插件校验及 `git diff --check` 通过。

## 未验证边界

- 真实 Gateway 的各 queue mode、跨客户端所有权和排队 turn 的终态时间线仍需独立真机
  验收；本次不把本地测试描述为远端运行证据。
- Windows、CentOS、Ubuntu 与 macOS 的灵动岛窗口焦点和自动收起仍需目标平台真机验收。

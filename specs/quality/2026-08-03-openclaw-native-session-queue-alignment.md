# OpenClaw 原生会话队列对齐规格

## 范围

本规格约束 JunQi 桌面客户端在 OpenClaw Session 已有活动 Run 时的普通文本、
Quick Chat、显式本地队列、Jarvis steering 和 Task checkpoint 行为。JunQi 只
消费 OpenClaw 已公开的 Gateway 协议，不自行实现另一套 Agent 或队列引擎。

## 目标行为

1. 普通文本发送必须调用 OpenClaw `chat.send`，由 Gateway 当前 queue mode 决定
   是注入活动 Run、等待后续执行、收集输入还是中断后执行。
2. JunQi 不得因活动 Run 自动把普通输入放入 renderer-owned queue；只有明确的
   `queueIfBusy` 或既有 `delivery: 'queue'` 本地选择，或会话 mutation gate，才能
   进入该队列。
3. 普通发送不得调用 `sessions.steer` 代替 `chat.send`。只有 Jarvis 明确的语音
   打断转向才使用官方 `sessions.steer`。
4. 一个已验证 Task binding 在任意时刻最多有一个非终态 Run。普通发送遇到活动
   Run 时只能关联现有 Run；Gateway 活动没有可验证本地 Run 时不得猜测 runId。
5. 发送失败只能结算本次由客户端新建且尚未被 Gateway 接管的 Run，不能结算旧的
   活动 Run 或未知 Gateway Run。
6. Stop、Tool recovery、transcript 和 session identity 继续遵守各自的 OpenClaw
   原生协议，不由本规格添加本地消息或合成 Tool Result。

## 验收条件

- 活动会话的普通发送仍到达 `chat.send`，本地队列为空。
- `queueIfBusy: true` 可以进入有上限的 JunQi 本地队列。
- 状态机对已有活动 Run 返回原 Run，且不新增 Run、revision 或伪造关系。
- 活动 Gateway 但无可验证本地 Run 时，状态机保持空快照。
- Gateway 断连错误不会结算被复用的活动 Run。
- Jarvis steering 的旧 Run 取消和新 Run intent 仍通过 `prepareTaskRunSteer` 维护。
- 相关测试、TypeScript 检查和 diff 检查通过。

## 非目标

- 不在 JunQi 内复制 OpenClaw queue mode、调度器或 Agent runtime。
- 不硬编码 OpenClaw 版本、安装路径、平台名称或默认 queue mode。
- 不把一次 `chat.send` ACK 推断成 Gateway 已经执行，也不为 queued followup 生成
  未被官方事件确认的本地 Run。
- 不把 `session.suggestions.*`、`session.typing` 或共享会话可见性事件映射为单人
  composer suggestion、助手生成状态或 JunQi 协作插件状态；这些协议只能在 OpenClaw
  共享会话身份、可见性、成员权限和事件投影均已完整接入时使用。

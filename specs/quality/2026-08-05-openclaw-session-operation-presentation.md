# OpenClaw 会话操作展示规格

日期：2026-08-05

## 目标

将 OpenClaw `session.operation` 显示为会话运行态，而不是聊天消息。

## 约束

1. 只消费官方当前 schema 的 `compact` start/end 事件。
2. `session.operation` 不创建 assistant、system、tool 或 transcript 消息。
3. 当前会话的操作状态放在会话上下文栏，紧随会话运行时控制。
4. 全局活动面和灵动岛只能读取同一按会话运行态投影，不能自行推断终态。
5. 只有 `completed: true` 才创建压缩完成分隔线；失败和缺失终态不伪造成功。

## 验收条件

- start 显示当前会话的压缩状态，匹配 end 清除状态。
- 事件不会在主窗口或 Quick Chat 的正文中创建本地消息。
- 最小化窗口期间，压缩中的会话保持灵动岛可见并能回到对应会话。
- 侧栏、顶部状态、活动中心、仪表盘和灵动岛采用同一 `compacting` 活动投影。

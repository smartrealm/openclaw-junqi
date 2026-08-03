# OpenClaw 原生技能提案事件对齐

日期：2026-08-03

## 审计结论

OpenClaw Skill Workshop 为 proposal 生命周期提供 append-only 的
`skills.proposals.events.list` 读取接口。JunQi 将在现有 agent-scoped 提案清单中投影该官方事件
ledger；它不创建本地任务图、不评价、不自动修订，也不决定任何生命周期转换。

## 权威依据

- [OpenClaw Skill Workshop 文档](https://github.com/openclaw/openclaw/blob/main/docs/tools/skill-workshop.md)
- [OpenClaw 技能协议 schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/agents-models-skills.ts)
- [OpenClaw 技能 Gateway handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/skills.ts)
- [OpenClaw Gateway 方法权限目录](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)

官方 schema 将 events list 定义为可选 `agentId`、`proposalId`、`afterSequence` 和 1 至 200 的
`limit`，返回按 sequence 排列的 events 与可选 `nextSequence`。每个 event 属于固定 proposal，包含
revision hash、事件类型、发生时间、actor 与可选 payload/evaluation。方法目录将其标为
`operator.read`；handler 使用与 proposal list/inspect 相同的 workspace resolver。

## 当前实现

- Gateway 明确未广告 `skills.proposals.events.list` 时隐藏入口并拒绝调用；广告未知或已广告时才按
  官方 RPC 请求。
- 从已验证的 proposal 详情入口传入相同 scope 的 proposal id 和 agent id。每一页 event 都必须属于
  请求的 proposal，sequence 必须严格递增；不匹配或畸形回包整体失败。
- UI 只保存并显示 sequence、原生 event type、发生时间与 actor type。revision hash、event id、actor
  id、correlation id、payload 和 evaluation 不进入 React 状态、持久化或 UI。
- 使用官方 `nextSequence` cursor 请求后页。scope、连接、capability 改变或关闭弹窗时废弃在途请求，
  防止旧 scope 或旧 proposal 回包污染当前视图。

## 保留边界

本项不接入 `skills.proposals.evaluate`，因为最新官方方法目录将其标为 `operator.admin` 写操作；也不
接入 create、update、revise、apply、reject、quarantine 或自动优化循环。OpenClaw 文档明确说明
controller 可消费事件并选择是否继续，OpenClaw 不调度或自动决定该循环，JunQi 不应自行添加该语义。

## 跨平台边界

事件通过既有 Gateway WebSocket RPC 返回，Tauri WebView 只呈现安全的只读投影。macOS、Windows、
CentOS 和 Ubuntu 共享该协议路径，不依赖浏览器 HTTP、本地 workspace 或 node host。真实 Gateway
权限、长事件历史、窄窗口和断线重连仍需目标平台真机验证。

## 验证目标

- `openclawSkillsRuntime.test.ts` 覆盖完整安全投影、跨 proposal event 与乱序 sequence 拒绝、scope、
  cursor、非法 cursor/limit，以及明确未广告时不调用 Gateway。
- `proposalEventsDialog.test.tsx` 覆盖时间线只渲染安全投影及分页入口，不渲染 actor id 或 event payload。
- `pnpm lint`、`pnpm test`、`pnpm verify:openclaw-docs`、`pnpm collab:test`、`pnpm collab:validate`
  通过。`OPENCLAW_BIN=/Users/wei/.npm-global/bin/openclaw pnpm build` 零退出；由于该命令没有打印
  共享构建阶段，另行执行 `pnpm exec vite build` 并确认 `dist/index.html` 引用存在的生产入口 bundle。

## 未验证边界

- 未连接真实 Gateway，尚未验证 proposal 不存在、operator.read 拒绝、空页、跨页期间生命周期变化或
  事件 ledger 字节上限的实际服务器响应。
- 未在 macOS、Windows、CentOS、Ubuntu 的打包 Tauri 应用验证图标、对话框焦点、键盘关闭、长事件历史、
  窄窗口与断线重连。

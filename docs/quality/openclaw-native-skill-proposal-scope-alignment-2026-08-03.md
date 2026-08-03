# OpenClaw 原生技能提案范围对齐

日期：2026-08-03

## 审计结论

Skill Workshop proposal manifest 是 agent workspace scoped 数据。此前 JunQi 只可请求 Gateway
默认 scope，无法让用户明确选择一个已验证 agent，也不能安全地为同一页面之后的 proposal
详情读取建立 scope 约束。

本次在“技能工作坊”清单加入 agent scope 选择。所有选项仅来自 Gateway 默认语义、当前原生
会话的 `agentId` 或已解析的 `agents.list` 条目；JunQi 不接受手工拼接的 agent id，不猜测
workspace 或本地路径。

## 权威依据

- [OpenClaw Skill Workshop 文档](https://github.com/openclaw/openclaw/blob/main/docs/tools/skill-workshop.md)
- [OpenClaw 技能协议 schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/agents-models-skills.ts)
- [OpenClaw 技能 Gateway handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/skills.ts)
- [OpenClaw 官方控制台 Skill Workshop 实现](https://github.com/openclaw/openclaw/blob/main/ui/src/pages/skill-workshop/proposals.ts)
- [OpenClaw 会话协议 schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts)

官方 `skills.proposals.list` 和 `skills.proposals.inspect` 都接受可选 `agentId`，Gateway handler
通过统一 workspace resolver 将它绑定到 agent workspace。官方控制台先从当前 session 或 selected
agent 得出一个 agent id，并将同一个 id 同时传给 list 和 inspect。`skills.proposals.list` 是
`operator.read`，不会创建或修改 proposal。

## 当前实现

- `src/pages/SkillsPage/proposalScope.ts` 只解析三个受控选择值：Gateway 默认、当前会话 agent 和
  `agents.list` 中的显式 agent。空值、未知格式和空 agent id 都退回未指定参数，不会形成伪造
  scope。
- 页面清楚显示“智能体范围”下拉框。默认项称为 Gateway 默认 agent；当前会话项只在 session
  snapshot 实际带有 `agentId` 时出现；其他项来自 gateway data store 已校验的 `agents.list`
  projection。agent list 加载或失败状态如实显示，不生成静态选项。
- 每次 scope、连接状态或能力广告变化都会递增请求代次、清空当前清单和废弃在途回包。新 scope 的
  请求只有仍处于当前代次时才写入页面，防止 agent A 的结果覆盖 agent B 的清单。
- 选择具体 agent 时 runtime 将 trim 后的原生 `agentId` 传给 `skills.proposals.list`；选择 Gateway
  默认项则按官方可选参数契约省略该字段。

## 保留边界

`skills.proposals.inspect` 已在同一受控 scope 上作为独立的只读草稿详情接入，详见
[OpenClaw 原生技能提案详情对齐](openclaw-native-skill-proposal-inspect-alignment-2026-08-03.md)。
history、events、evaluate 和任何管理员写方法仍未接入；它们不能从清单或详情状态推断。

`/skill-hub` 仍是 JunQi 的本地目录与符号链接工具，不是 Skill Workshop scope 或 agent
workspace。本次没有读取或写入任何本地技能、proposal 或 Gateway 配置文件。

## 跨平台边界

该选择器通过已有 Gateway WebSocket RPC 使用结构化 agent id。macOS、Windows、CentOS 和 Ubuntu
共享相同路径，不依赖浏览器 HTTP、系统路径或 node host。目标平台上的 Gateway 配对、agent
授权、动态 agent 列表和窄窗口菜单仍需真机验证。

## 验证结果

- `proposalScope.test.ts` 覆盖默认、当前会话和显式 agent 三种允许的 scope 映射，拒绝未知或空值。
- `openclawSkillsRuntime.test.ts` 覆盖默认参数省略和显式 agent 的 trim 后只读请求。
- `pnpm lint`、`pnpm test`、`pnpm verify:openclaw-docs`、`pnpm collab:test` 与
  `pnpm collab:validate` 通过。
- `OPENCLAW_BIN=/Users/wei/.npm-global/bin/openclaw pnpm build` 完成，未产生 provider catalog 或
  协作资源差异；该本机 CLI 仅用于构建复现，不作为客户端能力开关。
- `git diff --check`、locale JSON 解析和修改文件 Emoji 扫描通过。

## 未验证边界

- 未连接真实 Gateway，尚未验证 agent workspace 不存在、operator.read 拒绝、agent 列表刷新竞态
  或 Gateway 默认 agent 在请求之间变化的实际服务器响应。
- 未在 macOS、Windows、CentOS、Ubuntu 的打包 Tauri 应用验证 agent 下拉菜单、键盘焦点、窄窗口和
  断线重连。

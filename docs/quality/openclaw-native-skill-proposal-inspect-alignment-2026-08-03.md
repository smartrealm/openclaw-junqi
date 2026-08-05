# OpenClaw 原生技能提案详情对齐

日期：2026-08-03

## 审计结论

OpenClaw Skill Workshop 已定义只读 `skills.proposals.inspect`：客户端以 proposal id 和可选
`agentId` 读取同一 agent workspace 中的单个提案草稿。JunQi 现将该原生读取接入既有“技能工作坊”
清单；它不是本地文件浏览器，不创建、修改、评价、应用或恢复提案。

## 权威依据

- [OpenClaw Skill Workshop 文档](https://github.com/openclaw/openclaw/blob/main/docs/tools/skill-workshop.md)
- [OpenClaw 技能协议 schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/agents-models-skills.ts)
- [OpenClaw 技能 Gateway handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/skills.ts)
- [OpenClaw Gateway 方法权限目录](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)
- [OpenClaw 官方控制台提案实现](https://github.com/openclaw/openclaw/blob/main/ui/src/pages/skill-workshop/proposals.ts)

官方 schema 要求非空 `proposalId`，接受可选非空 `agentId`；返回 proposal record、可选 revision
hash、草稿正文与可选 support files。Gateway handler 通过与 list 相同的 workspace resolver 绑定
agent。官方方法目录将 inspect 标为 `operator.read`，不构成提案写入或审批。

## 当前实现

- `openClawSkillsRuntime.inspectProposal()` 仅调用 `skills.proposals.inspect`，参数由已验证的 proposal
  id 和当前选定 scope 构成。`features.methods` 不决定入口或发送；始终发起官方 RPC，并按 Gateway
  的结构化响应显示不支持、授权或失败，不按本机版本推断能力。
- decoder 核对 record 标识、提案 id、枚举、时间、target、扫描统计和 findings、support file 结构、
  revision hash 与正文。回包不完整或与请求 id 不一致时整体拒绝，不使用局部字段补造详情。
- decoder 只向页面投影 id、标题、描述、skill key、状态、可选 revision hash 与草稿正文。target 路径、
  support file 路径和正文、origin、扫描证据及 evaluation 不进入 React 状态、持久化或 UI。
- 每条清单提供只读图标入口。弹窗使用文本节点的 `pre` 展示正文，不解析 HTML，不提供下载或任何文件
  操作。list 和 inspect 使用同一个受控 agent scope。
- scope、连接状态或 inspect capability 变化时，详情请求代次递增并关闭弹窗。旧 scope 的回包不会写入
  当前页面；主动关闭也会废弃未完成回包。

## 保留边界

`skills.proposals.events.list` 已作为独立的只读生命周期投影接入，详见
[OpenClaw 原生技能提案事件对齐](openclaw-native-skill-proposal-events-alignment-2026-08-03.md)。
proposal history、evaluate、create、update、revise、apply、reject 和 quarantine 仍未接入；这些方法
各有独立权限和状态机契约，不能由 inspect 推断。JunQi 不读取 `/skill-hub`、本地 proposal 目录或本地
agent workspace，也不把它们映射为 OpenClaw 数据。

## 跨平台边界

详情通过既有 Gateway WebSocket RPC 返回，由 Tauri WebView 渲染纯文本。macOS、Windows、CentOS 和
Ubuntu 使用相同协议路径，不依赖浏览器 HTTP、系统路径、node host 或本机 OpenClaw 安装位置。真实
Gateway 配对、operator.read 授权、超长草稿和窄窗口仍需各目标平台真机验证。

## 验证结果

- `openclawSkillsRuntime.test.ts` 覆盖完整详情 envelope、请求 id 不匹配和畸形嵌套字段拒绝、受控
  agent scope 参数，以及方法发现遗漏时仍调用 Gateway 的边界。
- `pnpm exec tsc --noEmit` 与该服务定向回归 25 项通过；`pnpm lint`、`pnpm test`、
  `pnpm verify:openclaw-docs`、`pnpm collab:test` 与 `pnpm collab:validate` 通过。
- `OPENCLAW_BIN=/Users/wei/.npm-global/bin/openclaw pnpm build` 零退出，未改写 provider catalog 或协作
  资源；该本机 CLI 仅用于构建复现，不作为客户端 capability 的依据。

## 未验证边界

- 未连接真实 Gateway，尚未验证 proposal 不存在、workspace 不存在、operator.read 拒绝、正文最大长度
  和 scope 在网络响应途中变化时的真实服务端响应。
- 未在 macOS、Windows、CentOS、Ubuntu 的打包 Tauri 应用验证详情图标、弹窗焦点、键盘关闭、窄窗口和
  断线重连。

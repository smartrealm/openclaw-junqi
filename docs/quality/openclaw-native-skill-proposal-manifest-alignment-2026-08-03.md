# OpenClaw 原生技能提案清单对齐

日期：2026-08-03

## 审计结论

OpenClaw Skill Workshop 为 workspace 技能提案提供 `skills.proposals.list` 的只读 Gateway
清单。JunQi 此前没有该原生清单入口，用户无法查看 Gateway 已维护的 create/update 提案及其
生命周期和扫描状态。

本次在技能页新增条件性“技能工作坊”标签，只投影 Gateway 返回的 proposal manifest。标签不
代表本地 `/skill-hub`，不代表当前会话，也不创建、修改、审核或应用提案。

## 权威依据

- [OpenClaw Skill Workshop 文档](https://github.com/openclaw/openclaw/blob/main/docs/tools/skill-workshop.md)
- [OpenClaw 技能协议 schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/agents-models-skills.ts)
- [OpenClaw 技能 Gateway handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/skills.ts)
- [OpenClaw Gateway 方法权限目录](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)
- [OpenClaw 官方控制台 Skill Workshop 实现](https://github.com/openclaw/openclaw/blob/main/ui/src/pages/skill-workshop/proposals.ts)

官方 schema 将 `skills.proposals.list` 的参数定义为可选 `agentId`，返回固定
`openclaw.skill-workshop.proposals-manifest.v1` envelope、`updatedAt` 与 proposal 数组。每个
条目必须具有 id、create/update kind、五种 lifecycle status、标题、描述、技能名和 key、创建与
更新时间及四种 scan state。官方方法目录将它标为 `operator.read`；handler 通过 Gateway 的
workspace scope resolver 选择 agent workspace。

## 当前实现

- `src/services/openclawSkillsRuntime.ts` 新增 `proposalsCapability()` 与 `proposals()`。只有
  Gateway 明确未广告 `skills.proposals.list` 时才隐藏入口并拒绝调用；广告未知时按官方 RPC
  发起真实读取，不以本机 OpenClaw 版本推断功能。
- decoder 要求完整官方 envelope 和每个嵌套字段的合法枚举。未知状态、未知扫描状态、缺失字段
  或畸形条目会整体拒绝回包，不从部分数据生成本地提案结论。
- `src/pages/SkillsPage/index.tsx` 仅显示标题、描述、技能 key、更新时间和 Gateway 生命周期
  status。请求中、空清单与 Gateway/协议失败均有明确状态；刷新仅重新读取清单。
- 页面现在可在 Gateway 默认、当前会话 agent 与已验证 `agents.list` 条目之间明确选择 scope；
  默认选项仍省略 `agentId`，其他选择传递精确 agent id。请求隔离和来源边界见
  [OpenClaw 原生技能提案范围对齐](openclaw-native-skill-proposal-scope-alignment-2026-08-03.md)。
- `skills.proposals.inspect` 现在复用同一受控 agent scope 作为只读草稿详情接入；其完整 decoder、
  内容隔离与交互边界见
  [OpenClaw 原生技能提案详情对齐](openclaw-native-skill-proposal-inspect-alignment-2026-08-03.md)。

## 跨平台边界

清单经 Gateway WebSocket RPC 返回，Tauri WebView 只展示结构化只读数据。macOS、Windows、
CentOS 和 Ubuntu 共享同一协议路径，不依赖浏览器 HTTP、本地文件路径、node host 或本机技能
目录。各系统上的 Gateway 配对、operator.read 授权、窄窗口与长清单仍需真机验证。

## 验证结果

- `openclawSkillsRuntime.test.ts` 覆盖完整 manifest decoder、未知枚举拒绝、默认 scope 的只读
  调用参数，以及明确未广告时不发送请求。
- `pnpm exec tsc --noEmit`、技能页定向回归 23 项、`pnpm lint`、`pnpm test`、
  `pnpm verify:openclaw-docs`、`pnpm collab:test` 与 `pnpm collab:validate` 通过。
- `OPENCLAW_BIN=/Users/wei/.npm-global/bin/openclaw pnpm build` 完成，未产生 provider catalog 或
  协作资源差异；该本机 CLI 仅用于构建复现，不作为客户端能力开关。
- `git diff --check`、locale JSON 解析和修改文件 Emoji 扫描通过。

## 未验证边界

- 尚未连接真实 Gateway，未验证默认 agent 的解析结果、operator.read 拒绝、空清单、远端
  Gateway 或列表在提案状态变化时的实际表现。
- 尚未实装 proposal history 或任一管理员写操作：create、update、revise、evaluate、apply、reject、
  quarantine。只读事件流的 scope、cursor 和字段边界见
  [OpenClaw 原生技能提案事件对齐](openclaw-native-skill-proposal-events-alignment-2026-08-03.md)。
- `/skill-hub` 仍是单独的 JunQi 本地目录与符号链接工具，本次未把它或任何本地文件投影为
  OpenClaw Skill Workshop 数据。

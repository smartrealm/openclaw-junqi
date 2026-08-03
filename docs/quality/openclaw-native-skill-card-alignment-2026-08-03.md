# OpenClaw 原生技能卡对齐

日期：2026-08-03

## 审计结论

OpenClaw 为已安装技能提供 `skills.skillCard` 的只读 Gateway 方法。JunQi 此前只能显示
`skills.status` 的摘要，无法呈现 OpenClaw 已渲染的技能卡内容。当前实现将该官方能力接入
“我的技能”列表：用户按需打开一个技能卡，JunQi 读取并以纯文本显示 Gateway 返回的内容。

此能力不是 JunQi 的技能文件浏览器。JunQi 不读取桌面本地路径、不编辑卡片、不复制文件，
也不以卡片内容推断技能可用性、授权、安全结论或执行结果。

## 权威依据

- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [OpenClaw 技能协议 schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/agents-models-skills.ts)
- [OpenClaw 技能 Gateway handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/skills.ts)
- [OpenClaw Gateway 方法权限目录](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)
- [OpenClaw 官方 UI 技能卡读取实现](https://github.com/openclaw/openclaw/blob/main/ui/src/lib/skills/index.ts)

官方 schema 将请求定义为非空 `skillKey` 和可选 `agentId`。响应必须为
`openclaw.skills.skill-card.v1`，含 `skillKey`、`path`、非负 `sizeBytes` 和 `content`。
官方 handler 仅在当前 agent workspace 中找到具备技能卡的已安装技能后读取内容；不存在或
不可读时返回 `INVALID_REQUEST`。方法目录将其标为 `operator.read`。

## 当前实现

- `src/services/openclawSkillsRuntime.ts` 新增 `skillCardCapability()` 与 `skillCard()`。只有
  Gateway 明确未广告 `skills.skillCard` 时才将能力标为不可用；未提供 methods 广告时保持未知，
  允许按官方 RPC 真实请求，绝不以版本号推断支持情况。
- 响应解码要求固定 schema、请求对应的 `skillKey`、非空 `path`、安全整数 `sizeBytes` 与字符串
  `content`。路径仅用于验证官方回包完整性，未进入返回模型、状态或 UI，避免暴露 Gateway
  workspace 的主机信息。
- `src/pages/SkillsPage/index.tsx` 只为当前已安装技能显示查看按钮。请求中的加载、协议错误与
  Gateway 错误在对话框内如实呈现；连接断开时清除已读取内容，不跨 Gateway 会话保留卡片缓存。
  页面以本地请求代次拒绝关闭、断线或后续选择之后才返回的旧回包，避免陈旧内容覆盖当前卡片。
- `src/pages/SkillsPage/components.tsx` 复用现有 Radix Dialog、主题 token、键盘 Escape、焦点
  管理与关闭语义。卡片内容放入转义的 `pre` 文本节点，不解析 Markdown 或 HTML，不执行内容中的
  链接、脚本或样式。

## 跨平台边界

此功能经过 Gateway WebSocket RPC 获取数据，Tauri WebView 只负责显示纯文本。因此 macOS、
Windows、CentOS 和 Ubuntu 使用相同协议与 UI 路径，不依赖浏览器网页、系统文件路径或本地
技能运行时。各目标系统的 Gateway 配对、权限授权、窗口缩放和长卡片滚动仍需真机验证。

## 验证结果

- `openclawSkillsRuntime.test.ts` 覆盖严格卡片 envelope 解码、skillKey 回包一致性、只读 RPC
  参数与明确未广告时不发送请求。
- 技能页已有 Gateway 边界回归确认页面只通过共享 `openClawSkillsRuntime` 访问能力，未使用
  WebView adapter、直接 Gateway 调用或浏览器 HTTP。
- `pnpm exec tsc --noEmit`、技能页与语音定向回归 30 项、`pnpm lint`、`pnpm test`、
  `pnpm verify:openclaw-docs`、`pnpm collab:test` 与 `pnpm collab:validate` 通过。
- `OPENCLAW_BIN=/Users/wei/.npm-global/bin/openclaw pnpm build` 完成，没有产生 provider catalog
  或协作资源差异。该本机 CLI 仅用于构建复现，不作为客户端能力开关。
- `git diff --check`、locale JSON 解析和修改文件 Emoji 扫描通过。

## 未验证边界

- 当前未连接真实 Gateway，尚未验证 `operator.read` 授权、缺少卡片、不可读卡片、远程 agent
  workspace 或实际大内容返回。
- 尚未在 macOS、Windows、CentOS、Ubuntu 的打包 Tauri 应用验证 methods 广告、错误呈现、
  Escape 焦点恢复及长内容滚动。
- `skills.bins` 为 node scope，技能提案和 curator 方法另有状态与管理员权限契约；本次未接入，
  不将其伪装为技能卡能力。

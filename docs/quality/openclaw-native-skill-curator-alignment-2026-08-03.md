# OpenClaw 原生技能生命周期对齐

日期：2026-08-03

## 审计结论

OpenClaw Skill Workshop 会对由自动捕获创建的 workspace 技能维护生命周期状态，并提供
`skills.curator.status` 的只读 Gateway 视图。JunQi 先前只显示安装状态和 ClawHub 安全判定，
无法呈现 Gateway 已知的 active、stale、archived、pinned、使用次数及重叠建议。

本次将该状态投影到“我的技能”列表。JunQi 只显示 Gateway 返回且与 `skills.status.skillKey`
精确匹配的生命周期条目；没有条目的安装技能保持未知。它不运行 curator sweep，不猜测状态，
不变更任意技能文件或 Gateway 生命周期。

## 权威依据

- [OpenClaw Skill Workshop 文档](https://github.com/openclaw/openclaw/blob/main/docs/tools/skill-workshop.md)
- [OpenClaw 技能协议 schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/agents-models-skills.ts)
- [OpenClaw 技能 Gateway handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/skills.ts)
- [OpenClaw Gateway 方法权限目录](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)
- [OpenClaw curator 源码](https://github.com/openclaw/openclaw/blob/main/src/skills/workshop/curator.ts)

官方 schema 要求 `skills.curator.status` 返回最近执行与成功时间、错误、active/stale/archived
计数、完整技能 lifecycle entries 和 overlap candidates。方法目录将 status 标为 `operator.read`；
`pin`、`unpin` 和 `restore` 是独立 `operator.admin` 写操作。

## 当前实现

- `src/services/openclawSkillsRuntime.ts` 为 curator status 增加 capability 查询、严格 decoder 和
  普通 Gateway 读取。响应必须包含所有官方字段和合法状态；畸形嵌套条目、错误数值或未知状态
  会整体拒绝，不生成部分本地结论。
- 已安装列表同时读取 `skills.status`、`skills.securityVerdicts` 和 curator status。curator
  method 被 Gateway 明确不广告时不发请求；广告未知时才按官方 RPC 请求，并如实呈现失败。
- 页面只按完全相等的 `skillKey` 将状态、固定标记与使用次数关联到技能行。汇总区显示 Gateway
  原始计数和重叠候选数量；Gateway 的 `lastError` 与 RPC 失败分别作为非阻断状态显示。
- 没有接入 `skills.curator.pin`、`skills.curator.unpin`、`skills.curator.restore`，也没有接入
  proposals 的 create、revise、evaluate、apply、reject 或 quarantine。所有这些操作保留给
  OpenClaw 的明确管理员契约和后续独立审查。

## 跨平台边界

状态由 Gateway 提供，JunQi 仅以 Tauri WebView 展示。因此 macOS、Windows、CentOS 和 Ubuntu
共享同一读取协议，不依赖系统路径、node host 或本地定时任务。目标平台上的 Gateway 配对、
operator.read 授权、长列表和窄窗口显示仍需真机验证。

## 验证结果

- `openclawSkillsRuntime.test.ts` 覆盖完整 status decoder、未知状态和畸形 overlap 拒绝、
  只读调用参数及明确未广告时不发送请求。
- 技能页 Gateway 边界回归继续证明页面未绕过统一 runtime 调用 Gateway、WebView adapter 或
  浏览器 HTTP。
- `pnpm lint`、`pnpm test`、`pnpm verify:openclaw-docs`、`pnpm collab:test`、
  `pnpm collab:validate`、locale JSON 解析、`git diff --check` 和修改文件 Emoji 扫描通过。
- `OPENCLAW_BIN=/Users/wei/.npm-global/bin/openclaw pnpm build` 完成，未产生 provider catalog
  或协作资源差异。该本机 CLI 仅用于构建复现，不作为客户端能力开关。

## 未验证边界

- 当前未连接真实 Gateway，尚未验证自动捕获技能、daily sweep、lastError、overlap candidates、
  operator.read 拒绝和 remote Gateway 的实际组合。
- 尚未在 macOS、Windows、CentOS、Ubuntu 的打包 Tauri 应用验证生命周期标签、窄窗口、
  断线重连及长错误文本。
- `/skill-hub` 是单独的 JunQi 本地目录工具，不是 OpenClaw Skill Workshop；本次没有将二者
  混合或把本地符号链接行为投影为 Gateway curator 结果。

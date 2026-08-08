# OpenClaw 可选渠道配置审计

日期：2026-08-08

## 结论

JunQi 之前在首次引导中完成 Gateway、OpenClaw 配置和模型核验后直接进入完成页，渠道配置没有被呈现为用户可决定的步骤。这会把“官方支持但可选”的配置误表现为“无需配置”，不符合桌面客户端应忠实呈现 OpenClaw 能力的边界。

OpenClaw 官方协议把渠道配置定义为独立的 Wizard 流程：`wizard.start` 支持 `flow: "channels"`，可选接收 `channel`；后续仍使用 `wizard.next`、`wizard.status` 和 `wizard.cancel`。官方 Gateway 负责渠道插件、授权、账号写入和结果，JunQi 只投影结构化步骤和真实结果。

## 证据

- 官方协议 schema：`packages/gateway-protocol/src/schema/wizard.ts` 的 `WizardStartParamsSchema` 定义 `flow` 为 `setup | channels`。
- 官方 Gateway handler：`src/gateway/server-methods/wizard.ts` 将 `flow === "channels"` 路由到渠道配置向导。
- 官方渠道向导：`src/commands/channels/add-wizard.ts` 执行插件选择、授权和账号配置，并在完成结果中返回真实账号信息。
- JunQi 原实现：`src/services/openclawWizard.ts` 的 `start` 只发送本地 `setup` 参数；`useWizardSession` 完成后直接导航到 `ready`，没有渠道决策节点。

## 目标行为

首次引导在模型实时核验通过后进入“消息渠道”节点。用户必须明确选择：

1. “配置渠道”：调用官方 `wizard.start`，参数只包含协议允许的 `flow: "channels"`，由 Gateway 返回后续步骤；
2. “稍后配置”：取消当前官方向导（若已启动），记录用户选择并进入完成页。此选择不创建渠道、账号、路由，也不把渠道标记为已配置。

渠道向导的步骤、授权链接、设备代码、错误、取消、会话失效和最终账号数量均来自官方结构化响应。JunQi 不根据渠道名称、文本内容、超时或空结果推断成功。

## 实现边界

- `OpenClawWizardClient` 统一支持 `setup` 与 `channels` 两种官方 flow，并保留同一套会话生命周期和超时语义。
- `useChannelWizardSession` 只管理渠道向导的本地呈现状态，不写 OpenClaw 配置，不复制模型或渠道业务状态机。
- `WizardScreen` 是核心与渠道共用的官方步骤呈现器，避免两套交互在加载、授权、失败和键盘操作上分叉。
- 首次引导的渠道决定页和完成页使用三套语言资源；状态消息写入安装日志，便于追溯用户选择和官方结果。

## 验证与未验证边界

- 已通过 TypeScript、模块边界、版本一致性检查。
- 已通过 OpenClaw Wizard、渠道 flow、引导状态机、导航和安装回归测试。
- 已通过三份语言 JSON 解析检查。
- 尚未在 macOS、Windows、Linux 真机上完成各渠道插件授权、二维码或设备代码交互；这些行为仍以对应 Gateway 和插件的官方响应为准。
- 尚未以真实 Gateway 端到端验证 `flow: "channels"` 的所有插件分支，正式发布前需补充目标平台验收记录。

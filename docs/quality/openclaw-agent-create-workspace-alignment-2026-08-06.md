# OpenClaw 新建智能体工作区对齐记录

日期：2026-08-06

## 问题

JunQi 的新建智能体向导把工作区视为必填字段，`OpenClawAgentManagement` 也拒绝缺少工作区的请求。
这与 OpenClaw `agents.create` 的可选 `workspace` 契约不一致，导致客户端无法获知默认目录时错误阻止创建。

## 修复

- `GatewayAgentCreatePayload.workspace` 保持可选；Gateway client 仅在非空时发送该字段。
- 独立工作区未输入路径时，AgentHub 允许继续，并说明 Gateway 会解析并初始化目标 Agent 的专属默认工作区。
- “复用默认工作区”仍只在已解析默认路径时可用，避免未知目录造成工作区共享。
- 模型、技能和回退链仍在原生创建成功后按最小 `config.patch` 写入，不改变其现有并发保护。

## 验证

- `AgentManagement.test.ts` 覆盖无工作区创建请求只发送 `name`。
- `gatewayAgentFlow.test.ts` 覆盖无工作区 payload 不包含该字段。
- `AgentSettingsPanel.interaction.test.ts` 防止向导恢复非空工作区门禁。
- 仍需真实 Gateway 及 macOS、Windows、Linux 桌面制品验证默认目录创建与 bootstrap 文件。

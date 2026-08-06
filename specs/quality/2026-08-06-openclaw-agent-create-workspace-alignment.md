# OpenClaw 新建智能体工作区对齐

日期：2026-08-06

## 依据

- 本地官方 OpenClaw 源码提交 `1e3880352e6` 的
  `packages/gateway-protocol/src/schema/agents-models-skills.ts`：`agents.create.workspace`
  为可选字段。
- 同一源码的 `src/agents/agent-create.ts`：省略工作区时，服务端用
  `resolveAgentWorkspaceDir` 为目标 Agent 解析工作区，并先完成 bootstrap，再发布配置。
- `docs/concepts/agent-workspace.md`：非默认 Agent 未显式配置工作区时，使用其专属默认工作区。

## 当前行为与目标

旧版 JunQi 在向导和 Gateway client 两层要求非空工作区，因此在客户端还未获知默认工作区时无法创建 Agent。

目标是只在用户明确选择或输入路径时发送 `workspace`；独立工作区未填写路径时省略字段，让 Gateway
解析并初始化 Agent 专属默认工作区。复用默认工作区仍要求本地已知默认路径，不能把未知路径伪装成共享。

## 验收

- [ ] `agents.create` 可只收到 `{ name }`；
- [ ] 独立工作区没有路径时，向导可继续并明确说明 Gateway 默认解析语义；
- [ ] 复用默认工作区没有可确认路径时不可选择；
- [ ] 显式工作区、模型、技能和回退链既有行为不回退；
- [ ] Gateway client、创建 payload 与 AgentHub 交互回归测试通过。

## 边界

本次不改变 OpenClaw 服务端、身份字段、渠道绑定和认证迁移。真实 Gateway 的工作区创建仍需在 macOS、Windows 和 Linux 桌面制品上验收。

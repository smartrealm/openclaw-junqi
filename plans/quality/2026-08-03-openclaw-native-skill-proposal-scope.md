# OpenClaw 原生技能提案范围对齐计划

日期：2026-08-03

## 范围

- `src/pages/SkillsPage/index.tsx`
- `src/pages/SkillsPage/proposalScope.ts`
- `src/pages/SkillsPage/proposalScope.test.ts`
- `src/services/openclawSkillsRuntime.test.ts`
- 三套 locale、审计、规格与索引

## 实施顺序

1. 核对最新官方 Skill Workshop schema、handler、控制台的 agent scope 选择与 JunQi 现有会话、
   `agents.list` 数据来源。
2. 实现受控 scope 编码、默认参数省略、显式 agent 参数与 in-flight 请求代次隔离。
3. 在只读清单 UI 呈现 selector、加载和错误状态，不增加 proposal 操作。
4. 覆盖 scope 映射、RPC 参数和既有 Gateway 边界；运行完整验证。

## 非目标

- 不接入 proposal inspect、history、events、evaluation 或任一写操作。
- 不允许用户在 JunQi 中输入未经 Gateway 验证的 agent id。
- 不读取或写入 workspace 路径、proposal 文件、本地 SkillHub 或系统凭据。

## 执行结果

1. 已确认官方 list/inspect 的可选 `agentId` 共用 Gateway workspace resolver，官方控制台为同一
   scope 连续调用 list 和 inspect。
2. 已完成受控 selector 与请求代次隔离；默认 scope 和显式 agent scope 均保持原生 RPC 语义。
3. 最终验证和提交结果将在本次记录中按实际命令补充。

# Agent canonical main session projection

日期：2026-08-03

## 依据

- 本机 OpenClaw `2026.7.1-2 (0790d9f)` 官方文档：每个 Agent 的 direct-chat main
  session 使用 `agent:<agentId>:main`；session id 和 transcript 生命周期仍由 Gateway
  管理。
- JunQi 当前 AgentHub 将所有非 cron/subagent session 都标记为 `main`，并从排序后的列表
  取一条作为 main session。这会让普通渠道会话冒充主会话。

## 目标行为

1. `agent:<agentId>:main` 才能被 AgentHub/ChatTabs 视为 canonical main session。
2. 普通渠道、group、fork 和其他会话保持 `conversation` 分类，不改变其 Gateway key、id 或
   transcript。
3. AgentHub 的 main card 只从指定 Agent 的 canonical key 选择，不依赖列表顺序。
4. 不新增本地 Domain Agent、Thread 或 transcript 数据库；OpenClaw session identity 仍是
   唯一运行时权威。

## 验收条件

- `agent:main:telegram:dm:42` 不再被分类为 main。
- `agent:main:main` 与 `agent:writer:main` 分别被识别为对应 Agent 的 main session。
- 即使普通会话排在 canonical main 前面，AgentHub 仍选择 `agent:main:main`。
- ChatTabs 对所有 Agent 的 canonical main 保持不可拖拽/关闭语义。

## 未验证边界

- 未连接真实多 Agent Gateway 做 UI 手工验收；自动化只验证纯投影函数和静态调用链。
- OpenClaw 运行时仍可能因 reset 产生新的 `sessionId`；本改动不改变 JunQi 已有的
  session identity transition 和 transcript fence。

# OpenClaw 原生技能提案范围对齐规格

日期：2026-08-03

## 问题

Skill Workshop proposal 是 agent workspace scoped，而 JunQi 清单此前只能隐式使用 Gateway 默认
scope。用户无法区分默认、当前会话或另一个已知 agent 的 workspace，异步响应也可能在 scope
切换后覆盖新数据。

## 目标

让用户从官方 Gateway 身份来源选择 proposal agent scope，并将该 id 一致传给
`skills.proposals.list`，同时保证旧 scope 响应不会污染当前视图。

## 契约与约束

1. 合法 scope 只可为 Gateway 默认、当前 session snapshot 的非空 `agentId`，或已解析
   `agents.list` 条目的非空 id。
2. 默认 scope 必须省略 `agentId`；显式 scope 必须 trim 后以 `agentId` 传给原生 list RPC。
3. 不得接受任意手工输入、推导 workspace 路径、从 session key 解析 id，或将本地 `/skill-hub`
   目录当作 agent scope。
4. 连接断开、方法明确未广告或有效 scope 变化时，必须废弃在途请求并清除旧清单、错误和加载状态。
5. 本项只读取 `skills.proposals.list`。不得借 scope 选择接入 inspect、history、events 或任何
   `operator.admin` proposal 操作。

## 验收条件

1. UI 明确标注 Gateway 默认、当前 session agent 和 Gateway 已知 agents 的 scope 来源。
2. 显式 agent scope 的 RPC 仅包含其 trim 后 `agentId`；默认 scope RPC 没有该字段。
3. scope 映射和 RPC 参数拥有行为级回归，未知或空 scope 不会形成参数。
4. 切换 scope 后旧请求回包不能写入当前清单。
5. 类型、测试、locale JSON、官方文档链接、diff 和 Emoji 扫描通过；目标平台与真实 Gateway
   验收仍按实际记录报告。
